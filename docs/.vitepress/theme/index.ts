import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import TerminalHero from './components/TerminalHero.vue'
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
    app.component('TerminalHero', TerminalHero)
  },
} satisfies Theme
