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

  let activeRainToday: number | null = null;

  async function fetchHistory(tf: string) {
    currentTimeframe = tf;
    loading = true;
    try {
      const res = await fetch(`/api/history?timeframe=${tf}`);
      const json = await res.json();
      activeResolution = json.resolution || 'raw';
      activeSource = json.source || 'ram_buffer';
      activeRainToday = json.rainToday !== undefined ? json.rainToday : null;
      updateChart(json.data || []);
    } catch (e) {
      console.error('Failed to fetch history:', e);
    } finally {
      loading = false;
    }
  }

  function convertTemp(f: number | null | undefined): number | null {
    if (f === undefined || f === null || isNaN(f)) return null;
    if (unit === 'metric') return Math.round(((f - 32) * (5 / 9)) * 10) / 10;
    return Math.round(f * 10) / 10;
  }

  function convertRain(inches: number | null | undefined): number | null {
    if (inches === undefined || inches === null || isNaN(inches)) return null;
    if (unit === 'metric') return Math.round(inches * 25.4 * 10) / 10;
    return Math.round(inches * 100) / 100;
  }

  function convertSpeed(mph: number | null | undefined): number | null {
    if (mph === undefined || mph === null || isNaN(mph)) return null;
    if (unit === 'metric') return Math.round(mph * 1.60934 * 10) / 10;
    return Math.round(mph * 10) / 10;
  }

  function getGapThresholdSeconds(tf: string): number {
    switch (tf) {
      case '1H': return 300;    // 5 minutes (prevents false gaps from single missed RF packets)
      case '6H': return 300;    // 5 minutes
      case '24H': return 900;   // 15 minutes
      case '7D': return 1800;   // 30 minutes
      case '30D':
      case '1Y': return 7200;   // 2 hours
      default: return 900;
    }
  }

  function getTimeBounds(tf: string): { min: number; max: number } {
    const nowMs = Date.now();
    let durationMs = 24 * 3600 * 1000;
    switch (tf) {
      case '1H': durationMs = 3600 * 1000; break;
      case '6H': durationMs = 6 * 3600 * 1000; break;
      case '24H': durationMs = 24 * 3600 * 1000; break;
      case '7D': durationMs = 7 * 24 * 3600 * 1000; break;
      case '30D': durationMs = 30 * 24 * 3600 * 1000; break;
      case '1Y': durationMs = 365 * 24 * 3600 * 1000; break;
    }
    return { min: nowMs - durationMs, max: nowMs };
  }

  function updateChart(data: any[]) {
    if (!chartInstance) return;

    const isDark = theme === 'dark';
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    const gridLeft = isMobile ? 38 : 55;
    const gridRight = isMobile ? 38 : 55;
    const titleLeft = isMobile ? 38 : 55;
    const textColor = isDark ? '#94A3B8' : '#64748B';
    const titleColor = isDark ? '#CBD5E1' : '#334155';
    const gridLineColor = isDark ? 'rgba(30, 41, 59, 0.6)' : 'rgba(226, 232, 240, 0.8)';
    const tempUnitLabel = unit === 'metric' ? '°C' : '°F';
    const rainUnitLabel = unit === 'metric' ? 'mm' : 'in';
    const speedUnitLabel = unit === 'metric' ? 'km/h' : 'mph';

    const gapThresholdSec = getGapThresholdSeconds(currentTimeframe);
    const { min: timelineMin, max: timelineMax } = getTimeBounds(currentTimeframe);

    // Arrays of [timestampMs, value] with null inserts on gaps for line disconnects
    const tempData: [number, number | null][] = [];
    const feelsData: [number, number | null][] = [];
    const dewData: [number, number | null][] = [];
    const humidityData: [number, number | null][] = [];
    const rainData: [number, number | null][] = [];
    const rainRateData: [number, number | null][] = [];
    const windData: [number, number | null][] = [];
    const gustData: [number, number | null][] = [];

    // Sort data chronologically ascending
    // Sort data chronologically ascending
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

    // Find the latest known rain_today_in from data or activeRainToday
    let latestKnownTodayRain: number | null = activeRainToday;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].rain_today_in !== undefined && sorted[i].rain_today_in !== null) {
        latestKnownTodayRain = sorted[i].rain_today_in;
        break;
      }
    }

    const now = new Date();
    const startOfTodaySec = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime() / 1000);
    const n = sorted.length;
    const rainAtPoint: number[] = new Array(n);

    // Precalculate rain accumulation for today's points by integrating backwards from latestKnownTodayRain
    if (latestKnownTodayRain !== null && latestKnownTodayRain > 0) {
      let trailingDelta = 0;
      for (let i = n - 1; i >= 0; i--) {
        const d = sorted[i];
        if (d.timestamp >= startOfTodaySec) {
          if (d.rain_today_in !== undefined && d.rain_today_in !== null) {
            rainAtPoint[i] = d.rain_today_in;
            trailingDelta = Math.max(0, Math.round((latestKnownTodayRain - d.rain_today_in) * 100) / 100);
          } else {
            const calculated = Math.max(0, Math.round((latestKnownTodayRain - trailingDelta) * 100) / 100);
            rainAtPoint[i] = calculated;
          }
          trailingDelta += (d.rain_delta_in || 0);
        } else {
          rainAtPoint[i] = -1;
        }
      }
    }

    let cumulativeRain = 0;
    let prevDay = -1;

    for (let i = 0; i < n; i++) {
      const d = sorted[i];
      const dDate = new Date(d.timestamp * 1000);
      const dayNum = dDate.getDate();

      // Reset daily accumulation at local midnight
      if (prevDay !== -1 && dayNum !== prevDay) {
        cumulativeRain = 0;
      }
      prevDay = dayNum;

      if (d.timestamp >= startOfTodaySec && rainAtPoint[i] !== undefined && rainAtPoint[i] >= 0) {
        cumulativeRain = rainAtPoint[i];
      } else if (d.rain_today_in !== undefined && d.rain_today_in !== null) {
        cumulativeRain = d.rain_today_in;
      } else {
        cumulativeRain = Math.round((cumulativeRain + (d.rain_delta_in || 0)) * 100) / 100;
      }

      // Detect data gaps between consecutive points
      if (i > 0) {
        const deltaSec = d.timestamp - sorted[i - 1].timestamp;
        if (deltaSec > gapThresholdSec) {
          // Insert null entries at both ends of the gap to disconnect the line cleanly
          const gapStartMs = (sorted[i - 1].timestamp + 1) * 1000;
          const gapEndMs = (d.timestamp - 1) * 1000;

          tempData.push([gapStartMs, null], [gapEndMs, null]);
          feelsData.push([gapStartMs, null], [gapEndMs, null]);
          dewData.push([gapStartMs, null], [gapEndMs, null]);
          humidityData.push([gapStartMs, null], [gapEndMs, null]);
          windData.push([gapStartMs, null], [gapEndMs, null]);
          gustData.push([gapStartMs, null], [gapEndMs, null]);
        }
      }

      const tsMs = d.timestamp * 1000;
      tempData.push([tsMs, convertTemp(d.temp_f)]);
      feelsData.push([tsMs, convertTemp(d.feels_like_f)]);
      dewData.push([tsMs, convertTemp(d.dew_point_f)]);
      humidityData.push([tsMs, d.humidity !== undefined && d.humidity !== null ? d.humidity : null]);
      rainData.push([tsMs, convertRain(cumulativeRain)]);
      rainRateData.push([tsMs, convertRain(d.rain_rate_in_hr || 0)]);
      windData.push([tsMs, convertSpeed(d.wind_speed_mph)]);
      gustData.push([tsMs, convertSpeed(d.wind_gust_mph)]);
    }

    // Ensure edge-to-edge line continuity for rain accumulation in 1H/6H
    if (rainData.length > 0 && (currentTimeframe === '1H' || currentTimeframe === '6H')) {
      if (rainData[0][0] > timelineMin) {
        rainData.unshift([timelineMin, rainData[0][1]]);
      }
      if (rainData[rainData.length - 1][0] < timelineMax) {
        rainData.push([timelineMax, rainData[rainData.length - 1][1]]);
      }
    }

    // If the latest point is older than gap threshold, disconnect up to the current time
    if (sorted.length > 0) {
      const lastTs = sorted[sorted.length - 1].timestamp;
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - lastTs > gapThresholdSec) {
        const disconnectMs = (lastTs + 1) * 1000;
        tempData.push([disconnectMs, null], [timelineMax, null]);
        feelsData.push([disconnectMs, null], [timelineMax, null]);
        dewData.push([disconnectMs, null], [timelineMax, null]);
        humidityData.push([disconnectMs, null], [timelineMax, null]);
        rainData.push([disconnectMs, null], [timelineMax, null]);
        rainRateData.push([disconnectMs, null], [timelineMax, null]);
        windData.push([disconnectMs, null], [timelineMax, null]);
        gustData.push([disconnectMs, null], [timelineMax, null]);
      }
    }

    const series: any[] = [];

    // --- Pane 1: Temperature & Humidity ---
    if (showTemp) {
      series.push({
        name: `Temp (${tempUnitLabel})`,
        type: 'line',
        data: tempData,
        connectNulls: false, // Disconnect line across gaps
        smooth: false,
        showSymbol: false,
        lineStyle: { width: 2.2, color: '#3B82F6' },
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
        connectNulls: false,
        smooth: false,
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
        connectNulls: false,
        smooth: false,
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
        connectNulls: false,
        smooth: false,
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
        name: `Daily Rain (${rainUnitLabel})`,
        type: 'line',
        step: 'end',
        data: rainData,
        connectNulls: true,
        showSymbol: false,
        lineStyle: { width: 2, color: '#38BDF8' },
        itemStyle: { color: '#38BDF8' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(56, 189, 248, 0.35)' },
            { offset: 1, color: 'rgba(56, 189, 248, 0.02)' }
          ])
        },
        xAxisIndex: 1,
        yAxisIndex: 2
      });
    }

    if (showRainRate) {
      series.push({
        name: `Rain Rate (${rainUnitLabel}/h)`,
        type: 'line',
        data: rainRateData,
        connectNulls: true,
        smooth: false,
        showSymbol: false,
        lineStyle: { width: 2, color: '#F43F5E' },
        itemStyle: { color: '#F43F5E' },
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
        connectNulls: false,
        smooth: false,
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
        connectNulls: false,
        smooth: false,
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
        confine: true, // Prevents tooltip from rendering off-screen
        axisPointer: { type: 'cross', lineStyle: { color: '#64748B', type: 'dashed' } },
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.96)',
        borderColor: isDark ? '#334155' : '#E2E8F0',
        borderWidth: 1,
        padding: [8, 12],
        extraCssText: 'box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.3); backdrop-filter: blur(12px); z-index: 1000;',
        textStyle: { color: isDark ? '#F8FAFC' : '#0F172A', fontSize: 12 },
        formatter: (params: any) => {
          if (!params || !params.length) return '';
          try {
            const valid = params.find((p: any) => p && p.value && p.value[1] !== null && p.value[1] !== undefined);
            const rawTs = valid?.value?.[0] ?? (Array.isArray(params[0]?.value) ? params[0].value[0] : (params[0]?.axisValue ?? Date.now()));
            const ts = Number(rawTs) || Date.now();
            const d = new Date(ts);
            const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
            const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
            let html = `<div style="font-weight:600;margin-bottom:6px;font-family:monospace;border-bottom:1px solid ${isDark ? '#334155' : '#E2E8F0'};padding-bottom:3px;">${dateStr} · ${timeStr}</div>`;

            let hasData = false;
            const seenSeries = new Set();
            for (const p of params) {
              if (!p || seenSeries.has(p.seriesName)) continue;
              seenSeries.add(p.seriesName);
              if (p.value && p.value[1] !== null && p.value[1] !== undefined) {
                hasData = true;
                html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:11px;margin:2px 0;">
                  <span>${p.marker || ''} ${p.seriesName}</span>
                  <span style="font-weight:bold;font-family:monospace;">${p.value[1]}</span>
                </div>`;
              }
            }
            if (!hasData) {
              html += `<div style="font-size:11px;color:#94A3B8;font-style:italic;">No signal / Disconnected</div>`;
            }
            return html;
          } catch (err) {
            console.warn('Tooltip format exception:', err);
            return '';
          }
        }
      },
      axisPointer: {
        link: [{ xAxisIndex: 'all' }]
      },
      title: [
        {
          text: `TEMPERATURE & COMFORT (${tempUnitLabel})`,
          left: titleLeft,
          top: 6,
          textStyle: { fontSize: isMobile ? 10 : 11, fontFamily: 'monospace', color: titleColor, fontWeight: 'bold' }
        },
        {
          text: `RAINFALL & RATE (${rainUnitLabel})`,
          left: titleLeft,
          top: '43%',
          textStyle: { fontSize: isMobile ? 10 : 11, fontFamily: 'monospace', color: titleColor, fontWeight: 'bold' }
        },
        {
          text: `WIND SPEED & GUSTS (${speedUnitLabel})`,
          left: titleLeft,
          top: '71%',
          textStyle: { fontSize: isMobile ? 10 : 11, fontFamily: 'monospace', color: titleColor, fontWeight: 'bold' }
        }
      ],
      grid: [
        // Grid 0: Temperature & Humidity
        { left: gridLeft, right: gridRight, top: 32, height: '33%' },
        // Grid 1: Rainfall & Rate (Separate Pane)
        { left: gridLeft, right: gridRight, top: '48%', height: '18%' },
        // Grid 2: Wind Speed & Gusts (Separate Pane)
        { left: gridLeft, right: gridRight, top: '76%', height: '18%' }
      ],
      xAxis: [
        // 0: Top chart (labels hidden, true linear time axis)
        {
          type: 'time',
          min: timelineMin,
          max: timelineMax,
          gridIndex: 0,
          axisLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { show: false },
          splitLine: { show: true, lineStyle: { color: gridLineColor } },
          axisTick: { show: false }
        },
        // 1: Middle chart (labels hidden, true linear time axis)
        {
          type: 'time',
          min: timelineMin,
          max: timelineMax,
          gridIndex: 1,
          axisLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { show: false },
          splitLine: { show: true, lineStyle: { color: gridLineColor } },
          axisTick: { show: false }
        },
        // 2: Bottom chart (labels visible, mathematically even time increments)
        {
          type: 'time',
          min: timelineMin,
          max: timelineMax,
          gridIndex: 2,
          splitNumber: isMobile ? 4 : 8,
          axisLine: { lineStyle: { color: gridLineColor } },
          splitLine: { show: true, lineStyle: { color: gridLineColor } },
          axisTick: { show: true, lineStyle: { color: gridLineColor } },
          axisLabel: {
            hideOverlap: true,
            color: textColor,
            fontSize: isMobile ? 9 : 10,
            fontFamily: 'monospace',
            formatter: (val: number) => {
              const d = new Date(val);
              if (currentTimeframe === '1H' || currentTimeframe === '6H' || currentTimeframe === '24H') {
                return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              }
              if (isMobile) {
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }
              return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
            }
          }
        }
      ],
      yAxis: [
        // 0: Temp (Auto-scales dynamically to min & max of data with padding)
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
        // 2: Rain Accumulation (Grid 1 - starts at 0, adaptive fine-grained scale)
        {
          type: 'value',
          gridIndex: 1,
          position: 'left',
          min: 0,
          max: (val) => {
            if (val.max <= 0 || isNaN(val.max)) {
              return unit === 'metric' ? 2 : 0.05;
            }
            if (val.max <= 0.05) {
              return unit === 'metric' ? 2 : 0.08;
            }
            if (val.max <= 0.15) {
              return unit === 'metric' ? 5 : 0.20;
            }
            if (val.max <= 0.50) {
              return unit === 'metric' ? 15 : 0.60;
            }
            if (val.max <= 1.0) {
              return unit === 'metric' ? 30 : 1.20;
            }
            return Math.ceil((val.max * 1.2) * 10) / 10;
          },
          splitLine: { lineStyle: { color: gridLineColor } },
          axisLabel: {
            color: textColor,
            fontSize: 10,
            formatter: (v: number) => {
              if (unit === 'metric') return `${v.toFixed(1)} mm`;
              return `${v.toFixed(2)} in`;
            }
          }
        },
        // 3: Rain Rate (Grid 1 - right axis, adaptive fine-grained scale)
        {
          type: 'value',
          gridIndex: 1,
          position: 'right',
          show: showRainRate,
          min: 0,
          max: (val) => {
            if (val.max <= 0 || isNaN(val.max)) {
              return unit === 'metric' ? 2.5 : 0.10;
            }
            if (val.max <= 0.10) {
              return unit === 'metric' ? 5 : 0.20;
            }
            if (val.max <= 0.50) {
              return unit === 'metric' ? 15 : 0.60;
            }
            return Math.ceil((val.max * 1.2) * 10) / 10;
          },
          splitLine: { show: false },
          axisLine: { show: true, lineStyle: { color: isDark ? 'rgba(244, 63, 94, 0.4)' : 'rgba(244, 63, 94, 0.5)' } },
          axisTick: { show: true, lineStyle: { color: isDark ? 'rgba(244, 63, 94, 0.4)' : 'rgba(244, 63, 94, 0.5)' } },
          axisLabel: {
            color: isDark ? '#FB7185' : '#E11D48',
            fontSize: 10,
            formatter: (v: number) => {
              if (unit === 'metric') return `${v.toFixed(1)} mm/h`;
              return `${v.toFixed(2)} in/h`;
            }
          }
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
    <label class="flex items-center gap-1.5 cursor-pointer text-rose-500 dark:text-rose-400">
      <input type="checkbox" bind:checked={showRainRate} on:change={() => fetchHistory(currentTimeframe)} class="rounded text-rose-500" />
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
