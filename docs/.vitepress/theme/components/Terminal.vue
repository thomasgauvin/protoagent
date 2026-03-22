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
  // Generate a random session ID - use fallback for non-secure contexts
  const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().slice(0, 8)
    }
    // Fallback for non-secure contexts (http://192.168.x.x)
    return Math.random().toString(36).substring(2, 10)
  }
  sessionId.value = generateId()
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
      sandbox="allow-scripts allow-same-origin allow-forms"
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
