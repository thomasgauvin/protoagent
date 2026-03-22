<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import NavBar from './components/NavBar.vue'
import Sidebar from './components/Sidebar.vue'
import Home from './components/Home.vue'
import DocLayout from './components/DocLayout.vue'
import FooterBar from './components/FooterBar.vue'

const { page } = useData()

const isHome = computed(() => page.value.relativePath === 'index.md')
</script>

<template>
  <div class="vp-container">
    <NavBar />
    <div class="vp-wrapper" :class="{ 'is-docs': !isHome }">
      <Sidebar v-if="!isHome" />
      <main class="vp-main">
        <Home v-if="isHome" />
        <DocLayout v-else />
      </main>
    </div>
    <FooterBar />
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
  width: 100%;
}

.vp-wrapper.is-docs {
  max-width: var(--content-width);
  margin: 0 auto;
}

.vp-main {
  flex: 1;
  min-width: 0;
}

@media (max-width: 1100px) {
  .vp-wrapper {
    flex-direction: column;
  }
}
</style>
