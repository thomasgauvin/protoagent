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
  'DOCS BUILT LIKE A TERMINAL',
]

const stats = [
  { label: '// readable codebase', value: '~2K', width: '78%' },
  { label: '// core loop', value: 'VISIBLE', width: '92%' },
  { label: '// docs mode', value: 'LIVE', width: '100%' },
]

const terminalLines = [
  { type: 'prompt', text: 'C:\\PROTO> agent start --repo="./myapp"' },
  { type: 'dim', text: '  Indexing 847 files [########] 100%' },
  { type: 'gap', text: '' },
  { type: 'prompt', text: 'USER> add rate limiting to all API routes' },
  { type: 'gap', text: '' },
  { type: 'dim', text: '  [PLAN] Found 14 unprotected endpoints' },
  { type: 'dim', text: '  [PLAN] Strategy: Redis sliding window' },
  { type: 'dim', text: '  [EXEC] Creating middleware/rateLimit.ts' },
  { type: 'dim', text: '  [EXEC] Patching 14 route files...' },
  { type: 'dim', text: '  [TEST] Running test suite...' },
  { type: 'gap', text: '' },
  { type: 'ok', text: '  [OK] 52/52 tests passing' },
  { type: 'ok', text: '  [OK] PR #847 opened on GitHub' },
  { type: 'ok', text: '  [OK] Changelog generated' },
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
  font-size: 0.74rem;
}

.pa-marquee-item span {
  color: var(--green);
}

.pa-hero,
.pa-features {
  max-width: var(--content-width);
  margin: 0 auto;
  padding-left: 28px;
  padding-right: 28px;
}

.pa-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 42px;
  padding-top: 54px;
  padding-bottom: 54px;
  border-bottom: 2px solid var(--border-strong);
}

.pa-hero-eyebrow {
  margin-bottom: 16px;
  color: var(--text-dim);
  font-size: 0.8rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.pa-logo {
  margin: 0 0 20px;
  color: var(--green);
  font-family: var(--mono);
  font-size: clamp(0.9rem, 1.6vw, 1.25rem);
  line-height: 1.15;
  text-shadow: 0 0 10px var(--green-glow), 0 0 34px rgba(114, 255, 140, 0.12);
}

.pa-hero-sub {
  margin-bottom: 16px;
  padding-left: 14px;
  border-left: 3px solid var(--green);
  color: var(--green-bright);
  font-family: var(--display);
  font-size: clamp(2rem, 4vw, 3.1rem);
  letter-spacing: 0.08em;
  line-height: 0.96;
  text-transform: uppercase;
}

.pa-hero-text,
.pa-hero-subtext {
  max-width: 640px;
  font-size: 1rem;
  line-height: 1.85;
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
  min-height: 46px;
  padding: 12px 20px;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 0.76rem;
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
  gap: 18px;
  margin-top: 34px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}

.pa-stat-label {
  color: var(--text-dim);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pa-stat-value {
  margin-top: 6px;
  color: var(--green-bright);
  font-family: var(--display);
  font-size: 2.6rem;
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
  font-size: 0.76rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.pa-terminal-body {
  min-height: 100%;
  padding: 20px;
  font-size: 0.88rem;
  line-height: 1.85;
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
  margin: 0 0 34px;
  padding: 11px 16px;
  background: var(--green);
  color: var(--bg);
  font-family: var(--display);
  font-size: 1.6rem;
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
  padding: 26px 22px;
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
  margin-bottom: 12px;
  padding: 2px 9px;
  border: 1px solid var(--text-faint);
  color: var(--text-faint);
  font-family: var(--display);
  font-size: 2.2rem;
  line-height: 1;
}

.pa-feature-title {
  margin: 0 0 10px;
  color: var(--green-bright);
  font-family: var(--display);
  font-size: 2rem;
  letter-spacing: 0.08em;
  line-height: 0.92;
  text-transform: uppercase;
}

.pa-feature-text {
  margin: 0;
  color: var(--text);
  line-height: 1.8;
}

.pa-feature-tag {
  margin-top: 14px;
  color: var(--green);
  font-size: 0.72rem;
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

@media (max-width: 960px) {
  .pa-hero,
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
  .pa-hero,
  .pa-features {
    padding-left: 16px;
    padding-right: 16px;
  }

  .pa-hero {
    padding-top: 30px;
    gap: 26px;
  }

  .pa-logo {
    font-size: 0.7rem;
  }

  .pa-actions,
  .pa-stats {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .pa-btn {
    width: 100%;
  }

  .pa-stats {
    display: grid;
  }

  .pa-terminal-body {
    padding: 14px;
    font-size: 0.76rem;
  }
}
</style>
