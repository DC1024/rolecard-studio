import { Hono } from 'hono';
import type { AppEnv } from '../middleware/auth.js';

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get('/health', (c) => {
  const ctx = c.get('ctx');
  const policy = c.get('policy');
  const actor = c.get('actor');

  return c.json({
    status: 'ok',
    version: '0.1.0-m0',
    deploymentMode: ctx.deploymentMode,
    siteAccessMode: policy.siteAccessMode,
    apiAccessMode: policy.apiAccessMode,
    authenticated: actor !== null,
  });
});
