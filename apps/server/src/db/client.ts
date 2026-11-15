import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { generateRandomToken, hashPassword } from '@rolecard/core';
import { ALL_PERMISSIONS } from '@rolecard/shared';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema.js';

export type AppDatabase = SqliteRemoteDatabase<typeof schema>;

export interface DatabaseHandle {
  db: AppDatabase;
  sqlite: DatabaseSync;
  close(): void;
}

function normalizeSqlParams(params: unknown[]): SQLInputValue[] {
  return params.map((value) => {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'string' ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    return JSON.stringify(value);
  });
}

export function createSqliteDatabase(dbPath: string): DatabaseHandle {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new DatabaseSync(dbPath, {
    timeout: 5000,
    returnArrays: true,
  });

  sqlite.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    sqlite.exec('PRAGMA journal_mode = WAL;');
    sqlite.exec('PRAGMA synchronous = NORMAL;');
  }

  initializeTables(sqlite);

  const db = drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql);
      const bound = normalizeSqlParams(params);

      if (method === 'run') {
        stmt.run(...bound);
        return { rows: [] };
      }

      if (method === 'get') {
        const row = stmt.get(...bound) as unknown as unknown[] | undefined;
        return { rows: row as unknown[] };
      }

      const rows = stmt.all(...bound) as unknown as unknown[][];
      return { rows };
    },
    { schema },
  );

  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}

