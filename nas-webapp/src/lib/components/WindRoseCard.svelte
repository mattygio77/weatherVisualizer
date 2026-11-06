<script lang="ts">
  import { formatSpeed, type UnitSystem, type WeatherReading } from '$lib/types';

  export let reading: WeatherReading | null = null;
  export let unit: UnitSystem = 'imperial';
  export let isOnline: boolean = true;

  const directions = [
    { label: 'N', deg: 0 },
    { label: 'NNE', deg: 22.5 },
    { label: 'NE', deg: 45 },
    { label: 'ENE', deg: 67.5 },
    { label: 'E', deg: 90 },
    { label: 'ESE', deg: 112.5 },
    { label: 'SE', deg: 135 },
    { label: 'SSE', deg: 157.5 },
    { label: 'S', deg: 180 },
    { label: 'SSW', deg: 202.5 },
    { label: 'SW', deg: 225 },
    { label: 'WSW', deg: 247.5 },
    { label: 'W', deg: 270 },
    { label: 'WNW', deg: 292.5 },
    { label: 'NW', deg: 315 },
    { label: 'NNW', deg: 337.5 }
  ];

  $: activeDirDeg = isOnline ? (reading?.wind_dir_deg ?? 0) : 0;
  $: speedUnitLabel = unit === 'metric' ? 'km/h' : 'mph';

  function formatSpeedValue(mph: number | undefined | null): string {
    if (mph === undefined || mph === null || isNaN(mph)) return '--';
    if (unit === 'metric') return (mph * 1.60934).toFixed(1);
    return mph.toFixed(1);
  }

  function getWindCondition(mph: number | undefined | null): { label: string; color: string } {
    if (!isOnline) return { label: 'Offline', color: 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700' };
    if (mph === undefined || mph === null || mph < 1) return { label: 'Calm', color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700' };
    if (mph <= 7) return { label: 'Light Breeze', color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' };
    if (mph <= 18) return { label: 'Moderate Breeze', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
    if (mph <= 28) return { label: 'Strong Breeze', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
    return { label: 'High Wind', color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' };
  }

  $: condition = getWindCondition(reading?.wind_speed_mph);
</script>

<div class="rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm transition-colors flex flex-col justify-between h-full flex-1">
  <!-- Top: Card Label & State in Upper Left (No Duplicate Peak Gust) -->
  <div class="flex items-start justify-between mb-4">
    <div>
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Wind &amp; Direction
      </span>
      <div class="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 mt-0.5">
        Condition: <strong class="text-teal-600 dark:text-teal-400 font-bold">{condition.label}</strong>
      </div>
    </div>

    <!-- Direction Badge in Upper Right -->
    <div class="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
      {isOnline ? (reading?.wind_cardinal || 'CALM') : 'OFFLINE'} {isOnline && reading?.wind_dir_deg !== null && reading?.wind_dir_deg !== undefined ? `(${Math.round(reading.wind_dir_deg)}°)` : ''}
    </div>
  </div>

  <!-- Middle: Hero Wind Speed + Quick Stat Cards + Compact Compass Rose (Responsive on all screen sizes) -->
  <div class="my-auto py-2 flex items-center justify-between gap-2 sm:gap-4">
    <!-- Left: Hero Wind Speed -->
    <div class="flex flex-col min-w-[95px] sm:min-w-[130px]">
      <span class="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold">
        Live Speed
      </span>
      <div class="flex items-baseline gap-1 sm:gap-1.5 mt-0.5">
        <span class="text-3xl sm:text-5xl lg:text-6xl font-bold font-mono tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
          {isOnline ? formatSpeedValue(reading?.wind_speed_mph) : '--'}
        </span>
        <span class="text-[10px] sm:text-xs font-mono text-slate-400 uppercase tracking-wider font-semibold">
          {speedUnitLabel}
        </span>
      </div>
      <div class="text-[11px] sm:text-xs font-mono font-medium text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1 sm:gap-1.5">
        <span>From</span>
        <strong class="text-slate-700 dark:text-slate-200">
          {isOnline ? (reading?.wind_cardinal || 'CALM') : 'OFFLINE'}
        </strong>
        {#if isOnline && reading?.wind_dir_deg !== null && reading?.wind_dir_deg !== undefined}
          <span class="text-slate-400 font-mono">({Math.round(reading.wind_dir_deg)}°)</span>
        {/if}
      </div>
    </div>

    <!-- Center: Two Balanced Stat Cards (Visible on mobile & desktop) -->
    <div class="grid grid-cols-2 gap-1.5 sm:gap-2 flex-1 max-w-[220px]">
      <!-- Sustained (2m) -->
      <div class="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-left">
        <span class="text-[8px] sm:text-[9px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
          Sustained
        </span>
        <div class="text-xs sm:text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100 mt-0.5">
          {isOnline ? formatSpeed(reading?.wind_sustained_mph, unit) : '--'}
        </div>
        <span class="text-[9px] sm:text-[10px] text-slate-400 font-mono">2-min avg</span>
      </div>

      <!-- Peak Gust (10m) -->
      <div class="p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-left">
        <span class="text-[8px] sm:text-[9px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
          Peak Gust
        </span>
        <div class="text-xs sm:text-sm font-bold font-mono tabular-nums text-purple-600 dark:text-purple-400 mt-0.5">
          {isOnline ? formatSpeed(reading?.wind_gust_mph, unit) : '--'}
        </div>
        <span class="text-[9px] sm:text-[10px] text-slate-400 font-mono">10-min max</span>
      </div>
    </div>

    <!-- Right: Sleek Compact Compass Rose -->
    <div class="relative w-20 h-20 sm:w-28 sm:h-28 flex-shrink-0 flex items-center justify-center">
      <svg class="w-full h-full" viewBox="0 0 200 200">
        <!-- Outer Track Ring -->
        <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" stroke-width="1" class="text-slate-200 dark:text-slate-800" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="currentColor" stroke-width="0.75" stroke-dasharray="2 4" class="text-slate-200 dark:text-slate-800" />

        <!-- 16 Compass Spokes -->
        {#each directions as dir}
          {@const rad = (dir.deg - 90) * (Math.PI / 180)}
          {@const x1 = 100 + 82 * Math.cos(rad)}
          {@const y1 = 100 + 82 * Math.sin(rad)}
          {@const x2 = 100 + 90 * Math.cos(rad)}
          {@const y2 = 100 + 90 * Math.sin(rad)}
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" stroke-width={dir.deg % 90 === 0 ? '2' : '1'} class="text-slate-300 dark:text-slate-700" />
        {/each}

        <!-- Primary Cardinal Markers (N, E, S, W) -->
        <text x="100" y="24" text-anchor="middle" font-size="12" font-weight="700" font-family="monospace" class="fill-red-500">N</text>
        <text x="180" y="104" text-anchor="middle" font-size="11" font-weight="600" font-family="monospace" class="fill-slate-400 dark:fill-slate-500">E</text>
        <text x="100" y="184" text-anchor="middle" font-size="11" font-weight="600" font-family="monospace" class="fill-slate-400 dark:fill-slate-500">S</text>
        <text x="20" y="104" text-anchor="middle" font-size="11" font-weight="600" font-family="monospace" class="fill-slate-400 dark:fill-slate-500">W</text>

        <!-- Dynamic Rotating Compass Needle -->
        <g transform="rotate({activeDirDeg}, 100, 100)" class="transition-transform duration-500 ease-out">
          <!-- North Tip (Accent) -->
          <polygon points="100,28 94,95 106,95" fill={isOnline ? '#EF4444' : '#94A3B8'} />
          <!-- South Tip (Neutral) -->
          <polygon points="100,165 95,105 105,105" fill="#94A3B8" />
          <!-- Center Pivot Hub -->
          <circle cx="100" cy="100" r="6" fill="#0F172A" class="dark:fill-slate-100" />
          <circle cx="100" cy="100" r="2.5" fill="#FFFFFF" class="dark:fill-slate-900" />
        </g>
      </svg>
    </div>
  </div>

  <!-- Bottom: 3 Non-redundant Sub-metric Columns (No duplicate state or peak gust) -->
  <div class="grid grid-cols-3 gap-2 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-center sm:text-left min-h-[58px] items-center">
    <!-- 10m Lull -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        10m Lull
      </span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline ? formatSpeed(reading?.wind_lull_mph, unit) : '--'}
      </span>
    </div>

    <!-- Direction Details -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Compass Heading
      </span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline && reading?.wind_dir_deg !== null && reading?.wind_dir_deg !== undefined ? `${Math.round(reading.wind_dir_deg)}° ${reading?.wind_cardinal || ''}` : (isOnline ? 'CALM' : 'OFFLINE')}
      </span>
    </div>

    <!-- Gust Spread -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        10m Range
      </span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline ? `${formatSpeed(reading?.wind_lull_mph, unit)} – ${formatSpeed(reading?.wind_gust_mph, unit)}` : '--'}
      </span>
    </div>
  </div>
</div>
