# Part 14: Where to Go From Here

You've built a fully functional coding agent from scratch. Over thirteen parts, you've implemented streaming, tool use, file operations, shell execution, web fetching, approval systems, persistent sessions, skills, MCP integration, and sub-agents. It's a real, working coding agent.

## What You've Built

Take a moment to appreciate what's running on your machine:

- An **agentic loop** that can handle multi-step tasks autonomously
- **File tools** that respect filesystem boundaries and user approvals
- **Shell execution** with layered security (hard blocks, safe lists, and explicit approvals)
- **Web fetching** that won't accidentally hit internal services
- **Session persistence** that keeps your work alive across restarts
- **MCP integration** that extends capabilities without core code changes
- **Sub-agents** that keep your main context clean


## Extending ProtoAgent

One of the best things about building it yourself: you can change anything.

Want a different LLM provider? Modify `providers.ts`. Need a new tool? Add it to `tools/index.ts`. Don't like how approvals work? Change `utils/approval.ts`. The codebase is small enough that you can hold the whole architecture in your head.

Some directions you might take:

- **Custom tools** for your specific workflow (database queries, API testing, deployment)
- **Different UIs**—maybe a web interface instead of terminal-based
- **Multi-model routing**—use cheaper models for simple tasks, expensive ones for complex analysis
- **Integration with your IDE**—VS Code extension, Neovim plugin
- **Team features**—shared sessions, permissions, audit logs

Every workflow is different. The agent that works for me might not work for you. Building your own means you can optimize for exactly how you work.

## A Word on Security (and Prompt Injection)

We've covered a lot of security ground in this tutorial—path validation, command filtering, ReDoS protection, credential redaction, MCP sandboxing. These aren't theoretical concerns; they're real protections against real attack vectors.

But let's be real: **coding agents are inherently powerful tools, and powerful tools carry risk.** You're giving them access to practically everything you have access to. That's why every coding agent relies on human approval and oversight. That is, until you use `--dangerously-skip-permissions` and rely on the LLM to not get any destructive ideas. See the many instances of [coding agents deleting entire production databases](https://www.reddit.com/r/OpenAI/comments/1m4lqvh/replit_ai_went_rogue_deleted_a_companys_entire/). 

Prompt injection is also real. A malicious file in your repo could instruct the agent to do something you didn't intend. A website could have a carefully crafted prompt that bypasses safeguards and tells your coding agent to send sensitive data to a remote server. An MCP server could misbehave. We've built multiple layers of defense, but no defense is perfect. Prompt injection prevention is a [huge area research with great resources. ](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

**Here's the thing, though: don't let this paralyze you.**

The same risks exist in every coding agent—Claude Code, Cursor, Copilot. The difference is you *understand* ProtoAgent's security model because you built it. You know exactly what protections exist and where the boundaries are. That's actually a stronger position than using a black-box tool.

Practical advice:
- Run ProtoAgent in a Docker container or VM when working with untrusted code
- Review approvals carefully—don't autopilot through them
- Keep sensitive credentials out of the working directory
- Use the `--dangerously-skip-permissions` flag sparingly (it's named that way for a reason)

The security model is solid for personal use and trusted projects. For production deployments or sensitive environments, you'll want additional hardening—which brings me to pi-mono.

## When You Need More: pi-mono

ProtoAgent is designed to be understood. Every line of code is there for a reason, and you can trace any behavior from UI to LLM call to tool execution and back.

But maybe you're past the learning stage. Maybe you need:

- A production-hardened core with extensive testing
- Built-in UI components and theming
- Enterprise features like audit logging, RBAC, or SSO
- Managed deployments and automatic updates
- Professional support

For that, I'd point you to **pi-mono**.

[pi-mono](https://github.com/pi-mono/pi-mono) is a production-ready coding agent platform built by engineers who've been running agents at scale. It takes the concepts we've covered here—agentic loops, tool use, approvals, sessions—and hardens them for serious use:

- **Managed core**: Battle-tested agent loop with comprehensive error handling
- **Extensible architecture**: Plugin system for tools and integrations
- **Built-in UI**: Polished interface, not terminal-based
- **Security focus**: Sandboxed execution, audit trails, secrets management
- **Team features**: Multi-user, permissions, shared contexts

Think of it this way: ProtoAgent taught you *how* coding agents work. pi-mono gives you a foundation to *productionize* that knowledge.

You don't have to choose, by the way. ProtoAgent is great for understanding, prototyping, and personal workflows. pi-mono is great when you need to scale, harden, or deploy to a team. They serve different needs at different stages.

## The Bigger Picture

Coding agents are changing how we write software. Not replacing developers—augmenting them. The developers who thrive will be the ones who understand these tools deeply, who can bend them to their will, who know their limitations and work around them.

By building ProtoAgent, you've gone from "user" to "builder." You understand the mechanics. You can debug issues. You can extend functionality. You can evaluate new tools and integrations intelligently.

That understanding is valuable now and will be even more valuable as this space evolves.

## Keep Building

The best way to learn is still to build. Some ideas:

1. **Add a tool** you've always wanted (maybe a custom linter or test runner)
2. **Modify the UI** to show token usage differently or add progress indicators
3. **Integrate with a service** you use daily (Notion, Linear, custom APIs)
4. **Build a skill** for your tech stack (React patterns, Rust best practices, etc.)
5. **Write about your experience**—teaching others solidifies your own understanding

If you do extend ProtoAgent or build something cool, share it. The community benefits when we learn from each other.

## Thanks for Building Along

I built ProtoAgent because I wanted to understand coding agents deeply, and the best way to understand something is to build it. I hope this tutorial gave you that same depth of understanding.

If you have questions, find issues, or want to contribute, the [GitHub repo](https://github.com/thomasgauvin/protoagent) is open. I'm always interested in hearing how people extend and use what they've built.

Now go build something.

— Thomas
