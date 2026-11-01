import { json, type RequestHandler } from '@sveltejs/kit';
import { flushBufferToDisk } from '$lib/server/buffer';

export const POST: RequestHandler = async () => {
  try {
    const result = flushBufferToDisk();
    return json({
      success: true,
      flushed_count: result.flushedCount,
      timestamp: result.timestamp
    });
  } catch (err: any) {
    return json({ success: false, error: err.message }, { status: 500 });
  }
};
