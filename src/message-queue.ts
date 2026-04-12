/**
 * Message Queue System
 *
 * Manages two types of user messages:
 * - Interject: Interrupts the current agentic loop and is processed immediately
 * - Queued: Waits until the current agentic loop completes before being processed
 *
 * This allows users to send urgent messages that break the current flow,
 * or queue up follow-up messages while the agent is still working.
 */

import type { Message } from './agentic-loop.js';

export type QueuedMessageType = 'interject' | 'queued';

export interface QueuedMessage {
  id: string;
  content: string;
  type: QueuedMessageType;
  timestamp: number;
}

// Session-scoped message queues
const messageQueuesBySession = new Map<string, QueuedMessage[]>();

function getSessionKey(sessionId?: string): string {
  return sessionId ?? '__default__';
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get the message queue for a session
 */
export function getMessageQueue(sessionId?: string): QueuedMessage[] {
  const key = getSessionKey(sessionId);
  if (!messageQueuesBySession.has(key)) {
    messageQueuesBySession.set(key, []);
  }
  return messageQueuesBySession.get(key)!;
}

/**
 * Clear the message queue for a session
 */
export function clearMessageQueue(sessionId?: string): void {
  messageQueuesBySession.delete(getSessionKey(sessionId));
}

/**
 * Add a message to the queue
 */
export function queueMessage(
  content: string,
  type: QueuedMessageType,
  sessionId?: string
): QueuedMessage {
  const queue = getMessageQueue(sessionId);
  const message: QueuedMessage = {
    id: generateMessageId(),
    content,
    type,
    timestamp: Date.now(),
  };
  queue.push(message);
  return message;
}

/**
 * Add an interject message (will interrupt current processing)
 */
export function interjectMessage(content: string, sessionId?: string): QueuedMessage {
  return queueMessage(content, 'interject', sessionId);
}

/**
 * Add a queued message (will wait for current processing to complete)
 */
export function enqueueMessage(content: string, sessionId?: string): QueuedMessage {
  return queueMessage(content, 'queued', sessionId);
}

/**
 * Get and remove the next pending interject message
 */
export function getNextInterject(sessionId?: string): QueuedMessage | null {
  const queue = getMessageQueue(sessionId);
  const index = queue.findIndex((m) => m.type === 'interject');
  if (index === -1) return null;
  return queue.splice(index, 1)[0];
}

/**
 * Get and remove the next queued message
 */
export function getNextQueued(sessionId?: string): QueuedMessage | null {
  const queue = getMessageQueue(sessionId);
  const index = queue.findIndex((m) => m.type === 'queued');
  if (index === -1) return null;
  return queue.splice(index, 1)[0];
}

/**
 * Check if there are any pending interject messages
 */
export function hasInterjectMessages(sessionId?: string): boolean {
  const queue = getMessageQueue(sessionId);
  return queue.some((m) => m.type === 'interject');
}

/**
 * Check if there are any pending queued messages
 */
export function hasQueuedMessages(sessionId?: string): boolean {
  const queue = getMessageQueue(sessionId);
  return queue.some((m) => m.type === 'queued');
}

/**
 * Get count of pending messages by type
 */
export function getPendingCounts(sessionId?: string): { interject: number; queued: number } {
  const queue = getMessageQueue(sessionId);
  return {
    interject: queue.filter((m) => m.type === 'interject').length,
    queued: queue.filter((m) => m.type === 'queued').length,
  };
}

/**
 * Peek at pending messages without removing them
 */
export function peekPendingMessages(sessionId?: string): QueuedMessage[] {
  return [...getMessageQueue(sessionId)];
}

/**
 * Remove a specific message by ID
 */
export function removeMessage(messageId: string, sessionId?: string): boolean {
  const queue = getMessageQueue(sessionId);
  const index = queue.findIndex((m) => m.id === messageId);
  if (index === -1) return false;
  queue.splice(index, 1);
  return true;
}

/**
 * Get a message by ID
 */
export function getMessage(messageId: string, sessionId?: string): QueuedMessage | null {
  const queue = getMessageQueue(sessionId);
  return queue.find((m) => m.id === messageId) ?? null;
}

/**
 * Load queued messages from a session (restores persisted queue)
 */
export function loadQueueFromSession(queuedMessages: QueuedMessage[], sessionId?: string): void {
  const key = getSessionKey(sessionId);
  messageQueuesBySession.set(key, [...queuedMessages]);
}

/**
 * Get queued messages for session (for persistence)
 */
export function getQueueForSession(sessionId?: string): QueuedMessage[] {
  return [...getMessageQueue(sessionId)];
}
