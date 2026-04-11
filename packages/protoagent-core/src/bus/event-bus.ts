/**
 * Central event bus for pub/sub communication.
 */
import type { EventEnvelope } from './bus-event.js';

type EventHandler<T = unknown> = (event: EventEnvelope<T>) => void | Promise<void>;
type FilterFn<T = unknown> = (event: EventEnvelope<T>) => boolean;

interface Subscription {
  id: string;
  handler: EventHandler;
  filter?: FilterFn;
}

export class EventBus {
  private subscriptions = new Map<string, Subscription[]>();
  private globalHandlers: Subscription[] = [];

  subscribe<T>(
    eventType: string,
    handler: EventHandler<T>,
    filter?: FilterFn<T>
  ): () => void {
    const id = crypto.randomUUID();
    const subs = this.subscriptions.get(eventType) ?? [];
    subs.push({ id, handler: handler as EventHandler, filter });
    this.subscriptions.set(eventType, subs);

    return () => this.unsubscribe(eventType, id);
  }

  subscribeAll<T>(handler: EventHandler<T>, filter?: FilterFn<T>): () => void {
    const id = crypto.randomUUID();
    this.globalHandlers.push({ id, handler: handler as EventHandler, filter });
    return () => this.unsubscribeGlobal(id);
  }

  private unsubscribe(eventType: string, id: string): void {
    const subs = this.subscriptions.get(eventType);
    if (subs) {
      const filtered = subs.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        this.subscriptions.delete(eventType);
      } else {
        this.subscriptions.set(eventType, filtered);
      }
    }
  }

  private unsubscribeGlobal(id: string): void {
    this.globalHandlers = this.globalHandlers.filter((h) => h.id !== id);
  }

  emit<T>(event: EventEnvelope<T>): void {
    // Emit to specific subscribers
    const specificSubs = this.subscriptions.get(event.type) ?? [];
    for (const sub of specificSubs) {
      if (sub.filter && !sub.filter(event)) continue;
      try {
        void sub.handler(event);
      } catch (err) {
        console.error(`Event handler error for ${event.type}:`, err);
      }
    }

    // Emit to global subscribers
    for (const sub of this.globalHandlers) {
      if (sub.filter && !sub.filter(event)) continue;
      try {
        void sub.handler(event);
      } catch (err) {
        console.error(`Global event handler error for ${event.type}:`, err);
      }
    }
  }
}

// Singleton instance
export const eventBus = new EventBus();
