#!/usr/bin/env node
/**
 * pi-relay / AcuRite 5-in-1 Relay Service
 *
 * Responsibilities:
 * 1. Listen for rtl_433 syslog UDP packets (port 1514) and HTTP POSTs (port 3001)
 * 2. Strictly validate AcuRite 5-in-1 model and sensor ID (drops noise/default packets)
 * 3. Deduplicate 3x packet bursts from AcuRite 5-in-1 sensor
 * 4. Merge alternating message_type 49 (wind/rain) and 56 (wind/temp/humidity)
 * 5. Track per-sensor staleness (drops stale readings if msg 56 drops out)
 * 6. Forward normalized weather JSON to nas-webapp (POST /api/ingest)
 * 7. Expose GET /spool and GET /health on port 3001
 */

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Configuration from Environment
const SYSLOG_PORT = parseInt(process.env.SYSLOG_PORT || '1514', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3001', 10);
const NAS_INGEST_URL = process.env.NAS_INGEST_URL || 'http://weather-web:3000/api/ingest';
const INGEST_API_KEY = process.env.INGEST_API_KEY || 'replace_with_long_random_secret';
const SPOOL_FILE = process.env.SPOOL_FILE || '/dev/shm/weather_spool.json';
const SPOOL_MAX_HOURS = parseFloat(process.env.SPOOL_MAX_HOURS || '6');
const DEBUG = process.env.DEBUG !== 'false'; // Enabled by default

// Statistics
const stats = {
  startedAt: new Date().toISOString(),
  packetsReceived: 0,
  packetsDeduplicated: 0,
  packetsMerged: 0,
  forwardSuccess: 0,
  forwardErrors: 0,
  latestObservation: null
};

// In-Memory Deduplication Cache: signature -> expire timestamp (ms)
const dedupCache = new Map();
const DEDUP_TTL_MS = 4000; // 4 seconds window to drop identical 3x burst repeats

// In-Memory Sensor State (sensor_id -> state)
const sensorStates = new Map();

// In-Memory Spool: array of unified observations
let spool = [];

try {
  if (fs.existsSync(SPOOL_FILE)) {
    const raw = fs.readFileSync(SPOOL_FILE, 'utf-8');
    spool = JSON.parse(raw);
    console.log(`[pi-relay] Recovered ${spool.length} spooled readings from ${SPOOL_FILE}`);
  }
} catch (e) {
  console.warn(`[pi-relay] Note: Could not read existing spool file: ${e.message}`);
}

function saveSpool() {
  try {
    const dir = path.dirname(SPOOL_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cutoff = Date.now() - (SPOOL_MAX_HOURS * 3600 * 1000);
    spool = spool.filter(item => (item.timestamp * 1000) >= cutoff);
    fs.writeFileSync(SPOOL_FILE, JSON.stringify(spool), 'utf-8');
  } catch (e) {
    // Non-fatal if /dev/shm write fails
  }
}

// Periodically clean up dedup cache and prune spool
setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of dedupCache.entries()) {
    if (now >= expires) {
      dedupCache.delete(key);
    }
  }
  saveSpool();
}, 30000);

/**
 * Normalizes temperature to Fahrenheit
 */
function normalizeTempF(data) {
  if (data.temperature_F !== undefined && data.temperature_F !== null) {
    return parseFloat(data.temperature_F);
  }
  if (data.temperature_C !== undefined && data.temperature_C !== null) {
    return Math.round(((parseFloat(data.temperature_C) * 9 / 5) + 32) * 10) / 10;
  }
  return null;
}

/**
 * Normalizes wind speed to MPH
 */
function normalizeWindSpeedMph(data) {
  if (data.wind_speed_mph !== undefined && data.wind_speed_mph !== null) {
    return parseFloat(data.wind_speed_mph);
  }
  if (data.wind_avg_mi_h !== undefined && data.wind_avg_mi_h !== null) {
    return parseFloat(data.wind_avg_mi_h);
  }
  if (data.wind_avg_km_h !== undefined && data.wind_avg_km_h !== null) {
    return Math.round(parseFloat(data.wind_avg_km_h) * 0.621371 * 10) / 10;
  }
  if (data.wind_avg_m_s !== undefined && data.wind_avg_m_s !== null) {
    return Math.round(parseFloat(data.wind_avg_m_s) * 2.23694 * 10) / 10;
  }
  return null;
}

/**
 * Normalizes rain counter to inches
 */
function normalizeRainIn(data) {
  if (data.rain_in !== undefined && data.rain_in !== null) {
    return parseFloat(data.rain_in);
  }
  if (data.rain_mm !== undefined && data.rain_mm !== null) {
    return Math.round((parseFloat(data.rain_mm) / 25.4) * 100) / 100;
  }
  return null;
}

