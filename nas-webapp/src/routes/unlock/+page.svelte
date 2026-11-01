<script lang="ts">
  import { enhance } from '$app/forms';

  export let form: { error?: string } | null = null;

  let pin = '';
  let submitting = false;

  function pressKey(num: string) {
    if (pin.length < 8) {
      pin += num;
    }
  }

  function backspace() {
    pin = pin.slice(0, -1);
  }

  function clearAll() {
    pin = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key >= '0' && e.key <= '9') {
      pressKey(e.key);
    } else if (e.key === 'Backspace') {
      backspace();
    } else if (e.key === 'Escape') {
      clearAll();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#090D16]">
  <div class="w-full max-w-sm bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
    <div class="text-center mb-6">
      <div class="w-12 h-12 mx-auto mb-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 text-2xl">
        🌤️
      </div>
      <h1 class="text-lg font-semibold text-slate-900 dark:text-slate-100">AcuRite Weather Station</h1>
      <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Enter station PIN to unlock telemetry dashboard</p>
    </div>

    <!-- PIN Visual Indicator -->
    <div class="flex justify-center gap-3 mb-6">
      {#each [0, 1, 2, 3, 4, 5] as i}
        <div
          class="w-3.5 h-3.5 rounded-full border transition-all duration-150 {i < pin.length
            ? 'bg-blue-600 border-blue-600 scale-110'
            : 'border-slate-300 dark:border-slate-700 bg-transparent'}"
        ></div>
      {/each}
    </div>

    {#if form?.error}
      <div class="mb-5 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-xs text-red-600 dark:text-red-400 text-center">
        {form.error}
      </div>
    {/if}

    <form method="POST" use:enhance={() => {
      submitting = true;
      return async ({ update }) => {
        submitting = false;
        await update();
        pin = '';
      };
    }}>
      <input type="hidden" name="pin" value={pin} />

      <!-- Numeric Keypad -->
      <div class="grid grid-cols-3 gap-2.5 mb-4">
        {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as num}
          <button
            type="button"
            on:click={() => pressKey(num)}
            class="h-14 rounded-xl text-lg font-semibold font-mono bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 transition-colors active:scale-95 flex items-center justify-center"
          >
            {num}
          </button>
        {/each}
        <button
          type="button"
          on:click={clearAll}
          class="h-14 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          CLEAR
        </button>
        <button
          type="button"
          on:click={() => pressKey('0')}
          class="h-14 rounded-xl text-lg font-semibold font-mono bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 transition-colors active:scale-95 flex items-center justify-center"
        >
          0
        </button>
        <button
          type="button"
          on:click={backspace}
          class="h-14 rounded-xl text-base text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center"
        >
          ⌫
        </button>
      </div>

      <button
        type="submit"
        disabled={pin.length < 4 || submitting}
        class="w-full py-3 px-4 rounded-xl font-medium text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
      >
        {submitting ? 'Verifying...' : 'Unlock Dashboard'}
      </button>
    </form>
  </div>
</div>
