<script setup lang="ts">
import { useData, useRouter } from 'vitepress'

const { site, frontmatter } = useData()
const router = useRouter()

const navLinks = [
  { text: 'Guide', link: '/guide/getting-started' },
  { text: 'Tutorial', link: '/tutorial/' },
  { text: 'Reference', link: '/reference/spec' },
  { text: 'GitHub', link: 'https://github.com/user/protoagent' },
]

const isActive = (link: string) => {
  return router.route.path.startsWith(link.split('/').slice(0, -1).join('/'))
}
</script>

<template>
  <nav class="vp-nav">
    <div class="vp-nav-inner">
      <div class="vp-nav-logo">
        <a href="/">protoagent</a>
      </div>
      <ul class="vp-nav-links">
        <li v-for="link in navLinks" :key="link.text">
          <a :href="link.link" :class="{ active: isActive(link.link) && !link.link.includes('github') }">
            {{ link.text }}
          </a>
        </li>
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.vp-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(12, 12, 12, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
}

.vp-nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 32px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vp-nav-logo a {
  font-family: var(--sans);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--accent);
  text-decoration: none;
  letter-spacing: 0;
  transition: color 0.15s;
  cursor: pointer;
}

.vp-nav-logo a:hover {
  color: var(--accent-light);
}

.vp-nav-links {
  display: flex;
  gap: 24px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.vp-nav-links a {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text-dim);
  text-decoration: none;
  font-weight: 500;
  letter-spacing: 0;
  transition: color 0.15s;
}

.vp-nav-links a:hover,
.vp-nav-links a.active {
  color: var(--text-bright);
}

@media (max-width: 600px) {
  .vp-nav-links {
    gap: 14px;
  }

  .vp-nav-links a {
    font-size: 0.7rem;
  }
}
</style>