/**
 * Forward normalized observation payload to nas-webapp
 */
function forwardToNas(observation) {
  const payload = JSON.stringify(observation);
  const target = new url.URL(NAS_INGEST_URL);

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: target.pathname + target.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-Ingest-Key': INGEST_API_KEY
    },
    timeout: 4000
  };

  const req = http.request(options, (res) => {
    let resBody = '';
    res.on('data', chunk => { resBody += chunk; });
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        stats.forwardSuccess++;
        if (DEBUG) console.log(`[pi-relay] [FORWARD] Sensor ${observation.sensor_id} -> HTTP ${res.statusCode} (${observation.temp_f}°F, ${observation.humidity}%, ${observation.wind_speed_mph}mph)`);
      } else {
        stats.forwardErrors++;
        console.warn(`[pi-relay] [FORWARD_WARN] HTTP ${res.statusCode}: ${resBody.trim()}`);
      }
    });
  });

  req.on('error', (err) => {
    stats.forwardErrors++;
    console.error(`[pi-relay] [FORWARD_ERR] ${err.message}`);
  });

  req.on('timeout', () => {
    req.destroy();
    stats.forwardErrors++;
  });

  req.write(payload);
  req.end();
}

/**
 * Process a single decoded rtl_433 JSON packet
 */
function processPacket(pkt) {
  stats.packetsReceived++;

  const model = String(pkt.model || '').toLowerCase();
  // Filter strictly for AcuRite 5-in-1 sensors; reject anything else or missing model
  const isAcurite = model.includes('acurite') || model.includes('5n1') || model.includes('5-in-1') || model.includes('vn1tx');
  if (!isAcurite) {
    if (DEBUG && model) console.log(`[pi-relay] [DROP] Ignored non-AcuRite device: ${model}`);
    return;
  }

  // Reject packets without valid sensor ID
  const sensorId = pkt.id || pkt.sensor_id;
  if (!sensorId) {
    return;
  }

  const channel = pkt.channel || 'A';
  const msgType = pkt.message_type !== undefined ? pkt.message_type : (pkt.subtype || 0);
  const seqNum = pkt.sequence_num !== undefined ? pkt.sequence_num : 0;
  const batteryOk = pkt.battery_ok !== undefined ? (pkt.battery_ok ? 1 : 0) : 1;

  // Compute signature for burst deduplication
  const sig = `${sensorId}:${channel}:${msgType}:${pkt.temperature_C || pkt.temperature_F || ''}:${pkt.rain_in || pkt.rain_mm || ''}:${pkt.wind_avg_km_h || pkt.wind_speed_mph || ''}`;
  if (dedupCache.has(sig)) {
    stats.packetsDeduplicated++;
    if (DEBUG) console.log(`[pi-relay] [DEDUP] Sensor ${sensorId} duplicate burst (msgType ${msgType})`);
    return;
  }
  dedupCache.set(sig, Date.now() + DEDUP_TTL_MS);

  // Retrieve or create sensor state
  let state = sensorStates.get(sensorId);
  if (!state) {
    state = {
      sensor_id: sensorId,
      channel,
      battery_ok: batteryOk,
      temp_f: null,
      humidity: null,
      wind_speed_mph: null,
      wind_dir_deg: null,
      rain_in: null,
      last_temp_update: 0,
      last_wind_update: 0,
      last_update: 0
    };
    sensorStates.set(sensorId, state);
  }

  state.battery_ok = batteryOk;
  state.channel = channel;

  const nowMs = Date.now();
  const windMph = normalizeWindSpeedMph(pkt);
  if (windMph !== null) {
    state.wind_speed_mph = windMph;
  }

  if (DEBUG) console.log(`[pi-relay] [RX] Msg ${msgType} from Sensor ${sensorId} [Ch ${channel}]: temp=${pkt.temperature_F ?? pkt.temperature_C ?? "--"}°F, wind=${windMph ?? "--"}mph, rain=${pkt.rain_in ?? pkt.rain_mm ?? "--"}in`);

  // AcuRite Message Type 49 (0x31): Wind Speed, Wind Direction, Rain Counter
  if (msgType === 49 || msgType === 0x31) {
    state.last_wind_update = nowMs;
    if (pkt.wind_dir_deg !== undefined && pkt.wind_dir_deg !== null) {
      state.wind_dir_deg = parseFloat(pkt.wind_dir_deg);
    }
    const rainIn = normalizeRainIn(pkt);
    if (rainIn !== null) {
      state.rain_in = rainIn;
    }
  }

  // AcuRite Message Type 56 (0x38): Wind Speed, Temperature, Humidity
  if (msgType === 56 || msgType === 0x38) {
    const tempF = normalizeTempF(pkt);
    if (tempF !== null) {
      state.temp_f = tempF;
      state.last_temp_update = nowMs;
    }
    if (pkt.humidity !== undefined && pkt.humidity !== null) {
      state.humidity = parseInt(pkt.humidity, 10);
    }
  }

  // Generic or combined message
  if (msgType !== 49 && msgType !== 56) {
    const tempF = normalizeTempF(pkt);
    if (tempF !== null) {
      state.temp_f = tempF;
      state.last_temp_update = nowMs;
    }
    if (pkt.humidity !== undefined && pkt.humidity !== null) state.humidity = parseInt(pkt.humidity, 10);
    if (pkt.wind_dir_deg !== undefined && pkt.wind_dir_deg !== null) {
      state.wind_dir_deg = parseFloat(pkt.wind_dir_deg);
      state.last_wind_update = nowMs;
    }
    const rainIn = normalizeRainIn(pkt);
    if (rainIn !== null) state.rain_in = rainIn;
  }

  state.last_update = Math.floor(nowMs / 1000);
  stats.packetsMerged++;

  // Watchdog: If no fresh temperature message in > 3 minutes (180s), invalidate temperature so we never freeze
  if (nowMs - state.last_temp_update > 180000) {
    if (state.temp_f !== null) console.warn(`[pi-relay] [WATCHDOG] Stale temp (>180s) on sensor ${sensorId}, setting to null`);
    state.temp_f = null;
  }

  // Watchdog: If no fresh wind message in > 3 minutes (180s), invalidate wind
  if (nowMs - state.last_wind_update > 180000) {
    state.wind_dir_deg = null;
  }

  // Never forward an observation if temperature is missing
  if (state.temp_f === null) {
    return;
  }

  // Build unified observation
  const observation = {
    timestamp: state.last_update,
    source: 'rtl_433',
    sensor_id: state.sensor_id,
    channel: state.channel,
    battery_ok: state.battery_ok,
    temp_f: state.temp_f,
    humidity: state.humidity,
    wind_speed_mph: state.wind_speed_mph,
    wind_dir_deg: state.wind_dir_deg,
    rain_in: state.rain_in
  };

  stats.latestObservation = observation;

  spool.push(observation);
  if (spool.length > 5000) {
    spool.shift();
  }

  forwardToNas(observation);
}

