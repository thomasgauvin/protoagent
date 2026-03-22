<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const sessionId = ref('')
const isLoading = ref(true)

const terminalUrl = computed(() => {
  // Use local worker for development, production for deployed site
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const isLocal = hostname === 'localhost' || /^192\.168\./.test(hostname) || /^10\./.test(hostname)
  const baseUrl = isLocal ? `http://${hostname}:8787` : 'https://demo.protoagent.dev'
  return `${baseUrl}/s/${sessionId.value}`
})

onMounted(() => {
  // Generate a random session ID
  sessionId.value = Math.random().toString(36).substring(2, 10)
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
