import { z } from 'zod';
import {
  ApiAccessModeSchema,
  PermissionSchema,
  SiteAccessModeSchema,
  UserRoleSchema,
} from './permissions.js';

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(6).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const CreateUserRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, '用户名仅支持字母、数字及 _ . -'),
  password: z.string().min(6).max(128),
  role: UserRoleSchema.default('user'),
  permissions: z.array(PermissionSchema).default(['card:read']),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserPermissionsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, '用户名仅支持字母、数字及 _ . -')
    .optional(),
  permissions: z.array(PermissionSchema).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).max(128).optional(),
});
export type UpdateUserPermissionsRequest = z.infer<typeof UpdateUserPermissionsSchema>;

export const UpdateMyAccountSchema = z
  .object({
    currentPassword: z.string().min(6, '请输入当前密码').max(128),
    newUsername: z
      .string()
      .trim()
      .min(2, '用户名至少 2 个字符')
      .max(64)
      .regex(/^[a-zA-Z0-9_.-]+$/, '用户名仅支持字母、数字及 _ . -')
      .optional(),
    newPassword: z.string().min(6, '新密码至少 6 个字符').max(128).optional(),
  })
  .refine((data) => Boolean(data.newUsername || data.newPassword), {
    message: '请至少填写新用户名或新密码中的一项',
  });
export type UpdateMyAccountRequest = z.infer<typeof UpdateMyAccountSchema>;

export const AccessPolicySchema = z.object({
  siteAccessMode: SiteAccessModeSchema,
  apiAccessMode: ApiAccessModeSchema,
  guestPermissions: z.array(PermissionSchema).min(0),
});
export type AccessPolicy = z.infer<typeof AccessPolicySchema>;

export interface UserSummary {
  id: string;
  username: string;
  role: z.infer<typeof UserRoleSchema>;
  permissions: z.infer<typeof PermissionSchema>[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthContextResponse {
  authenticated: boolean;
  user: UserSummary | null;
  effectivePermissions: z.infer<typeof PermissionSchema>[];
  policy: AccessPolicy;
}
