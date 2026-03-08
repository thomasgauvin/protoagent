<script setup lang="ts">
import { computed } from 'vue'
import { useData, useRouter } from 'vitepress'

const { site } = useData()
const router = useRouter()

const activeSidebar = computed(() => {
  const sidebar = (site.value.themeConfig as { sidebar?: Record<string, any[]> }).sidebar || {}
  const path = router.route.path

  for (const [prefix, items] of Object.entries(sidebar)) {
    if (path.startsWith(prefix)) return items
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

const isActive = (link?: string) => !!link && router.route.path.startsWith(link)
</script>

<template>
  <aside class="pa-sidebar">
    <div class="pa-sidebar-inner">
      <div class="pa-sidebar-title">// MODULE INDEX</div>

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
  </aside>
</template>

<style scoped>
.pa-sidebar {
  position: fixed;
  top: var(--nav-height);
  left: 0;
  width: var(--sidebar-width);
  height: calc(100vh - var(--nav-height));
  border-right: 1px solid var(--border-strong);
  background: rgba(4, 10, 6, 0.92);
  box-shadow: inset -1px 0 0 rgba(114, 255, 140, 0.04);
  overflow-y: auto;
}

.pa-sidebar-inner {
  padding: 18px 0 32px;
}

.pa-sidebar-title,
.pa-sidebar-group {
  padding: 10px 20px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.pa-sidebar-title {
  font-family: var(--display);
  font-size: 1.55rem;
  color: var(--green);
  text-shadow: 0 0 10px var(--green-glow);
}

.pa-sidebar-group {
  margin-top: 10px;
  font-size: 0.76rem;
}

.pa-sidebar-link {
  display: block;
  padding: 11px 20px 11px 26px;
  border-left: 2px solid transparent;
  color: var(--text);
  text-decoration: none;
  font-size: 0.86rem;
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

@media (max-width: 960px) {
  .pa-sidebar {
    display: none;
  }
}
</style>
