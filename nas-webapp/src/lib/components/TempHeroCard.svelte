<script lang="ts">
  import { formatTemp, type UnitSystem, type WeatherReading } from '$lib/types';

  export let reading: WeatherReading | null = null;
  export let unit: UnitSystem = 'imperial';
  export let trend1h: number = 0;
  export let highTemp: number | null = null;
  export let lowTemp: number | null = null;
  export let sparkline: number[] = [];
  export let isOnline: boolean = true;

  function formatTrend(t: number): string {
    if (Math.abs(t) < 0.1) return 'Steady';
    const sign = t > 0 ? '+' : '';
    return `${t > 0 ? '↑' : '↓'} ${sign}${t.toFixed(1)}°/hr`;
  }

  // Generate SVG path for 24-hour background sparkline
  $: sparkPath = (() => {
    if (!sparkline || sparkline.length < 2) return '';
    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min || 1;
    const width = 300;
    const height = 48;
    const pts = sparkline.map((val, i) => {
      const x = (i / (sparkline.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M ${pts.join(' L ')}`;
  })();
</script>

<div class="relative overflow-hidden rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm transition-colors flex flex-col justify-between">
  <!-- Top: Card Label & Today's High/Low -->
  <div class="flex items-start justify-between mb-4">
    <div>
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Outdoor Temperature
      </span>
      <div class="flex items-center gap-2 mt-0.5">
        <span class="text-xs font-mono font-medium text-slate-500 dark:text-slate-400">
          High: <strong class="text-slate-700 dark:text-slate-200">{formatTemp(highTemp, unit)}</strong>
        </span>
        <span class="text-slate-300 dark:text-slate-700">·</span>
        <span class="text-xs font-mono font-medium text-slate-500 dark:text-slate-400">
          Low: <strong class="text-slate-700 dark:text-slate-200">{formatTemp(lowTemp, unit)}</strong>
        </span>
      </div>
    </div>

    <!-- 1-Hour Trend / Status Pill -->
    <div class="px-2.5 py-1 rounded-full text-xs font-mono font-medium border {!isOnline
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      : trend1h > 0
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      : trend1h < 0
      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'}">
      {isOnline ? formatTrend(trend1h) : 'No Signal'}
    </div>
  </div>

  <!-- Middle: Hero Temperature Display -->
  <div class="my-3">
    <div class="flex items-baseline gap-2">
      {#if isOnline && reading?.temp_f !== undefined && reading?.temp_f !== null}
        <span class="text-5xl sm:text-6xl font-bold font-mono tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
          {formatTemp(reading.temp_f, unit)}
        </span>
      {:else}
        <span class="text-5xl sm:text-6xl font-bold font-mono tracking-tight tabular-nums text-slate-400 dark:text-slate-600">
          --
        </span>
        <span class="text-xs font-mono text-amber-500 font-medium">Awaiting Data</span>
      {/if}

      {#if reading?.battery_ok === 0}
        <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
          LOW BATT
        </span>
      {/if}
    </div>
  </div>

  <!-- Bottom: 3 Sub-Metric Blocks -->
  <div class="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/80 z-10">
    <!-- Feels Like -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        {reading?.feels_like_type || 'Feels Like'}
      </span>
      <span class="text-base sm:text-lg font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline ? formatTemp(reading?.feels_like_f, unit) : '--'}
      </span>
    </div>

    <!-- Dew Point -->
    <div class="flex flex-col">
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
          Dew Point
        </span>
      </div>
      <div class="flex items-baseline gap-1.5 mt-0.5">
        <span class="text-base sm:text-lg font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200">
          {isOnline ? formatTemp(reading?.dew_point_f, unit) : '--'}
        </span>
      </div>
      {#if isOnline && reading?.comfort_level}
        <span class="text-[10px] font-medium text-blue-600 dark:text-blue-400">
          {reading.comfort_level}
        </span>
      {/if}
    </div>

    <!-- Humidity -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Humidity
      </span>
      <span class="text-base sm:text-lg font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {isOnline && reading?.humidity !== undefined ? `${reading.humidity}%` : '--'}
      </span>
      <!-- Relative humidity progress bar -->
      <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 mt-1.5 overflow-hidden">
        <div
          class="bg-blue-500 h-full rounded-full transition-all duration-300"
          style="width: {isOnline ? (reading?.humidity || 0) : 0}%"
        ></div>
      </div>
    </div>
  </div>

  <!-- Background 24h Sparkline along bottom -->
  {#if sparkPath}
    <div class="absolute bottom-0 left-0 right-0 h-12 pointer-events-none opacity-20 dark:opacity-30">
      <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 300 48">
        <path d={sparkPath} fill="none" stroke="currentColor" stroke-width="2" class="text-blue-600 dark:text-blue-400" />
      </svg>
    </div>
  {/if}
</div>
