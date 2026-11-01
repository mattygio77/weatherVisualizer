/**
 * Meteorological Calculations & Conversions
 * Implements NWS formulas, Magnus-Tetens dew point, Rothfusz heat index,
 * zero-spike rain delta math, and rolling wind metrics.
 */

export interface WeatherReading {
  timestamp: number; // Unix epoch seconds
  temp_f: number;
  feels_like_f: number;
  feels_like_type: 'Actual' | 'Wind Chill' | 'Heat Index';
  dew_point_f: number;
  comfort_level: string;
  humidity: number;
  rain_delta_in: number;
  rain_rate_in_hr: number;
  rain_today_in?: number;
  storm_rain_in?: number;
  rain_24h_in?: number;
  wind_speed_mph: number;
  wind_sustained_mph?: number;
  wind_gust_mph?: number;
  wind_lull_mph?: number;
  wind_dir_deg: number | null;
  wind_cardinal?: string;
  barom_in_hg?: number | null;
  battery_ok: number;
  source: string;
}

export function calcDewPointF(tempF: number, rh: number): number {
  if (rh <= 0) return tempF;
  const tempC = (tempF - 32.0) * (5.0 / 9.0);
  const a = 17.625;
  const b = 243.04;
  const clampedRh = Math.max(1, Math.min(100, rh));
  const gamma = Math.log(clampedRh / 100.0) + (a * tempC) / (b + tempC);
  const dewC = (b * gamma) / (a - gamma);
  return Math.round(((dewC * 9.0) / 5.0 + 32.0) * 10) / 10;
}

export function calcWindChillF(tempF: number, windMph: number): number {
  if (tempF > 50.0 || windMph < 3.0) return tempF;
  const wc =
    35.74 +
    0.6215 * tempF -
    35.75 * Math.pow(windMph, 0.16) +
    0.4275 * tempF * Math.pow(windMph, 0.16);
  return Math.round(wc * 10) / 10;
}

export function calcHeatIndexF(tempF: number, rh: number): number {
  if (tempF < 80.0 || rh < 40.0) return tempF;
  let hi =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * rh -
    0.22475541 * tempF * rh -
    0.00683783 * tempF * tempF -
    0.05481717 * rh * rh +
    0.00122874 * tempF * tempF * rh +
    0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh;

  // Low RH adjustment
  if (rh < 13 && tempF >= 80 && tempF <= 112) {
    const adj = ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17);
    hi -= adj;
  }
  // High RH adjustment
  else if (rh > 85 && tempF >= 80 && tempF <= 87) {
    const adj = ((rh - 85) / 10) * ((87 - tempF) / 5);
    hi += adj;
  }

  return Math.round(hi * 10) / 10;
}

export function calcFeelsLikeF(
  tempF: number,
  rh: number,
  windMph: number
): { feels_f: number; type: 'Actual' | 'Wind Chill' | 'Heat Index' } {
  if (tempF <= 50.0 && windMph >= 3.0) {
    return { feels_f: calcWindChillF(tempF, windMph), type: 'Wind Chill' };
  }
  if (tempF >= 80.0 && rh >= 40.0) {
    return { feels_f: calcHeatIndexF(tempF, rh), type: 'Heat Index' };
  }
  return { feels_f: Math.round(tempF * 10) / 10, type: 'Actual' };
}

export function getComfortBadge(dewPointF: number): string {
  if (dewPointF < 50.0) return 'Crisp';
  if (dewPointF < 60.0) return 'Comfortable';
  if (dewPointF < 65.0) return 'Slightly Humid';
  if (dewPointF < 70.0) return 'Muggy';
  return 'Oppressive';
}

export function degToCardinal(deg: number | null): string {
  if (deg === null || isNaN(deg)) return 'CALM';
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
  ];
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}

// ---------------------------------------------------------------------------
// Stateful Processors: Rain Tracking & Rolling Wind Engine
// ---------------------------------------------------------------------------

interface RainState {
  lastCumulativeIn: number | null;
  lastResetDay: number;
  todaySumIn: number;
  stormSumIn: number;
  lastRainTimestamp: number;
  tipTimestamps: { ts: number; amount: number }[]; // 15-minute sliding window
}

const rainState: RainState = {
  lastCumulativeIn: null,
  lastResetDay: new Date().getDate(),
  todaySumIn: 0,
  stormSumIn: 0,
  lastRainTimestamp: 0,
  tipTimestamps: []
};

/**
 * Computes rain delta and rolling rain rate (in/hr) with zero-spike safety.
 * Handles both dailyrainin (Wi-Fi display midnight resets) and rain_in (cumulative RTL-SDR counter).
 */
