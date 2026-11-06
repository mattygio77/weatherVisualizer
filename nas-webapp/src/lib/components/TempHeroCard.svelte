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


  interface ThermalComfort {
    tempLabel: string;
    humidityLabel: string;
    fullLabel: string;
    color: string;
  }

  function getThermalComfort(
    tempF: number | null | undefined,
    rh: number | null | undefined,
    dewF: number | null | undefined,
    feelsF: number | null | undefined
  ): ThermalComfort | null {
    if (tempF === null || tempF === undefined || isNaN(tempF)) return null;

    const t = feelsF ?? tempF;
    const humidity = rh ?? 50;
    const dew = dewF ?? tempF;

    // Temperature adjective
    let tempLabel = 'Comfortable';
    if (t < 32) tempLabel = 'Freezing';
    else if (t < 45) tempLabel = 'Very Cold';
    else if (t < 55) tempLabel = 'Cold';
    else if (t < 65) tempLabel = 'Cool';
    else if (t < 75) tempLabel = 'Comfortable';
    else if (t < 85) tempLabel = 'Warm';
    else if (t < 95) tempLabel = 'Hot';
    else tempLabel = 'Sweltering';

    // Humidity adjective based on dew point and relative humidity
    let humidityLabel = 'Comfortable';
    if (dew < 45 && humidity < 35) humidityLabel = 'Dry';
    else if (dew < 50) humidityLabel = 'Crisp';
    else if (dew <= 60 && humidity <= 60) humidityLabel = 'Pleasant';
    else if (dew > 72 || (t >= 80 && humidity >= 70)) humidityLabel = 'Oppressive';
    else if (dew >= 67 || (t >= 75 && humidity >= 65)) humidityLabel = 'Muggy';
    else if (dew >= 62 || humidity >= 75) humidityLabel = t < 65 ? 'Damp' : 'Humid';
    else if (dew >= 58 || humidity >= 65) humidityLabel = 'Moderate';
    else humidityLabel = 'Comfortable';

    let fullLabel = `${tempLabel} · ${humidityLabel}`;
    if ((tempLabel === 'Comfortable' || tempLabel === 'Mild') && (humidityLabel === 'Comfortable' || humidityLabel === 'Pleasant')) {
      fullLabel = 'Comfortable · Pleasant';
    }

    // Color theme
    let color = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    if (t >= 95 || humidityLabel === 'Oppressive') {
      color = 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';
    } else if (t >= 85 || humidityLabel === 'Muggy') {
      color = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
    } else if (t >= 75) {
      color = 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20';
    } else if (tempLabel === 'Comfortable') {
      color = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    } else if (t < 45) {
      color = 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20';
    }

    return { tempLabel, humidityLabel, fullLabel, color };
  }

  $: comfort = isOnline ? getThermalComfort(reading?.temp_f, reading?.humidity, reading?.dew_point_f, reading?.feels_like_f) : null;

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

<div class="relative overflow-hidden rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm transition-colors flex flex-col justify-between h-full flex-1">
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
        {#if isOnline && comfort}
          <span class="text-slate-300 dark:text-slate-700">·</span>
          <span class="text-xs font-mono font-medium text-slate-600 dark:text-slate-300">
            {comfort.tempLabel} &amp; {comfort.humidityLabel}
          </span>
        {/if}
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
    <div class="flex flex-wrap items-baseline gap-2.5 sm:gap-3">
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

      {#if isOnline && comfort}
        <div class="px-2.5 py-1 rounded-full text-xs font-mono font-medium border {comfort.color} shadow-sm">
          {comfort.fullLabel}
        </div>
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
