import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import Terminal from './components/Terminal.vue'
import './custom.css'

if (typeof window !== 'undefined') {
  // Force dark mode
  document.documentElement.classList.remove('light')
  document.documentElement.classList.add('dark')
}

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('Terminal', Terminal)
  },
} satisfies Theme
