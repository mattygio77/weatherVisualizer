import type { PageServerLoad } from './$types';
import { getLatestReading, getBufferStats, getHistoryFromRam, getRamDbStats, getRamRainTotals } from '$lib/server/buffer';

export const load: PageServerLoad = async () => {
  const latest = getLatestReading();
  const buffer = getBufferStats();
  const database = getRamDbStats(); // 100% RAM: Zero disk reads on page loads
  const rainTotals = getRamRainTotals(); // 100% RAM: Zero disk reads on page loads

  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const isOnline = latest ? (nowSec - latest.timestamp < 180) : false;

  // Compute 24-hour summary stats from RAM cache (Zero Disk Wakeups)
  const history24h = getHistoryFromRam('24H');
  const samples = history24h.data || [];

  let highTemp: number | null = null;
  let lowTemp: number | null = null;
  let trend1h = 0;
  const sparkline: number[] = [];

  // Local calendar midnight for today
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const startOfDaySec = Math.floor(startOfDay.getTime() / 1000);

  if (samples.length > 0) {
    let maxToday = -Infinity;
    let minToday = Infinity;

    for (const s of samples) {
      if (s.temp_f !== undefined && s.temp_f !== null) {
        sparkline.push(s.temp_f);
        // Calendar-day high and low (midnight to midnight)
        if (s.timestamp >= startOfDaySec) {
          if (s.temp_f > maxToday) maxToday = s.temp_f;
          if (s.temp_f < minToday) minToday = s.temp_f;
        }
      }
    }

    if (maxToday !== -Infinity) highTemp = maxToday;
    else if (latest) highTemp = latest.temp_f;

    if (minToday !== Infinity) lowTemp = minToday;
    else if (latest) lowTemp = latest.temp_f;

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
    rainToday: rainTotals.rainToday,
    rain24h: rainTotals.rain24h,
    monthTotal: rainTotals.monthTotal,
    yearTotal: rainTotals.yearTotal,
    sparkline
  };
};
