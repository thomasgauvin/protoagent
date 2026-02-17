<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
</script>

<template>
  <!-- Render the full VitePress layout (navbar is hidden via CSS) -->
  <DefaultTheme.Layout />
</template>

<style>
/* Hide the default VitePress navbar since we use our custom one */
.VPNav {
  display: none !important;
}
</style>
