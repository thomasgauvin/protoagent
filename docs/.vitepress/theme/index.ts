import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import TerminalHero from './components/TerminalHero.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('TerminalHero', TerminalHero)
  },
} satisfies Theme
