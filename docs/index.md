---
layout: home

hero:
  eyebrow: PROTOAGENT//BBS
  title: The AI That Ships Code -- In Plain Sight
  text: ProtoAgent is a readable coding-agent CLI with a visible tool loop, inline approvals, persistent sessions, and enough real features to study and use.
  subtext: Small enough to understand, capable enough to run on real projects.
  actions:
    - theme: brand
      text: "[ENTER] Get Started"
      link: /guide/getting-started
    - theme: alt
      text: "[F2] Build Your Own"
      link: /tutorial/
    - theme: alt
      text: "[F3] Read The Spec"
      link: /reference/spec

features:
  - title: STREAMING TOOL LOOP
    tag: autonomous execution
    details: Streams model output, executes tools, appends results, retries transient failures, and keeps iterating until the model is done.
  - title: FILES + SHELL
    tag: practical built-ins
    details: Reads, writes, edits, lists, searches, runs shell commands, fetches web pages, and tracks TODOs inside the same loop.
  - title: APPROVALS
    tag: local safety rails
    details: Writes, edits, and non-safe shell commands go through inline approval prompts, with hard-blocked shell patterns always denied.
  - title: SESSIONS + TODOS
    tag: persistent context
    details: Auto-saves conversations and TODO state to disk so you can quit, resume, and keep working without rebuilding context.
  - title: SKILLS + MCP
    tag: extensible runtime
    details: Loads local skill packs on demand and registers external MCP tools dynamically at startup.
  - title: SUB-AGENTS
    tag: isolated delegation
    details: Offloads focused research or exploration into child runs so the main conversation stays cleaner and cheaper.
---
