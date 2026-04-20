import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function handleApiError(error: unknown, c: Context) {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status as any);
  }

  if (error instanceof ApiError) {
    return c.json({ error: error.message }, error.status as any);
  }

  if (error instanceof ZodError) {
    return c.json(
      {
        error: 'Invalid request body.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return c.json({ error: message }, 500);
}
