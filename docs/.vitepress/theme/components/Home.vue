<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

const { frontmatter } = useData()

const hero = computed(() => frontmatter.value.hero || {})
const features = computed(() => frontmatter.value.features || [])

const marqueeItems = [
  'READABLE AI CODING AGENT',
  'MULTI-STEP TOOL LOOPS',
  'MCP + SKILLS SUPPORT',
  'SESSION PERSISTENCE',
  'LEARNING BY BUILDING',
]

const stats = [
  { label: '// readable codebase', value: 'SMALL', width: '78%' },
  { label: '// core loop', value: 'VISIBLE', width: '92%' },
  { label: '// docs mode', value: 'LIVE', width: '100%' },
]

const terminalLines = [
  { type: 'prompt', text: 'PROTO> read this repo and explain how the agent loop works' },
  { type: 'dim', text: '  Reading src/agentic-loop.ts...' },
  { type: 'gap', text: '' },
  { type: 'prompt', text: 'USER> now add session resume support' },
  { type: 'gap', text: '' },
  { type: 'dim', text: '  [PLAN] Add session persistence in src/sessions.ts' },
  { type: 'dim', text: '  [PLAN] Wire --session into src/cli.tsx' },
  { type: 'dim', text: '  [EXEC] Updating App state and save/load flow...' },
  { type: 'dim', text: '  [TEST] Re-running the flow from a fresh terminal...' },
  { type: 'dim', text: '  [TEST] Running test suite...' },
  { type: 'gap', text: '' },
  { type: 'ok', text: '  [OK] sessions resume with TODO state intact' },
  { type: 'ok', text: '  [OK] the exact resume command is printed on quit' },
  { type: 'ok', text: '  [OK] docs updated to match the runtime' },
]
</script>

<template>
  <div class="pa-home">
    <section class="pa-marquee" aria-label="ProtoAgent highlights">
      <div class="pa-marquee-track">
        <span v-for="(item, index) in [...marqueeItems, ...marqueeItems]" :key="`${item}-${index}`" class="pa-marquee-item">
          <span>★</span> {{ item }}
        </span>
      </div>
    </section>

    <section class="pa-hero">
      <div class="pa-hero-copy">
        <div class="pa-hero-eyebrow">{{ hero.eyebrow }}</div>

        <pre class="pa-logo" aria-label="ProtoAgent wordmark">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</pre>

        <div class="pa-hero-sub">{{ hero.title }}</div>
        <p class="pa-hero-text">{{ hero.text }}</p>
        <p class="pa-hero-subtext">{{ hero.subtext }}</p>

        <div class="pa-actions">
          <a
            v-for="action in hero.actions"
            :key="action.text"
            :href="action.link"
            class="pa-btn"
            :class="action.theme === 'brand' ? 'is-brand' : 'is-ghost'"
          >
            {{ action.text }}
          </a>
        </div>

        <div class="pa-stats">
          <div v-for="stat in stats" :key="stat.label" class="pa-stat">
            <div class="pa-stat-label">{{ stat.label }}</div>
            <div class="pa-stat-value">{{ stat.value }}</div>
            <div class="pa-stat-bar"><span :style="{ width: stat.width }"></span></div>
          </div>
        </div>
      </div>

      <div class="pa-terminal">
        <div class="pa-terminal-head">
          <span>PROTOAGENT -- LIVE SESSION</span>
          <span>NODE 12</span>
        </div>
        <div class="pa-terminal-body">
          <div
            v-for="line in terminalLines"
            :key="`${line.type}-${line.text}`"
            class="pa-terminal-line"
            :class="`is-${line.type}`"
          >
            {{ line.text }}
          </div>
          <div class="pa-terminal-line is-prompt">PROTO&gt;<span class="pa-cursor"></span></div>
        </div>
      </div>
    </section>

    <section class="pa-features">
      <div class="pa-section-bar">// SYSTEM CAPABILITIES -- MODULE INDEX</div>
      <div class="pa-feature-grid">
        <article v-for="(feature, index) in features" :key="feature.title" class="pa-feature-card">
          <div class="pa-feature-num">{{ String(index + 1).padStart(2, '0') }}</div>
          <h2 class="pa-feature-title">{{ feature.title }}</h2>
          <p class="pa-feature-text">{{ feature.details }}</p>
          <div v-if="feature.tag" class="pa-feature-tag">{{ feature.tag }}</div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pa-home {
  padding-bottom: 64px;
}