export function processRainTelemetry(
  rawRainIn: number | null,
  rawDailyRainIn: number | null,
  timestamp: number
): { deltaIn: number; rateInHr: number; todaySumIn: number; stormSumIn: number } {
  const currentDay = new Date(timestamp * 1000).getDate();
  if (currentDay !== rainState.lastResetDay) {
    rainState.todaySumIn = 0;
    rainState.lastResetDay = currentDay;
  }

  // 12 hours of dry weather resets storm total
  if (timestamp - rainState.lastRainTimestamp > 12 * 3600) {
    rainState.stormSumIn = 0;
  }

  let deltaIn = 0;

  // Case A: Wi-Fi display provided dailyrainin directly
  if (rawDailyRainIn !== null && !isNaN(rawDailyRainIn)) {
    if (rainState.lastCumulativeIn !== null) {
      if (rawDailyRainIn >= rainState.lastCumulativeIn && (rawDailyRainIn - rainState.lastCumulativeIn) < 2.0) {
        deltaIn = Math.round((rawDailyRainIn - rainState.lastCumulativeIn) * 100) / 100;
      } else if (rawDailyRainIn < rainState.lastCumulativeIn) {
        // Midnight reset on display
        deltaIn = rawDailyRainIn <= 0.05 ? rawDailyRainIn : 0;
      }
    }
    rainState.lastCumulativeIn = rawDailyRainIn;
    rainState.todaySumIn = Math.round(rawDailyRainIn * 100) / 100;
  }
  // Case B: RTL-SDR cumulative rain_in counter
  else if (rawRainIn !== null && !isNaN(rawRainIn)) {
    if (rainState.lastCumulativeIn !== null) {
      if (rawRainIn >= rainState.lastCumulativeIn && (rawRainIn - rainState.lastCumulativeIn) < 2.0) {
        deltaIn = Math.round((rawRainIn - rainState.lastCumulativeIn) * 100) / 100;
      } else if (rawRainIn < rainState.lastCumulativeIn) {
        // Battery replacement or counter rollover
        deltaIn = 0;
      }
    }
    rainState.lastCumulativeIn = rawRainIn;
    rainState.todaySumIn = Math.round((rainState.todaySumIn + deltaIn) * 100) / 100;
  }

  if (deltaIn > 0) {
    rainState.lastRainTimestamp = timestamp;
    rainState.stormSumIn = Math.round((rainState.stormSumIn + deltaIn) * 100) / 100;
    rainState.tipTimestamps.push({ ts: timestamp, amount: deltaIn });
  }

  // Prune tips older than 15 minutes (900 seconds)
  const cutoff = timestamp - 900;
  rainState.tipTimestamps = rainState.tipTimestamps.filter(t => t.ts >= cutoff);

  // Compute 15-minute rolling rain rate normalized to 1 hour (sum * 4)
  const windowSum = rainState.tipTimestamps.reduce((acc, t) => acc + t.amount, 0);
  const rateInHr = Math.round(windowSum * 4 * 100) / 100;

  return {
    deltaIn,
    rateInHr,
    todaySumIn: rainState.todaySumIn,
    stormSumIn: rainState.stormSumIn
  };
}

// ---------------------------------------------------------------------------
// Rolling Wind Processor (Sustained, Gust, Lull)
// ---------------------------------------------------------------------------
interface WindSample {
  ts: number;
  speed: number;
  dir: number | null;
}

const windWindow: WindSample[] = [];

export function processWindTelemetry(
  speedMph: number,
  dirDeg: number | null,
  timestamp: number
): { sustainedMph: number; gustMph: number; lullMph: number } {
  windWindow.push({ ts: timestamp, speed: speedMph, dir: dirDeg });

  // Retain up to 10 minutes (600 seconds)
  const cutoff10m = timestamp - 600;
  while (windWindow.length > 0 && windWindow[0].ts < cutoff10m) {
    windWindow.shift();
  }

  // Sustained wind: 2-minute average (120 seconds)
  const cutoff2m = timestamp - 120;
  const samples2m = windWindow.filter(w => w.ts >= cutoff2m);
  const sustainedMph = samples2m.length > 0
    ? Math.round((samples2m.reduce((acc, s) => acc + s.speed, 0) / samples2m.length) * 10) / 10
    : speedMph;

  // Gust & Lull: 10-minute max & min
  let gustMph = speedMph;
  let lullMph = speedMph;
  for (const s of windWindow) {
    if (s.speed > gustMph) gustMph = s.speed;
    if (s.speed < lullMph) lullMph = s.speed;
  }

  return {
    sustainedMph,
    gustMph: Math.round(gustMph * 10) / 10,
    lullMph: Math.round(lullMph * 10) / 10
  };
}
