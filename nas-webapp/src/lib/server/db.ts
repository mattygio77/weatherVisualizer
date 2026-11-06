import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { WeatherReading } from './meteorology';

export interface RollupRecord {
  bucket_ts: number;
  temp_avg: number;
  temp_min: number;
  temp_max: number;
  feels_avg: number;
  feels_min: number;
  feels_max: number;
  dew_avg: number;
  humidity_avg: number;
  rain_sum_in: number;
  rain_rate_max_in_hr: number;
  wind_avg_mph: number;
  wind_gust_mph: number;
  wind_lull_mph: number;
  wind_dir_deg_dominant: number | null;
  barom_avg_in_hg: number | null;
  sample_count: number;
}

// Universal SQLite database wrapper using Node.js built-in DatabaseSync
class DatabaseAdapter {
  private db: DatabaseSync;

  constructor(dbFilePath: string) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbFilePath);

    this.exec('PRAGMA journal_mode = WAL;');
    this.exec('PRAGMA synchronous = NORMAL;');
    this.exec('PRAGMA temp_store = MEMORY;');
  }

  exec(sql: string) {
    return this.db.exec(sql);
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: any[]) => stmt.run(...params),
      all: (...params: any[]) => stmt.all(...params),
      get: (...params: any[]) => {
        const res = stmt.all(...params);
        return res && res.length > 0 ? res[0] : null;
      }
    };
  }
}

const DB_PATH = process.env.DB_PATH || path.resolve('./data/weather.db');
let adapterInstance: DatabaseAdapter | null = null;

export function getDb(): DatabaseAdapter {
  if (!adapterInstance) {
    adapterInstance = new DatabaseAdapter(DB_PATH);
    initSchema(adapterInstance);
  }
  return adapterInstance;
}

