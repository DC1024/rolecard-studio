import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  CardType,
  EntityType,
  GenerateCardRequest,
  GenerationMode,
} from '@rolecard/shared';
import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronUp,
  Eye,
  Globe,
  Layers,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';

interface GenerateFormProps {
  cardType: CardType;
  canCreate: boolean;
  isConfigured: boolean;
  generating: boolean;
  progressStep: string;
  progressText: string;
  progressLogs: string[];
  thinkingText: string;
  errorText: string | null;
  onCardTypeChange: (cardType: CardType) => void;
  onSubmit: (req: GenerateCardRequest) => Promise<void>;
  onOpenSettings: () => void;
}

const PROGRESS_STAGES = [
  { id: 'preparing', label: '材料准备' },
  { id: 'retrieving', label: '百科考据' },
  { id: 'llm_request', label: '模型推演' },
  { id: 'validating', label: 'Schema校验' },
  { id: 'persisting', label: '保存入库' },
] as const;

function resolveStageIndex(step: string): number {
  if (step === 'preparing') return 0;
  if (step === 'retrieving' || step === 'building_prompt') return 1;
  if (step === 'llm_request' || step === 'thinking') return 2;
  if (step === 'validating') return 3;
  if (step === 'persisting') return 4;
  return 0;
}

const PRESET_TABS: readonly { id: CardType; label: string; hint: string }[] = [
  {
    id: 'sillytavern_v3',
    label: 'AI 角色扮演',
    hint: '强化沉浸式开场白、对话示例与 SillyTavern CCV3 防出戏设定',
  },
  {
    id: 'trpg_coc7',
    label: 'TRPG 车卡',
    hint: '生成 CoC 7e / D&D 5e 真实面板数值与技能，支持 Foundry VTT 与跑团车卡表导出',
  },
  {
    id: 'general',
    label: '通用设定',
    hint: '精炼客观的人物档案结构，适用于小说、游戏策划与设定集归档',
  },
];

const MODE_DESCRIPTIONS: Record<GenerationMode, string> = {
  A: '仅基于你提供的文本、设定集文件或直链 URL 提纯生成，忠实还原原作/OC 设定。',
  B: '自动直连免 Key 公开百科（萌娘/PRTS/Wikipedia）与通用搜索考据，无检索依据则硬拦截。',
  C: 'A+B 混合：以你的设定材料为第一优先级骨架，自动联网补充背景/关系并标明双溯源。',
};

const CARD_TYPE_META: Record<
  CardType,
  { badge: string; desc: string }
> = {
  'sillytavern_v3': {
    badge: 'AI 角色扮演 (SillyTavern CCV3)',
    desc: '重点强化沉浸开场白、备选情境、对话示例与防 OOC 系统提示词。',
  },
  'trpg_coc7': {
    badge: 'TRPG 车卡 · CoC 7e 调查员',
    desc: 'AI 将推演 8 项基础属性、HP/MP/SAN 衍生值与核心技能（支持导出跑团车卡表）。',
  },
  'trpg_dnd5e': {
    badge: 'TRPG 车卡 · D&D 5e 冒险者',
    desc: 'AI 将推演六维属性、种族职业、AC/MaxHP 与特性（支持直接导出 Foundry VTT Actor JSON）。',
  },
  general: {
    badge: '通用角色设定档案',
    desc: '输出清晰严谨的通用人设档案，适合小说创作、游戏策划与设定集归档。',
  },
  custom: {
    badge: '自定义规格',
    desc: '结合自定义指令生成结构化角色卡。',
  },
};

