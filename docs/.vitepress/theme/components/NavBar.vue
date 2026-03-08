<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vitepress'

const router = useRouter()

const navLinks = [
  { text: '[F1] GUIDE', link: '/guide/getting-started', match: '/guide/' },
  { text: '[F2] TUTORIAL', link: '/tutorial/', match: '/tutorial/' },
  { text: '[F3] REFERENCE', link: '/reference/spec', match: '/reference/' },
  { text: '[F4] ARCHITECTURE', link: '/reference/architecture', match: '/reference/architecture' },
]

const clock = ref('--:--:--')
let timer: ReturnType<typeof setInterval> | undefined

const tick = () => {
  clock.value = new Date().toTimeString().slice(0, 8)
}

onMounted(() => {
  tick()
  timer = setInterval(tick, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const currentPath = computed(() => router.route.path)

const isActive = (match: string) => currentPath.value.startsWith(match)
</script>

<template>
  <header class="pa-nav">
    <div class="pa-nav-top">
      <span>PROTOAGENT//DOCS v0.0.1 -- CONNECTED AT 56600 BAUD</span>
      <span>{{ clock }}</span>
    </div>

    <div class="pa-nav-main">
      <a class="pa-nav-brand" href="/" aria-label="ProtoAgent home">
        <pre class="pa-nav-logo">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</pre>
        <span class="pa-nav-sub">// READABLE AI CODING AGENT //</span>
      </a>

      <nav class="pa-nav-links" aria-label="Primary">
        <a
          v-for="link in navLinks"
          :key="link.text"
          :href="link.link"
          :class="{ active: isActive(link.match) }"
        >
          {{ link.text }}
        </a>
      </nav>

      <div class="pa-nav-meta">
        <span>SESSION: ONLINE</span>
        <span>THEME: NEON-GREEN</span>
        <span>MODE: DOC TERMINAL</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.pa-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 2px solid var(--border-strong);
  background: rgba(4, 9, 6, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 28px rgba(114, 255, 140, 0.08);
}

.pa-nav-top {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 28px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.pa-nav-main {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 14px 28px 16px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 28px;
  align-items: center;
}

.pa-nav-brand {
  text-decoration: none;
}

.pa-nav-logo {
  margin: 0;
  color: var(--green);
  font-family: var(--mono);
  font-size: 0.72rem;
  line-height: 1.05;
  letter-spacing: 0.02em;
  text-shadow: 0 0 10px var(--green-glow), 0 0 22px rgba(114, 255, 140, 0.2);
}

.pa-nav-sub {
  display: block;
  margin-top: 2px;
  color: var(--text-dim);
  font-size: 0.68rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.pa-nav-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  border: 1px solid var(--border);
}

.pa-nav-links a {
  padding: 11px 16px;
  border-right: 1px solid var(--border);
  color: var(--text-dim);
  text-decoration: none;
  font-size: 0.76rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transition: all 0.15s ease;
}

.pa-nav-links a:last-child {
  border-right: 0;
}

.pa-nav-links a:hover,
.pa-nav-links a.active {
  background: var(--green);
  color: var(--bg);
  text-shadow: none;
  box-shadow: 0 0 18px rgba(114, 255, 140, 0.24);
}

.pa-nav-meta {
  display: grid;
  justify-items: end;
  color: var(--text-dim);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1.8;
}

@media (max-width: 1100px) {
  .pa-nav-main {
    grid-template-columns: 1fr;
    justify-items: start;
  }

  .pa-nav-links,
  .pa-nav-meta {
    justify-self: stretch;
  }

  .pa-nav-meta {
    justify-items: start;
  }
}

@media (max-width: 640px) {
  .pa-nav-top,
  .pa-nav-main {
    padding-left: 16px;
    padding-right: 16px;
  }

  .pa-nav-logo {
    font-size: 0.51rem;
  }

  .pa-nav-links {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pa-nav-links a:nth-child(2n) {
    border-right: 0;
  }

  .pa-nav-links a:nth-child(-n + 2) {
    border-bottom: 1px solid var(--border);
  }
}
</style>
