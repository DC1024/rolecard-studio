import {
  authorizeAdmin,
  authorizeExternalApiRequest,
  authorizePermission,
  hashToken,
  resolveEffectivePermissions,
  type ActorContext,
  type CoreError,
} from '@rolecard/core';
import {
  DEFAULT_GUEST_PERMISSIONS,
  PermissionSchema,
  type AccessPolicy,
  type Permission,
} from '@rolecard/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ServerContext } from '../context.js';
import { getNow } from '../context.js';
import { externalApiKeys, sessions, systemSecuritySettings, users } from '../db/schema.js';

export const SESSION_COOKIE_NAME = 'rc_session';

export interface AppEnv {
  Variables: {
    ctx: ServerContext;
    actor: ActorContext | null;
    policy: AccessPolicy;
    effectivePermissions: Permission[];
  };
}

export async function loadAccessPolicy(ctx: ServerContext): Promise<AccessPolicy> {
  const rows = await ctx.db.select().from(systemSecuritySettings).limit(1);
  const row = rows[0];
  if (!row) {
    return {
      siteAccessMode: 'public',
      apiAccessMode: 'authenticated',
      guestPermissions: [...DEFAULT_GUEST_PERMISSIONS],
    };
  }
  return {
    siteAccessMode: row.siteAccessMode,
    apiAccessMode: row.apiAccessMode,
    guestPermissions: parsePermissionsJson(row.guestPermissionsJson),
  };
}

export function parsePermissionsJson(raw: string): Permission[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid: Permission[] = [];
    for (const item of parsed) {
      const check = PermissionSchema.safeParse(item);
      if (check.success && !valid.includes(check.data)) {
        valid.push(check.data);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

export function attachAuthContext(serverCtx: ServerContext): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('ctx', serverCtx);

    const policy = await loadAccessPolicy(serverCtx);
    c.set('policy', policy);

    let actor: ActorContext | null = null;
    const rawToken = extractSessionToken(c);

    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const nowIso = getNow(serverCtx).toISOString();
      const sessionRows = await serverCtx.db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          permissionsJson: users.permissionsJson,
          isActive: users.isActive,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, nowIso)))
        .limit(1);

      const found = sessionRows[0];
      if (found) {
        actor = {
          userId: found.userId,
          username: found.username,
          role: found.role,
          permissions: parsePermissionsJson(found.permissionsJson),
          isActive: found.isActive,
        };
      }
    }

    c.set('actor', actor);
    c.set('effectivePermissions', resolveEffectivePermissions(actor, policy));

    await next();
  };
}

function extractSessionToken(c: Context<AppEnv>): string | null {
  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieToken) {
    return cookieToken;
  }
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token && !token.startsWith('rc_ext_')) {
      return token;
    }
  }
  return null;
}

export function sendCoreError(c: Context<AppEnv>, error: CoreError): Response {
  const status = error.status as ContentfulStatusCode;
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    },
    status,
  );
}

export function guardPermission(c: Context<AppEnv>, permission: Permission): Response | null {
  const check = authorizePermission(c.get('actor'), c.get('policy'), permission);
  if (!check.ok) {
    return sendCoreError(c, check.error);
  }
  return null;
}

export function guardAdmin(c: Context<AppEnv>): Response | null {
  const check = authorizeAdmin(c.get('actor'));
  if (!check.ok) {
    return sendCoreError(c, check.error);
  }
  return null;
}

export async function guardExternalApi(
  c: Context<AppEnv>,
  requiredScope?: string,
): Promise<Response | null> {
  const policy = c.get('policy');
  if (policy.apiAccessMode === 'public') {
    return null;
  }

  const authHeader = c.req.header('authorization');
  const rawKey = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  let scopes: string[] | null = null;
  if (rawKey) {
    const keyHash = hashToken(rawKey);
    const rows = await c
      .get('ctx')
      .db.select()
      .from(externalApiKeys)
      .where(and(eq(externalApiKeys.keyHash, keyHash), eq(externalApiKeys.isActive, true)))
      .limit(1);
    const keyRow = rows[0];
    if (keyRow) {
      try {
        const parsed = JSON.parse(keyRow.scopesJson) as unknown;
        if (Array.isArray(parsed)) {
          scopes = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        scopes = [];
      }
    }
  }

  const check = authorizeExternalApiRequest(policy, scopes, requiredScope);
  if (!check.ok) {
    return sendCoreError(c, check.error);
  }
  return null;
}
