# Part 11: MCP Integration

MCP is what turns ProtoAgent from "a useful local coding agent" into "an agent that can grow beyond its built-in tool set."

If you have used tools like filesystem servers, GitHub tools, or browser automation through an agent, you have already seen the value of this pattern.

By the end, your project should match `protoagent-tutorial-again-part-11`.

## What you are building in this part

Starting from Part 10, you are focusing on the MCP layer inside the late staged runtime:

- MCP config loading
- MCP server connection setup
- remote tool discovery
- dynamic tool registration for MCP tools
- App initialization that loads MCP before the first useful turn

This is the stage where built-ins stop being the only way ProtoAgent can grow.

## Starting point

Copy your Part 10 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-11`

## Files to create or change

This stage mainly touches:

- `src/utils/mcp.ts`
- `src/tools/index.ts`
- `src/agentic-loop.ts` for dynamic handler execution
- `src/App.tsx` to initialize MCP on startup

This recreated checkpoint is cumulative, but it is clean enough to treat Part 11 as the MCP stage: Part 10 gives you sessions, and Part 11 layers in external tool servers on top.

## Step 1: Add MCP config loading

The runtime should look for merged runtime config and read MCP servers from:

- `.protoagent/protoagent.jsonc` under `mcp.servers`

That config becomes the declaration of which external tool servers ProtoAgent should try to connect to.

## Step 2: Connect to MCP servers

The staged checkpoint uses a lightweight line-oriented JSON-RPC client over stdio. It is simpler than the final app, but the important behavior is the same:

- connect to each configured server
- discover its tools
- wrap those remote tools in local tool definitions

## Step 3: Register remote tools dynamically

This is the core design decision.

MCP tools should end up looking like regular tools to the model, typically with names like:

- `mcp_<server>_<tool>`

That namespacing avoids collisions and keeps the runtime surface predictable.

In this stage, the MCP loader imports the dynamic tool registration helpers from `src/tools/index.ts` and wires each discovered remote tool into the normal tool dispatch path.

## Verification

Run the app with a simple MCP config present:

```bash
npm run dev
```

If it worked, you should see:

- the runtime attempting to connect to the configured server during startup
- discovered tools added to the available tool set
- the model able to call those tools like any other tool

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-11`

## Pitfalls

- assuming one bad MCP server should crash the whole app
- registering remote tools without namespacing them
- treating MCP results as if they already match the local tool-result format
- forgetting to connect tool discovery back into the main registry

## Core takeaway

MCP is the bridge between ProtoAgent and external tool ecosystems. This is the checkpoint where your staged rebuild stops being limited to built-ins and starts accepting tools from outside the app.
