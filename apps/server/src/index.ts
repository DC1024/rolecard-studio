import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadOrCreateMasterKey } from '@rolecard/core';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState } from './db/client.js';
import { runScheduledEvolutionTick } from './routes/evolution.js';

function resolveWebDistDir(): string | undefined {
  if (process.env.ROLECARD_WEB_DIST && existsSync(process.env.ROLECARD_WEB_DIST)) {
    return resolve(process.env.ROLECARD_WEB_DIST);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../web/dist'),
    resolve(here, '../public'),
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), 'public'),
  ];
  return candidates.find((p) => existsSync(resolve(p, 'index.html')));
}

async function main(): Promise<void> {
  const dataDir = resolve(process.env.ROLECARD_DATA_DIR ?? './data');
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const hostname = process.env.HOST ?? '0.0.0.0';
  const webDistDir = resolveWebDistDir();

  const masterKey = await loadOrCreateMasterKey(resolve(dataDir, '.master.key'));
  const { db } = createSqliteDatabase(resolve(dataDir, 'rolecard.db'));

  const seedResult = await seedInitialState(db, {
    adminUsername: process.env.ROLECARD_ADMIN_USER,
    adminPassword: process.env.ROLECARD_ADMIN_PASSWORD,
  });

  if (seedResult.generatedAdminPassword) {
    console.info(
      `[RoleCard Studio] Initial admin account created -> username: "${seedResult.createdAdminUsername}", password: "${seedResult.generatedAdminPassword}" (please change it after login)`,
    );
  }

  const serverCtx = {
    db,
    masterKey,
    dataDir,
    deploymentMode: (process.env.ROLECARD_DEPLOYMENT_MODE === 'cloud' ? 'cloud' : 'local') as
      | 'local'
      | 'cloud',
    webDistDir,
  };

  const app = createApp(serverCtx);

  if (process.env.ROLECARD_ENABLE_SCHEDULER !== 'false') {
    const intervalMs = 60 * 60 * 1000;
    const timer = setInterval(() => {
      void runScheduledEvolutionTick(serverCtx).catch((err) => {
        console.warn('[RoleCard Studio] Evolution scheduler tick warning:', err);
      });
    }, intervalMs);
    timer.unref();
  }

  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
  });
  if ('requestTimeout' in server) {
    server.requestTimeout = 0;
  }
  if ('headersTimeout' in server) {
    server.headersTimeout = 600_000;
  }

  console.info(`[RoleCard Studio] Server listening on http://${hostname}:${port}`);
}

main().catch((err) => {
  console.error('[RoleCard Studio] Fatal startup error:', err);
  process.exit(1);
});