function initSchema(db: DatabaseAdapter) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS readings_raw (
      timestamp INTEGER PRIMARY KEY,
      temp_f REAL NOT NULL,
      feels_like_f REAL NOT NULL,
      dew_point_f REAL NOT NULL,
      humidity INTEGER NOT NULL,
      rain_delta_in REAL NOT NULL DEFAULT 0,
      rain_rate_in_hr REAL NOT NULL DEFAULT 0,
      wind_speed_mph REAL NOT NULL,
      wind_dir_deg REAL,
      barom_in_hg REAL,
      battery_ok INTEGER DEFAULT 1,
      source TEXT DEFAULT 'rtl_433'
    );

    CREATE TABLE IF NOT EXISTS readings_5m (
      bucket_ts INTEGER PRIMARY KEY,
      temp_avg REAL,
      temp_min REAL,
      temp_max REAL,
      feels_avg REAL,
      feels_min REAL,
      feels_max REAL,
      dew_avg REAL,
      humidity_avg REAL,
      rain_sum_in REAL,
      rain_rate_max_in_hr REAL,
      wind_avg_mph REAL,
      wind_gust_mph REAL,
      wind_lull_mph REAL,
      wind_dir_deg_dominant REAL,
      barom_avg_in_hg REAL,
      sample_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS readings_1h (
      bucket_ts INTEGER PRIMARY KEY,
      temp_avg REAL,
      temp_min REAL,
      temp_max REAL,
      feels_avg REAL,
      feels_min REAL,
      feels_max REAL,
      dew_avg REAL,
      humidity_avg REAL,
      rain_sum_in REAL,
      rain_rate_max_in_hr REAL,
      wind_avg_mph REAL,
      wind_gust_mph REAL,
      wind_lull_mph REAL,
      wind_dir_deg_dominant REAL,
      barom_avg_in_hg REAL,
      sample_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS station_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_raw_ts ON readings_raw(timestamp);
    CREATE INDEX IF NOT EXISTS idx_5m_ts ON readings_5m(bucket_ts);
    CREATE INDEX IF NOT EXISTS idx_1h_ts ON readings_1h(bucket_ts);
  `);
}

export function getState(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM station_state WHERE key = ?').get(key) as any;
    return row ? String(row.value) : null;
  } catch {
    return null;
  }
}

export function setState(key: string, value: string): void {
  try {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO station_state (key, value) VALUES (?, ?)').run(key, value);
  } catch (err: any) {
    console.error('[DB] setState error:', err.message);
  }
}

/**
 * Inserts a batch of raw readings and updates 5m and 1h rollups
 */
export function insertBatchReadings(readings: WeatherReading[]) {
  if (!readings || readings.length === 0) return;
  const db = getDb();

  db.exec('BEGIN TRANSACTION;');
  try {
    const rawStmt = db.prepare(`
      INSERT OR REPLACE INTO readings_raw (
        timestamp, temp_f, feels_like_f, dew_point_f, humidity,
        rain_delta_in, rain_rate_in_hr, wind_speed_mph, wind_dir_deg,
        barom_in_hg, battery_ok, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of readings) {
      rawStmt.run(
        r.timestamp,
        r.temp_f,
        r.feels_like_f,
        r.dew_point_f,
        r.humidity,
        r.rain_delta_in || 0,
        r.rain_rate_in_hr || 0,
        r.wind_speed_mph || 0,
        r.wind_dir_deg !== undefined ? r.wind_dir_deg : null,
        r.barom_in_hg !== undefined ? r.barom_in_hg : null,
        r.battery_ok !== undefined ? r.battery_ok : 1,
        r.source || 'rtl_433'
      );
    }

    // Compute 5-minute and 1-hour rollups for this batch
    updateRollups(db, readings);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

function updateRollups(db: DatabaseAdapter, readings: WeatherReading[]) {
  const buckets5m = new Map<number, WeatherReading[]>();
  const buckets1h = new Map<number, WeatherReading[]>();

  for (const r of readings) {
    const b5m = Math.floor(r.timestamp / 300) * 300;
    const b1h = Math.floor(r.timestamp / 3600) * 3600;

    if (!buckets5m.has(b5m)) buckets5m.set(b5m, []);
    buckets5m.get(b5m)!.push(r);

    if (!buckets1h.has(b1h)) buckets1h.set(b1h, []);
    buckets1h.get(b1h)!.push(r);
  }

  const upsert5m = db.prepare(`
    INSERT OR REPLACE INTO readings_5m (
      bucket_ts, temp_avg, temp_min, temp_max, feels_avg, feels_min, feels_max,
      dew_avg, humidity_avg, rain_sum_in, rain_rate_max_in_hr, wind_avg_mph,
      wind_gust_mph, wind_lull_mph, wind_dir_deg_dominant, barom_avg_in_hg, sample_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [bucketTs, items] of buckets5m.entries()) {
    const r = calculateAggregation(bucketTs, items);
    upsert5m.run(
      r.bucket_ts, r.temp_avg, r.temp_min, r.temp_max,
      r.feels_avg, r.feels_min, r.feels_max, r.dew_avg,
      r.humidity_avg, r.rain_sum_in, r.rain_rate_max_in_hr,
      r.wind_avg_mph, r.wind_gust_mph, r.wind_lull_mph,
      r.wind_dir_deg_dominant, r.barom_avg_in_hg, r.sample_count
    );
  }

  const upsert1h = db.prepare(`
    INSERT OR REPLACE INTO readings_1h (
      bucket_ts, temp_avg, temp_min, temp_max, feels_avg, feels_min, feels_max,
      dew_avg, humidity_avg, rain_sum_in, rain_rate_max_in_hr, wind_avg_mph,
      wind_gust_mph, wind_lull_mph, wind_dir_deg_dominant, barom_avg_in_hg, sample_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [bucketTs, items] of buckets1h.entries()) {
    const r = calculateAggregation(bucketTs, items);
    upsert1h.run(
      r.bucket_ts, r.temp_avg, r.temp_min, r.temp_max,
      r.feels_avg, r.feels_min, r.feels_max, r.dew_avg,
      r.humidity_avg, r.rain_sum_in, r.rain_rate_max_in_hr,
      r.wind_avg_mph, r.wind_gust_mph, r.wind_lull_mph,
      r.wind_dir_deg_dominant, r.barom_avg_in_hg, r.sample_count
    );
  }
}

function calculateAggregation(bucketTs: number, items: WeatherReading[]): RollupRecord {
  let tempSum = 0, tempMin = Infinity, tempMax = -Infinity;
  let feelsSum = 0, feelsMin = Infinity, feelsMax = -Infinity;
  let dewSum = 0, humSum = 0;
  let rainSum = 0, rainRateMax = 0;
  let windSum = 0, windGust = 0, windLull = Infinity;
  let baromSum = 0, baromCount = 0;

  let sinSum = 0, cosSum = 0;

  for (const item of items) {
    tempSum += item.temp_f;
    if (item.temp_f < tempMin) tempMin = item.temp_f;
    if (item.temp_f > tempMax) tempMax = item.temp_f;

    feelsSum += item.feels_like_f;
    if (item.feels_like_f < feelsMin) feelsMin = item.feels_like_f;
    if (item.feels_like_f > feelsMax) feelsMax = item.feels_like_f;

    dewSum += item.dew_point_f;
    humSum += item.humidity;

    rainSum += (item.rain_delta_in || 0);
    if ((item.rain_rate_in_hr || 0) > rainRateMax) rainRateMax = item.rain_rate_in_hr || 0;

    windSum += item.wind_speed_mph;
    if (item.wind_speed_mph > windGust) windGust = item.wind_speed_mph;
    if (item.wind_speed_mph < windLull) windLull = item.wind_speed_mph;

    if (item.wind_dir_deg !== null && !isNaN(item.wind_dir_deg)) {
      const rad = (item.wind_dir_deg * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
    }

    if (item.barom_in_hg !== null && item.barom_in_hg !== undefined) {
      baromSum += item.barom_in_hg;
      baromCount++;
    }
  }

  const n = items.length;
  let dominantDir: number | null = null;
  if (sinSum !== 0 || cosSum !== 0) {
    let deg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    dominantDir = Math.round(deg);
  }

  return {
    bucket_ts: bucketTs,
    temp_avg: Math.round((tempSum / n) * 10) / 10,
    temp_min: Math.round(tempMin * 10) / 10,
    temp_max: Math.round(tempMax * 10) / 10,
    feels_avg: Math.round((feelsSum / n) * 10) / 10,
    feels_min: Math.round(feelsMin * 10) / 10,
    feels_max: Math.round(feelsMax * 10) / 10,
    dew_avg: Math.round((dewSum / n) * 10) / 10,
    humidity_avg: Math.round(humSum / n),
    rain_sum_in: Math.round(rainSum * 100) / 100,
    rain_rate_max_in_hr: Math.round(rainRateMax * 100) / 100,
    wind_avg_mph: Math.round((windSum / n) * 10) / 10,
    wind_gust_mph: Math.round(windGust * 10) / 10,
    wind_lull_mph: windLull === Infinity ? 0 : Math.round(windLull * 10) / 10,
    wind_dir_deg_dominant: dominantDir,
    barom_avg_in_hg: baromCount > 0 ? Math.round((baromSum / baromCount) * 100) / 100 : null,
    sample_count: n
  };
}

/**
 * Queries historical records from SQLite with automatic decimation
 */
export function queryHistoryDb(timeframe: string, fromTs: number, toTs: number) {
  const db = getDb();

  if (timeframe === '7D') {
    return {
      resolution: '5m',
      data: db.prepare(`
        SELECT bucket_ts as timestamp, temp_avg as temp_f, temp_min, temp_max,
               feels_avg as feels_like_f, dew_avg as dew_point_f, humidity_avg as humidity,
               rain_sum_in as rain_delta_in, rain_rate_max_in_hr as rain_rate_in_hr,
               wind_avg_mph as wind_speed_mph, wind_gust_mph, wind_lull_mph,
               wind_dir_deg_dominant as wind_dir_deg, barom_avg_in_hg as barom_in_hg
        FROM readings_5m
        WHERE bucket_ts >= ? AND bucket_ts <= ?
        ORDER BY bucket_ts ASC
      `).all(fromTs, toTs)
    };
  }

  return {
    resolution: '1h',
    data: db.prepare(`
      SELECT bucket_ts as timestamp, temp_avg as temp_f, temp_min, temp_max,
             feels_avg as feels_like_f, dew_avg as dew_point_f, humidity_avg as humidity,
             rain_sum_in as rain_delta_in, rain_rate_max_in_hr as rain_rate_in_hr,
             wind_avg_mph as wind_speed_mph, wind_gust_mph, wind_lull_mph,
             wind_dir_deg_dominant as wind_dir_deg, barom_avg_in_hg as barom_in_hg
      FROM readings_1h
      WHERE bucket_ts >= ? AND bucket_ts <= ?
      ORDER BY bucket_ts ASC
    `).all(fromTs, toTs)
  };
}

export function getDbStats() {
  const db = getDb();
  let rawCount = 0;
  let roll5mCount = 0;
  let roll1hCount = 0;
  let fileSizeMb = 0;

  try {
    const rawRes = db.prepare('SELECT count(*) as c FROM readings_raw').get() as any;
    if (rawRes) rawCount = rawRes.c || 0;
    const r5mRes = db.prepare('SELECT count(*) as c FROM readings_5m').get() as any;
    if (r5mRes) roll5mCount = r5mRes.c || 0;
    const r1hRes = db.prepare('SELECT count(*) as c FROM readings_1h').get() as any;
    if (r1hRes) roll1hCount = r1hRes.c || 0;

    if (fs.existsSync(DB_PATH)) {
      fileSizeMb = Math.round((fs.statSync(DB_PATH).size / (1024 * 1024)) * 100) / 100;
    }
  } catch {}

  return {
    rawCount,
    roll5mCount,
    roll1hCount,
    fileSizeMb,
    dbPath: DB_PATH
  };
}

/**
 * Computes exact rain totals for 24h, current month-to-date, and current year-to-date
 * from SQLite persisted records plus in-memory unflushed buffer samples.
 */
export function getRainTotals(unflushedBuffer: WeatherReading[] = []): { rainToday: number; rain24h: number; monthTotal: number; yearTotal: number } {
  const db = getDb();
  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const start24hSec = nowSec - 86400;

  // Start of today at local midnight
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const startTodaySec = Math.floor(startToday.getTime() / 1000);

  // Start of current month at local midnight (day 1)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const startOfMonthSec = Math.floor(startOfMonth.getTime() / 1000);

  // Start of current year at local midnight (Jan 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
  const startOfYearSec = Math.floor(startOfYear.getTime() / 1000);

  let rToday = 0;
  let r24h = 0;
  let rMonth = 0;
  let rYear = 0;

  try {
    const qToday = db.prepare('SELECT COALESCE(SUM(rain_delta_in), 0) as total FROM readings_raw WHERE timestamp >= ?').get(startTodaySec) as any;
    if (qToday) rToday = Number(qToday.total) || 0;

    const q24h = db.prepare('SELECT COALESCE(SUM(rain_delta_in), 0) as total FROM readings_raw WHERE timestamp >= ?').get(start24hSec) as any;
    if (q24h) r24h = Number(q24h.total) || 0;

    const qMonth = db.prepare('SELECT COALESCE(SUM(rain_delta_in), 0) as total FROM readings_raw WHERE timestamp >= ?').get(startOfMonthSec) as any;
    if (qMonth) rMonth = Number(qMonth.total) || 0;

    const qYear = db.prepare('SELECT COALESCE(SUM(rain_delta_in), 0) as total FROM readings_raw WHERE timestamp >= ?').get(startOfYearSec) as any;
    if (qYear) rYear = Number(qYear.total) || 0;
  } catch (err: any) {
    console.error('[DB] getRainTotals error:', err.message);
  }

  // Include unflushed buffer readings
  for (const b of unflushedBuffer) {
    const delta = b.rain_delta_in || 0;
    if (delta > 0) {
      if (b.timestamp >= startTodaySec) rToday += delta;
      if (b.timestamp >= start24hSec) r24h += delta;
      if (b.timestamp >= startOfMonthSec) rMonth += delta;
      if (b.timestamp >= startOfYearSec) rYear += delta;
    }
  }

  return {
    rainToday: Math.round(rToday * 100) / 100,
    rain24h: Math.round(r24h * 100) / 100,
    monthTotal: Math.round(rMonth * 100) / 100,
    yearTotal: Math.round(rYear * 100) / 100
  };
}
