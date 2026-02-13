---
layout: home

hero:
  name: ProtoAgent
  text: A coding agent you can actually read
  tagline: Built to learn how production coding agents work — and to teach you how to build your own. The entire codebase fits in an afternoon of reading.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Build Your Own
      link: /tutorial/
    - theme: alt
      text: GitHub
      link: https://github.com/user/protoagent

features:
  - title: "The Agentic Loop"
    icon: "🔄"
    details: The same tool-use loop pattern that powers OpenCode, Codex, and pi-mono — stream an LLM response, execute tool calls, feed results back, repeat.
  - title: "File & Shell Tools"
    icon: "🛠"
    details: Read, write, edit, search files. Run shell commands with a safety whitelist so the agent can't rm -rf your project. Destructive ops ask for approval first.
  - title: "MCP Support"
    icon: "🔌"
    details: Connect external tool servers without touching agent code. The Model Context Protocol is becoming the standard — ProtoAgent speaks it natively.
  - title: "Sub-agents"
    icon: "🧬"
    details: Long conversations get messy. Sub-agents spawn isolated child sessions for self-contained tasks, keeping the parent's context clean.
  - title: "Skills"
    icon: "📋"
    details: Drop a markdown file into your project and the agent follows your instructions — code style, preferred tools, whatever you need. No code changes.
  - title: "Session Persistence"
    icon: "💾"
    details: Save and resume conversations across restarts. Pick up right where you left off, with full context intact.
---

<div style="max-width: 720px; margin: -40px auto 60px; padding: 0 24px;">
  <TerminalHero />
</div>
