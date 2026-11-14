import { useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  CardType,
  EntityType,
  GenerateCardRequest,
  GenerationMode,
} from '@rolecard/shared';
import { BookOpen, Globe, Layers, Loader2, Sparkles, Upload } from 'lucide-react';

interface GenerateFormProps {
  cardType: CardType;
  canCreate: boolean;
  isConfigured: boolean;
  generating: boolean;
  progressText: string;
  errorText: string | null;
  onCardTypeChange: (cardType: CardType) => void;
  onSubmit: (req: GenerateCardRequest) => Promise<void>;
  onOpenSettings: () => void;
}

const MODE_DESCRIPTIONS: Record<GenerationMode, string> = {
  A: '仅基于你提供的文本、设定集文件或直链 URL 提纯生成，忠实还原原作/OC 设定。',
  B: '自动直连免 Key 公开百科（萌娘/PRTS/Wikipedia）与通用搜索考据，无检索依据则硬拦截。',
  C: 'A+B 混合：以你的设定材料为第一优先级骨架，自动联网补充背景/关系并标明双溯源。',
};

export function GenerateForm({
  cardType,
  canCreate,
  isConfigured,
  generating,
  progressText,
  errorText,
  onCardTypeChange,
  onSubmit,
  onOpenSettings,
}: GenerateFormProps) {
  const [mode, setMode] = useState<GenerationMode>('C');
  const [characterName, setCharacterName] = useState('');
  const [workName, setWorkName] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('fictional');
  const [referenceText, setReferenceText] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [enableSupplementSearch, setEnableSupplementSearch] = useState(false);

  const handleFileImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setReferenceText((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
    e.target.value = '';
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const referenceUrls = urlsText
      .split(/[\r\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    const tags = tagsText
      .split(/[,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    await onSubmit({
      mode,
      characterName: characterName.trim(),
      workName: workName.trim(),
      cardType,
      entityType,
      referenceText: referenceText.trim(),
      referenceUrls,
      visionDescription: '',
      enableSupplementSearch: mode === 'C' ? true : enableSupplementSearch,
      tags,
      lorebookIds: [],
      customPrompt: customPrompt.trim(),
    });
  };

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-content-primary">
          <Sparkles className="h-4 w-4 text-accent" />
          创建角色卡
        </h2>
        <select
          value={cardType}
          onChange={(e) => onCardTypeChange(e.target.value as CardType)}
          className="h-7 rounded-sm border border-line bg-subtle px-2 text-xs text-content-secondary outline-none focus:border-accent"
        >
          <option value="sillytavern_v3">SillyTavern CCV3</option>
          <option value="trpg_coc7">TRPG CoC 7e</option>
          <option value="trpg_dnd5e">TRPG DnD 5e</option>
          <option value="general">通用人物卡</option>
        </select>
      </div>

      {!isConfigured && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-content-primary">
          <span>尚未配置主大模型（LLM Key 或本地 Ollama），请先完成 1 步冷启动配置。</span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="shrink-0 rounded-sm bg-accent px-2.5 py-1 font-medium text-content-inverse hover:bg-accent-hover"
          >
            去配置
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-content-secondary">
            生成模式（严禁无源纯幻觉）
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-md border border-line bg-subtle p-1">
            {(
              [
                { id: 'A', label: '模式 A · 资料', icon: BookOpen },
                { id: 'B', label: '模式 B · 考据', icon: Globe },
                { id: 'C', label: '模式 C · 混合', icon: Layers },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-xs font-medium transition-all ${
                    active
                      ? 'bg-surface text-content-primary shadow-sm'
                      : 'text-content-secondary hover:text-content-primary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-content-muted">
            {MODE_DESCRIPTIONS[mode]}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-content-primary">
              角色名称 <span className="text-status-danger">*</span>
            </label>
            <input
              type="text"
              required
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="如：星见雅 / 阿米娅"
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-content-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-content-primary">
              所属作品 / 世界观
            </label>
            <input
              type="text"
              value={workName}
              onChange={(e) => setWorkName(e.target.value)}
              placeholder="如：绝区零 / 明日方舟 / 原创"
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-content-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-content-secondary">实体类型</span>
          <div className="flex gap-2">
            {(
              [
                { id: 'fictional', label: '虚构角色' },
                { id: 'real_person', label: '现实人物（禁用主观风评）' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setEntityType(item.id)}
                className={`rounded-sm border px-2.5 py-1 transition ${
                  entityType === item.id
                    ? 'border-accent bg-accent/10 font-medium text-accent'
                    : 'border-line bg-surface text-content-secondary hover:bg-subtle'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {(mode === 'A' || mode === 'C') && (
          <div className="space-y-2.5 rounded-md border border-line bg-subtle/50 p-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-content-primary">
                参考设定文本（{mode === 'C' ? '第一优先级覆盖基线' : '核心依据'}）
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-content-secondary hover:bg-subtle hover:text-content-primary">
                <Upload className="h-3 w-3" />
                <span>导入 .txt/.md</span>
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
            </div>

            <textarea
              rows={4}
              value={referenceText}
              onChange={(e) => setReferenceText(e.target.value)}
              placeholder="粘贴人物设定、二创补充、台词风格或剧本摘要..."
              className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-content-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
            />

            <div>
              <label className="mb-1 block text-xs font-medium text-content-secondary">
                参考设定网页 URL（每行一个，经 SSRF 校验抓取正文）
              </label>
              <textarea
                rows={2}
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder="https://zh.moegirl.org.cn/..."
                className="w-full rounded-sm border border-line bg-surface px-3 py-1.5 font-mono text-xs text-content-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </div>

            {mode === 'A' && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-content-secondary">
                <input
                  type="checkbox"
                  checked={enableSupplementSearch}
                  onChange={(e) => setEnableSupplementSearch(e.target.checked)}
                  className="rounded border-line accent-accent"
                />
                <span>允许补充检索百科资料作为辅助背景</span>
              </label>
            )}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-content-secondary">
            分类标签（逗号或空格分隔，用于常用标签筛选）
          </label>
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="例如：二次元, 高冷, 剑术"
            className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-content-secondary">
            额外生成要求（可选）
          </label>
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="例如：增加 2 个不同时间线的备选开场白"
            className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </div>

        {errorText && (
          <div className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {errorText}
          </div>
        )}

        {generating && progressText && (
          <div className="flex items-center gap-2 rounded-md border border-status-info/40 bg-status-info/10 px-3 py-2 text-xs text-status-info">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{progressText}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={generating || !canCreate || !characterName.trim()}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-accent text-sm font-semibold text-content-inverse shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>正在生成角色卡...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              <span>{canCreate ? '生成结构化角色卡' : '当前权限不可创建角色卡'}</span>
            </>
          )}
        </button>
      </form>
    </section>
  );
}