/**
 * Handle incoming syslog UDP packets
 */
function handleSyslogMessage(msg) {
  const str = msg.toString('utf-8');
  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return;
  }
  const jsonStr = str.substring(firstBrace, lastBrace + 1);
  try {
    const pkt = JSON.parse(jsonStr);
    processPacket(pkt);
  } catch (e) {
    // Malformed JSON frame
  }
}

// ---------------------------------------------------------------------------
// Start Syslog UDP Listener
// ---------------------------------------------------------------------------
const udpServer = dgram.createSocket('udp4');

udpServer.on('message', (msg) => {
  handleSyslogMessage(msg);
});

udpServer.on('error', (err) => {
  console.error(`[pi-relay] UDP Error: ${err.message}`);
});

udpServer.bind(SYSLOG_PORT, '0.0.0.0', () => {
  console.log(`[pi-relay] Listening for rtl_433 syslog on UDP 0.0.0.0:${SYSLOG_PORT}`);
});

// ---------------------------------------------------------------------------
// Start HTTP Server
// ---------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'GET' && (parsed.pathname === '/health' || parsed.pathname === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      stats,
      spool_size: spool.length,
      nas_ingest_url: NAS_INGEST_URL
    }, null, 2));
    return;
  }

  if (req.method === 'GET' && parsed.pathname === '/spool') {
    const hours = parseFloat(parsed.query.hours || '6');
    const cutoff = Math.floor(Date.now() / 1000) - Math.floor(hours * 3600);
    const filtered = spool.filter(item => item.timestamp >= cutoff);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(filtered));
    return;
  }

  if (req.method === 'POST' && (parsed.pathname === '/packet' || parsed.pathname === '/ingest')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsedBody = JSON.parse(body);
        if (Array.isArray(parsedBody)) {
          parsedBody.forEach(processPacket);
        } else {
          processPacket(parsedBody);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', merged: stats.packetsMerged }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[pi-relay] HTTP API listening on http://0.0.0.0:${HTTP_PORT} (/health, /spool, /packet)`);
});

process.on('SIGTERM', () => {
  saveSpool();
  udpServer.close();
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  saveSpool();
  udpServer.close();
  httpServer.close(() => process.exit(0));
});
