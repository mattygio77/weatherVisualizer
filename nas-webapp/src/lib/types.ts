export type UnitSystem = 'imperial' | 'metric';

export interface WeatherReading {
  timestamp: number;
  temp_f: number;
  feels_like_f: number;
  feels_like_type: 'Actual' | 'Wind Chill' | 'Heat Index';
  dew_point_f: number;
  comfort_level: string;
  humidity: number;
  rain_delta_in: number;
  rain_rate_in_hr: number;
  rain_today_in?: number;
  storm_rain_in?: number;
  rain_24h_in?: number;
  wind_speed_mph: number;
  wind_sustained_mph?: number;
  wind_gust_mph?: number;
  wind_lull_mph?: number;
  wind_dir_deg: number | null;
  wind_cardinal?: string;
  barom_in_hg?: number | null;
  battery_ok: number;
  source: string;
}

export function formatTemp(tempF: number | undefined | null, unit: UnitSystem): string {
  if (tempF === undefined || tempF === null || isNaN(tempF)) return '--';
  if (unit === 'metric') {
    const c = (tempF - 32) * (5 / 9);
    return `${c.toFixed(1)}°C`;
  }
  return `${tempF.toFixed(1)}°F`;
}

export function formatSpeed(mph: number | undefined | null, unit: UnitSystem): string {
  if (mph === undefined || mph === null || isNaN(mph)) return '--';
  if (unit === 'metric') {
    const kmh = mph * 1.60934;
    return `${kmh.toFixed(1)} km/h`;
  }
  return `${mph.toFixed(1)} mph`;
}

export function formatRain(inches: number | undefined | null, unit: UnitSystem): string {
  if (inches === undefined || inches === null || isNaN(inches)) return '--';
  if (unit === 'metric') {
    const mm = inches * 25.4;
    return `${mm.toFixed(1)} mm`;
  }
  return `${inches.toFixed(2)} in`;
}

export function formatRainRate(inHr: number | undefined | null, unit: UnitSystem): string {
  if (inHr === undefined || inHr === null || isNaN(inHr)) return '--';
  if (unit === 'metric') {
    const mmHr = inHr * 25.4;
    return `${mmHr.toFixed(1)} mm/h`;
  }
  return `${inHr.toFixed(2)} in/h`;
}

export function formatBarometer(inHg: number | undefined | null, unit: UnitSystem): string {
  if (inHg === undefined || inHg === null || isNaN(inHg)) return '--';
  if (unit === 'metric') {
    const hPa = inHg * 33.8639;
    return `${hPa.toFixed(1)} hPa`;
  }
  return `${inHg.toFixed(2)} inHg`;
}
