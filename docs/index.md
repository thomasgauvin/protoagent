---
layout: home

hero:
  name: ProtoAgent
  text: A coding agent you can actually read
  tagline: I built this to learn how production coding agents work — and to teach others how to build their own. The entire codebase fits in an afternoon of reading.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Build Your Own (Tutorial)
      link: /tutorial/
    - theme: alt
      text: GitHub
      link: https://github.com/user/protoagent

features:
  - title: The Agentic Loop
    details: The same tool-use loop pattern that powers OpenCode, Codex, and pi-mono — stream an LLM response, execute tool calls, feed results back, repeat. It's the core of every coding agent.
  - title: File & Shell Tools
    details: Read, write, edit, and search files. Run shell commands with a safety whitelist so the agent can't accidentally rm -rf your project. Destructive operations ask for your approval first.
  - title: MCP Support
    details: Connect external tool servers without touching agent code. The Model Context Protocol is becoming the standard way to give agents new capabilities — ProtoAgent speaks it natively.
  - title: Sub-agents
    details: Long conversations get messy. Sub-agents spawn isolated child sessions for self-contained tasks, so the parent's context stays clean. No more "wait, what was I doing?"
  - title: Skills
    details: Drop a markdown file into your project and the agent follows your instructions — "always use pnpm", "follow this code style", whatever you need. No code changes required.
  - title: Session Persistence
    details: Save and resume conversations across restarts. Pick up right where you left off, with full context intact.
---
