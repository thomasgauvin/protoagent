/**
 * Shared core runtime.
 *
 * This re-exports ApiRuntime as CoreRuntime so the rest of the codebase
 * (SDK, CLI adapter, HTTP server) can depend on a single transport-
 * independent runtime surface. The eventual goal is for this module to
 * become the home of the runtime and for src/api/state.ts to depend on
 * it, not the other way around.
 */

export {
  ApiRuntime as CoreRuntime,
  type ApiRuntimeOptions as CoreRuntimeOptions,
  type ApiRuntimeDependencies as CoreRuntimeDependencies,
  type ApiEvent as CoreEvent,
  type ApiApproval as CoreApproval,
  type SessionSnapshot,
  definedProps,
} from '../api/state.js';
