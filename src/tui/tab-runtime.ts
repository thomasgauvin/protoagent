/**
 * TabRuntime — per-tab SDK client facade.
 *
 * This introduces a lazily-initialized per-tab CoreRuntime + InMemoryTransport
 * + ProtoAgentClient. The goal in this stage is structural: every tab now
 * owns an SDK surface it can use for session lifecycle and other read-only
 * operations, so that incremental migration of the TUI hot path (agentic
 * loop, approvals, workflow, persistence) can happen in follow-up stages
 * without changing how sessions are looked up or listed.
 *
 * Intentionally NOT in scope this stage:
 *   - Calling `initialize()` automatically (which spins up a real client,
 *     real MCP connections, and reads the user's real API key). The TUI
 *     already manages these through its own per-tab McpManager etc.
 *   - Migrating the hot streaming path (runAgenticLoop) to the SDK.
 *   - Making CoreRuntime multi-session.
 *
 * A tab can safely call `tabRuntime.listSessions()` or `tabRuntime.loadSession(id)`
 * without full initialization: those underlying dependencies (`listStoredSessions`,
 * `loadSession`) do not require config/MCP/LLM.
 */

import { ToolRegistry } from '../tools/registry.js';
import { CoreRuntime, type CoreRuntimeDependencies } from '../core/runtime.js';
import {
  createProtoAgentClient,
  InMemoryTransport,
  ProtoAgentClient,
} from '../sdk/index.js';

export interface TabRuntimeOptions {
  /** Isolated tool registry used by this tab for agent tool execution. */
  toolRegistry: ToolRegistry;
  /** Whether to auto-approve file/shell operations; matches TabApp option. */
  dangerouslySkipPermissions?: boolean;
  /** Optional runtime dependency overrides, primarily for tests. */
  dependencies?: Partial<CoreRuntimeDependencies>;
}

export class TabRuntime {
  readonly coreRuntime: CoreRuntime;
  readonly transport: InMemoryTransport;
  readonly client: ProtoAgentClient;

  private closed = false;

  constructor(options: TabRuntimeOptions) {
    const dependencies: Partial<CoreRuntimeDependencies> = {
      toolRegistry: options.toolRegistry,
      ...(options.dependencies ?? {}),
    };

    this.coreRuntime = new CoreRuntime(
      { dangerouslySkipPermissions: options.dangerouslySkipPermissions },
      dependencies,
    );
    this.transport = new InMemoryTransport({ runtime: this.coreRuntime });
    this.client = createProtoAgentClient({ transport: this.transport });
  }

  /**
   * Dispose of the per-tab runtime. Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // InMemoryTransport that did not own the runtime won't close it, but in
    // our case the transport owns nothing external — closing the runtime is
    // the right move for session cleanup.
    await this.coreRuntime.close();
  }
}

export function createTabRuntime(options: TabRuntimeOptions): TabRuntime {
  return new TabRuntime(options);
}