.pa-marquee {
  overflow: hidden;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: rgba(10, 24, 14, 0.9);
}

.pa-marquee-track {
  display: flex;
  width: max-content;
  animation: marquee 24s linear infinite;
}

.pa-marquee-item {
  flex: none;
  padding: 10px 22px;
  color: var(--text-dim);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: var(--text-xs);
}

.pa-marquee-item span {
  color: var(--green);
}

.pa-hero,
.pa-features {
  max-width: var(--content-width);
  margin: 0 auto;
  padding-left: clamp(18px, 3vw, 28px);
  padding-right: clamp(18px, 3vw, 28px);
}

.pa-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr);
  gap: clamp(24px, 4vw, 42px);
  padding-top: clamp(32px, 5vw, 54px);
  padding-bottom: clamp(32px, 5vw, 54px);
  border-bottom: 2px solid var(--border-strong);
}

.pa-hero-eyebrow {
  margin-bottom: 16px;
  color: var(--text-dim);
  font-size: var(--text-sm);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.pa-logo {
  margin: 0 0 20px;
  color: var(--green);
  font-family: monospace;
  font-size: clamp(0.76rem, 1.4vw, 1.05rem);
  line-height: 1;
  text-shadow: 0 0 10px var(--green-glow), 0 0 34px rgba(114, 255, 140, 0.12);
  max-width: 100%;
  overflow-x: hidden;
}

.pa-hero-sub {
  margin-bottom: 16px;
  padding-left: 14px;
  border-left: 3px solid var(--green);
  color: var(--green-bright);
  font-family: var(--display);
  font-size: clamp(1.5rem, 3.1vw, 2.5rem);
  letter-spacing: 0.08em;
  line-height: 0.96;
  text-transform: uppercase;
}

.pa-hero-text,
.pa-hero-subtext {
  max-width: 640px;
  font-family: var(--sans);
  font-size: clamp(var(--text-base), 1vw, 0.95rem);
  line-height: 1.75;
}

.pa-hero-text {
  color: var(--text);
  margin: 0 0 12px;
}

.pa-hero-subtext {
  color: var(--text-dim);
  margin: 0 0 28px;
}

.pa-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.pa-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 14px 20px;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: var(--text-sm);
  transition: all 0.15s ease;
}

.pa-btn.is-brand {
  border: 2px solid var(--green);
  color: var(--bg);
  background: var(--green);
  box-shadow: 0 0 24px rgba(114, 255, 140, 0.18);
}

.pa-btn.is-brand:hover {
  background: var(--green-bright);
  border-color: var(--green-bright);
}

.pa-btn.is-ghost {
  border: 2px solid var(--border-strong);
  color: var(--green);
  background: transparent;
}

.pa-btn.is-ghost:hover {
  border-color: var(--green);
  box-shadow: 0 0 22px rgba(114, 255, 140, 0.1);
}

.pa-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}

