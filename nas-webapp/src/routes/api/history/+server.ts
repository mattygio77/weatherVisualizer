import { json, type RequestHandler } from '@sveltejs/kit';
import { getHistoryFromRam } from '$lib/server/buffer';
import { queryHistoryDb } from '$lib/server/db';

export const GET: RequestHandler = ({ url }) => {
  const timeframe = url.searchParams.get('timeframe') || '24H';
  const now = Math.floor(Date.now() / 1000);

  // 1H, 6H, and 24H are served 100% from RAM to avoid hard drive spin-ups
  if (timeframe === '1H' || timeframe === '6H' || timeframe === '24H') {
    const result = getHistoryFromRam(timeframe);
    return json({
      timeframe,
      resolution: result.resolution,
      source: 'ram_buffer',
      data: result.data
    });
  }

  // 7D, 30D, 1Y or Custom: query SQLite database rollups
  let fromTs = now - 7 * 24 * 3600;
  let toTs = now;

  if (timeframe === '7D') {
    fromTs = now - 7 * 24 * 3600;
  } else if (timeframe === '30D') {
    fromTs = now - 30 * 24 * 3600;
  } else if (timeframe === '1Y') {
    fromTs = now - 365 * 24 * 3600;
  } else if (timeframe === 'custom') {
    fromTs = parseInt(url.searchParams.get('from') || String(now - 86400), 10);
    toTs = parseInt(url.searchParams.get('to') || String(now), 10);
  }

  const result = queryHistoryDb(timeframe, fromTs, toTs);

  return json({
    timeframe,
    resolution: result.resolution,
    source: 'sqlite_wal',
    data: result.data
  });
};
