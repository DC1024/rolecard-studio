import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface RoleCardMcpClientConfig {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface RoleCardMcpHandlerSet {
  searchCards(query?: string): Promise<unknown>;
  getCard(cardId: string): Promise<unknown>;
  exportCardCcv3(cardId: string): Promise<unknown>;
  listLorebooks(): Promise<unknown>;
}

export function createRoleCardApiClient(config: RoleCardMcpClientConfig): RoleCardMcpHandlerSet {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const fetchFn = config.fetchImpl ?? fetch;

  async function requestJson(path: string): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (config.apiKey?.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }

    const res = await fetchFn(`${baseUrl}/api/v1${path}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`RoleCard Studio API error (${res.status}): ${text}`);
    }
    return res.json();
  }

  return {
    searchCards(query?: string) {
      const q = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
      return requestJson(`/external/cards${q}`);
    },
    getCard(cardId: string) {
      return requestJson(`/external/cards/${encodeURIComponent(cardId)}`);
    },
    exportCardCcv3(cardId: string) {
      return requestJson(`/external/cards/${encodeURIComponent(cardId)}/ccv3`);
    },
    listLorebooks() {
      return requestJson('/external/lorebooks');
    },
  };
}

export function createRoleCardMcpServer(config: RoleCardMcpClientConfig): {
  server: McpServer;
  handlers: RoleCardMcpHandlerSet;
} {
  const handlers = createRoleCardApiClient(config);
  const server = new McpServer({
    name: 'rolecard-studio',
    version: '0.1.0',
  });

  server.tool(
    'search_cards',
    '按角色名、作品或标签搜索 RoleCard Studio 中的角色卡',
    { query: z.string().optional().describe('关键词（可选）') },
    async ({ query }) => {
      const data = await handlers.searchCards(query);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    'get_card',
    '获取指定角色卡的完整设定、版本与溯源详情',
    { cardId: z.string().min(1).describe('角色卡 ID') },
    async ({ cardId }) => {
      const data = await handlers.getCard(cardId);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    'export_card_ccv3',
    '导出指定角色卡的 SillyTavern CCV3 JSON（含关联世界书）',
    { cardId: z.string().min(1).describe('角色卡 ID') },
    async ({ cardId }) => {
      const data = await handlers.exportCardCcv3(cardId);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.tool(
    'list_lorebooks',
    '列出 RoleCard Studio 中的独立世界书及其词条列表',
    {},
    async () => {
      const data = await handlers.listLorebooks();
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.resource('cards-index', 'rolecard://cards', async (uri) => {
    const data = await handlers.searchCards();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  });

  server.resource('lorebooks-index', 'rolecard://lorebooks', async (uri) => {
    const data = await handlers.listLorebooks();
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  });

  return { server, handlers };
}
