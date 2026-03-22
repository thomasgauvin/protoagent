---
layout: home

hero:
  eyebrow: PROTOAGENT
  title: A coding agent you can build yourself
  text: Coding agents can feel like magic. ProtoAgent is a lean, readable implementation that pulls back the curtain, giving you the blueprint to understand and build your own.
  subtext: Small enough to understand in a 20 minutes, simple enough to build yourself in an afternoon, usable enough to try out on an actual project.
  actions:
    - theme: brand
      text: Build Your Own
      link: /build-your-own/
    - theme: alt
      text: Try it out
      link: /try-it-out/getting-started

features:
  - title: CORE AGENTIC LOOP
    tag: the core of the coding agent
    details: ProtoAgent streams model output, executes tools, appends results, retries transient failures, and keeps going until the model can answer directly.
  - title: FILES, SHELL, AND WEB
    tag: taking action
    details: It can read, write, and edit files, search a repo, run shell commands with approvals, fetch docs from the web, and keep a TODO list while it works.
  - title: APPROVE TOOL USES
    tag: local safety rails
    details: Writes, edits, and non-safe shell commands go through inline approvals, while a small set of dangerous shell patterns stays blocked outright.
  - title: SESSIONS
    tag: persistent context
    details: Sessions are saved to disk with message history and TODOs, so you can quit, come back later, and keep working without starting from scratch.
  - title: SKILLS AND MCP
    tag: easy extension points
    details: Skills let you package project-specific instructions, and MCP lets you connect external tools without hardcoding them into the app.
  - title: SUB-AGENTS
    tag: keep context clean
    details: Focused research can be pushed into child runs so the parent conversation stays lighter and easier to follow.
---
