import { insertBatchReadings, getDb } from './db';
import type { WeatherReading } from './meteorology';

const FLUSH_INTERVAL_HOURS = parseFloat(process.env.FLUSH_INTERVAL_HOURS || '3');
const FLUSH_INTERVAL_MS = FLUSH_INTERVAL_HOURS * 3600 * 1000;

// RAM Ring-Buffer: collected since last SQLite flush
let unflushedQueue: WeatherReading[] = [];

// Sliding 24-Hour Cache in RAM (serves Live, 1H, 6H, 24H with ZERO disk wakeups)
let recentCache24h: WeatherReading[] = [];

let lastFlushTimestamp = Math.floor(Date.now() / 1000);
let flushTimer: NodeJS.Timeout | null = null;

// Initialize 24-hour RAM cache from SQLite at container startup
export function initBuffer() {
  try {
    const db = getDb();
    const cutoff24h = Math.floor(Date.now() / 1000) - 24 * 3600;
    const rows = db.prepare(`
      SELECT timestamp, temp_f, feels_like_f, dew_point_f, humidity,
             rain_delta_in, rain_rate_in_hr, wind_speed_mph, wind_dir_deg,
             barom_in_hg, battery_ok, source
      FROM readings_raw
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `).all(cutoff24h) as any[];

    if (rows && rows.length > 0) {
      recentCache24h = rows.map(r => ({
        ...r,
        feels_like_type: 'Actual',
        comfort_level: 'Comfortable'
      }));
      console.log(`[RAM-Buffer] Seeded 24-hour RAM cache with ${recentCache24h.length} readings from SQLite.`);
    }
  } catch (err: any) {
    console.warn(`[RAM-Buffer] Cache initialization note: ${err.message}`);
  }

  // Schedule periodic batch flush every FLUSH_INTERVAL_HOURS
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      console.log(`[RAM-Buffer] Periodic ${FLUSH_INTERVAL_HOURS}-hour timer triggered.`);
      flushBufferToDisk();
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Pushes a new reading into the RAM ring buffer and sliding 24h cache
 */
export function pushReading(reading: WeatherReading) {
  unflushedQueue.push(reading);
  recentCache24h.push(reading);

  // Prune 24h cache to keep exactly 24 hours in RAM
  const cutoff24h = Math.floor(Date.now() / 1000) - 24 * 3600;
  while (recentCache24h.length > 0 && recentCache24h[0].timestamp < cutoff24h) {
    recentCache24h.shift();
  }
}

export function getLatestReading(): WeatherReading | null {
  if (recentCache24h.length > 0) {
    return recentCache24h[recentCache24h.length - 1];
  }
  return null;
}

/**
 * Serves 1H, 6H, and 24H queries 100% from RAM with zero disk wakeups
 */
export function getHistoryFromRam(timeframe: string): { resolution: string; data: any[] } {
  const now = Math.floor(Date.now() / 1000);

  if (timeframe === '1H') {
    const cutoff = now - 3600;
    const data = recentCache24h.filter(r => r.timestamp >= cutoff);
    return { resolution: 'raw', data };
  }

  if (timeframe === '6H') {
    const cutoff = now - 6 * 3600;
    const raw6h = recentCache24h.filter(r => r.timestamp >= cutoff);
    // Bucket into 1-minute averages (60s)
    const data = bucketReadings(raw6h, 60);
    return { resolution: '1m', data };
  }

  if (timeframe === '24H') {
    const cutoff = now - 24 * 3600;
    const raw24h = recentCache24h.filter(r => r.timestamp >= cutoff);
    // Bucket into 5-minute averages (300s)
    const data = bucketReadings(raw24h, 300);
    return { resolution: '5m', data };
  }

  return { resolution: 'raw', data: recentCache24h };
}

function bucketReadings(items: WeatherReading[], bucketSeconds: number) {
  if (items.length === 0) return [];

  const buckets = new Map<number, WeatherReading[]>();
  for (const item of items) {
    const bTs = Math.floor(item.timestamp / bucketSeconds) * bucketSeconds;
    if (!buckets.has(bTs)) buckets.set(bTs, []);
    buckets.get(bTs)!.push(item);
  }

  const result: any[] = [];
  for (const [ts, group] of buckets.entries()) {
    const n = group.length;
    let tempSum = 0, tempMin = Infinity, tempMax = -Infinity;
    let feelsSum = 0, dewSum = 0, humSum = 0;
    let rainSum = 0, rainRateMax = 0;
    let windSum = 0, windGust = 0, windLull = Infinity;
    let sinSum = 0, cosSum = 0;
    let baromSum = 0, baromCount = 0;

    for (const g of group) {
      tempSum += g.temp_f;
      if (g.temp_f < tempMin) tempMin = g.temp_f;
      if (g.temp_f > tempMax) tempMax = g.temp_f;

      feelsSum += g.feels_like_f;
      dewSum += g.dew_point_f;
      humSum += g.humidity;

      rainSum += (g.rain_delta_in || 0);
      if ((g.rain_rate_in_hr || 0) > rainRateMax) rainRateMax = g.rain_rate_in_hr || 0;

      windSum += g.wind_speed_mph;
      if (g.wind_speed_mph > windGust) windGust = g.wind_speed_mph;
      if (g.wind_speed_mph < windLull) windLull = g.wind_speed_mph;

      if (g.wind_dir_deg !== null && !isNaN(g.wind_dir_deg)) {
        const rad = (g.wind_dir_deg * Math.PI) / 180;
        sinSum += Math.sin(rad);
        cosSum += Math.cos(rad);
      }

      if (g.barom_in_hg !== null && g.barom_in_hg !== undefined) {
        baromSum += g.barom_in_hg;
        baromCount++;
      }
    }

    let dominantDir: number | null = null;
    if (sinSum !== 0 || cosSum !== 0) {
      let deg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      dominantDir = Math.round(deg);
    }

    result.push({
      timestamp: ts,
      temp_f: Math.round((tempSum / n) * 10) / 10,
      temp_min: Math.round(tempMin * 10) / 10,
      temp_max: Math.round(tempMax * 10) / 10,
      feels_like_f: Math.round((feelsSum / n) * 10) / 10,
      dew_point_f: Math.round((dewSum / n) * 10) / 10,
      humidity: Math.round(humSum / n),
      rain_delta_in: Math.round(rainSum * 100) / 100,
      rain_rate_in_hr: Math.round(rainRateMax * 100) / 100,
      wind_speed_mph: Math.round((windSum / n) * 10) / 10,
      wind_gust_mph: Math.round(windGust * 10) / 10,
      wind_lull_mph: windLull === Infinity ? 0 : Math.round(windLull * 10) / 10,
      wind_dir_deg: dominantDir,
      barom_in_hg: baromCount > 0 ? Math.round((baromSum / baromCount) * 100) / 100 : null
    });
  }

  return result.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Flushes all pending in-memory readings to SQLite WAL
 */
export function flushBufferToDisk(): { flushedCount: number; timestamp: number } {
  const count = unflushedQueue.length;
  if (count === 0) {
    lastFlushTimestamp = Math.floor(Date.now() / 1000);
    return { flushedCount: 0, timestamp: lastFlushTimestamp };
  }

  console.log(`[RAM-Buffer] Flushing ${count} readings to SQLite WAL database...`);
  const batch = [...unflushedQueue];
  unflushedQueue = [];

  try {
    insertBatchReadings(batch);
    lastFlushTimestamp = Math.floor(Date.now() / 1000);
    console.log(`[RAM-Buffer] Successfully flushed ${count} readings to disk.`);
    return { flushedCount: count, timestamp: lastFlushTimestamp };
  } catch (err: any) {
    console.error(`[RAM-Buffer] Failed to flush batch to SQLite: ${err.message}`);
    // Restore batch to queue so data isn't lost
    unflushedQueue = [...batch, ...unflushedQueue];
    throw err;
  }
}

export function getBufferStats() {
  const nextFlushSeconds = Math.max(
    0,
    Math.floor((lastFlushTimestamp + FLUSH_INTERVAL_HOURS * 3600) - (Date.now() / 1000))
  );

  return {
    queueLength: unflushedQueue.length,
    cacheLength: recentCache24h.length,
    lastFlushTimestamp,
    nextFlushSeconds,
    flushIntervalHours: FLUSH_INTERVAL_HOURS
  };
}

// Graceful container shutdown: flush all RAM records before exiting
const handleShutdown = (signal: string) => {
  console.log(`[RAM-Buffer] ${signal} received. Executing synchronous batch flush...`);
  try {
    flushBufferToDisk();
  } catch (err: any) {
    console.error(`[RAM-Buffer] Error during shutdown flush: ${err.message}`);
  }
  process.exit(0);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
