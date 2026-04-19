/**
 * Approval state module — holds global approval-related state.
 *
 * This is a separate module to avoid circular dependencies between
 * approval.ts and approval-manager.ts.
 */

// Global state (shared across all tabs)
let dangerouslySkipPermissions = false;

export function setDangerouslySkipPermissions(value: boolean): void {
  console.error(`[DEBUG approval-state] setDangerouslySkipPermissions(${value})`)
  dangerouslySkipPermissions = value;
}

export function isDangerouslySkipPermissions(): boolean {
  const result = dangerouslySkipPermissions;
  console.error(`[DEBUG approval-state] isDangerouslySkipPermissions() = ${result}`)
  return result;
}
