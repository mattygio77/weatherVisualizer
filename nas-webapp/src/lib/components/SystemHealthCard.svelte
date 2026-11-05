<script lang="ts">
  import { formatBarometer, type UnitSystem, type WeatherReading } from '$lib/types';
  import { createEventDispatcher } from 'svelte';

  export let reading: WeatherReading | null = null;
  export let unit: UnitSystem = 'imperial';
  export let dbStats: { rawCount: number; roll5mCount: number; roll1hCount: number; fileSizeMb: number } | null = null;
  export let bufferStats: { queueLength: number; cacheLength: number; lastFlushTimestamp: number; nextFlushSeconds: number } | null = null;

  const dispatch = createEventDispatcher();
  let flushing = false;

  async function triggerFlush() {
    if (flushing) return;
    flushing = true;
    try {
      const res = await fetch('/api/admin/flush', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        dispatch('flushed', data);
      }
    } catch (e) {
      console.error('Flush failed:', e);
    } finally {
      flushing = false;
    }
  }

  function formatTime(ts: number): string {
    if (!ts) return 'Never';
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
</script>

<div class="rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm transition-colors flex flex-col justify-between h-full flex-1">
  <!-- Top: Card Label & Ingestion Badge -->
  <div class="flex items-center justify-between mb-4">
    <div>
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Station &amp; System Telemetry
      </span>
      <div class="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 mt-0.5">
        Source: <strong class="text-slate-700 dark:text-slate-200">
          {reading?.source === 'rtl_433' ? 'Mode 2: RTL-SDR 433.92 MHz' : 'Mode 1: Wi-Fi Intercept'}
        </strong>
      </div>
    </div>

    <!-- Battery Status Pill -->
    <div class="px-2.5 py-1 rounded-full text-xs font-mono font-medium border {reading?.battery_ok !== 0
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
      : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'}">
      {reading?.battery_ok !== 0 ? 'Battery Normal' : 'Battery Low'}
    </div>
  </div>

  <!-- Middle: Barometer & Storage Specs -->
  <div class="grid grid-cols-2 gap-4 my-auto py-2">
    <!-- Barometer -->
    <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        Barometer
      </span>
      <div class="text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100 mt-0.5">
        {formatBarometer(reading?.barom_in_hg, unit)}
      </div>
      <span class="text-[11px] text-slate-400 font-mono">Atmospheric Pressure</span>
    </div>

    <!-- SQLite WAL Storage -->
    <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
      <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 font-mono">
        SQLite WAL DB
      </span>
      <div class="text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100 mt-0.5">
        {dbStats?.fileSizeMb ?? 0} MB
      </div>
      <span class="text-[11px] text-slate-400 font-mono">{(dbStats?.rawCount ?? 0).toLocaleString()} Total Readings</span>
    </div>
  </div>

  <!-- Bottom: 3-Hour RAM Batching Engine Info & Action Button -->
  <div class="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 min-h-[58px]">
    <div class="text-xs font-mono text-slate-500 dark:text-slate-400">
      <div>RAM Buffer: <strong class="text-slate-700 dark:text-slate-200">{bufferStats?.queueLength ?? 0}</strong> unflushed</div>
      <div class="text-[11px] text-slate-400">Last Disk Write: {formatTime(bufferStats?.lastFlushTimestamp ?? 0)}</div>
    </div>

    <button
      type="button"
      on:click={triggerFlush}
      disabled={flushing || (bufferStats?.queueLength ?? 0) === 0}
      class="w-full sm:w-auto px-3.5 py-1.5 rounded-xl font-mono text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-all shadow-sm flex items-center justify-center gap-1.5"
    >
      <span>{flushing ? 'Writing to Disk...' : 'Flush Buffer to Disk'}</span>
      <span>⚡</span>
    </button>
  </div>
</div>
