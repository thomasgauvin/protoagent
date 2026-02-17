/** @type {import('tailwindcss').Config} */
export default {
  content: ['./docs/**/*.{md,vue,ts}', './docs/.vitepress/**/*.{js,ts,vue}'],
  theme: {
    extend: {
      colors: {
        // ProtoAgent CLI green
        accent: {
          DEFAULT: '#09A469',
          light: '#0FD68C',
          dim: '#067A4E',
          bg: 'rgba(9, 164, 105, 0.08)',
          border: 'rgba(9, 164, 105, 0.2)',
        },
        // Dark surfaces
        dark: {
          black: '#0c0c0c',
          surface: '#141414',
          'surface-2': '#1a1a1a',
          border: '#2a2a2a',
          'border-bright': '#3a3a3a',
        },
        // Text colors
        text: {
          DEFAULT: '#c0c0c0',
          bright: '#f0f0f0',
          dim: '#999',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'Menlo', 'monospace'],
        sans: ['Instrument Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: '0.65rem',
        sm: '0.8rem',
        base: '0.88rem',
        lg: '1.1rem',
        xl: '1.3rem',
        '2xl': '1.6rem',
        '3xl': '3rem',
      },
      backgroundColor: {
        black: '#0c0c0c',
        surface: '#141414',
        'surface-2': '#1a1a1a',
      },
      borderColor: {
        dark: '#2a2a2a',
      },
      textColor: {
        DEFAULT: '#c0c0c0',
        bright: '#f0f0f0',
        dim: '#999',
      },
    },
  },
  plugins: [],
}
