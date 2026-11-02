<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import type { UnitSystem, WeatherReading } from '$lib/types';

  import Header from '$lib/components/Header.svelte';
  import TempHeroCard from '$lib/components/TempHeroCard.svelte';
  import RainHeroCard from '$lib/components/RainHeroCard.svelte';
  import TelemetryChart from '$lib/components/TelemetryChart.svelte';
  import WindRoseCard from '$lib/components/WindRoseCard.svelte';
  import SystemHealthCard from '$lib/components/SystemHealthCard.svelte';

  export let data: PageData;

  let unit: UnitSystem = 'imperial';
  let theme: 'light' | 'dark' = 'dark';

  let reading: WeatherReading | null = data.latest;
  let isOnline = data.isOnline ?? false;
  let bufferStats = data.buffer;
  let dbStats = data.database;
  let highTemp = data.highTemp;
  let lowTemp = data.lowTemp;
  let trend1h = data.trend1h;
  let rain24h = data.rain24h;
  let monthTotal = data.monthTotal;
  let yearTotal = data.yearTotal;
  let sparkline = data.sparkline || [];

  let lastPacketSecondsAgo = reading ? Math.max(0, Math.floor(Date.now() / 1000 - reading.timestamp)) : -1;
  let eventSource: EventSource | null = null;
  let tickerTimer: NodeJS.Timeout | null = null;
  let statusPollTimer: NodeJS.Timeout | null = null;

  function toggleUnit() {
    unit = unit === 'imperial' ? 'metric' : 'imperial';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pws_unit', unit);
    }
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pws_theme', theme);
    }
    applyTheme();
  }

  function applyTheme() {
    if (typeof document !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const json = await res.json();
        bufferStats = json.buffer;
        dbStats = json.database;
        if (json.latest_reading && (!reading || json.latest_reading.timestamp > reading.timestamp)) {
          reading = json.latest_reading;
        }
      }
    } catch {}
  }

  onMount(() => {
    // Restore user preferences
    if (typeof localStorage !== 'undefined') {
      const savedUnit = localStorage.getItem('pws_unit');
      if (savedUnit === 'imperial' || savedUnit === 'metric') unit = savedUnit;
      const savedTheme = localStorage.getItem('pws_theme');
      if (savedTheme === 'light' || savedTheme === 'dark') theme = savedTheme;
    }
    applyTheme();

    // Start 1-second interval ticker for packet age and online/offline status
    tickerTimer = setInterval(() => {
      if (reading) {
        lastPacketSecondsAgo = Math.max(0, Math.floor(Date.now() / 1000 - reading.timestamp));
        isOnline = lastPacketSecondsAgo < 180; // 3 minutes without packet = OFFLINE
      } else {
        isOnline = false;
      }

      if (bufferStats && bufferStats.nextFlushSeconds > 0) {
        bufferStats.nextFlushSeconds = Math.max(0, bufferStats.nextFlushSeconds - 1);
      }
    }, 1000);

    // Poll status every 30s
    statusPollTimer = setInterval(refreshStatus, 30000);

    // Connect to Server-Sent Events real-time stream
    eventSource = new EventSource('/api/stream');

    eventSource.addEventListener('weather', (e) => {
      try {
        const fresh: WeatherReading = JSON.parse(e.data);
        reading = fresh;
        lastPacketSecondsAgo = 0;
        isOnline = true;

        if (bufferStats) {
          bufferStats.queueLength++;
        }

        // Live high/low & sparkline update
        if (fresh.temp_f !== undefined && fresh.temp_f !== null) {
          if (highTemp === null || fresh.temp_f > highTemp) highTemp = fresh.temp_f;
          if (lowTemp === null || fresh.temp_f < lowTemp) lowTemp = fresh.temp_f;
          sparkline = [...sparkline.slice(-200), fresh.temp_f];
        }
      } catch (err) {
        console.error('Error parsing SSE weather event:', err);
      }
    });

    eventSource.addEventListener('ping', () => {
      // Ping confirms socket connectivity to server
    });

    eventSource.onerror = () => {
      // Socket disconnect
    };
  });

  onDestroy(() => {
    if (tickerTimer) clearInterval(tickerTimer);
    if (statusPollTimer) clearInterval(statusPollTimer);
    if (eventSource) eventSource.close();
  });
</script>

<div class="min-h-screen bg-slate-50 dark:bg-[#090D16] text-slate-900 dark:text-slate-100 transition-colors">
  <Header
    {unit}
    {theme}
    queueLength={bufferStats?.queueLength ?? 0}
    nextFlushSeconds={bufferStats?.nextFlushSeconds ?? 0}
    {lastPacketSecondsAgo}
    {isOnline}
    on:toggleUnit={toggleUnit}
    on:toggleTheme={toggleTheme}
    on:flushed={refreshStatus}
  />

  <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
    <!-- Tier 1: Hero Cards — Temperature & Rainfall (Top Priority, 12-Column Grid) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
      <!-- Temperature Card: 7 Columns on Desktop -->
      <div class="lg:col-span-7 flex flex-col">
        <TempHeroCard
          {reading}
          {unit}
          {trend1h}
          {highTemp}
          {lowTemp}
          {sparkline}
          {isOnline}
        />
      </div>

      <!-- Rainfall Card: 5 Columns on Desktop -->
      <div class="lg:col-span-5 flex flex-col">
        <RainHeroCard
          {reading}
          {unit}
          {rain24h}
          {monthTotal}
          {yearTotal}
          {isOnline}
        />
      </div>
    </div>

    <!-- Tier 2: Synchronized Interactive Time-Series Workbench (Full 12 Columns) -->
    <TelemetryChart
      {unit}
      {theme}
    />

    <!-- Tier 3: Wind Rose, Compass & Hardware Health (Secondary Priority, 12-Column Grid) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
      <!-- Wind Rose & Compass: 6 Columns on Desktop -->
      <div class="lg:col-span-6 flex flex-col">
        <WindRoseCard
          {reading}
          {unit}
          {isOnline}
        />
      </div>

      <!-- Station & System Telemetry: 6 Columns on Desktop -->
      <div class="lg:col-span-6 flex flex-col">
        <SystemHealthCard
          {reading}
          {unit}
          {dbStats}
          {bufferStats}
          on:flushed={refreshStatus}
        />
      </div>
    </div>
  </main>
</div>
