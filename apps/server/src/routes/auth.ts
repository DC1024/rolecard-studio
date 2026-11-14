import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import { generateRandomToken, hashToken, verifyPassword } from '@rolecard/core';
import { LoginRequestSchema, type AuthContextResponse } from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getNow } from '../context.js';
import { sessions, users } from '../db/schema.js';
import { parsePermissionsJson, SESSION_COOKIE_NAME, type AppEnv } from '../middleware/auth.js';

export const authRoutes = new Hono<AppEnv>();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

authRoutes.post('/auth/login', zValidator('json', LoginRequestSchema), async (c) => {
  const { username, password } = c.req.valid('json');
  const ctx = c.get('ctx');

  const foundUsers = await ctx.db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  const user = foundUsers[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return c.json(
      { error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } },
      401,
    );
  }

  if (!user.isActive) {
    return c.json(
      { error: { code: 'ACCOUNT_DISABLED', message: '该账号已被管理员禁用' } },
      403,
    );
  }

  const rawToken = generateRandomToken(32);
  const tokenHash = hashToken(rawToken);
  const now = getNow(ctx);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await ctx.db.insert(sessions).values({
    id: randomUUID(),
    userId: user.id,
    tokenHash,
    expiresAt,
    createdAt: now.toISOString(),
  });

  setCookie(c, SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  const permissions = parsePermissionsJson(user.permissionsJson);
  return c.json({
    token: rawToken,
    expiresAt,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

authRoutes.post('/auth/logout', async (c) => {
  const ctx = c.get('ctx');
  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  const authHeader = c.req.header('authorization');
  const rawToken =
    cookieToken ??
    (authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null);

  if (rawToken) {
    await ctx.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(rawToken)));
  }

  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/auth/me', async (c) => {
  const ctx = c.get('ctx');
  const actor = c.get('actor');
  const policy = c.get('policy');
  const effectivePermissions = c.get('effectivePermissions');

  let userSummary: AuthContextResponse['user'] = null;
  if (actor) {
    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    const row = rows[0];
    if (row) {
      userSummary = {
        id: row.id,
        username: row.username,
        role: row.role,
        permissions: parsePermissionsJson(row.permissionsJson),
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }
  }

  const response: AuthContextResponse = {
    authenticated: actor !== null,
    user: userSummary,
    effectivePermissions,
    policy,
  };

  return c.json(response);
});
