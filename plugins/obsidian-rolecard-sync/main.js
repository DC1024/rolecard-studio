const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
  serverUrl: 'http://127.0.0.1:3000',
  apiToken: '',
  targetFolder: 'RoleCards',
  lastCursor: 0,
  pollIntervalSec: 60,
};

function sanitizeFileName(name) {
  return String(name || 'untitled').replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled';
}

function renderCardMarkdown(card) {
  const c = card.content || {};
  const tags = Array.isArray(card.tags) ? card.tags : [];
  return [
    '---',
    `rolecard_id: "${card.id}"`,
    `character_name: "${card.characterName}"`,
    `work_name: "${card.workName || ''}"`,
    `card_type: "${card.cardType}"`,
    `version: ${card.version}`,
    `updated_at: "${card.updatedAt}"`,
    `tags: [${tags.map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(', ')}]`,
    '---',
    '',
    `# ${card.characterName}${card.workName ? `（${card.workName}）` : ''}`,
    '',
    `## 简介与核心设定`,
    c.summary || '',
    '',
    `## 外貌特征`,
    c.appearance || '',
    '',
    `## 性格特质`,
    Array.isArray(c.personality) ? c.personality.map((p) => `- ${p}`).join('\n') : '',
    '',
    `## 背景故事`,
    c.background || '',
    '',
    `## 说话风格`,
    c.speechStyle || '',
    '',
    `## 开场白`,
    c.firstMessage || '',
    '',
  ].join('\n');
}

class RoleCardSyncPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addCommand({
      id: 'sync-rolecard-studio-now',
      name: '立即从 RoleCard Studio 增量同步',
      callback: () => this.syncNow(true),
    });

    this.addSettingTab(new RoleCardSyncSettingTab(this.app, this));

    this.registerInterval(
      window.setInterval(() => {
        void this.syncNow(false);
      }, Math.max(15, this.settings.pollIntervalSec) * 1000),
    );
  }

  authHeaders() {
    const headers = { Accept: 'application/json' };
    if (this.settings.apiToken) {
      headers.Authorization = `Bearer ${this.settings.apiToken}`;
    }
    return headers;
  }

  async ensureFolder(folderPath) {
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
  }

  async upsertMarkdown(filePath, content) {
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  async syncNow(showNotice) {
    const baseUrl = this.settings.serverUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(
        `${baseUrl}/api/v1/external/sync/events?since_cursor=${this.settings.lastCursor}&limit=50`,
        { headers: this.authHeaders() },
      );
      if (!res.ok) {
        if (showNotice) new Notice(`RoleCard 同步失败: HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        if (showNotice) new Notice('RoleCard Studio 已是最新状态');
        return;
      }

      await this.ensureFolder(this.settings.targetFolder);

      let updatedCount = 0;
      for (const evt of items) {
        if (evt.targetType === 'card' && evt.targetId) {
          const cardRes = await fetch(
            `${baseUrl}/api/v1/external/cards/${encodeURIComponent(evt.targetId)}`,
            { headers: this.authHeaders() },
          );
          if (cardRes.ok) {
            const payload = await cardRes.json();
            const card = payload.card;
            if (card) {
              const filePath = `${this.settings.targetFolder}/${sanitizeFileName(card.characterName)}_${card.id.slice(0, 6)}.md`;
              await this.upsertMarkdown(filePath, renderCardMarkdown(card));
              updatedCount += 1;
            }
          }
        }
        if (typeof evt.cursor === 'number' && evt.cursor > this.settings.lastCursor) {
          this.settings.lastCursor = evt.cursor;
        }
      }

      await this.saveData(this.settings);
      if (showNotice || updatedCount > 0) {
        new Notice(`RoleCard Studio 已同步 ${updatedCount} 张角色卡（cursor=${this.settings.lastCursor}）`);
      }
    } catch (err) {
      if (showNotice) {
        new Notice(`RoleCard 同步异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

class RoleCardSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'RoleCard Studio 实时同步设置' });

    new Setting(containerEl)
      .setName('服务地址')
      .setDesc('RoleCard Studio 服务根地址')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (val) => {
            this.plugin.settings.serverUrl = val.trim() || DEFAULT_SETTINGS.serverUrl;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(containerEl)
      .setName('External API Token')
      .setDesc('当对外 API 为 authenticated 模式时必填')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (val) => {
            this.plugin.settings.apiToken = val.trim();
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(containerEl)
      .setName('同步目录')
      .setDesc('角色卡 Markdown 写入的 Vault 目录')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (val) => {
            this.plugin.settings.targetFolder = val.trim() || 'RoleCards';
            await this.plugin.saveData(this.plugin.settings);
          }),
      );
  }
}

module.exports = RoleCardSyncPlugin;
