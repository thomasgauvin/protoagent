<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// Each "frame" is a line that appears in sequence
interface TerminalLine {
  text: string
  classes: string
  delay: number // ms before this line appears
}

const lines: TerminalLine[] = [
  // ASCII banner (simplified)
  { text: '╔═══════════════════════════════════════╗', classes: 'terminal-green terminal-bold', delay: 0 },
  { text: '║        P R O T O A G E N T            ║', classes: 'terminal-green terminal-bold', delay: 50 },
  { text: '╚═══════════════════════════════════════╝', classes: 'terminal-green terminal-bold', delay: 100 },
  { text: '"The beginning stage of something that will later evolve."', classes: 'terminal-dim', delay: 200 },
  { text: '', classes: '', delay: 250 },
  { text: 'Model: anthropic / claude-sonnet-4-20250514', classes: 'terminal-dim', delay: 300 },
  { text: '', classes: '', delay: 350 },

  // User prompt
  { text: '> Fix the type error in config.ts', classes: '', delay: 800 },
  { text: '', classes: '', delay: 900 },

  // Tool calls
  { text: '⟳ read_file config.ts', classes: 'terminal-yellow', delay: 1200 },
  { text: '✓ read_file config.ts', classes: 'terminal-green', delay: 2000 },
  { text: '⟳ grep_search "interface Config"', classes: 'terminal-yellow', delay: 2200 },
  { text: '✓ grep_search "interface Config"', classes: 'terminal-green', delay: 2800 },
  { text: '⟳ edit_file config.ts', classes: 'terminal-yellow', delay: 3000 },
  { text: '', classes: '', delay: 3100 },

  // Approval prompt
  { text: '╭──────────────────────────────────────╮', classes: 'terminal-yellow', delay: 3200 },
  { text: '│ Approval Required                    │', classes: 'terminal-yellow terminal-bold', delay: 3250 },
  { text: '│ Write to file: config.ts             │', classes: 'terminal-text', delay: 3300 },
  { text: '│ > Approve once                       │', classes: 'terminal-green', delay: 3400 },
  { text: '╰──────────────────────────────────────╯', classes: 'terminal-yellow', delay: 3450 },
  { text: '', classes: '', delay: 3500 },

  { text: '✓ edit_file config.ts', classes: 'terminal-green', delay: 3700 },
  { text: '', classes: '', delay: 3800 },

  // Response
  { text: 'Fixed the type mismatch — the logLevel property', classes: 'terminal-text-bright', delay: 4000 },
  { text: 'was declared as string but setLogLevel() expects', classes: 'terminal-text-bright', delay: 4050 },
  { text: 'a LogLevel enum. Added a parse step to convert.', classes: 'terminal-text-bright', delay: 4100 },
  { text: '', classes: '', delay: 4200 },

  // Usage bar
  { text: 'tokens: 1,247↓ 156↑ | ctx: 12% | cost: $0.0043', classes: 'terminal-dim', delay: 4400 },
]

const visibleCount = ref(0)
const showCursor = ref(true)
let timeouts: ReturnType<typeof setTimeout>[] = []

onMounted(() => {
  lines.forEach((line, index) => {
    const t = setTimeout(() => {
      visibleCount.value = index + 1
    }, line.delay)
    timeouts.push(t)
  })

  // Loop: reset after all lines are shown + a pause
  const totalDuration = lines[lines.length - 1].delay + 3000
  const loopTimeout = setTimeout(() => {
    visibleCount.value = 0
    // Small delay then restart
    const restartTimeout = setTimeout(() => {
      lines.forEach((line, index) => {
        const t = setTimeout(() => {
          visibleCount.value = index + 1
        }, line.delay)
        timeouts.push(t)
      })
    }, 500)
    timeouts.push(restartTimeout)
  }, totalDuration)
  timeouts.push(loopTimeout)
})

onUnmounted(() => {
  timeouts.forEach(clearTimeout)
})
</script>

<template>
  <div class="terminal-window">
    <div class="terminal-titlebar">
      <div class="terminal-dot red"></div>
      <div class="terminal-dot yellow"></div>
      <div class="terminal-dot green"></div>
      <div class="terminal-title">protoagent</div>
    </div>
    <div class="terminal-body">
      <div
        v-for="(line, index) in lines.slice(0, visibleCount)"
        :key="index"
        class="terminal-line"
        :class="line.classes"
        :style="{ animationDelay: '0s' }"
      >
        {{ line.text }}<span v-if="index === visibleCount - 1 && showCursor" class="terminal-cursor"></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-line {
  opacity: 1;
  animation: none;
}
</style>
