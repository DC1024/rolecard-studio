import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { loadOrCreateMasterKey } from '@rolecard/core';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState } from './db/client.js';

async function main(): Promise<void> {
  const dataDir = resolve(process.env.ROLECARD_DATA_DIR ?? './data');
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const hostname = process.env.HOST ?? '0.0.0.0';

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

  const app = createApp({
    db,
    masterKey,
    dataDir,
    deploymentMode: process.env.ROLECARD_DEPLOYMENT_MODE === 'cloud' ? 'cloud' : 'local',
  });

  serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  console.info(`[RoleCard Studio] Server listening on http://${hostname}:${port}`);
}

main().catch((err) => {
  console.error('[RoleCard Studio] Fatal startup error:', err);
  process.exit(1);
});
