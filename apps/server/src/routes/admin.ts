import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import { generateRandomToken, hashPassword, hashToken } from '@rolecard/core';
import {
  AccessPolicySchema,
  ALL_PERMISSIONS,
  CreateUserRequestSchema,
  UpdateUserPermissionsSchema,
} from '@rolecard/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getNow } from '../context.js';
import { externalApiKeys, systemSecuritySettings, users } from '../db/schema.js';
import { guardAdmin, parsePermissionsJson, type AppEnv } from '../middleware/auth.js';

export const adminRoutes = new Hono<AppEnv>();

const CreateExternalKeySchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.string().trim().min(1)).default(['*']),
});

adminRoutes.get('/admin/access-policy', (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;
  return c.json(c.get('policy'));
});

adminRoutes.put('/admin/access-policy', zValidator('json', AccessPolicySchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  const nowIso = getNow(ctx).toISOString();

  await ctx.db
    .update(systemSecuritySettings)
    .set({
      siteAccessMode: input.siteAccessMode,
      apiAccessMode: input.apiAccessMode,
      guestPermissionsJson: JSON.stringify(input.guestPermissions),
      updatedAt: nowIso,
    })
    .where(eq(systemSecuritySettings.id, 'default'));

  return c.json(input);
});

adminRoutes.get('/admin/users', async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const rows = await c.get('ctx').db.select().from(users).orderBy(desc(users.createdAt));
  return c.json({
    users: rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      permissions:
        row.role === 'admin' ? [...ALL_PERMISSIONS] : parsePermissionsJson(row.permissionsJson),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  });
});

adminRoutes.post('/admin/users', zValidator('json', CreateUserRequestSchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  const existing = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1);

  if (existing.length > 0) {
    return c.json(
      { error: { code: 'USERNAME_EXISTS', message: `用户名 ${input.username} 已存在` } },
      409,
    );
  }

  const id = randomUUID();
  const nowIso = getNow(ctx).toISOString();
  const permissions = input.role === 'admin' ? [...ALL_PERMISSIONS] : input.permissions;

  await ctx.db.insert(users).values({
    id,
    username: input.username,
    passwordHash: hashPassword(input.password),
    role: input.role,
    permissionsJson: JSON.stringify(permissions),
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  return c.json(
    {
      id,
      username: input.username,
      role: input.role,
      permissions,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    201,
  );
});

adminRoutes.patch(
  '/admin/users/:id/permissions',
  zValidator('json', UpdateUserPermissionsSchema),
  async (c) => {
    const denied = guardAdmin(c);
    if (denied) return denied;

    const targetId = c.req.param('id');
    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const actor = c.get('actor');

    const rows = await ctx.db.select().from(users).where(eq(users.id, targetId)).limit(1);
    const target = rows[0];
    if (!target) {
      return c.json({ error: { code: 'USER_NOT_FOUND', message: '目标用户不存在' } }, 404);
    }

    if (target.id === actor?.userId && input.isActive === false) {
      return c.json(
        { error: { code: 'CANNOT_DISABLE_SELF', message: '不能禁用当前正在使用的管理员账号' } },
        400,
      );
    }

    const nowIso = getNow(ctx).toISOString();
    const nextPermissions =
      target.role === 'admin'
        ? [...ALL_PERMISSIONS]
        : (input.permissions ?? parsePermissionsJson(target.permissionsJson));
    const nextActive = input.isActive ?? target.isActive;
    const nextPasswordHash = input.password ? hashPassword(input.password) : target.passwordHash;

    await ctx.db
      .update(users)
      .set({
        permissionsJson: JSON.stringify(nextPermissions),
        isActive: nextActive,
        passwordHash: nextPasswordHash,
        updatedAt: nowIso,
      })
      .where(eq(users.id, targetId));

    return c.json({
      id: target.id,
      username: target.username,
      role: target.role,
      permissions: nextPermissions,
      isActive: nextActive,
      createdAt: target.createdAt,
      updatedAt: nowIso,
    });
  },
);

adminRoutes.delete('/admin/users/:id', async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const targetId = c.req.param('id');
  const ctx = c.get('ctx');
  const actor = c.get('actor');

  if (targetId === actor?.userId) {
    return c.json(
      { error: { code: 'CANNOT_DELETE_SELF', message: '不能删除当前登录的管理员账号' } },
      400,
    );
  }

  const existing = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: { code: 'USER_NOT_FOUND', message: '目标用户不存在' } }, 404);
  }

  await ctx.db.delete(users).where(eq(users.id, targetId));
  return c.json({ ok: true, id: targetId });
});

adminRoutes.get('/admin/api-keys', async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const rows = await c
    .get('ctx')
    .db.select({
      id: externalApiKeys.id,
      name: externalApiKeys.name,
      scopesJson: externalApiKeys.scopesJson,
      rateLimitPerMin: externalApiKeys.rateLimitPerMin,
      rateLimitPerDay: externalApiKeys.rateLimitPerDay,
      isActive: externalApiKeys.isActive,
      createdAt: externalApiKeys.createdAt,
    })
    .from(externalApiKeys)
    .orderBy(desc(externalApiKeys.createdAt));

  return c.json({
    keys: rows.map((k) => ({
      id: k.id,
      name: k.name,
      scopes: JSON.parse(k.scopesJson) as string[],
      rateLimitPerMin: k.rateLimitPerMin,
      rateLimitPerDay: k.rateLimitPerDay,
      isActive: k.isActive,
      createdAt: k.createdAt,
    })),
  });
});

adminRoutes.post('/admin/api-keys', zValidator('json', CreateExternalKeySchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  const rawKey = `rc_ext_${generateRandomToken(24)}`;
  const id = randomUUID();
  const nowIso = getNow(ctx).toISOString();

  await ctx.db.insert(externalApiKeys).values({
    id,
    keyHash: hashToken(rawKey),
    name: input.name,
    scopesJson: JSON.stringify(input.scopes),
    isActive: true,
    createdAt: nowIso,
  });

  // Plaintext external key is returned ONLY once on creation.
  return c.json(
    {
      id,
      name: input.name,
      apiKey: rawKey,
      scopes: input.scopes,
      createdAt: nowIso,
    },
    201,
  );
});

adminRoutes.delete('/admin/api-keys/:id', async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const id = c.req.param('id');
  await c.get('ctx').db.delete(externalApiKeys).where(eq(externalApiKeys.id, id));
  return c.json({ ok: true, id });
});
