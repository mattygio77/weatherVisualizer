<script lang="ts">
  import { formatRain, formatRainRate, type UnitSystem, type WeatherReading } from '$lib/types';

  export let reading: WeatherReading | null = null;
  export let unit: UnitSystem = 'imperial';
  export let rain24h: number = 0;
  export let monthTotal: number = 0;
  export let yearTotal: number = 0;

  function getRainIntensity(rateInHr: number): { label: string; color: string } {
    if (rateInHr <= 0) return { label: 'Dry', color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700' };
    if (rateInHr < 0.10) return { label: 'Light Rain', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' };
    if (rateInHr < 0.30) return { label: 'Moderate Rain', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' };
    return { label: 'Heavy Downpour', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' };
  }

  $: intensity = getRainIntensity(reading?.rain_rate_in_hr || 0);
</script>

<div class="relative overflow-hidden rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm transition-colors flex flex-col justify-between">
  <!-- Top: Card Label & Intensity Badge -->
  <div class="flex items-start justify-between mb-4">
    <div>
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Rainfall &amp; Rate
      </span>
      <div class="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 mt-0.5">
        Live Rate: <strong class="text-slate-700 dark:text-slate-200">{formatRainRate(reading?.rain_rate_in_hr, unit)}</strong>
      </div>
    </div>

    <!-- Active Rain Intensity Badge -->
    <div class="px-2.5 py-1 rounded-full text-xs font-mono font-medium border {intensity.color}">
      {intensity.label}
    </div>
  </div>

  <!-- Middle: Hero Today's Rain Display -->
  <div class="my-3">
    <div class="flex items-baseline gap-2">
      <span class="text-5xl sm:text-6xl font-bold font-mono tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
        {formatRain(reading?.rain_today_in, unit)}
      </span>
      <span class="text-xs font-mono text-slate-400 uppercase tracking-wider">
        Today
      </span>
    </div>
  </div>

  <!-- Bottom: 4-Cell Accumulation Grid -->
  <div class="grid grid-cols-4 gap-2 pt-4 border-t border-slate-100 dark:border-slate-800/80 z-10 text-center sm:text-left">
    <!-- Storm Total -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Storm
      </span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {formatRain(reading?.storm_rain_in, unit)}
      </span>
    </div>

    <!-- 24 Hours -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        24 Hours
      </span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {formatRain(rain24h, unit)}
      </span>
    </div>

    <!-- Month to Date -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Month
      </span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {formatRain(monthTotal, unit)}
      </span>
    </div>

    <!-- Year to Date -->
    <div class="flex flex-col">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Year
      </span>
      <span class="text-xs sm:text-sm font-semibold font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
        {formatRain(yearTotal, unit)}
      </span>
    </div>
  </div>
</div>
