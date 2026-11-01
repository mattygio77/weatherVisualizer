import crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || 'weather_secret_key_nas_1234567890abcdef';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptTracker {
  count: number;
  lockedUntil: number;
}

const ipAttempts = new Map<string, AttemptTracker>();

export function isIpLocked(ip: string): boolean {
  const tracker = ipAttempts.get(ip);
  if (!tracker) return false;
  if (Date.now() < tracker.lockedUntil) {
    return true;
  }
  if (Date.now() >= tracker.lockedUntil && tracker.count >= MAX_FAILED_ATTEMPTS) {
    ipAttempts.delete(ip);
  }
  return false;
}

export function verifyPin(pin: string, ip: string): { success: boolean; error?: string } {
  const targetPin = (process.env.DASHBOARD_PIN || '123456').trim();
  const inputPin = (pin || '').trim();

  if (isIpLocked(ip)) {
    return { success: false, error: 'Too many incorrect attempts. Please try again in 15 minutes.' };
  }

  if (inputPin === targetPin) {
    ipAttempts.delete(ip);
    return { success: true };
  }

  // Increment failure
  const tracker = ipAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  tracker.count++;
  if (tracker.count >= MAX_FAILED_ATTEMPTS) {
    tracker.lockedUntil = Date.now() + LOCKOUT_MS;
    ipAttempts.set(ip, tracker);
    return { success: false, error: 'Too many incorrect attempts. Account locked for 15 minutes.' };
  }

  ipAttempts.set(ip, tracker);
  const remaining = MAX_FAILED_ATTEMPTS - tracker.count;
  return { success: false, error: `Incorrect PIN. ${remaining} attempts remaining.` };
}

export function createSessionToken(): string {
  const expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000; // 90 days
  const data = `authenticated:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return `${Buffer.from(data).toString('base64url')}.${hmac}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const [dataB64, signature] = token.split('.');
    if (!dataB64 || !signature) return false;

    const data = Buffer.from(dataB64, 'base64url').toString('utf-8');
    const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedHmac))) {
      return false;
    }

    const [prefix, expiresStr] = data.split(':');
    if (prefix !== 'authenticated') return false;

    const expiresAt = parseInt(expiresStr, 10);
    return Date.now() < expiresAt;
  } catch {
    return false;
  }
}
