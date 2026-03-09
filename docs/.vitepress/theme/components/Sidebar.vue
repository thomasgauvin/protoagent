<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useData, useRouter } from 'vitepress'

const { site, page } = useData()
const router = useRouter()
const mobileMenuOpen = ref(false)

const pageTitle = computed(() => page.value.title)

const activeSidebar = computed(() => {
  const sidebarInfo = (site.value.themeConfig as any).sidebar || {}
  const path = router.route.path

  for (const [prefix, items] of Object.entries(sidebarInfo)) {
    if (path.startsWith(prefix)) return items as any[]
  }

  return []
})

const flatItems = computed(() => {
  const result: Array<{ text: string; link?: string; level: 0 | 1 }> = []

  activeSidebar.value.forEach((item: any) => {
    if (item.items?.length) {
      result.push({ text: item.text, level: 0 })
      item.items.forEach((child: any) => {
        result.push({ text: child.text, link: child.link, level: 1 })
      })
    }
  })

  return result
})

const currentPath = computed(() => router.route.path)

const activeSectionTitle = computed(() => activeSidebar.value[0]?.text || 'Pages')

const isActive = (link?: string) => {
  if (!link) return false
  const normalize = (p: string) => p.replace(/\.html$/, '').replace(/\/$/, '')
  return normalize(currentPath.value) === normalize(link)
}

watch(currentPath, () => {
  mobileMenuOpen.value = false
})
</script>

<template>
  <aside class="pa-sidebar">
    <button
      class="pa-sidebar-mobile-toggle"
      type="button"
      :aria-expanded="mobileMenuOpen"
      aria-controls="pa-sidebar-mobile-nav"
      @click="mobileMenuOpen = !mobileMenuOpen"
    >
      <span class="pa-breadcrumb" v-if="pageTitle">// {{ activeSectionTitle.toUpperCase() }} <span class="pa-dim">&gt;</span> {{ pageTitle.toUpperCase() }}</span>
      <span class="pa-breadcrumb" v-else>// {{ activeSectionTitle.toUpperCase() }}</span>
      <span>{{ mobileMenuOpen ? '[CLOSE]' : '[PAGES]' }}</span>
    </button>

    <div class="pa-sidebar-inner">
      <template v-for="item in flatItems" :key="`${item.level}-${item.text}`">
        <div v-if="item.level === 0" class="pa-sidebar-group">{{ item.text }}</div>
        <a
          v-else
          :href="item.link"
          class="pa-sidebar-link"
          :class="{ active: isActive(item.link) }"

        >
          {{ item.text }}
        </a>
      </template>
    </div>

    <div v-if="mobileMenuOpen" id="pa-sidebar-mobile-nav" class="pa-sidebar-mobile-panel">
      <template v-for="item in flatItems" :key="`mobile-${item.level}-${item.text}`">
        <div v-if="item.level === 0" class="pa-sidebar-mobile-group">{{ item.text }}</div>
        <a
          v-else
          :href="item.link"
          class="pa-sidebar-mobile-link"
          :class="{ active: isActive(item.link) }"

        >
          {{ item.text }}
        </a>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.pa-sidebar {
  position: sticky;
  top: calc(var(--nav-height) - 1px);
  flex-shrink: 0;
  width: var(--sidebar-width);
  height: calc(100vh - var(--nav-height) + 1px);
  border-right: 1px solid var(--border-strong);
  background: transparent;
  box-shadow: inset -1px 0 0 rgba(114, 255, 140, 0.04);
  overflow-y: auto;
}

.pa-sidebar-mobile-toggle,
.pa-sidebar-mobile-panel {
  display: none;
}

.pa-sidebar-inner {
  padding: 8px 0 24px;
}

.pa-sidebar-title,
.pa-sidebar-group {
  padding: 8px 20px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.pa-sidebar-title {
  font-family: var(--display);
  font-size: var(--text-xl);
  color: var(--green);
  text-shadow: 0 0 10px var(--green-glow);
}

.pa-sidebar-group {
  margin-top: 4px;
  font-size: 0.78rem;
}

.pa-sidebar-link {
  display: block;
  padding: 9px 20px 9px 24px;
  border-left: 2px solid transparent;
  color: var(--text);
  text-decoration: none;
  font-family: var(--sans);
  font-size: var(--text-base);
  line-height: 1.4;
  transition: all 0.15s ease;
}

.pa-sidebar-link:hover {
  background: rgba(114, 255, 140, 0.06);
  color: var(--green-bright);
}

.pa-sidebar-link.active {
  border-left-color: var(--green);
  background: rgba(114, 255, 140, 0.08);
  color: var(--green);
  text-shadow: 0 0 8px rgba(114, 255, 140, 0.18);
}

@media (max-width: 1100px) {
  .pa-sidebar {
    position: static;
    top: auto;
    width: 100%;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-strong);
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }

  .pa-sidebar-inner {
    display: none;
  }

  .pa-sidebar-mobile-toggle {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    border: 0;
    background: transparent;
    color: var(--green);
    font-family: var(--mono);
    font-size: var(--text-sm);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .pa-sidebar-mobile-panel {
    display: grid;
    padding: 0 20px 18px;
    border-top: 1px solid var(--border);
  }

  .pa-sidebar-mobile-group {
    padding: 14px 0 8px;
    color: var(--text-dim);
    font-size: var(--text-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .pa-sidebar-mobile-link {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-top: 0;
    color: var(--text);
    text-decoration: none;
    font-size: var(--text-sm);
    line-height: 1.35;
    background: rgba(114, 255, 140, 0.03);
  }

  .pa-sidebar-mobile-group + .pa-sidebar-mobile-link {
    border-top: 1px solid var(--border);
  }

  .pa-sidebar-mobile-link.active {
    background: rgba(114, 255, 140, 0.12);
    color: var(--green);
  }

  .pa-breadcrumb {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }
  
  .pa-dim {
    color: var(--text-dim);
  }
}
</style>
