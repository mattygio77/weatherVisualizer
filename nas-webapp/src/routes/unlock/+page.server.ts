import { fail, redirect, type Actions } from '@sveltejs/kit';
import { verifyPin, createSessionToken } from '$lib/server/auth';

export const actions: Actions = {
  default: async ({ request, getClientAddress, cookies }) => {
    const data = await request.formData();
    const pin = data.get('pin')?.toString() || '';
    const ip = getClientAddress();

    const result = verifyPin(pin, ip);
    if (!result.success) {
      return fail(400, { error: result.error || 'Incorrect PIN' });
    }

    const sessionToken = createSessionToken();
    cookies.set('weather_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // Allows local LAN HTTP access as well as HTTPS reverse proxy
      maxAge: 90 * 24 * 60 * 60 // 90 days
    });

    throw redirect(303, '/');
  }
};
