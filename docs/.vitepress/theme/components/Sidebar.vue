<script setup lang="ts">
import { useData, useRouter } from 'vitepress'

const { site } = useData()
const router = useRouter()

const siteConfig = site.value.themeConfig as any

const getActiveSidebar = () => {
  const path = router.route.path
  for (const [key, items] of Object.entries(siteConfig?.sidebar || {})) {
    if (path.startsWith(key)) {
      return items
    }
  }
  return []
}

const activeSidebar = getActiveSidebar()

const isActive = (link: string) => {
  return router.route.path === link || router.route.path.startsWith(link)
}

const flattenItems = (items: any[]): any[] => {
  const result: any[] = []
  items.forEach(item => {
    if (item.items) {
      result.push({
        text: item.text,
        level: 0,
      })
      item.items.forEach((child: any) => {
        result.push({
          text: child.text,
          link: child.link,
          level: 1,
        })
      })
    }
  })
  return result
}

const flatItems = flattenItems(activeSidebar as any[])
</script>

<template>
  <aside class="vp-sidebar">
    <div class="vp-sidebar-inner">
      <div class="vp-sidebar-group" v-for="item in flatItems" :key="item.text">
        <div v-if="item.level === 0" class="vp-sidebar-group-title">{{ item.text }}</div>
        <a
          v-else
          :href="item.link"
          class="vp-sidebar-link"
          :class="{ active: isActive(item.link) }"
        >
          {{ item.text }}
        </a>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.vp-sidebar {
  position: fixed;
  left: 0;
  top: 52px;
  width: 240px;
  height: calc(100vh - 52px);
  border-right: 1px solid var(--border);
  background: var(--black);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.vp-sidebar-inner {
  padding: 20px 0;
}

.vp-sidebar-group-title {
  font-family: var(--mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-dim);
  padding: 12px 20px 8px;
  margin-top: 12px;
}

.vp-sidebar-group-title:first-child {
  margin-top: 0;
}

.vp-sidebar-link {
  display: block;
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--text);
  text-decoration: none;
  padding: 10px 20px;
  border-left: 2px solid transparent;
  transition: all 0.15s;
  letter-spacing: 0.01em;
}

.vp-sidebar-link:hover {
  color: var(--text-bright);
  background: rgba(0, 255, 136, 0.05);
}

.vp-sidebar-link.active {
  color: var(--accent);
  border-left-color: var(--accent);
  font-weight: 600;
}

@media (max-width: 768px) {
  .vp-sidebar {
    display: none;
  }
}
</style>
