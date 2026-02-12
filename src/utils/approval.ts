/**
 * Approval system for destructive operations.
 *
 * Two categories of approval:
 *  1. File operations (write_file, edit_file)
 *  2. Shell commands (non-whitelisted)
 *
 * Approval can be granted:
 *  - Per-operation (one-time)
 *  - Per-operation-type for the session (e.g., "approve all writes")
 *  - Globally via --dangerously-accept-all
 *
 * In the Ink UI, approvals are handled by emitting an event and waiting
 * for the UI to resolve it (instead of blocking on stdin with inquirer).
 */

export type ApprovalRequest = {
  id: string;
  type: 'file_write' | 'file_edit' | 'shell_command';
  description: string;
  detail?: string;
};

export type ApprovalResponse = 'approve_once' | 'approve_session' | 'reject';

// Global state
let dangerouslyAcceptAll = false;
const sessionApprovals = new Set<string>(); // stores approval types like "file_write", "file_edit", "shell:npm", etc.

// Callback that the Ink UI provides to handle interactive approval
let approvalHandler: ((req: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;

export function setDangerouslyAcceptAll(value: boolean): void {
  dangerouslyAcceptAll = value;
}

export function isDangerouslyAcceptAll(): boolean {
  return dangerouslyAcceptAll;
}

export function setApprovalHandler(handler: (req: ApprovalRequest) => Promise<ApprovalResponse>): void {
  approvalHandler = handler;
}

export function clearSessionApprovals(): void {
  sessionApprovals.clear();
}

/**
 * Request approval for an operation. Returns true if approved.
 *
 * Check order:
 *  1. --dangerously-accept-all → auto-approve
 *  2. Session approval for this type → auto-approve
 *  3. Interactive prompt via the UI handler
 *  4. No handler registered → auto-approve (non-interactive mode)
 */
export async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (dangerouslyAcceptAll) return true;

  const sessionKey = req.type;
  if (sessionApprovals.has(sessionKey)) return true;

  if (!approvalHandler) {
    // No interactive UI — auto-approve (e.g., running in tests or non-interactive mode)
    return true;
  }

  const response = await approvalHandler(req);

  switch (response) {
    case 'approve_once':
      return true;
    case 'approve_session':
      sessionApprovals.add(sessionKey);
      return true;
    case 'reject':
      return false;
  }
}
