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
</script>

<div class="rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm transition-colors flex flex-col justify-between">
  <!-- Top: Card Label -->
  <div class="flex items-center justify-between mb-3">
    <div>
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Wind Rose &amp; Compass
      </span>
      <div class="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 mt-0.5">
        Direction: <strong class="text-slate-700 dark:text-slate-200">
          {isOnline ? (reading?.wind_cardinal || 'CALM') : 'OFFLINE'} {isOnline && reading?.wind_dir_deg !== null ? `(${Math.round(reading?.wind_dir_deg || 0)}°)` : ''}
        </strong>
      </div>
    </div>

    <div class="px-2.5 py-1 rounded-full text-xs font-mono font-medium {isOnline ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}">
      {isOnline ? formatSpeed(reading?.wind_speed_mph, unit) : '--'}
    </div>
  </div>

  <!-- Center: Minimalist Polar Compass Rose -->
  <div class="my-2 flex items-center justify-center">
    <div class="relative w-44 h-44 sm:w-48 sm:h-48">
      <svg class="w-full h-full" viewBox="0 0 200 200">
        <!-- Outer Track Ring -->
        <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" stroke-width="1" class="text-slate-200 dark:text-slate-800" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="currentColor" stroke-width="0.75" stroke-dasharray="2 4" class="text-slate-200 dark:text-slate-800" />
        <circle cx="100" cy="100" r="30" fill="none" stroke="currentColor" stroke-width="0.75" class="text-slate-200 dark:text-slate-800" />

        <!-- 16 Compass Spokes & Cardinal Labels -->
        {#each directions as dir}
          {@const rad = (dir.deg - 90) * (Math.PI / 180)}
          {@const x1 = 100 + 82 * Math.cos(rad)}
          {@const y1 = 100 + 82 * Math.sin(rad)}
          {@const x2 = 100 + 90 * Math.cos(rad)}
          {@const y2 = 100 + 90 * Math.sin(rad)}
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" stroke-width={dir.deg % 90 === 0 ? '2' : '1'} class="text-slate-300 dark:text-slate-700" />
        {/each}

        <!-- Primary Cardinal Markers (N, E, S, W) -->
        <text x="100" y="24" text-anchor="middle" font-size="11" font-weight="700" font-family="monospace" class="fill-red-500">N</text>
        <text x="180" y="104" text-anchor="middle" font-size="10" font-weight="600" font-family="monospace" class="fill-slate-400 dark:fill-slate-500">E</text>
        <text x="100" y="184" text-anchor="middle" font-size="10" font-weight="600" font-family="monospace" class="fill-slate-400 dark:fill-slate-500">S</text>
        <text x="20" y="104" text-anchor="middle" font-size="10" font-weight="600" font-family="monospace" class="fill-slate-400 dark:fill-slate-500">W</text>

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

  <!-- Bottom: 4 Wind Stats Sub-grid -->
  <div class="grid grid-cols-4 gap-2 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-center">
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">Current</span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline ? formatSpeed(reading?.wind_speed_mph, unit) : '--'}
      </span>
    </div>
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">Sustained (2m)</span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline ? formatSpeed(reading?.wind_sustained_mph, unit) : '--'}
      </span>
    </div>
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">Gust (10m)</span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline ? formatSpeed(reading?.wind_gust_mph, unit) : '--'}
      </span>
    </div>
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">Lull (10m)</span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline ? formatSpeed(reading?.wind_lull_mph, unit) : '--'}
      </span>
    </div>
  </div>
</div>
