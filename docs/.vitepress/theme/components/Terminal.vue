<script setup lang="ts">
import { ref, onMounted } from 'vue'

const terminalUrl = ref('')
const isLoading = ref(true)

onMounted(() => {
  // Generate a random session ID
  const sessionId = Math.random().toString(36).substring(2, 10)
  // Use the worker URL - in production this should be your deployed worker
  terminalUrl.value = `${window.location.origin}/s/${sessionId}`
  isLoading.value = false
})
</script>

<template>
  <div class="terminal-container">
    <div v-if="isLoading" class="loading">
      Loading terminal...
    </div>
    <iframe
      v-else
      :src="terminalUrl"
      class="terminal-iframe"
      allow="fullscreen"
    ></iframe>
  </div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 600px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  overflow: hidden;
  background: #030805;
}

.terminal-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--vp-c-text-2);
}
</style>