function initializeTables(sqlite: DatabaseSync): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      permissions_json TEXT NOT NULL DEFAULT '["card:read"]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_security_settings (
      id TEXT PRIMARY KEY,
      site_access_mode TEXT NOT NULL DEFAULT 'public',
      api_access_mode TEXT NOT NULL DEFAULT 'authenticated',
      guest_permissions_json TEXT NOT NULL DEFAULT '["card:read"]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_service_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      llm_provider TEXT NOT NULL,
      llm_api_key_encrypted TEXT NOT NULL DEFAULT '',
      llm_base_url TEXT NOT NULL DEFAULT '',
      llm_model TEXT NOT NULL,
      json_mode_strategy TEXT NOT NULL DEFAULT 'auto',
      chat_llm_config_encrypted TEXT,
      vision_config_encrypted TEXT,
      image_config_encrypted TEXT,
      search_provider TEXT NOT NULL DEFAULT 'none',
      search_api_key_encrypted TEXT,
      enable_layer1_wiki INTEGER NOT NULL DEFAULT 1,
      daily_auto_refresh_limit INTEGER NOT NULL DEFAULT 20,
      custom_system_prompt TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      parent_card_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      publish_status TEXT NOT NULL DEFAULT 'published',
      entity_type TEXT NOT NULL DEFAULT 'fictional',
      character_name TEXT NOT NULL,
      work_name TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      card_type TEXT NOT NULL DEFAULT 'sillytavern_v3',
      mode TEXT NOT NULL,
      reference_info TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL,
      meta_reputation_json TEXT,
      enable_meta_in_chat INTEGER NOT NULL DEFAULT 0,
      locked_fields_json TEXT NOT NULL DEFAULT '[]',
      diff_summary TEXT,
      sources_json TEXT NOT NULL DEFAULT '[]',
      search_snapshot TEXT,
      token_count INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      image_source TEXT,
      image_prompt TEXT,
      schedule_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_role_cards_created_at ON role_cards(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_role_cards_character_name ON role_cards(character_name);

    CREATE TABLE IF NOT EXISTS external_api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '["*"]',
      rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
      rate_limit_per_day INTEGER NOT NULL DEFAULT 1000,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      target_id TEXT,
      provider TEXT,
      status TEXT NOT NULL,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lorebooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      world_summary TEXT NOT NULL DEFAULT '',
      scan_depth INTEGER NOT NULL DEFAULT 4,
      token_budget INTEGER NOT NULL DEFAULT 1500,
      recursive_scanning INTEGER NOT NULL DEFAULT 0,
      entries_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lorebook_character_links (
      id TEXT PRIMARY KEY,
      lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES role_cards(id) ON DELETE CASCADE,
      entry_uid TEXT NOT NULL,
      relation_role TEXT NOT NULL DEFAULT '核心人物',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lorebook_links_card ON lorebook_character_links(card_id);
    CREATE INDEX IF NOT EXISTS idx_lorebook_links_book ON lorebook_character_links(lorebook_id);

    CREATE TABLE IF NOT EXISTS sync_schedules (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL UNIQUE REFERENCES role_cards(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_days INTEGER NOT NULL DEFAULT 7,
      sync_scope TEXT NOT NULL DEFAULT 'canon',
      auto_apply_threshold TEXT NOT NULL DEFAULT 'manual_review',
      last_run_at TEXT,
      next_run_at TEXT,
      last_source_hash TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS impression_events (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES role_cards(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      diff_summary TEXT NOT NULL DEFAULT '',
      before_content_json TEXT NOT NULL,
      after_content_json TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      meta_summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_impression_events_status ON impression_events(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS ripple_proposals (
      id TEXT PRIMARY KEY,
      source_card_id TEXT NOT NULL REFERENCES role_cards(id) ON DELETE CASCADE,
      target_card_id TEXT NOT NULL REFERENCES role_cards(id) ON DELETE CASCADE,
      lorebook_id TEXT,
      hop INTEGER NOT NULL DEFAULT 1,
      proposed_attitude TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ripple_proposals_status ON ripple_proposals(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS sync_events (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_subscriptions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      secret_encrypted TEXT NOT NULL,
      events_json TEXT NOT NULL DEFAULT '["card.updated","card.evolved"]',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_cursor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      events_json TEXT NOT NULL DEFAULT '["review.pending","card.evolved"]',
      config_encrypted TEXT NOT NULL,
      last_status TEXT,
      last_error TEXT,
      last_sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumnExists(sqlite, 'user_service_configs', 'image_config_encrypted', 'TEXT');
}

function ensureColumnExists(
  sqlite: DatabaseSync,
  tableName: string,
  columnName: string,
  columnDef: string,
): void {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName});`).all() as unknown[];
  const exists = rows.some((row) => {
    if (Array.isArray(row)) {
      return String(row[1] ?? '') === columnName;
    }
    if (typeof row === 'object' && row !== null) {
      return String((row as { name?: unknown }).name ?? '') === columnName;
    }
    return false;
  });
  if (!exists) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`);
  }
}

export interface BootstrapSeedOptions {
  adminUsername?: string;
  adminPassword?: string;
  nowIso?: string;
}

export async function seedInitialState(
  db: AppDatabase,
  options: BootstrapSeedOptions = {},
): Promise<{ createdAdminUsername?: string; generatedAdminPassword?: string }> {
  const nowIso = options.nowIso ?? new Date().toISOString();

  const existingPolicy = await db.select().from(schema.systemSecuritySettings).limit(1);
  if (existingPolicy.length === 0) {
    await db.insert(schema.systemSecuritySettings).values({
      id: 'default',
      siteAccessMode: 'public',
      apiAccessMode: 'authenticated',
      guestPermissionsJson: JSON.stringify(['card:read']),
      updatedAt: nowIso,
    });
  }

  const existingUsers = await db.select().from(schema.users).limit(1);
  if (existingUsers.length === 0) {
    const username = options.adminUsername?.trim() || 'admin';
    const rawPassword = options.adminPassword?.trim() || generateRandomToken(12);
    await db.insert(schema.users).values({
      id: randomUUID(),
      username,
      passwordHash: hashPassword(rawPassword),
      role: 'admin',
      permissionsJson: JSON.stringify(ALL_PERMISSIONS),
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return {
      createdAdminUsername: username,
      generatedAdminPassword: options.adminPassword ? undefined : rawPassword,
    };
  }

  return {};
}
