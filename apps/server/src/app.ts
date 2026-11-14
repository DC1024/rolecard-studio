import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServerContext } from './context.js';
import { attachAuthContext, type AppEnv } from './middleware/auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { cardM1Routes } from './routes/cards-m1.js';
import { cardRoutes } from './routes/cards.js';
import { configRoutes } from './routes/config.js';
import { externalRoutes } from './routes/external.js';
import { healthRoutes } from './routes/health.js';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createApp(ctx: ServerContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('/api/*', cors({ origin: (origin) => origin || '*', credentials: true }));
  app.use('/api/*', attachAuthContext(ctx));

  app.route('/api/v1', healthRoutes);
  app.route('/api/v1', authRoutes);
  app.route('/api/v1', adminRoutes);
  app.route('/api/v1', configRoutes);
  app.route('/api/v1', cardRoutes);
  app.route('/api/v1', cardM1Routes);
  app.route('/api/v1', externalRoutes);

  // Serve uploaded portrait images safely
  app.get('/uploads/:filename', async (c) => {
    const rawName = c.req.param('filename');
    const safeName = basename(rawName);
    if (!safeName || safeName !== rawName || safeName.includes('..')) {
      return c.json({ error: { code: 'INVALID_PATH', message: '非法文件名' } }, 400);
    }

    const memHit = ctx.memoryUploads?.get(safeName);
    if (memHit) {
      c.header('Content-Type', memHit.contentType);
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(new Uint8Array(memHit.data));
    }

    if (ctx.dataDir !== ':memory:') {
      const filePath = resolve(ctx.dataDir, 'uploads', safeName);
      if (existsSync(filePath)) {
        const buf = await readFile(filePath);
        const mime = MIME_BY_EXT[extname(safeName).toLowerCase()] ?? 'application/octet-stream';
        c.header('Content-Type', mime);
        c.header('Cache-Control', 'public, max-age=86400');
        return c.body(new Uint8Array(buf));
      }
    }

    return c.json({ error: { code: 'NOT_FOUND', message: '文件不存在' } }, 404);
  });

  // Serve built frontend SPA when webDistDir is available
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/uploads/')) {
      return next();
    }
    const distDir = ctx.webDistDir;
    if (!distDir || !existsSync(distDir)) {
      return next();
    }

    const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
    const resolvedTarget = resolve(distDir, `.${reqPath}`);
    if (!resolvedTarget.startsWith(resolve(distDir))) {
      return c.json({ error: { code: 'FORBIDDEN', message: '非法路径' } }, 403);
    }

    if (existsSync(resolvedTarget) && extname(resolvedTarget)) {
      const buf = await readFile(resolvedTarget);
      const mime = MIME_BY_EXT[extname(resolvedTarget).toLowerCase()] ?? 'application/octet-stream';
      c.header('Content-Type', mime);
      return c.body(new Uint8Array(buf));
    }

    const indexPath = resolve(distDir, 'index.html');
    if (existsSync(indexPath)) {
      const html = await readFile(indexPath, 'utf8');
      return c.html(html);
    }

    return next();
  });

  app.notFound((c) => {
    return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404);
  });

  app.onError((err, c) => {
    console.error('[server error]', err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } }, 500);
  });

  return app;
}
