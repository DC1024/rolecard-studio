import { useEffect, useState } from 'react';
import type { DeclarativePluginManifest } from '@rolecard/shared';
import { CheckCircle2, Copy, Download, Puzzle, Terminal } from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';
import { useToast } from '../hooks/useToast';

interface PluginPanelProps {
  selectedCard: RoleCardDto | null;
  canExport: boolean;
}

export function PluginPanel({ selectedCard, canExport }: PluginPanelProps) {
  const { notifySuccess, notifyError, copyWithToast } = useToast();
  const [plugins, setPlugins] = useState<DeclarativePluginManifest[]>([]);
  const [manifestDraft, setManifestDraft] = useState(
    JSON.stringify(
      {
        id: 'custom-markdown-summary',
        name: '自定义简报导出器',
        version: '1.0.0',
        type: 'export_formatter',
        exportSpec: {
          fileExtension: 'txt',
          mimeType: 'text/plain; charset=utf-8',
          template: '角色: {{name}}\n定位: {{summary}}\n标签: {{tags}}',
        },
      },
      null,
      2,
    ),
  );
  const [validationMsg, setValidationMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.listPlugins();
        setPlugins(res.plugins);
      } catch {
        // ignore
      }
    })();
  }, []);

  const handleValidate = async () => {
    try {
      const parsed = JSON.parse(manifestDraft) as unknown;
      const res = await api.validatePlugin(parsed);
      setValidationMsg({ ok: true, text: `校验通过：${res.manifest.name} (${res.manifest.type})` });
      notifySuccess(`插件清单「${res.manifest.name}」校验通过`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Manifest JSON 校验失败';
      setValidationMsg({
        ok: false,
        text: msg,
      });
      notifyError(msg);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <Puzzle className="h-4 w-4 text-accent" />
            方向 A-L1 声明式插件列表
          </h3>
          {selectedCard && (
            <span className="text-xs text-content-muted">
              当前联动角色卡：<strong className="text-content-primary">{selectedCard.characterName}</strong>
            </span>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="flex min-w-0 flex-col justify-between rounded-md border border-line bg-canvas p-3.5">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-content-primary">{plugin.name}</span>
                  <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                    {plugin.type}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-content-secondary">
                  {plugin.description}
                </p>
              </div>
              {plugin.type === 'export_formatter' && selectedCard && canExport && (
                <button
                  type="button"
                  onClick={() => {
                    window.open(
                      api.getPluginExportUrl(plugin.id, selectedCard.id),
                      '_blank',
                      'noopener,noreferrer',
                    );
                    notifySuccess(`已触发「${plugin.name}」导出 (.${plugin.exportSpec?.fileExtension})`);
                  }}
                  className="mt-3 inline-flex h-7 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-accent hover:bg-accent/10"
                >
                  <Download className="h-3 w-3 shrink-0" />
                  导出 .{plugin.exportSpec?.fileExtension}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-line bg-surface p-4 shadow-sm">
          <h4 className="mb-2 text-xs font-semibold text-content-primary">
            声明式插件清单 (JSON Schema) 在线校验
          </h4>
          <textarea
            rows={9}
            value={manifestDraft}
            onChange={(e) => setManifestDraft(e.target.value)}
            className="w-full rounded-sm border border-line bg-canvas p-2.5 font-mono text-[11px] text-content-primary"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleValidate}
              className="h-8 shrink-0 whitespace-nowrap rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse"
            >
              校验 Manifest
            </button>
            {validationMsg && (
              <span
                className={`inline-flex min-w-0 items-center gap-1 text-xs ${
                  validationMsg.ok ? 'text-status-success' : 'text-status-danger'
                }`}
              >
                {validationMsg.ok && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                <span className="break-words">{validationMsg.text}</span>
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-line bg-surface p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-content-primary">
              <Terminal className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span>方向 B · 官方 MCP Server (@rolecard/mcp) 接入配置</span>
            </h4>
            <button
              type="button"
              onClick={() =>
                void copyWithToast(
                  JSON.stringify(
                    {
                      mcpServers: {
                        'rolecard-studio': {
                          command: 'npx',
                          args: ['@rolecard/mcp'],
                          env: {
                            ROLECARD_API_URL: window.location.origin,
                            ROLECARD_API_KEY: '你的_rc_ext_密钥',
                          },
                        },
                      },
                    },
                    null,
                    2,
                  ),
                  'MCP 配置',
                )
              }
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-canvas px-2.5 text-[11px] font-medium text-content-secondary hover:border-accent hover:text-accent"
            >
              <Copy className="h-3 w-3 shrink-0" />
              复制配置
            </button>
          </div>
          <p className="mb-2 text-[11px] leading-relaxed text-content-secondary">
            在 Cursor / Claude Desktop 等支持 Stdio 的 MCP 客户端中配置以下 MCP Server，即可直接检索角色卡、读取世界书并导出 CCV3：
          </p>
          <pre className="overflow-x-auto rounded-sm border border-line bg-canvas p-3 font-mono text-[11px] text-content-primary">
{`{
  "mcpServers": {
    "rolecard-studio": {
      "command": "npx",
      "args": ["@rolecard/mcp"],
      "env": {
        "ROLECARD_API_URL": "http://127.0.0.1:3000",
        "ROLECARD_API_KEY": "你的_rc_ext_密钥"
      }
    }
  }
}`}
          </pre>
        </div>
      </section>
    </div>
  );
}
