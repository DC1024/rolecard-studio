import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  permissionsJson: text('permissions_json').notNull().default('["card:read"]'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const systemSecuritySettings = sqliteTable('system_security_settings', {
  id: text('id').primaryKey(),
  siteAccessMode: text('site_access_mode', { enum: ['public', 'login_required'] })
    .notNull()
    .default('public'),
  apiAccessMode: text('api_access_mode', { enum: ['public', 'authenticated'] })
    .notNull()
    .default('authenticated'),
  guestPermissionsJson: text('guest_permissions_json').notNull().default('["card:read"]'),
  updatedAt: text('updated_at').notNull(),
});

export const userServiceConfigs = sqliteTable('user_service_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().unique(),
  llmProvider: text('llm_provider').notNull(),
  llmApiKeyEncrypted: text('llm_api_key_encrypted').notNull().default(''),
  llmBaseUrl: text('llm_base_url').notNull().default(''),
  llmModel: text('llm_model').notNull(),
  jsonModeStrategy: text('json_mode_strategy', { enum: ['auto', 'json_object', 'prompt'] })
    .notNull()
    .default('auto'),
  chatLlmConfigEncrypted: text('chat_llm_config_encrypted'),
  visionConfigEncrypted: text('vision_config_encrypted'),
  searchProvider: text('search_provider').notNull().default('none'),
  searchApiKeyEncrypted: text('search_api_key_encrypted'),
  enableLayer1Wiki: integer('enable_layer1_wiki', { mode: 'boolean' }).notNull().default(true),
  dailyAutoRefreshLimit: integer('daily_auto_refresh_limit').notNull().default(20),
  customSystemPrompt: text('custom_system_prompt').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

export const roleCards = sqliteTable('role_cards', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  parentCardId: text('parent_card_id'),
  version: integer('version').notNull().default(1),
  publishStatus: text('publish_status', { enum: ['published', 'pending_review', 'archived'] })
    .notNull()
    .default('published'),
  entityType: text('entity_type', { enum: ['fictional', 'real_person'] })
    .notNull()
    .default('fictional'),
  characterName: text('character_name').notNull(),
  workName: text('work_name').notNull().default(''),
  tagsJson: text('tags_json').notNull().default('[]'),
  cardType: text('card_type', {
    enum: ['general', 'sillytavern_v3', 'trpg_coc7', 'trpg_dnd5e', 'custom'],
  })
    .notNull()
    .default('sillytavern_v3'),
  mode: text('mode', { enum: ['A', 'B', 'C'] }).notNull(),
  referenceInfo: text('reference_info').notNull().default(''),
  contentJson: text('content_json').notNull(),
  metaReputationJson: text('meta_reputation_json'),
  enableMetaInChat: integer('enable_meta_in_chat', { mode: 'boolean' }).notNull().default(false),
  lockedFieldsJson: text('locked_fields_json').notNull().default('[]'),
  diffSummary: text('diff_summary'),
  sourcesJson: text('sources_json').notNull().default('[]'),
  searchSnapshot: text('search_snapshot'),
  tokenCount: integer('token_count').notNull().default(0),
  imageUrl: text('image_url'),
  imageSource: text('image_source'),
  imagePrompt: text('image_prompt'),
  scheduleEnabled: integer('schedule_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const externalApiKeys = sqliteTable('external_api_keys', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull().unique(),
  name: text('name').notNull(),
  scopesJson: text('scopes_json').notNull().default('["*"]'),
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(60),
  rateLimitPerDay: integer('rate_limit_per_day').notNull().default(1000),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
});

export const generationLogs = sqliteTable('generation_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  targetId: text('target_id'),
  provider: text('provider'),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
});

export const lorebooks = sqliteTable('lorebooks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  worldSummary: text('world_summary').notNull().default(''),
  scanDepth: integer('scan_depth').notNull().default(4),
  tokenBudget: integer('token_budget').notNull().default(1500),
  recursiveScanning: integer('recursive_scanning', { mode: 'boolean' }).notNull().default(false),
  entriesJson: text('entries_json').notNull().default('[]'),
  tagsJson: text('tags_json').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const lorebookCharacterLinks = sqliteTable('lorebook_character_links', {
  id: text('id').primaryKey(),
  lorebookId: text('lorebook_id')
    .notNull()
    .references(() => lorebooks.id, { onDelete: 'cascade' }),
  cardId: text('card_id')
    .notNull()
    .references(() => roleCards.id, { onDelete: 'cascade' }),
  entryUid: text('entry_uid').notNull(),
  relationRole: text('relation_role').notNull().default('核心人物'),
  createdAt: text('created_at').notNull(),
});
