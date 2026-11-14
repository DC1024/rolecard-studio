#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRoleCardMcpServer } from './server.js';

async function main(): Promise<void> {
  const baseUrl = process.env.ROLECARD_API_URL ?? 'http://127.0.0.1:3000';
  const apiKey = process.env.ROLECARD_API_KEY;

  const { server } = createRoleCardMcpServer({ baseUrl, apiKey });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[rolecard-mcp] fatal error:', err);
  process.exit(1);
});
