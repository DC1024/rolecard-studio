import { z } from 'zod';

export const UserRoleSchema = z.enum(['admin', 'user']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const ALL_PERMISSIONS = [
  'card:read',
  'card:create',
  'card:update',
  'card:delete',
  'card:export',
  'playtest:use',
  'review:resolve',
] as const;

export const PermissionSchema = z.enum(ALL_PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  'card:read': { label: '查看角色卡', description: '查看角色卡库、版本历史、引用溯源与世界书' },
  'card:create': { label: '新增角色卡', description: '生成模式 A/B/C 角色卡或导入旧卡' },
  'card:update': { label: '修改与标签', description: '微调人设、管理标签、开启或调整定时任务' },
  'card:delete': { label: '删除角色卡', description: '删除角色卡及历史版本' },
  'card:export': { label: '导出角色卡', description: '导出 CCV3 PNG、JSON 与世界书' },
  'playtest:use': { label: '快速试聊', description: '使用试聊沙盒验证人设与世界书触发' },
  'review:resolve': { label: '审核演化', description: '审核定时演化草稿与强关系涟漪提案' },
};

export const SiteAccessModeSchema = z.enum(['public', 'login_required']);
export type SiteAccessMode = z.infer<typeof SiteAccessModeSchema>;

export const ApiAccessModeSchema = z.enum(['public', 'authenticated']);
export type ApiAccessMode = z.infer<typeof ApiAccessModeSchema>;

export const DEFAULT_GUEST_PERMISSIONS: readonly Permission[] = ['card:read'];