.pa-stat-label {
  color: var(--text-dim);
  font-size: var(--text-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pa-stat-value {
  margin-top: 6px;
  color: var(--green-bright);
  font-family: var(--display);
  font-size: clamp(1.7rem, 2.7vw, 2.2rem);
  line-height: 1;
  letter-spacing: 0.05em;
  text-shadow: 0 0 10px var(--green-glow);
}

.pa-stat-bar {
  height: 4px;
  margin-top: 10px;
  background: rgba(114, 255, 140, 0.08);
}

.pa-stat-bar span {
  display: block;
  height: 100%;
  background: var(--green);
  box-shadow: 0 0 10px rgba(114, 255, 140, 0.3);
}

.pa-terminal {
  border: 2px solid var(--border-strong);
  background: linear-gradient(180deg, rgba(6, 14, 8, 0.97), rgba(3, 8, 5, 0.98));
  box-shadow: 0 0 32px rgba(114, 255, 140, 0.08), inset 0 0 44px rgba(114, 255, 140, 0.03);
}

.pa-terminal-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 16px;
  background: var(--green);
  color: var(--bg);
  font-size: var(--text-sm);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.pa-terminal-body {
  min-height: 100%;
  padding: clamp(16px, 2vw, 20px);
  font-size: clamp(0.65rem, 0.85vw, 0.76rem);
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.pa-terminal-line.is-prompt {
  color: var(--green);
}

.pa-terminal-line.is-dim {
  color: var(--text-dim);
}

.pa-terminal-line.is-ok {
  color: var(--green-bright);
}

.pa-terminal-line.is-gap {
  min-height: 12px;
}

.pa-cursor {
  display: inline-block;
  width: 10px;
  height: 16px;
  margin-left: 4px;
  vertical-align: middle;
  background: var(--green);
  box-shadow: 0 0 10px var(--green-glow);
  animation: terminalBlink 0.9s step-end infinite;
}

.pa-features {
  padding-top: 0;
}

.pa-section-bar {
  margin: 0 0 24px;
  padding: 8px 14px;
  background: var(--green);
  color: var(--bg);
  font-family: var(--display);
  font-size: clamp(0.8rem, 1.8vw, 1.05rem);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.pa-feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--border-strong);
}

.pa-feature-card {
  min-height: 100%;
  padding: 18px 16px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: rgba(7, 17, 10, 0.88);
  transition: background 0.15s ease;
}

.pa-feature-card:nth-child(3n) {
  border-right: 0;
}

.pa-feature-card:nth-last-child(-n + 3) {
  border-bottom: 0;
}

.pa-feature-card:hover {
  background: rgba(12, 27, 16, 0.95);
}

.pa-feature-num {
  display: inline-block;
  margin-bottom: 8px;
  padding: 1px 7px;
  border: 1px solid var(--text-faint);
  color: var(--text-faint);
  font-family: var(--display);
  font-size: clamp(1.05rem, 1.8vw, 1.3rem);
  line-height: 1;
}

.pa-feature-title {
  margin: 0 0 6px;
  color: var(--green-bright);
  font-family: var(--display);
  font-size: clamp(0.95rem, 1.6vw, 1.2rem);
  letter-spacing: 0.08em;
  line-height: 0.92;
  text-transform: uppercase;
}

.pa-feature-text {
  margin: 0;
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--text-sm);
  line-height: 1.7;
}

.pa-feature-tag {
  margin-top: 10px;
  color: var(--green);
  font-size: var(--text-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pa-feature-tag::before {
  content: '> ';
}

@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@media (max-width: 1180px) {
  .pa-hero {
    grid-template-columns: 1fr;
  }

  .pa-feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pa-feature-card:nth-child(3n) {
    border-right: 1px solid var(--border);
  }

  .pa-feature-card:nth-child(2n) {
    border-right: 0;
  }

  .pa-feature-card:nth-last-child(-n + 3) {
    border-bottom: 1px solid var(--border);
  }

  .pa-feature-card:nth-last-child(-n + 2) {
    border-bottom: 0;
  }
}

@media (max-width: 960px) {
  .pa-hero {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .pa-hero-copy {
    display: contents;
  }

  .pa-hero-eyebrow {
    order: 1;
  }

  .pa-logo {
    order: 2;
  }

  .pa-hero-sub {
    order: 3;
    margin-bottom: 24px;
  }

  .pa-terminal {
    order: 4;
    margin-bottom: 24px;
  }

  .pa-hero-text {
    order: 5;
  }

  .pa-hero-subtext {
    order: 6;
  }

  .pa-actions {
    order: 7;
  }

  .pa-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    order: 8;
  }

  .pa-feature-grid {
    grid-template-columns: 1fr;
  }

  .pa-feature-card,
  .pa-feature-card:nth-child(3n) {
    border-right: 0;
  }

  .pa-feature-card:nth-last-child(-n + 3) {
    border-bottom: 1px solid var(--border);
  }

  .pa-feature-card:last-child {
    border-bottom: 0;
  }
}

@media (max-width: 640px) {
  .pa-hero {
    padding-top: 30px;
    gap: 0;
  }

  .pa-actions,
  .pa-stats {
    flex-direction: column;
  }

  .pa-btn {
    width: 100%;
  }

  .pa-stats {
    display: grid;
    grid-template-columns: 1fr;
  }

  .pa-terminal-head {
    padding: 10px 12px;
    font-size: 0.58rem;
    letter-spacing: 0.12em;
  }

  .pa-terminal-body {
    padding: 14px;
    font-size: var(--text-sm);
  }
}
</style>
