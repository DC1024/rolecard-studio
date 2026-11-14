import {
  ALL_PERMISSIONS,
  type AccessPolicy,
  type Permission,
  type UserRole,
} from '@rolecard/shared';
import { type CoreError, type Result, err, ok } from './types.js';

export interface ActorContext {
  userId: string;
  username: string;
  role: UserRole;
  permissions: readonly Permission[];
  isActive: boolean;
}

export function resolveEffectivePermissions(
  actor: ActorContext | null,
  policy: AccessPolicy,
): Permission[] {
  if (!actor) {
    if (policy.siteAccessMode === 'login_required') {
      return [];
    }
    return [...new Set(policy.guestPermissions)];
  }
  if (!actor.isActive) {
    return [];
  }
  if (actor.role === 'admin') {
    return [...ALL_PERMISSIONS];
  }
  return [...new Set(actor.permissions)];
}

export function canAccessSite(
  actor: ActorContext | null,
  policy: AccessPolicy,
): boolean {
  if (policy.siteAccessMode === 'public') {
    return actor ? actor.isActive : true;
  }
  return actor !== null && actor.isActive;
}

export function authorizePermission(
  actor: ActorContext | null,
  policy: AccessPolicy,
  required: Permission,
): Result<void, CoreError> {
  if (!actor && policy.siteAccessMode === 'login_required') {
    return err({
      code: 'UNAUTHORIZED',
      message: '当前站点已开启必须登录访问，请先登录账号',
      status: 401,
    });
  }

  if (actor && !actor.isActive) {
    return err({
      code: 'ACCOUNT_DISABLED',
      message: '当前账号已被管理员禁用',
      status: 403,
    });
  }

  const effective = resolveEffectivePermissions(actor, policy);
  if (!effective.includes(required)) {
    if (!actor) {
      return err({
        code: 'UNAUTHORIZED',
        message: `匿名访客缺少权限 (${required})，请先登录或联系管理员授权`,
        status: 401,
      });
    }
    return err({
      code: 'FORBIDDEN',
      message: `当前账号缺少操作权限: ${required}`,
      status: 403,
    });
  }

  return ok(undefined);
}

export function authorizeAdmin(actor: ActorContext | null): Result<void, CoreError> {
  if (!actor) {
    return err({
      code: 'UNAUTHORIZED',
      message: '请先使用管理员账号登录',
      status: 401,
    });
  }
  if (!actor.isActive) {
    return err({
      code: 'ACCOUNT_DISABLED',
      message: '当前账号已被禁用',
      status: 403,
    });
  }
  if (actor.role !== 'admin') {
    return err({
      code: 'FORBIDDEN',
      message: '仅管理员可执行该操作',
      status: 403,
    });
  }
  return ok(undefined);
}

export function authorizeExternalApiRequest(
  policy: AccessPolicy,
  validKeyScopes: readonly string[] | null,
  requiredScope?: string,
): Result<void, CoreError> {
  if (policy.apiAccessMode === 'public') {
    return ok(undefined);
  }

  if (!validKeyScopes) {
    return err({
      code: 'API_UNAUTHORIZED',
      message: '对外 API 当前处于鉴权模式，请提供有效的 Bearer Access Key',
      status: 401,
    });
  }

  if (requiredScope && !validKeyScopes.includes('*') && !validKeyScopes.includes(requiredScope)) {
    return err({
      code: 'API_FORBIDDEN',
      message: `Access Key 缺少所需权限 Scope: ${requiredScope}`,
      status: 403,
    });
  }

  return ok(undefined);
}
