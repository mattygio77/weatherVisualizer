<script lang="ts">
  import type { UnitSystem } from '$lib/types';
  import { createEventDispatcher } from 'svelte';

  export let unit: UnitSystem = 'imperial';
  export let theme: 'light' | 'dark' = 'dark';
  export let queueLength = 0;
  export let nextFlushSeconds = 0;
  export let lastPacketSecondsAgo = 0;
  export let isOnline = true;

  const dispatch = createEventDispatcher();

  let flushing = false;

  async function handleManualFlush() {
    if (flushing) return;
    flushing = true;
    try {
      const res = await fetch('/api/admin/flush', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        dispatch('flushed', data);
      }
    } catch (e) {
      console.error('Failed to flush buffer:', e);
    } finally {
      flushing = false;
    }
  }

  function formatCountdown(sec: number): string {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function formatLastSeen(sec: number): string {
    if (sec < 60) return `${sec}s ago`;
    const mins = Math.floor(sec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m ago`;
  }
</script>

<header class="border-b border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-[#0c121e]/80 backdrop-blur-md sticky top-0 z-30 transition-colors">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
    <!-- Left: Station Title & Live Pulse -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <span class="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100 font-sans">
          AcuRite Iris
        </span>
        <span class="text-[10px] font-mono tracking-wider uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
          5-in-1
        </span>
      </div>

      <div class="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block"></div>

      <!-- Live status pulse -->
      <div class="flex items-center gap-1.5 text-xs">
        <span class="relative flex h-2 w-2">
          {#if isOnline}
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          {:else}
            <span class="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          {/if}
        </span>
        <span class="font-medium text-[11px] uppercase tracking-wider hidden sm:inline font-mono {isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">
          {isOnline ? 'LIVE' : 'OFFLINE'}
        </span>
        {#if !isOnline && lastPacketSecondsAgo >= 0}
          <span class="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
            · No Signal ({formatLastSeen(lastPacketSecondsAgo)})
          </span>
        {/if}
      </div>
    </div>

    <!-- Right: Buffer Pill, Unit Toggle & Theme Toggle -->
    <div class="flex items-center gap-2.5">
      <!-- RAM Buffer Pill -->
      <div class="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-[11px] font-mono text-slate-600 dark:text-slate-300">
        <span>RAM: <strong class="text-slate-900 dark:text-slate-100">{queueLength}</strong> pts</span>
        <span class="text-slate-300 dark:text-slate-700">|</span>
        <span>Flush: {formatCountdown(nextFlushSeconds)}</span>
        <button
          type="button"
          on:click={handleManualFlush}
          disabled={flushing}
          title="Flush RAM buffer to SQLite WAL immediately"
          class="ml-1 hover:text-blue-500 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
        >
          {flushing ? '⏳' : '⚡'}
        </button>
      </div>

      <!-- Unit Switcher (°F / °C) -->
      <button
        type="button"
        on:click={() => dispatch('toggleUnit')}
        class="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-mono font-medium text-slate-700 dark:text-slate-300 transition-colors"
      >
        {unit === 'imperial' ? '°F · in' : '°C · mm'}
      </button>

      <!-- Theme Switcher -->
      <button
        type="button"
        on:click={() => dispatch('toggleTheme')}
        aria-label="Toggle light and dark theme"
        class="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-xs text-slate-700 dark:text-slate-300 transition-colors"
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </div>
  </div>
</header>
