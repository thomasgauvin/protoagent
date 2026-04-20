import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleApiError } from './errors.js';
import { logger } from '../utils/logger.js';
import { createApiRoutes } from './routes.js';
import { ApiRuntime, type ApiRuntimeDependencies, type ApiRuntimeOptions } from './state.js';

export interface ApiServerOptions extends ApiRuntimeOptions {
  runtime?: ApiRuntime;
  dependencies?: Partial<ApiRuntimeDependencies>;
}

export function createApiApp(runtime: ApiRuntime) {
  const app = new Hono();
  app.use('*', cors());

  app.route('/', createApiRoutes(runtime));

  app.onError((error, c) => {
    logger.error('API request failed', {
      error: error instanceof Error ? error.message : String(error),
      path: c.req.path,
      method: c.req.method,
    });
    return handleApiError(error, c);
  });

  return app;
}

export async function createApiServer(options: ApiServerOptions = {}) {
  const runtime = options.runtime ?? new ApiRuntime(options, options.dependencies);
  await runtime.initialize();
  const app = createApiApp(runtime);
  return { app, runtime };
}
