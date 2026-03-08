<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import NavBar from './components/NavBar.vue'
import Sidebar from './components/Sidebar.vue'
import Home from './components/Home.vue'
import DocLayout from './components/DocLayout.vue'

const { page } = useData()

const isHome = computed(() => page.value.relativePath === 'index.md')
</script>

<template>
  <div class="vp-container">
    <NavBar />
    <div class="vp-wrapper">
      <Sidebar v-if="!isHome" />
      <main class="vp-main" :class="{ 'has-sidebar': !isHome }">
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
  background: transparent;
}

.vp-wrapper {
  display: flex;
  flex: 1;
}

.vp-main {
  flex: 1;
  width: 100%;
  min-width: 0;
}

.vp-main.has-sidebar {
  margin-left: var(--sidebar-width);
  width: calc(100% - var(--sidebar-width));
}

@media (max-width: 960px) {
  .vp-main.has-sidebar {
    margin-left: 0;
    width: 100%;
  }
}
</style>
