/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          '"Fira Sans"',
          '"Droid Sans"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
      },
      colors: {
        border: 'hsl(var(--border) / <alpha>)',
        input: 'hsl(var(--input) / <alpha>)',
        ring: 'hsl(var(--ring) / <alpha>)',
        background: 'hsl(var(--background) / <alpha>)',
        foreground: 'hsl(var(--foreground) / <alpha>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha>)',
          foreground: 'hsl(var(--success-foreground) / <alpha>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha>)',
          foreground: 'hsl(var(--info-foreground) / <alpha>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha>)',
          foreground: 'hsl(var(--card-foreground) / <alpha>)',
        },
        // TUI semantic palette (mirrors src/tui/theme.ts)
        tui: {
          primary: 'hsl(var(--tui-primary) / <alpha>)',
          green: 'hsl(var(--tui-green) / <alpha>)',
          dim: 'hsl(var(--tui-dim) / <alpha>)',
          gray: 'hsl(var(--tui-gray) / <alpha>)',
          white: 'hsl(var(--tui-white) / <alpha>)',
          darkbg: 'hsl(var(--tui-darkbg) / <alpha>)',
          yellow: 'hsl(var(--tui-yellow) / <alpha>)',
          blue: 'hsl(var(--tui-blue) / <alpha>)',
          red: 'hsl(var(--tui-red) / <alpha>)',
          border: 'hsl(var(--tui-border) / <alpha>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        base: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        'dark-sm': '0 1px 2px 0 rgb(0 0 0 / 0.3)',
        'dark-base': '0 1px 3px 0 rgb(0 0 0 / 0.4), 0 1px 2px -1px rgb(0 0 0 / 0.3)',
        'dark-md': '0 4px 6px -1px rgb(0 0 0 / 0.5), 0 2px 4px -2px rgb(0 0 0 / 0.4)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'slide-in-from-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-to-left': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-100%)' },
        },
        'spinner': {
          '0%': { content: '"⠋"' },
          '10%': { content: '"⠙"' },
          '20%': { content: '"⠹"' },
          '30%': { content: '"⠸"' },
          '40%': { content: '"⠼"' },
          '50%': { content: '"⠴"' },
          '60%': { content: '"⠦"' },
          '70%': { content: '"⠧"' },
          '80%': { content: '"⠇"' },
          '90%': { content: '"⠏"' },
          '100%': { content: '"⠋"' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'fade-out': 'fade-out 0.2s ease-out',
        'slide-in-from-left': 'slide-in-from-left 0.3s ease-out',
        'slide-out-to-left': 'slide-out-to-left 0.3s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
