<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as echarts from 'echarts';
  import type { UnitSystem } from '$lib/types';

  export let unit: UnitSystem = 'imperial';
  export let theme: 'light' | 'dark' = 'dark';

  let chartContainer: HTMLDivElement;
  let chartInstance: echarts.ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;

  let currentTimeframe = '24H';
  let activeResolution = '5m';
  let activeSource = 'ram_buffer';
  let loading = false;

  // Active layer visibility
  let showTemp = true;
  let showFeels = true;
  let showDew = true;
  let showHumidity = false;
  let showRain = true;
  let showRainRate = true;
  let showWind = true;
  let showGusts = true;

  const timeframes = ['1H', '6H', '24H', '7D', '30D', '1Y'];

  async function fetchHistory(tf: string) {
    currentTimeframe = tf;
    loading = true;
    try {
      const res = await fetch(`/api/history?timeframe=${tf}`);
      const json = await res.json();
      activeResolution = json.resolution || 'raw';
      activeSource = json.source || 'ram_buffer';
      updateChart(json.data || []);
    } catch (e) {
      console.error('Failed to fetch history:', e);
    } finally {
      loading = false;
    }
  }

  function convertTemp(f: number) {
    if (unit === 'metric') return Math.round(((f - 32) * (5 / 9)) * 10) / 10;
    return f;
  }

  function convertRain(inches: number) {
    if (unit === 'metric') return Math.round(inches * 25.4 * 10) / 10;
    return inches;
  }

  function convertSpeed(mph: number) {
    if (unit === 'metric') return Math.round(mph * 1.60934 * 10) / 10;
    return mph;
  }

  function updateChart(data: any[]) {
    if (!chartInstance) return;

    const isDark = theme === 'dark';
    const textColor = isDark ? '#94A3B8' : '#64748B';
    const titleColor = isDark ? '#CBD5E1' : '#334155';
    const gridLineColor = isDark ? 'rgba(30, 41, 59, 0.6)' : 'rgba(226, 232, 240, 0.8)';
    const tempUnitLabel = unit === 'metric' ? '°C' : '°F';
    const rainUnitLabel = unit === 'metric' ? 'mm' : 'in';
    const speedUnitLabel = unit === 'metric' ? 'km/h' : 'mph';

    const timestamps: string[] = [];
    const tempData: (number | null)[] = [];
    const feelsData: (number | null)[] = [];
    const dewData: (number | null)[] = [];
    const humidityData: (number | null)[] = [];
    const rainData: (number | null)[] = [];
    const rainRateData: (number | null)[] = [];
    const windData: (number | null)[] = [];
    const gustData: (number | null)[] = [];

    for (const d of data) {
      const date = new Date(d.timestamp * 1000);
      let timeLabel = '';
      if (currentTimeframe === '1H' || currentTimeframe === '6H' || currentTimeframe === '24H') {
        timeLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        timeLabel = `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }

      timestamps.push(timeLabel);
      tempData.push(d.temp_f !== undefined && d.temp_f !== null ? convertTemp(d.temp_f) : null);
      feelsData.push(d.feels_like_f !== undefined && d.feels_like_f !== null ? convertTemp(d.feels_like_f) : null);
      dewData.push(d.dew_point_f !== undefined && d.dew_point_f !== null ? convertTemp(d.dew_point_f) : null);
      humidityData.push(d.humidity !== undefined && d.humidity !== null ? d.humidity : null);
      rainData.push(d.rain_delta_in !== undefined && d.rain_delta_in !== null ? convertRain(d.rain_delta_in) : 0);
      rainRateData.push(d.rain_rate_in_hr !== undefined && d.rain_rate_in_hr !== null ? convertRain(d.rain_rate_in_hr) : 0);
      windData.push(d.wind_speed_mph !== undefined && d.wind_speed_mph !== null ? convertSpeed(d.wind_speed_mph) : null);
      gustData.push(d.wind_gust_mph !== undefined && d.wind_gust_mph !== null ? convertSpeed(d.wind_gust_mph) : null);
    }

    const series: any[] = [];

    // --- Pane 1: Temperature & Humidity ---
    if (showTemp) {
      series.push({
        name: `Temp (${tempUnitLabel})`,
        type: 'line',
        data: tempData,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2.5, color: '#3B82F6' },
        itemStyle: { color: '#3B82F6' },
        xAxisIndex: 0,
        yAxisIndex: 0
      });
    }

    if (showFeels) {
      series.push({
        name: `Feels Like (${tempUnitLabel})`,
        type: 'line',
        data: feelsData,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, type: 'dashed', color: '#60A5FA' },
        itemStyle: { color: '#60A5FA' },
        xAxisIndex: 0,
        yAxisIndex: 0
      });
    }

    if (showDew) {
      series.push({
        name: `Dew Point (${tempUnitLabel})`,
        type: 'line',
        data: dewData,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#10B981' },
        itemStyle: { color: '#10B981' },
        xAxisIndex: 0,
        yAxisIndex: 0
      });
    }

    if (showHumidity) {
      series.push({
        name: 'Humidity (%)',
        type: 'line',
        data: humidityData,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#06B6D4' },
        itemStyle: { color: '#06B6D4' },
        xAxisIndex: 0,
        yAxisIndex: 1
      });
    }

    // --- Pane 2: Rainfall & Accumulation ---
    if (showRain) {
      series.push({
        name: `Rain (${rainUnitLabel})`,
        type: 'bar',
        data: rainData,
        itemStyle: { color: 'rgba(56, 189, 248, 0.75)', borderRadius: [2, 2, 0, 0] },
        xAxisIndex: 1,
        yAxisIndex: 2
      });
    }

    if (showRainRate) {
      series.push({
        name: `Rain Rate (${rainUnitLabel}/h)`,
        type: 'line',
        data: rainRateData,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: '#0284C7' },
        itemStyle: { color: '#0284C7' },
        xAxisIndex: 1,
        yAxisIndex: 3
      });
    }

    // --- Pane 3: Wind Speed & Gusts ---
    if (showWind) {
      series.push({
        name: `Wind (${speedUnitLabel})`,
        type: 'line',
        data: windData,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.8, color: '#8B5CF6' },
        itemStyle: { color: '#8B5CF6' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(139, 92, 246, 0.25)' },
            { offset: 1, color: 'rgba(139, 92, 246, 0.02)' }
          ])
        },
        xAxisIndex: 2,
        yAxisIndex: 4
      });
    }

    if (showGusts) {
      series.push({
        name: `Gust (${speedUnitLabel})`,
        type: 'line',
        data: gustData,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, type: 'dotted', color: '#C084FC' },
        itemStyle: { color: '#C084FC' },
        xAxisIndex: 2,
        yAxisIndex: 4
      });
    }

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#64748B', type: 'dashed' } },
        backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
        borderColor: isDark ? '#334155' : '#E2E8F0',
        textStyle: { color: isDark ? '#F8FAFC' : '#0F172A', fontSize: 12 }
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }]
      },
      title: [
        {
          text: `TEMPERATURE & COMFORT (${tempUnitLabel})`,
          left: 55,
          top: 6,
          textStyle: { fontSize: 11, fontFamily: 'monospace', color: titleColor, fontWeight: 'bold' }
        },
        {
          text: `RAINFALL & RATE (${rainUnitLabel})`,
          left: 55,
          top: '43%',
          textStyle: { fontSize: 11, fontFamily: 'monospace', color: titleColor, fontWeight: 'bold' }
        },
        {
          text: `WIND SPEED & GUSTS (${speedUnitLabel})`,
          left: 55,
          top: '71%',
          textStyle: { fontSize: 11, fontFamily: 'monospace', color: titleColor, fontWeight: 'bold' }
        }
      ],
      grid: [
        // Grid 0: Temperature & Humidity
        { left: 55, right: 55, top: 32, height: '33%' },
        // Grid 1: Rainfall & Rate (Separate Pane)
        { left: 55, right: 55, top: '48%', height: '18%' },
        // Grid 2: Wind Speed & Gusts (Separate Pane)
        { left: 55, right: 55, top: '76%', height: '18%' }
      ],
      xAxis: [
        // 0: Top chart (labels hidden)
        {
          type: 'category',
          data: timestamps,
          gridIndex: 0,
          axisLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { show: false },
          axisTick: { show: false }
        },
        // 1: Middle chart (labels hidden)
        {
          type: 'category',
          data: timestamps,
          gridIndex: 1,
          axisLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { show: false },
          axisTick: { show: false }
        },
        // 2: Bottom chart (labels visible with time ticks)
        {
          type: 'category',
          data: timestamps,
          gridIndex: 2,
          axisLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { color: textColor, fontSize: 10, interval: Math.floor(timestamps.length / 6) },
          axisTick: { show: false }
        }
      ],
      yAxis: [
        // 0: Temp (Auto-scales to min & max of data with padding)
        {
          type: 'value',
          gridIndex: 0,
          position: 'left',
          scale: true,
          min: (val) => {
            if (val.min === Infinity || isNaN(val.min)) return 0;
            return Math.floor(val.min - 1);
          },
          max: (val) => {
            if (val.max === -Infinity || isNaN(val.max)) return 100;
            return Math.ceil(val.max + 1);
          },
          splitLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { color: textColor, fontSize: 10, formatter: `{value} ${tempUnitLabel}` }
        },
        // 1: Humidity (Auto-scales or 0-100)
        {
          type: 'value',
          gridIndex: 0,
          position: 'right',
          show: showHumidity,
          scale: true,
          min: (val) => Math.max(0, Math.floor(val.min - 5)),
          max: (val) => Math.min(100, Math.ceil(val.max + 5)),
          splitLine: { show: false },
          axisLabel: { color: textColor, fontSize: 10, formatter: '{value}%' }
        },
        // 2: Rain Accumulation (Grid 1 - starts at 0, auto-scales max)
        {
          type: 'value',
          gridIndex: 1,
          position: 'left',
          min: 0,
          max: (val) => {
            if (val.max > 0) return Math.ceil(val.max * 10) / 10 + (unit === 'metric' ? 1 : 0.05);
            return unit === 'metric' ? 5 : 0.2;
          },
          splitLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { color: textColor, fontSize: 10, formatter: `{value} ${rainUnitLabel}` }
        },
        // 3: Rain Rate (Grid 1 - right axis)
        {
          type: 'value',
          gridIndex: 1,
          position: 'right',
          show: showRainRate,
          min: 0,
          max: (val) => {
            if (val.max > 0) return Math.ceil(val.max * 10) / 10 + 0.1;
            return unit === 'metric' ? 10 : 0.5;
          },
          splitLine: { show: false },
          axisLabel: { color: textColor, fontSize: 10, formatter: `{value} ${unit === 'metric' ? 'mm/h' : 'in/h'}` }
        },
        // 4: Wind Speed & Gusts (Grid 2 - auto-scales max to peak gust)
        {
          type: 'value',
          gridIndex: 2,
          position: 'left',
          min: 0,
          max: (val) => {
            if (val.max > 0) return Math.ceil(val.max + 3);
            return unit === 'metric' ? 20 : 12;
          },
          splitLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { color: textColor, fontSize: 10, formatter: `{value} ${speedUnitLabel}` }
        }
      ],
      series
    };

    chartInstance.setOption(option, true);
  }

  onMount(() => {
    chartInstance = echarts.init(chartContainer);
    fetchHistory(currentTimeframe);

    resizeObserver = new ResizeObserver(() => {
      chartInstance?.resize();
    });
    resizeObserver.observe(chartContainer);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    chartInstance?.dispose();
  });

  $: if (chartInstance && (theme || unit)) {
    fetchHistory(currentTimeframe);
  }
</script>

<div class="rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm transition-colors">
  <!-- Controls Bar -->
  <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-100 dark:border-slate-800">
    <!-- Timeframe Selector Pills -->
    <div class="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 text-xs font-mono">
      {#each timeframes as tf}
        <button
          type="button"
          on:click={() => fetchHistory(tf)}
          class="px-2.5 py-1 rounded-lg font-medium transition-all {currentTimeframe === tf
            ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}"
        >
          {tf}
        </button>
      {/each}
    </div>

    <!-- Active Decimation & Source Badge -->
    <div class="flex items-center gap-2">
      <span class="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
        Res: {activeResolution} · {activeSource === 'ram_buffer' ? 'RAM (Zero Disk Read)' : 'SQLite WAL'}
      </span>
      {#if loading}
        <span class="text-xs text-blue-500 animate-pulse font-mono">Updating...</span>
      {/if}
    </div>
  </div>

  <!-- Metric Layer Toggles -->
  <div class="flex flex-wrap items-center gap-3 mb-4 text-xs font-mono">
    <!-- Temp Pane Layers -->
    <label class="flex items-center gap-1.5 cursor-pointer text-blue-600 dark:text-blue-400">
      <input type="checkbox" bind:checked={showTemp} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-blue-600" />
      <span>Temperature</span>
    </label>
    <label class="flex items-center gap-1.5 cursor-pointer text-blue-400">
      <input type="checkbox" bind:checked={showFeels} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-blue-400" />
      <span>Feels Like</span>
    </label>
    <label class="flex items-center gap-1.5 cursor-pointer text-emerald-600 dark:text-emerald-400">
      <input type="checkbox" bind:checked={showDew} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-emerald-600" />
      <span>Dew Point</span>
    </label>
    <label class="flex items-center gap-1.5 cursor-pointer text-cyan-600 dark:text-cyan-400">
      <input type="checkbox" bind:checked={showHumidity} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-cyan-600" />
      <span>Humidity</span>
    </label>

    <div class="h-3 w-px bg-slate-200 dark:bg-slate-800 mx-1"></div>

    <!-- Rain Pane Layers -->
    <label class="flex items-center gap-1.5 cursor-pointer text-sky-500">
      <input type="checkbox" bind:checked={showRain} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-sky-500" />
      <span>Rain Accum</span>
    </label>
    <label class="flex items-center gap-1.5 cursor-pointer text-sky-600 dark:text-sky-400">
      <input type="checkbox" bind:checked={showRainRate} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-sky-600" />
      <span>Rain Rate</span>
    </label>

    <div class="h-3 w-px bg-slate-200 dark:bg-slate-800 mx-1"></div>

    <!-- Wind Pane Layers -->
    <label class="flex items-center gap-1.5 cursor-pointer text-purple-500">
      <input type="checkbox" bind:checked={showWind} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-purple-500" />
      <span>Wind Speed</span>
    </label>
    <label class="flex items-center gap-1.5 cursor-pointer text-purple-400">
      <input type="checkbox" bind:checked={showGusts} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-purple-400" />
      <span>Gusts</span>
    </label>
  </div>

  <!-- Synchronized 3-Pane ECharts Container -->
  <div bind:this={chartContainer} class="w-full h-[540px] sm:h-[620px]"></div>
</div>
