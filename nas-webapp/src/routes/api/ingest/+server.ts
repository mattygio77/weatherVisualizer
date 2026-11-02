import { json, type RequestHandler } from '@sveltejs/kit';
import {
  calcFeelsLikeF,
  calcDewPointF,
  getComfortBadge,
  degToCardinal,
  processRainTelemetry,
  processWindTelemetry,
  type WeatherReading
} from '$lib/server/meteorology';
import { pushReading, getLatestReading } from '$lib/server/buffer';
import { broadcastTelemetry } from '$lib/server/sse';

const INGEST_API_KEY = process.env.INGEST_API_KEY || 'replace_with_long_random_secret';

export const POST: RequestHandler = async ({ request }) => {
  const apiKey = request.headers.get('X-Ingest-Key');
  if (apiKey !== INGEST_API_KEY) {
    return json({ error: 'Unauthorized: Invalid X-Ingest-Key' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const ts = body.timestamp || Math.floor(Date.now() / 1000);
  const rawTemp = body.temp_f ?? body.temperature_F ?? body.temp;
  if (rawTemp === null || rawTemp === undefined || isNaN(parseFloat(rawTemp))) {
    return json({ success: false, error: 'No valid temperature provided in telemetry frame' }, { status: 422 });
  }
  const tempF = parseFloat(rawTemp);
  const humidity = parseInt(body.humidity ?? 50, 10);
  const windMph = parseFloat(body.wind_speed_mph ?? body.wind_speed ?? 0.0);
  const windDir = body.wind_dir_deg !== undefined && body.wind_dir_deg !== null ? parseFloat(body.wind_dir_deg) : null;
  const rawRainIn = body.rain_in !== undefined && body.rain_in !== null ? parseFloat(body.rain_in) : null;
  const rawDailyRainIn = body.dailyrainin !== undefined && body.dailyrainin !== null ? parseFloat(body.dailyrainin) : null;
  const baromInHg = body.barom_in_hg !== undefined && body.barom_in_hg !== null ? parseFloat(body.barom_in_hg) : null;
  const batteryOk = body.battery_ok !== undefined ? (body.battery_ok ? 1 : 0) : 1;
  const source = body.source || 'rtl_433';

  // Run meteorological calculations
  const { feels_f, type: feelsType } = calcFeelsLikeF(tempF, humidity, windMph);
  const dewPointF = calcDewPointF(tempF, humidity);
  const comfortBadge = getComfortBadge(dewPointF);
  const windStats = processWindTelemetry(windMph, windDir, ts);
  const rainStats = processRainTelemetry(rawRainIn, rawDailyRainIn, ts);

  const reading: WeatherReading = {
    timestamp: ts,
    temp_f: Math.round(tempF * 10) / 10,
    feels_like_f: feels_f,
    feels_like_type: feelsType,
    dew_point_f: dewPointF,
    comfort_level: comfortBadge,
    humidity,
    rain_delta_in: rainStats.deltaIn,
    rain_rate_in_hr: rainStats.rateInHr,
    rain_today_in: rainStats.todaySumIn,
    storm_rain_in: rainStats.stormSumIn,
    wind_speed_mph: Math.round(windMph * 10) / 10,
    wind_sustained_mph: windStats.sustainedMph,
    wind_gust_mph: windStats.gustMph,
    wind_lull_mph: windStats.lullMph,
    wind_dir_deg: windDir,
    wind_cardinal: degToCardinal(windDir),
    barom_in_hg: baromInHg,
    battery_ok: batteryOk,
    source
  };

  // Push to 3-hour RAM buffer and broadcast to live clients
  pushReading(reading);
  broadcastTelemetry(reading);

  return json({ success: true, reading });
};
