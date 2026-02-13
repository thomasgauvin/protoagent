import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ProtoAgent',
  description: 'A minimal, tutorial-friendly AI coding agent CLI',

  appearance: 'dark',

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
            { text: 'Part 3: Configuration', link: '/tutorial/part-3' },
            { text: 'Part 4: Agentic Loop', link: '/tutorial/part-4' },
            { text: 'Part 5: File Tools', link: '/tutorial/part-5' },
            { text: 'Part 6: Shell Commands', link: '/tutorial/part-6' },
            { text: 'Part 7: System Prompt', link: '/tutorial/part-7' },
            { text: 'Part 8: Compaction & Cost', link: '/tutorial/part-8' },
            { text: 'Part 9: Skills & Sessions', link: '/tutorial/part-9' },
            { text: 'Part 10: MCP & Sub-agents', link: '/tutorial/part-10' },
            { text: 'Part 11: Polish & UI', link: '/tutorial/part-11' },
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

    socialLinks: [
      { icon: 'github', link: 'https://github.com/user/protoagent' },
    ],

    footer: {
      message: 'Built as an educational project to learn how coding agents work.',
    },
  },
})
