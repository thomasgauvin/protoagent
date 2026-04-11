/**
 * Session Service — Persistence for conversation sessions.
 */
import { z } from 'zod';
import type OpenAI from 'openai';

const SessionSchema = z.object({
  id: z.string(),
  title: z.string().default('New Session'),
  model: z.string(),
  provider: z.string(),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
  messages: z.array(z.any()).default([]),
  todos: z.array(z.any()).optional(),
});

type Session = z.infer<typeof SessionSchema>;

// In-memory storage for now (can be swapped for file/DB storage)
const sessions = new Map<string, Session>();

export class SessionService {
  async create(data: Partial<Session>): Promise<Session> {
    const session = SessionSchema.parse({
      ...data,
      id: data.id || crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    sessions.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<Session | null> {
    return sessions.get(id) || null;
  }

  async list(): Promise<Session[]> {
    return Array.from(sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async update(id: string, updates: Partial<Session>): Promise<Session | null> {
    const session = sessions.get(id);
    if (!session) return null;

    const updated = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
    };
    
    sessions.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return sessions.delete(id);
  }
}
