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
  imageConfigEncrypted: text('image_config_encrypted'),
  searchProvider: text('search_provider').notNull().default('none'),
  searchApiKeyEncrypted: text('search_api_key_encrypted'),
  enableLayer1Wiki: integer('enable_layer1_wiki', { mode: 'boolean' }).notNull().default(true),
  dailyAutoRefreshLimit: integer('daily_auto_refresh_limit').notNull().default(20),
  llmRequestTimeoutSeconds: integer('llm_request_timeout_seconds').notNull().default(300),
  llmMaxTokens: integer('llm_max_tokens').notNull().default(16384),
  customSystemPrompt: text('custom_system_prompt').notNull().default(''),
  proxyConfigEncrypted: text('proxy_config_encrypted'),
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
  tokenImageUrl: text('token_image_url'),
  tokenCropJson: text('token_crop_json'),
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

export const syncSchedules = sqliteTable('sync_schedules', {
  id: text('id').primaryKey(),
  cardId: text('card_id')
    .notNull()
    .unique()
    .references(() => roleCards.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  intervalDays: integer('interval_days').notNull().default(7),
  syncScope: text('sync_scope', { enum: ['canon', 'meta_reputation', 'both'] })
    .notNull()
    .default('canon'),
  autoApplyThreshold: text('auto_apply_threshold', { enum: ['manual_review', 'auto_minor'] })
    .notNull()
    .default('manual_review'),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
  lastSourceHash: text('last_source_hash'),
  updatedAt: text('updated_at').notNull(),
});

export const impressionEvents = sqliteTable('impression_events', {
  id: text('id').primaryKey(),
  cardId: text('card_id')
    .notNull()
    .references(() => roleCards.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  diffSummary: text('diff_summary').notNull().default(''),
  beforeContentJson: text('before_content_json').notNull(),
  afterContentJson: text('after_content_json').notNull(),
  sourcesJson: text('sources_json').notNull().default('[]'),
  metaSummary: text('meta_summary'),
  status: text('status', { enum: ['pending_review', 'applied', 'rejected'] })
    .notNull()
    .default('pending_review'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
});

export const rippleProposals = sqliteTable('ripple_proposals', {
  id: text('id').primaryKey(),
  sourceCardId: text('source_card_id')
    .notNull()
    .references(() => roleCards.id, { onDelete: 'cascade' }),
  targetCardId: text('target_card_id')
    .notNull()
    .references(() => roleCards.id, { onDelete: 'cascade' }),
  lorebookId: text('lorebook_id'),
  hop: integer('hop').notNull().default(1),
  proposedAttitude: text('proposed_attitude').notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['pending_review', 'approved', 'rejected'] })
    .notNull()
    .default('pending_review'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
});

export const syncEvents = sqliteTable('sync_events', {
  cursor: integer('cursor').primaryKey({ autoIncrement: true }),
  id: text('id').notNull().unique(),
  eventType: text('event_type', {
    enum: ['card.updated', 'card.evolved', 'lorebook.updated', 'ripple.approved', 'review.pending'],
  }).notNull(),
  targetType: text('target_type', { enum: ['card', 'lorebook'] }).notNull(),
  targetId: text('target_id').notNull(),
  version: integer('version').notNull().default(1),
  payloadJson: text('payload_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
});

export const syncSubscriptions = sqliteTable('sync_subscriptions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  webhookUrl: text('webhook_url').notNull(),
  secretEncrypted: text('secret_encrypted').notNull(),
  eventsJson: text('events_json').notNull().default('["card.updated","card.evolved"]'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastCursor: integer('last_cursor').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const notificationChannels = sqliteTable('notification_channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  channelType: text('channel_type', {
    enum: ['smtp', 'feishu', 'wecom', 'dingtalk', 'telegram', 'discord', 'bark', 'serverchan', 'webhook'],
  }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  eventsJson: text('events_json').notNull().default('["review.pending","card.evolved"]'),
  configEncrypted: text('config_encrypted').notNull(),
  lastStatus: text('last_status', { enum: ['success', 'error'] }),
  lastError: text('last_error'),
  lastSentAt: text('last_sent_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const portraitStylePresets = sqliteTable('portrait_style_presets', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().default('global'),
  name: text('name').notNull(),
  stylePrompt: text('style_prompt').notNull().default(''),
  negativePromptHint: text('negative_prompt_hint').notNull().default(''),
  instructionHint: text('instruction_hint').notNull().default(''),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  isCustomized: integer('is_customized', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const roleCardRevisions = sqliteTable('role_card_revisions', {
  id: text('id').primaryKey(),
  cardId: text('card_id')
    .notNull()
    .references(() => roleCards.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  summary: text('summary').notNull().default(''),
  characterName: text('character_name').notNull(),
  cardType: text('card_type', {
    enum: ['general', 'sillytavern_v3', 'trpg_coc7', 'trpg_dnd5e', 'custom'],
  }).notNull(),
  tagsJson: text('tags_json').notNull().default('[]'),
  contentJson: text('content_json').notNull(),
  lockedFieldsJson: text('locked_fields_json').notNull().default('[]'),
  tokenCount: integer('token_count').notNull().default(0),
  createdBy: text('created_by').notNull().default('guest'),
  createdAt: text('created_at').notNull(),
});

export const playtestSessions = sqliteTable('playtest_sessions', {
  id: text('id').primaryKey(),
  cardId: text('card_id')
    .notNull()
    .references(() => roleCards.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().default('guest'),
  title: text('title').notNull().default('新试聊会话'),
  greetingIndex: integer('greeting_index').notNull().default(0),
  userName: text('user_name').notNull().default('旅行者'),
  userPersona: text('user_persona').notNull().default(''),
  trpgMode: text('trpg_mode', { enum: ['auto', 'coc7e', 'dnd5e', 'none'] })
    .notNull()
    .default('auto'),
  modelOverride: text('model_override').notNull().default(''),
  messagesJson: text('messages_json').notNull().default('[]'),
  messageCount: integer('message_count').notNull().default(0),
  lastMessagePreview: text('last_message_preview').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
