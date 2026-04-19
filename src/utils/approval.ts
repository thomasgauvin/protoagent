/**
 * Approval system for destructive operations.
 *
 * This module now delegates to src/utils/approval-manager.ts for per-tab state.
 * New code should import ApprovalManager from approval-manager.ts and instantiate
 * it with an approval handler for each tab.
 *
 * The --dangerously-skip-permissions flag is still global (shared across all tabs).
 *
 * Two categories of approval:
 *  1. File operations (write_file, edit_file)
 *  2. Shell commands (non-whitelisted)
 *
 * Approval can be granted:
 *  - Per-operation (one-time)
 *  - Per-operation-type for the session (e.g., "approve all writes")
 *  - Globally via --dangerously-skip-permissions
 *
 * In the Ink UI, approvals are handled by emitting an event and waiting
 * for the UI to resolve it (instead of blocking on stdin with inquirer).
 */

import { ApprovalManager, type ApprovalRequest, type ApprovalResponse } from './approval-manager.js';
import {
  setDangerouslySkipPermissions,
  isDangerouslySkipPermissions,
} from './approval-state.js';

export {
  setDangerouslySkipPermissions,
  isDangerouslySkipPermissions,
} from './approval-state.js';

/**
 * For backwards compatibility: maintain module-level exports that delegate to
 * a default shared ApprovalManager instance. This allows existing code to work
 * without changes, but gradually migrated code will pass ApprovalManager instances around.
 */
const defaultApprovalManager = new ApprovalManager();

export function setApprovalHandler(handler: (req: ApprovalRequest) => Promise<ApprovalResponse>): void {
  defaultApprovalManager.setApprovalHandler(handler);
}

export function clearApprovalHandler(): void {
  defaultApprovalManager.clearApprovalHandler();
}

export function clearSessionApprovals(): void {
  defaultApprovalManager.clearSessionApprovals();
}

/**
 * Request approval for an operation. Returns true if approved.
 *
 * Check order:
 *  1. --dangerously-skip-permissions → auto-approve
 *  2. Session approval for this type → auto-approve
 *  3. Interactive prompt via the handler
 *  4. No handler registered → reject (fail closed)
 */
export async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (isDangerouslySkipPermissions()) return true;
  return defaultApprovalManager.requestApproval(req);
}

/**
 * Unified helper to request tool approval that works with both per-tab
 * approval managers and the default global approval manager.
 *
 * This eliminates the duplicated conditional logic in tool handlers.
 *
 * @param approvalManager - Optional per-tab approval manager
 * @param req - The approval request
 * @returns true if approved, false otherwise
 */
export async function requestToolApproval(
  approvalManager: ApprovalManager | undefined,
  req: ApprovalRequest,
): Promise<boolean> {
  // --dangerously-skip-permissions bypasses all approval checks (global flag)
  console.error(`[DEBUG approval] requestToolApproval called, checking isDangerouslySkipPermissions()`);
  const skip = isDangerouslySkipPermissions();
  console.error(`[DEBUG approval] isDangerouslySkipPermissions() = ${skip}`);
  if (skip) return true;
  if (approvalManager) {
    console.error(`[DEBUG approval] Using approvalManager`);
    return await approvalManager.requestApproval(req);
  }
  console.error(`[DEBUG approval] Using default requestApproval`);
  return await requestApproval(req);
}

/**
 * Export ApprovalManager class and types for new code that needs per-tab instances
 */
export { ApprovalManager, type ApprovalRequest, type ApprovalResponse } from './approval-manager.js';
