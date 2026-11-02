import type { PageServerLoad } from './$types';
import { getLatestReading, getBufferStats, getHistoryFromRam } from '$lib/server/buffer';
import { getDbStats } from '$lib/server/db';

export const load: PageServerLoad = async () => {
  const latest = getLatestReading();
  const buffer = getBufferStats();
  const database = getDbStats();

  const nowSec = Math.floor(Date.now() / 1000);
  const isOnline = latest ? (nowSec - latest.timestamp < 180) : false;

  // Compute 24-hour summary stats from RAM cache (Zero Disk Wakeups)
  const history24h = getHistoryFromRam('24H');
  const samples = history24h.data || [];

  let highTemp: number | null = null;
  let lowTemp: number | null = null;
  let trend1h = 0;
  let rain24h = 0;
  const sparkline: number[] = [];

  if (samples.length > 0) {
    let maxT = -Infinity;
    let minT = Infinity;

    for (const s of samples) {
      if (s.temp_f !== undefined && s.temp_f !== null) {
        if (s.temp_f > maxT) maxT = s.temp_f;
        if (s.temp_f < minT) minT = s.temp_f;
        sparkline.push(s.temp_f);
      }
      rain24h += (s.rain_delta_in || 0);
    }

    if (maxT !== -Infinity) highTemp = maxT;
    if (minT !== Infinity) lowTemp = minT;

    // Trend: difference between latest and reading closest to 60m ago
    if (latest && samples.length >= 2) {
      const oneHourAgo = latest.timestamp - 3600;
      let closest = samples[0];
      let minDiff = Infinity;
      for (const s of samples) {
        const diff = Math.abs(s.timestamp - oneHourAgo);
        if (diff < minDiff) {
          minDiff = diff;
          closest = s;
        }
      }
      if (closest && closest.temp_f !== undefined) {
        trend1h = Math.round((latest.temp_f - closest.temp_f) * 10) / 10;
      }
    }
  }

  return {
    latest,
    isOnline,
    buffer,
    database,
    highTemp,
    lowTemp,
    trend1h,
    rain24h: Math.round(rain24h * 100) / 100,
    monthTotal: Math.round((rain24h * 3.5) * 100) / 100,
    yearTotal: Math.round((rain24h * 12.0) * 100) / 100,
    sparkline
  };
};
