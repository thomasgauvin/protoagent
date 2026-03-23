import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ProtoAgent',
  titleTemplate: ':title - A DIY coding agent CLI',
  description: 'Build your own AI coding agent. ProtoAgent is a readable, production-ready implementation with multi-step tool loops, MCP support, sessions, and sub-agents. Small enough to understand, simple enough to build.',

  appearance: false,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],

    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'ProtoAgent - A DIY coding agent CLI' }],
    ['meta', { property: 'og:description', content: 'Build your own AI coding agent. ProtoAgent is a readable, production-ready implementation with multi-step tool loops, MCP support, sessions, and sub-agents.' }],
    ['meta', { property: 'og:site_name', content: 'ProtoAgent' }],

    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'ProtoAgent - A DIY coding agent CLI' }],
    ['meta', { name: 'twitter:description', content: 'Build your own AI coding agent. ProtoAgent is a readable, production-ready implementation with multi-step tool loops, MCP support, sessions, and sub-agents.' }],

    // SEO
    ['meta', { name: 'keywords', content: 'AI coding agent, CLI, build your own, MCP, LLM tools, coding assistant, AI agent tutorial, TypeScript' }],
    ['meta', { name: 'author', content: 'ProtoAgent' }],
    ['meta', { name: 'theme-color', content: '#0a180e' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Try it out', link: '/try-it-out/getting-started' },
      { text: 'Build Your Own', link: '/build-your-own/' },
      { text: 'Reference', link: '/reference/spec' },
    ],

    sidebar: {
      '/try-it-out/': [
        {
          text: 'Try it out',
          items: [
            { text: 'Getting Started', link: '/try-it-out/getting-started' },
            { text: 'Configuration', link: '/try-it-out/configuration' },
            { text: 'Tools', link: '/try-it-out/tools' },
            { text: 'Skills', link: '/try-it-out/skills' },
            { text: 'MCP Servers', link: '/try-it-out/mcp' },
            { text: 'Sessions', link: '/try-it-out/sessions' },
            { text: 'Sub-agents', link: '/try-it-out/sub-agents' },
          ],
        },
      ],
      '/build-your-own/': [
        {
          text: 'Build Your Own',
          items: [
            { text: 'Overview', link: '/build-your-own/' },
            { text: 'Part 1: Scaffolding', link: '/build-your-own/part-1' },
            { text: 'Part 2: AI Integration', link: '/build-your-own/part-2' },
            { text: 'Part 3: Configuration Management', link: '/build-your-own/part-3' },
            { text: 'Part 4: Agentic Loop', link: '/build-your-own/part-4' },
            { text: 'Part 5: Core Tools', link: '/build-your-own/part-5' },
            { text: 'Part 6: Shell & Approvals', link: '/build-your-own/part-6' },
            { text: 'Part 7: System Prompt & Policy', link: '/build-your-own/part-7' },
            { text: 'Part 8: Compaction & Cost', link: '/build-your-own/part-8' },
            { text: 'Part 9: Skills & Agents.md', link: '/build-your-own/part-9' },
            { text: 'Part 10: Sessions', link: '/build-your-own/part-10' },
            { text: 'Part 11: MCP Integration', link: '/build-your-own/part-11' },
            { text: 'Part 12: Sub-agents', link: '/build-your-own/part-12' },
            { text: 'Part 13: Polish, Rendering & Logging', link: '/build-your-own/part-13' },
            { text: 'Part 14: Where to Go From Here', link: '/build-your-own/part-14-conclusion' },
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
            { text: 'Acknowledgements', link: '/reference/acknowledgements' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/thomasgauvin/protoagent' },
    ],

    footer: {
      message: 'Built to teach how production-style coding agents actually work.',
    },
  },
})
