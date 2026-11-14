import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServerContext } from './context.js';
import { attachAuthContext, type AppEnv } from './middleware/auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { cardRoutes } from './routes/cards.js';
import { configRoutes } from './routes/config.js';
import { externalRoutes } from './routes/external.js';
import { healthRoutes } from './routes/health.js';

export function createApp(ctx: ServerContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('/api/*', cors({ origin: (origin) => origin || '*', credentials: true }));
  app.use('/api/*', attachAuthContext(ctx));

  app.route('/api/v1', healthRoutes);
  app.route('/api/v1', authRoutes);
  app.route('/api/v1', adminRoutes);
  app.route('/api/v1', configRoutes);
  app.route('/api/v1', cardRoutes);
  app.route('/api/v1', externalRoutes);

  app.notFound((c) => {
    return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404);
  });

  app.onError((err, c) => {
    console.error('[server error]', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } }, 500);
  });

  return app;
}
