import {
  calcFeelsLikeF,
  calcDewPointF,
  getComfortBadge,
  degToCardinal,
  processRainTelemetry,
  processWindTelemetry,
  type WeatherReading
} from '$lib/server/meteorology';
import { updateRainAndPush, getLatestReading } from '$lib/server/buffer';
import { broadcastTelemetry } from '$lib/server/sse';
import type { RequestHandler } from '@sveltejs/kit';

async function handleWeatherUndergroundIntercept(url: URL, request: Request): Promise<Response> {
  const params: Record<string, string> = {};

  // Extract from query params
  for (const [k, v] of url.searchParams.entries()) {
    params[k.toLowerCase()] = v;
  }

  // Also extract from POST body if present
  if (request.method === 'POST') {
    try {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData();
        for (const [k, v] of formData.entries()) {
          params[k.toLowerCase()] = v.toString();
        }
      }
    } catch {}
  }

  // Verify telemetry presence
  if (params.tempf || params.windspeedmph || params.humidity) {
    const ts = Math.floor(Date.now() / 1000);
    const latest = getLatestReading();
    const tempF = params.tempf ? parseFloat(params.tempf) : (latest?.temp_f ?? 0);
    const humidity = parseInt(params.humidity || '50', 10);
    const windMph = parseFloat(params.windspeedmph || '0.0');
    const windDir = params.winddir ? parseFloat(params.winddir) : null;
    const rawRainIn = params.rainin ? parseFloat(params.rainin) : null;
    const rawDailyRainIn = params.dailyrainin ? parseFloat(params.dailyrainin) : null;
    const baromInHg = params.baromin ? parseFloat(params.baromin) : null;

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
      battery_ok: 1,
      source: 'wifi_intercept'
    };

    updateRainAndPush(reading, rawRainIn ?? rawDailyRainIn);
    broadcastTelemetry(reading);
  }

  // AcuRite 06101M Wi-Fi display strictly requires exact 'success\n' response
  return new Response('success\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': '8'
    }
  });
}

export const GET: RequestHandler = async ({ url, request }) => {
  return handleWeatherUndergroundIntercept(url, request);
};

export const POST: RequestHandler = async ({ url, request }) => {
  return handleWeatherUndergroundIntercept(url, request);
};
