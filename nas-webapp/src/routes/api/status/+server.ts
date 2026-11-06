import { json, type RequestHandler } from '@sveltejs/kit';
import { getBufferStats, getLatestReading, getRamDbStats } from '$lib/server/buffer';

export const GET: RequestHandler = () => {
  const bufferStats = getBufferStats();
  const dbStats = getRamDbStats(); // Served 100% from RAM to prevent disk wakeups
  const latest = getLatestReading();

  return json({
    status: 'healthy',
    timestamp: Math.floor(Date.now() / 1000),
    latest_reading: latest,
    buffer: bufferStats,
    database: dbStats
  });
};
