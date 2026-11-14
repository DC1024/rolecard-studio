/**
 * RoleCard Studio -> SillyTavern 实时同步扩展
 * 消费 /api/v1/external/sync/stream (SSE) 与 /api/v1/external/sync/events?since_cursor=
 * 并在角色卡演化/更新或世界书变更时自动拉取 CCV3 最新卡面。
 */

const STORAGE_KEY = 'rolecard_studio_sync_settings_v1';

const defaultSettings = {
  serverUrl: 'http://127.0.0.1:3000',
  apiToken: '',
  lastCursor: 0,
  autoApply: true,
  pollIntervalMs: 30000,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function authHeaders(token) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export class RoleCardSyncClient {
  constructor(options = {}) {
    this.settings = { ...loadSettings(), ...options };
    this.abortController = null;
    this.pollTimer = null;
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
  }

  get baseUrl() {
    return this.settings.serverUrl.replace(/\/+$/, '');
  }

  updateConfig(partial) {
    this.settings = { ...this.settings, ...partial };
    saveSettings(this.settings);
  }

  async pullLatestCardCcv3(cardId) {
    const res = await fetch(`${this.baseUrl}/api/v1/external/cards/${encodeURIComponent(cardId)}/ccv3`, {
      headers: authHeaders(this.settings.apiToken),
    });
    if (!res.ok) {
      throw new Error(`拉取 CCV3 角色卡失败: HTTP ${res.status}`);
    }
    return res.json();
  }

  async pullLorebooks() {
    const res = await fetch(`${this.baseUrl}/api/v1/external/lorebooks`, {
      headers: authHeaders(this.settings.apiToken),
    });
    if (!res.ok) {
      throw new Error(`拉取世界书失败: HTTP ${res.status}`);
    }
    return res.json();
  }

  async handleSyncEvent(evt) {
    if (!evt || typeof evt.cursor !== 'number') return;
    if (evt.cursor <= this.settings.lastCursor) return;

    this.settings.lastCursor = evt.cursor;
    saveSettings(this.settings);

    let syncedResource = null;
    if (this.settings.autoApply) {
      if (evt.targetType === 'card' && evt.targetId) {
        syncedResource = await this.pullLatestCardCcv3(evt.targetId);
      } else if (evt.targetType === 'lorebook') {
        syncedResource = await this.pullLorebooks();
      }
    }

    this.onEvent({ event: evt, resource: syncedResource });
  }

  async pollOnce() {
    const url = `${this.baseUrl}/api/v1/external/sync/events?since_cursor=${this.settings.lastCursor}&limit=50`;
    const res = await fetch(url, { headers: authHeaders(this.settings.apiToken) });
    if (!res.ok) {
      throw new Error(`轮询同步事件失败: HTTP ${res.status}`);
    }
    const data = await res.json();
    for (const evt of data.items || []) {
      await this.handleSyncEvent(evt);
    }
    return data;
  }

  async startStream() {
    this.stop();
    this.abortController = new AbortController();
    const url = `${this.baseUrl}/api/v1/external/sync/stream?since_cursor=${this.settings.lastCursor}`;

    try {
      const res = await fetch(url, {
        headers: {
          ...authHeaders(this.settings.apiToken),
          Accept: 'text/event-stream',
        },
        signal: this.abortController.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`SSE 握手失败: HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const dataLines = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          if (!dataLines.length) continue;
          try {
            const payload = JSON.parse(dataLines.join('\n'));
            if (payload && typeof payload.cursor === 'number') {
              await this.handleSyncEvent(payload);
            }
          } catch {
            // 忽略 ping 或非 JSON 心跳帧
          }
        }
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) return;
      console.warn('[RoleCard Sync] SSE 断开，回退至增量轮询模式:', err);
      this.pollTimer = setInterval(() => {
        void this.pollOnce().catch(() => {});
      }, this.settings.pollIntervalMs);
    }
  }

  stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

if (typeof window !== 'undefined') {
  const client = new RoleCardSyncClient({
    onEvent: ({ event, resource }) => {
      console.info('[RoleCard Sync] 收到同步事件:', event.eventType, event.targetId, resource ? '已拉取最新 CCV3' : '');
      window.dispatchEvent(new CustomEvent('rolecard:synced', { detail: { event, resource } }));
    },
  });
  window.RoleCardSync = client;
  if (localStorage.getItem(STORAGE_KEY)) {
    void client.startStream();
  }
}
