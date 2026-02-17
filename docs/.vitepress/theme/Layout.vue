<script setup lang="ts">
import { useData } from 'vitepress'
import NavBar from './components/NavBar.vue'
import Sidebar from './components/Sidebar.vue'
import Home from './components/Home.vue'
import DocLayout from './components/DocLayout.vue'
import { ref, computed } from 'vue'

const { frontmatter, page } = useData()
const showSidebar = ref(true)

const isHome = computed(() => page.value.relativePath === 'index.md')
const layout = computed(() => frontmatter.value.layout || (isHome.value ? 'home' : 'doc'))
</script>

<template>
  <div class="vp-container">
    <NavBar />
    <div class="vp-wrapper">
      <Sidebar v-if="!isHome && showSidebar" />
      <main class="vp-main" :class="{ 'has-sidebar': !isHome && showSidebar }">
        <Home v-if="isHome" />
        <DocLayout v-else />
      </main>
    </div>
  </div>
</template>

<style scoped>
.vp-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--black);
}

.vp-wrapper {
  display: flex;
  flex: 1;
}

.vp-main {
  flex: 1;
  overflow-y: auto;
  width: 100%;
}

.vp-main.has-sidebar {
  max-width: calc(100% - 240px);
  margin-left: 240px;
}

@media (max-width: 768px) {
  .vp-main.has-sidebar {
    max-width: 100%;
    margin-left: 0;
  }
}
</style>
