---
layout: home

hero:
  eyebrow: PROTOAGENT
  title: A coding agent you can actually read
  text: You've probably used coding agents that feel a bit magical. They read files, run commands, edit code, and somehow hold the whole loop together. ProtoAgent is a small TypeScript CLI built so you can actually see how that works.
  subtext: It is small enough to understand in an afternoon, but real enough to use on an actual project.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Build Your Own
      link: /tutorial/
    - theme: alt
      text: Read The Spec
      link: /reference/spec

features:
  - title: STREAMING TOOL LOOP
    tag: what the agent is actually doing
    details: ProtoAgent streams model output, executes tools, appends results, retries transient failures, and keeps going until the model can answer directly.
  - title: FILES, SHELL, AND WEB
    tag: the practical core
    details: It can read, write, and edit files, search a repo, run shell commands with approvals, fetch docs from the web, and keep a TODO list while it works.
  - title: APPROVALS THAT MATTER
    tag: local safety rails
    details: Writes, edits, and non-safe shell commands go through inline approvals, while a small set of dangerous shell patterns stays blocked outright.
  - title: SESSIONS THAT RESUME
    tag: persistent context
    details: Sessions are saved to disk with message history and TODOs, so you can quit, come back later, and keep working without starting from scratch.
  - title: SKILLS AND MCP
    tag: easy extension points
    details: Skills let you package project-specific instructions, and MCP lets you connect external tools without hardcoding them into the app.
  - title: SUB-AGENTS
    tag: keeping the main thread clean
    details: Focused research can be pushed into child runs so the parent conversation stays lighter and easier to follow.
---
