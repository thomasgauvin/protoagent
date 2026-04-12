/**
 * Approval Manager — wraps approval state and handlers.
 *
 * Extracted into a class so that each tab can have its own isolated
 * approval handler and session approval tracking.
 *
 * Two categories of approval:
 *  1. File operations (write_file, edit_file)
 *  2. Shell commands (non-whitelisted)
 *
 * Approval can be granted:
 *  - Per-operation (one-time)
 *  - Per-operation-type for the session (e.g., "approve all writes")
 *  - Globally via --dangerously-skip-permissions (shared across all tabs)
 *
 * In the TUI, approvals are handled by emitting an event and waiting
 * for the UI to resolve it (instead of blocking on stdin with inquirer).
 */

export type ApprovalRequest = {
  id: string;
  type: 'file_write' | 'file_edit' | 'shell_command';
  description: string;
  detail?: string;
  sessionId?: string;
  sessionScopeKey?: string;
};

export type ApprovalResponse = 'approve_once' | 'approve_session' | 'reject';

/**
 * ApprovalManager — manages approval state for a single tab/session.
 */
export class ApprovalManager {
  private sessionApprovals = new Set<string>(); // stores approval keys scoped by session
  private approvalHandler: ((req: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;

  /**
   * Set the approval handler for this tab/session.
   */
  setApprovalHandler(handler: (req: ApprovalRequest) => Promise<ApprovalResponse>): void {
    this.approvalHandler = handler;
  }

  /**
   * Clear the approval handler for this tab/session.
   */
  clearApprovalHandler(): void {
    this.approvalHandler = null;
  }

  /**
   * Clear all session approvals for this tab/session.
   */
  clearSessionApprovals(): void {
    this.sessionApprovals.clear();
  }

  /**
   * Get the scope key for an approval request.
   */
  private getApprovalScopeKey(req: ApprovalRequest): string {
    const sessionId = req.sessionId ?? '__global__';
    const scope = req.sessionScopeKey ?? req.type;
    return `${sessionId}:${scope}`;
  }

  /**
   * Request approval for an operation. Returns true if approved.
   *
   * Check order:
   *  1. Session approval for this type → auto-approve
   *  2. Interactive prompt via the handler
   *  3. No handler registered → reject (fail closed)
   *
   * Note: --dangerously-skip-permissions is shared globally and checked by the caller.
   */
  async requestApproval(req: ApprovalRequest): Promise<boolean> {
    const sessionKey = this.getApprovalScopeKey(req);
    if (this.sessionApprovals.has(sessionKey)) return true;

    if (!this.approvalHandler) {
      return false;
    }

    const response = await this.approvalHandler(req);

    switch (response) {
      case 'approve_once':
        return true;
      case 'approve_session':
        this.sessionApprovals.add(sessionKey);
        return true;
      case 'reject':
        return false;
      default:
        return false;
    }
  }
}
