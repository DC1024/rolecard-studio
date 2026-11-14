import { resolve } from 'node:path';
import {
  loadPluginsFromDirectory,
  renderDeclarativeExport,
  validatePluginManifest,
} from '@rolecard/core';
import type { RoleCardContent } from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { roleCards } from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';

export const pluginRoutes = new Hono<AppEnv>();

function resolvePluginsDir(dataDir: string, customDir?: string): string {
  if (customDir) return customDir;
  if (dataDir === ':memory:') return ':memory:';
  return resolve(dataDir, 'plugins');
}

pluginRoutes.get('/plugins', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const plugins = await loadPluginsFromDirectory(
    resolvePluginsDir(ctx.dataDir, ctx.pluginsDir),
  );
  return c.json({ plugins });
});

pluginRoutes.post('/plugins/validate', async (c) => {
  const denied = guardPermission(c, 'card:create');
  if (denied) return denied;

  const raw = (await c.req.json()) as unknown;
  const result = validatePluginManifest(raw);
  if (!result.ok) {
    return sendCoreError(c, result.error);
  }
  return c.json({ valid: true, manifest: result.value });
});

pluginRoutes.get('/plugins/:id/export/:cardId', async (c) => {
  const denied = guardPermission(c, 'card:export');
  if (denied) return denied;

  const pluginId = c.req.param('id');
  const cardId = c.req.param('cardId');
  const ctx = c.get('ctx');

  const plugins = await loadPluginsFromDirectory(
    resolvePluginsDir(ctx.dataDir, ctx.pluginsDir),
  );
  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: '插件不存在' } }, 404);
  }

  const [card] = await ctx.db.select().from(roleCards).where(eq(roleCards.id, cardId)).limit(1);
  if (!card) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const content = JSON.parse(card.contentJson) as RoleCardContent;
  const rendered = renderDeclarativeExport(plugin, content, {
    workName: card.workName,
    version: card.version,
    mode: card.mode,
  });
  if (!rendered.ok) {
    return sendCoreError(c, rendered.error);
  }

  c.header('Content-Type', rendered.value.mimeType);
  c.header(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(rendered.value.filename)}`,
  );
  return c.body(rendered.value.content);
});
