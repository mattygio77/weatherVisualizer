import { addSseClient, removeSseClient } from '$lib/server/sse';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = () => {
  let clientId = '';

  const stream = new ReadableStream({
    start(controller) {
      clientId = addSseClient(controller);
    },
    cancel() {
      if (clientId) {
        removeSseClient(clientId);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
};