export function GenerateForm({
  cardType,
  canCreate,
  isConfigured,
  generating,
  progressStep,
  progressText,
  progressLogs,
  thinkingText,
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
  const [thinkingExpanded, setThinkingExpanded] = useState(true);
  const thinkingBoxRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (thinkingExpanded && thinkingBoxRef.current) {
      thinkingBoxRef.current.scrollTop = thinkingBoxRef.current.scrollHeight;
    }
  }, [thinkingText, thinkingExpanded]);
  const [urlsText, setUrlsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [enableSupplementSearch, setEnableSupplementSearch] = useState(false);
  const [visionDescription, setVisionDescription] = useState('');
  const [visionUrl, setVisionUrl] = useState('');
  const [visionBusy, setVisionBusy] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);
  const { notifySuccess, notifyError } = useToast();

  const mergeSuggestedTags = (suggested: string[]) => {
    if (suggested.length === 0) return;
    setTagsText((prev) => {
      const existing = prev
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...existing, ...suggested]));
      return merged.join(', ');
    });
  };

  const runVisionAnalysis = async (payload: { imageDataUrl?: string; imageUrl?: string }) => {
    setVisionBusy(true);
    setVisionError(null);
    try {
      const res = await api.analyzeVision({
        ...payload,
        hint: characterName.trim() || workName.trim(),
      });
      const combined = res.imagePrompt
        ? `${res.appearanceDescription}\n\n[Prompt] ${res.imagePrompt}`
        : res.appearanceDescription;
      setVisionDescription(combined);
      mergeSuggestedTags(res.suggestedTags);
      notifySuccess('立绘视觉反推已完成并填入设定');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Vision 图文反推失败';
      setVisionError(msg);
      notifyError(msg);
    } finally {
      setVisionBusy(false);
    }
  };

  const handleVisionFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void runVisionAnalysis({ imageDataUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleFileImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setReferenceText((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
    notifySuccess(`已导入设定文件「${file.name}」`);
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
      visionDescription: visionDescription.trim(),
      enableSupplementSearch: mode === 'C' ? true : enableSupplementSearch,
      tags,
      lorebookIds: [],
      customPrompt: customPrompt.trim(),
    });
  };

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-content-primary">
          <Sparkles className="h-4 w-4 text-accent" />
          创建角色卡
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-line bg-subtle p-0.5">
            {PRESET_TABS.map((tab) => {
              const active =
                tab.id === 'trpg_coc7'
                  ? cardType === 'trpg_coc7' || cardType === 'trpg_dnd5e'
                  : cardType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.hint}
                  onClick={() => onCardTypeChange(tab.id)}
                  className={`rounded-sm px-2.5 py-1 text-[12px] font-medium leading-4 transition-all ${
                    active
                      ? 'bg-surface text-content-primary shadow-sm'
                      : 'text-content-secondary hover:text-content-primary'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
            {CARD_TYPE_META[cardType]?.badge ?? cardType}
          </span>
        </div>
      </div>

      <div className="mb-4 rounded-md border border-line-subtle bg-subtle/60 px-3 py-2 text-[11.5px] text-content-secondary">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong className="text-content-primary">输出规格：</strong>
            {CARD_TYPE_META[cardType]?.desc}
          </span>
          {(cardType === 'trpg_coc7' || cardType === 'trpg_dnd5e') && (
            <div className="inline-flex rounded-sm border border-line bg-surface p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => onCardTypeChange('trpg_coc7')}
                className={`rounded-sm px-2 py-0.5 font-medium transition ${
                  cardType === 'trpg_coc7'
                    ? 'bg-accent text-content-inverse'
                    : 'text-content-secondary hover:text-content-primary'
                }`}
              >
                CoC 7e
              </button>
              <button
                type="button"
                onClick={() => onCardTypeChange('trpg_dnd5e')}
                className={`rounded-sm px-2 py-0.5 font-medium transition ${
                  cardType === 'trpg_dnd5e'
                    ? 'bg-accent text-content-inverse'
                    : 'text-content-secondary hover:text-content-primary'
                }`}
              >
                D&amp;D 5e
              </button>
            </div>
          )}
        </div>
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

        <div className="space-y-2 rounded-md border border-line bg-subtle/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-content-primary">
              <Eye className="h-3.5 w-3.5 text-accent" />
              Vision 参考图反推（可选：提取外貌特征、Tag 与英文绘图 Prompt）
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-content-secondary hover:bg-subtle hover:text-content-primary">
              {visionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              <span>{visionBusy ? '反推中...' : '上传参考图反推'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={visionBusy}
                onChange={handleVisionFile}
                className="hidden"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={visionUrl}
              onChange={(e) => setVisionUrl(e.target.value)}
              placeholder="或粘贴公网图片 URL 点击右侧反推（经 SSRF 校验）"
              className="h-8 flex-1 rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={visionBusy || !visionUrl.trim()}
              onClick={() => void runVisionAnalysis({ imageUrl: visionUrl.trim() })}
              className="h-8 shrink-0 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-primary hover:bg-subtle disabled:opacity-50"
            >
              URL 反推
            </button>
          </div>
          <textarea
            rows={2}
            value={visionDescription}
            onChange={(e) => setVisionDescription(e.target.value)}
            placeholder="反推结果将自动填入此处并作为外貌/形象设定依据，也可手动编辑补充..."
            className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-content-primary outline-none focus:border-accent"
          />
          {visionError && (
            <p className="text-[11px] text-status-danger">{visionError}</p>
          )}
        </div>

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

        {(generating || thinkingText) && (
          <div className="space-y-2.5 rounded-md border border-status-info/40 bg-status-info/5 p-3 text-xs">
            {generating && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PROGRESS_STAGES.map((stage, idx) => {
                    const currentIdx = resolveStageIndex(progressStep);
                    const done = idx < currentIdx;
                    const active = idx === currentIdx;
                    return (
                      <span
                        key={stage.id}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                          active
                            ? 'bg-status-info text-content-inverse'
                            : done
                              ? 'bg-status-success/15 text-status-success'
                              : 'bg-subtle text-content-muted'
                        }`}
                      >
                        {idx + 1}. {stage.label}
                      </span>
                    );
                  })}
                </div>
                {progressText && (
                  <div className="flex items-center gap-2 font-medium text-status-info">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span>{progressText}</span>
                  </div>
                )}
                {progressLogs.length > 1 && (
                  <div className="max-h-20 space-y-0.5 overflow-y-auto border-t border-line-subtle pt-1.5 text-[11px] text-content-muted">
                    {progressLogs.slice(-5).map((log, i) => (
                      <div key={`${i}-${log}`} className="truncate">
                        • {log}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {thinkingText && (
              <div className="rounded-sm border border-line bg-surface">
                <button
                  type="button"
                  onClick={() => setThinkingExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-semibold text-content-secondary hover:text-content-primary"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Brain className="h-3.5 w-3.5 text-accent" />
                    模型思考过程（{thinkingText.length} 字）
                  </span>
                  {thinkingExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {thinkingExpanded && (
                  <pre
                    ref={thinkingBoxRef}
                    className="max-h-44 overflow-y-auto whitespace-pre-wrap border-t border-line-subtle bg-canvas px-2.5 py-2 font-mono text-[11px] leading-relaxed text-content-secondary"
                  >
                    {thinkingText}
                  </pre>
                )}
              </div>
            )}
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
