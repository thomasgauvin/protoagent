<script setup lang="ts">
import { useData } from 'vitepress'

const { frontmatter } = useData()

const hero = frontmatter.value.hero || {}
const features = frontmatter.value.features || []
</script>

<template>
  <div class="vp-home">
    <!-- Hero section -->
    <section class="vp-hero">
      <div class="vp-hero-content">
        <div class="vp-hero-label">{{ hero.tagline || 'Open Source' }}</div>
        <h1 class="vp-hero-title">{{ hero.title || 'ProtoAgent' }}</h1>
        <p class="vp-hero-description">{{ hero.text || 'A coding agent you can actually read' }}</p>

        <div class="vp-cta-row">
          <a v-for="action in hero.actions" :key="action.text" :href="action.link" :class="`vp-btn vp-btn-${action.type || 'primary'}`">
            {{ action.text }}
          </a>
        </div>
      </div>
    </section>

    <!-- Features section -->
    <section v-if="features.length" class="vp-features">
      <div class="vp-features-header">
        <div class="vp-features-label">Features</div>
        <h2 class="vp-features-title">Everything you need</h2>
      </div>
      <div class="vp-features-grid">
        <div v-for="feature in features" :key="feature.title" class="vp-feature-card">
          <div v-if="feature.icon" class="vp-feature-icon" v-html="feature.icon"></div>
          <h3 class="vp-feature-title">{{ feature.title }}</h3>
          <p class="vp-feature-details">{{ feature.details }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.vp-home {
  background: var(--black);
  min-height: 100vh;
}

/* Hero section */
.vp-hero {
  max-width: 1100px;
  margin: 0 auto;
  padding: 96px 24px 72px;
  display: flex;
  align-items: center;
  gap: 48px;
}

.vp-hero-content {
  flex: 1;
}

.vp-hero-label {
  font-family: var(--mono);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
}

.vp-hero-label::before {
  content: '';
  width: 20px;
  height: 1px;
  background: var(--accent);
}

.vp-hero-title {
  font-family: var(--mono);
  font-size: clamp(2rem, 5vw, 3.2rem);
  font-weight: 700;
  color: var(--text-bright);
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin-bottom: 24px;
  max-width: 700px;
}

.vp-hero-description {
  font-size: 1.1rem;
  color: var(--text);
  line-height: 1.65;
  max-width: 520px;
  margin-bottom: 40px;
}

/* CTA buttons */
.vp-cta-row {
  display: flex;
  gap: 12px;
  margin-bottom: 32px;
}

.vp-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  font-family: var(--mono);
  font-size: 0.8rem;
  font-weight: 600;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  transition: all 0.2s;
  border: 1px solid transparent;
  border-radius: 6px;
}

.vp-btn-primary {
  background: var(--accent);
  color: #000;
}

.vp-btn-primary:hover {
  background: #00ffaa;
  box-shadow: 0 0 20px rgba(0, 255, 136, 0.2);
}

.vp-btn-secondary {
  background: transparent;
  border-color: var(--border);
  color: var(--text);
}

.vp-btn-secondary:hover {
  border-color: var(--text-dim);
  color: var(--text-bright);
}

/* Features section */
.vp-features {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 24px 80px;
  border-top: 1px solid var(--border);
}

.vp-features-header {
  padding: 80px 0 48px;
}

.vp-features-label {
  font-family: var(--mono);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-dim);
  margin-bottom: 12px;
  font-weight: 500;
}

.vp-features-title {
  font-family: var(--mono);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-bright);
  letter-spacing: -0.01em;
}

.vp-features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  margin-bottom: 80px;
}

@media (max-width: 900px) {
  .vp-features-grid {
    grid-template-columns: 1fr;
  }
}

.vp-feature-card {
  background: var(--surface);
  padding: 28px 24px;
  transition: background 0.15s;
}

.vp-feature-card:hover {
  background: var(--surface-2);
}

.vp-feature-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  border: 1px solid var(--accent-border);
  background: var(--accent-bg);
}

.vp-feature-icon :deep(svg) {
  width: 16px;
  height: 16px;
  stroke: var(--accent);
  stroke-width: 1.5;
}

.vp-feature-title {
  font-family: var(--mono);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 8px;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.vp-feature-details {
  font-size: 0.85rem;
  color: var(--text-dim);
  line-height: 1.55;
}

@media (max-width: 600px) {
  .vp-hero {
    flex-direction: column;
    padding: 64px 20px 56px;
  }

  .vp-hero-title {
    font-size: 2.2rem;
  }

  .vp-cta-row {
    flex-direction: column;
  }

  .vp-btn {
    justify-content: center;
  }
}
</style>
