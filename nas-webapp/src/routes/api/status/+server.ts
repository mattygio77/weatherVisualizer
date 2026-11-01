import { json, type RequestHandler } from '@sveltejs/kit';
import { getBufferStats, getLatestReading } from '$lib/server/buffer';
import { getDbStats } from '$lib/server/db';

export const GET: RequestHandler = () => {
  const bufferStats = getBufferStats();
  const dbStats = getDbStats();
  const latest = getLatestReading();

  return json({
    status: 'healthy',
    timestamp: Math.floor(Date.now() / 1000),
    latest_reading: latest,
    buffer: bufferStats,
    database: dbStats
  });
};
