import { redirect, type Handle } from '@sveltejs/kit';
import { verifySessionToken } from '$lib/server/auth';
import { initBuffer } from '$lib/server/buffer';

// Initialize the RAM buffer on server boot
initBuffer();

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  // Public & ingestion routes that do not require browser session cookie
  if (
    path.startsWith('/unlock') ||
    path.startsWith('/api/ingest') ||
    path.startsWith('/weatherstation') ||
    path.startsWith('/_app') ||
    path.startsWith('/favicon')
  ) {
    return resolve(event);
  }

  // Check browser session token
  const token = event.cookies.get('weather_session');
  const isAuthenticated = verifySessionToken(token);

  if (!isAuthenticated) {
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw redirect(303, '/unlock');
  }

  event.locals.authenticated = true;
  return resolve(event);
};
