import { describe, expect, it } from 'vitest';
import { createRoleCardMcpServer } from './server.js';

describe('Official RoleCard MCP Server', () => {
  it('constructs McpServer and queries cards & lorebooks via Bearer API Key', async () => {
    const seenHeaders: string[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      seenHeaders.push(`${String(input)}|${auth}`);

      if (String(input).includes('/external/lorebooks')) {
        return new Response(JSON.stringify({ items: [{ id: 'lb-1', name: '灰雾世界书' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (String(input).includes('/ccv3')) {
        return new Response(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '克莱恩' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ items: [{ id: 'c-1', characterName: '克莱恩' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const { server, handlers } = createRoleCardMcpServer({
      baseUrl: 'http://127.0.0.1:3000',
      apiKey: 'rc_ext_test_token',
      fetchImpl: mockFetch,
    });

    expect(server).toBeDefined();
    const cards = (await handlers.searchCards('克莱恩')) as { items: { id: string }[] };
    expect(cards.items[0]?.id).toBe('c-1');
    const ccv3 = (await handlers.exportCardCcv3('c-1')) as { spec: string };
    expect(ccv3.spec).toBe('chara_card_v3');
    const books = (await handlers.listLorebooks()) as { items: { name: string }[] };
    expect(books.items[0]?.name).toBe('灰雾世界书');

    expect(seenHeaders.every((h) => h.includes('Bearer rc_ext_test_token'))).toBe(true);
  });
});
