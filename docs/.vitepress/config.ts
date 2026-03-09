import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'PROTOAGENT',
  description: 'Terminal-themed docs for a readable AI coding agent CLI',

  appearance: false,
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Tutorial', link: '/tutorial/' },
      { text: 'Reference', link: '/reference/spec' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Tools', link: '/guide/tools' },
            { text: 'Skills', link: '/guide/skills' },
            { text: 'MCP Servers', link: '/guide/mcp' },
            { text: 'Sessions', link: '/guide/sessions' },
            { text: 'Sub-agents', link: '/guide/sub-agents' },
          ],
        },
      ],
      '/tutorial/': [
        {
          text: 'DIY Tutorial',
          items: [
            { text: 'Overview', link: '/tutorial/' },
            { text: 'Part 1: Scaffolding', link: '/tutorial/part-1' },
            { text: 'Part 2: AI Integration', link: '/tutorial/part-2' },
            { text: 'Part 3: Configuration Management', link: '/tutorial/part-3' },
            { text: 'Part 4: Agentic Loop', link: '/tutorial/part-4' },
            { text: 'Part 5: Core Tools', link: '/tutorial/part-5' },
            { text: 'Part 6: Shell & Approvals', link: '/tutorial/part-6' },
            { text: 'Part 7: System Prompt & Policy', link: '/tutorial/part-7' },
            { text: 'Part 8: Compaction & Cost', link: '/tutorial/part-8' },
            { text: 'Part 9: Skills', link: '/tutorial/part-9' },
            { text: 'Part 10: Sessions', link: '/tutorial/part-10' },
            { text: 'Part 11: MCP Integration', link: '/tutorial/part-11' },
            { text: 'Part 12: Sub-agents', link: '/tutorial/part-12' },
            { text: 'Part 13: Polish, Rendering & Logging', link: '/tutorial/part-13' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Specification', link: '/reference/spec' },
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'CLI Reference', link: '/reference/cli' },
          ],
        },
      ],
    },

    socialLinks: [],

    footer: {
      message: 'Built to teach how production-style coding agents actually work.',
    },
  },
})
