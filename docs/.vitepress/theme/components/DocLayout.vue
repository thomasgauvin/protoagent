<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
</script>

<template>
  <!-- Render the full VitePress layout (navbar is hidden via CSS) -->
  <DefaultTheme.Layout />
</template>

<style>
/* Hide duplicated VitePress chrome; custom docs shell provides it. */
.VPNav,
.VPSidebar,
.VPLocalNav {
  display: none !important;
}
</style>
