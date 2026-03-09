<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vitepress'

const router = useRouter()

const navLinks = [
  { text: 'GUIDE', link: '/guide/getting-started', match: '/guide/' },
  { text: 'TUTORIAL', link: '/tutorial/', match: '/tutorial/' },
  { text: 'REFERENCE', link: '/reference/spec', match: '/reference/' },
]

const mobileMenuBreakpoint = 680
const mobileMenuOpen = ref(false)

function handleResize() {
  if (window.innerWidth > mobileMenuBreakpoint) {
    mobileMenuOpen.value = false
  }
}

onMounted(() => {
  handleResize()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

const currentPath = computed(() => router.route.path)

const isActive = (match: string) => currentPath.value.startsWith(match)

watch(currentPath, () => {
  mobileMenuOpen.value = false
})
</script>

<template>
  <header class="pa-nav">
    <div class="pa-nav-main">
      <a class="pa-nav-brand" href="/" aria-label="ProtoAgent home">
        <pre class="pa-nav-logo">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</pre>
        <span class="pa-nav-sub">// LEARN BY BUILDING //</span>
      </a>

      <button
        class="pa-nav-toggle"
        type="button"
        :aria-expanded="mobileMenuOpen"
        aria-controls="pa-mobile-nav"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        {{ mobileMenuOpen ? '[CLOSE]' : '[MENU]' }}
      </button>

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

    </div>

    <div v-if="mobileMenuOpen" id="pa-mobile-nav" class="pa-nav-mobile">
      <div class="pa-nav-mobile-inner">
        <nav class="pa-nav-mobile-links" aria-label="Mobile primary">
          <a
            v-for="link in navLinks"
            :key="`mobile-${link.text}`"
            :href="link.link"
            :class="{ active: isActive(link.match) }"
  
          >
            {{ link.text }}
          </a>
        </nav>
      </div>
    </div>
  </header>
</template>

<style scoped>
.pa-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--border-strong);
  background: rgba(4, 9, 6, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 28px rgba(114, 255, 140, 0.08);
}

.pa-nav-main {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 12px 28px 14px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px 28px;
  align-items: center;
}

.pa-nav-brand {
  min-width: 0;
  text-decoration: none;
  padding-top: 8px;
}

.pa-nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 10px 14px;
  border: 1px solid var(--border-strong);
  background: rgba(114, 255, 140, 0.06);
  color: var(--green);
  font-family: var(--mono);
  font-size: var(--text-sm);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
}

.pa-nav-toggle:hover {
  background: rgba(114, 255, 140, 0.12);
}

.pa-nav-logo {
  margin: 0;
  color: var(--green);
  font-family: monospace;
  font-size: var(--text-xs);
  line-height: 1;
  letter-spacing: 0;
  text-shadow: 0 0 10px var(--green-glow), 0 0 22px rgba(114, 255, 140, 0.2);
  max-width: 100%;
  overflow-x: hidden;
}

.pa-nav-sub {
  display: block;
  margin-top: 2px;
  color: var(--text-dim);
  font-size: var(--text-xs);
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.pa-nav-links {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  justify-self: end;
  border: 1px solid var(--border);
}

.pa-nav-links a {
  padding: 8px 12px;
  border-right: 1px solid var(--border);
  color: var(--text-dim);
  text-decoration: none;
  font-size: var(--text-sm);
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

.pa-nav-mobile {
  display: none;
}

@media (max-width: 680px) {
  .pa-nav-main {
    grid-template-columns: auto minmax(0, 1fr);
    justify-items: start;
  }

  .pa-nav-brand {
    grid-column: 1 / -1;
  }

  .pa-nav-links {
    justify-self: stretch;
  }

  .pa-nav-main {
    padding-left: 24px;
    padding-right: 24px;
  }

  .pa-nav-logo {
    font-size: calc(var(--text-xs) - 0.12rem);
  }

  .pa-nav-main {
    gap: 14px;
    padding-top: 10px;
    padding-bottom: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    justify-items: unset;
  }

  .pa-nav-brand {
    grid-column: auto;
  }

  .pa-nav-toggle {
    display: inline-flex;
  }

  .pa-nav-links {
    display: none;
  }

  .pa-nav-mobile {
    display: block;
    border-top: 1px solid var(--border);
  }

  .pa-nav-mobile-inner {
    max-width: var(--content-width);
    margin: 0 auto;
    padding: 12px 24px 24px;
  }

  .pa-nav-mobile-links {
    display: grid;
    border: 1px solid var(--border);
  }

  .pa-nav-mobile-links a {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    text-decoration: none;
    font-size: var(--text-sm);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .pa-nav-mobile-links a:last-child {
    border-bottom: 0;
  }

  .pa-nav-mobile-links a.active {
    background: var(--green);
    color: var(--bg);
  }
}

</style>
