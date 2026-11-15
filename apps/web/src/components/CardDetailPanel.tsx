import { useEffect, useState } from 'react';
import type {
  AutoApplyThreshold,
  CardGeneratableField,
  DeclarativePluginManifest,
  ExportFormat,
  RoleCardContent,
  SyncScheduleDto,
  SyncScope,
} from '@rolecard/shared';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  Copy,
  Dice5,
  Download,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquare,
  Minimize2,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';
import { useToast } from '../hooks/useToast';

const CARD_TYPE_LABELS: Record<RoleCardDto['cardType'], string> = {
  'sillytavern_v3': 'AI 角色扮演 (SillyTavern CCV3)',
  'trpg_coc7': 'TRPG · CoC 7e 调查员',
  'trpg_dnd5e': 'TRPG · D&D 5e 冒险者',
  general: '通用角色设定',
  custom: '自定义规格',
};

function getTokenBadgeMeta(tokenCount: number, cardType: RoleCardDto['cardType']): {
  className: string;
  labelSuffix: string;
  tooltip: string;
} {
  const isTrpg = cardType === 'trpg_coc7' || cardType === 'trpg_dnd5e';
  const skyMax = isTrpg ? 800 : 600;
  const greenMax = isTrpg ? 2400 : 1800;

  if (tokenCount < 80) {
    return {
      className: 'border-line bg-subtle text-content-muted',
      labelSuffix: '· 内容可能偏短',
      tooltip: `当前 ${tokenCount} tok（< 80 tok）：内容可能偏短，建议补充角色设定或使用 AI 微调丰富细节`,
    };
  }
  if (tokenCount <= skyMax) {
    return {
      className: 'border-status-info/40 bg-status-info/10 text-status-info',
      labelSuffix: '· 轻量',
      tooltip: `当前 ${tokenCount} tok（80～${skyMax} tok）：优于预期，上下文开销极低`,
    };
  }
  if (tokenCount <= greenMax) {
    return {
      className: 'border-status-success/40 bg-status-success/10 text-status-success',
      labelSuffix: '· 合理',
      tooltip: `当前 ${tokenCount} tok（${skyMax + 1}～${greenMax} tok）：信息丰满且上下文占用合理`,
    };
  }
  return {
    className: 'border-status-danger/40 bg-status-danger/10 text-status-danger',
    labelSuffix: '· 偏高',
    tooltip: `当前 ${tokenCount} tok（> ${greenMax} tok）：Token 偏高，建议点击上方「精简」压缩上下文占用`,
  };
}

interface CardDetailPanelProps {
  card: RoleCardDto | null;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
  canPlaytest: boolean;
  onCardUpdated: (card: RoleCardDto, banner?: string) => void;
  onCardDeleted: (id: string) => void;
  onOpenPlaytest: (card: RoleCardDto) => void;
  onOpenPortraitModal: () => void;
  onOpenTokenModal: () => void;
  onBackToGallery: () => void;
}

const LOCKABLE_FIELDS: { key: keyof RoleCardContent; label: string }[] = [
  { key: 'summary', label: '角色简介' },
  { key: 'personality', label: '性格特征' },
  { key: 'appearance', label: '外貌立绘' },
  { key: 'background', label: '背景故事' },
  { key: 'speech_style', label: '语言风格' },
  { key: 'relationships', label: '人际关系' },
  { key: 'first_mes', label: '开场白' },
  { key: 'alternate_greetings', label: '备选开场白' },
  { key: 'mes_example', label: '对话示例' },
  { key: 'scenario', label: '场景设定' },
  { key: 'system_prompt', label: '系统提示词' },
  { key: 'creator_notes', label: '作者备注' },
];

export function CardDetailPanel({
  card,
  canUpdate,
  canDelete,
  canExport,
  canPlaytest,
  onCardUpdated,
  onCardDeleted,
  onOpenPlaytest,
  onOpenPortraitModal,
  onOpenTokenModal,
  onBackToGallery,
}: CardDetailPanelProps) {
  const { notifySuccess, notifyError, copyWithToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RoleCardContent | null>(null);
  const [lockedFields, setLockedFields] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [refineInput, setRefineInput] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'dialogue' | 'sources' | 'evolution'>('profile');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportPlugins, setExportPlugins] = useState<DeclarativePluginManifest[]>([]);
  const [schedule, setSchedule] = useState<SyncScheduleDto | null>(null);
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedDays, setSchedDays] = useState(7);
  const [schedScope, setSchedScope] = useState<SyncScope>('canon');
  const [schedThreshold, setSchedThreshold] = useState<AutoApplyThreshold>('manual_review');
  const [metaSummaryDraft, setMetaSummaryDraft] = useState('');

  useEffect(() => {
    api
      .listPlugins()
      .then((res) => {
        setExportPlugins(res.plugins.filter((p) => p.type === 'export_formatter'));
      })
      .catch(() => {
        setExportPlugins([]);
      });
  }, []);

  useEffect(() => {
    if (card) {
      setDraft(structuredClone(card.content));
      setLockedFields([...card.lockedFields]);
      setMetaSummaryDraft(card.metaSummary ?? '');
      setEditing(false);
      setError(null);
      api
        .getCardSchedule(card.id)
        .then((res) => {
          setSchedule(res.schedule);
          setSchedEnabled(res.schedule.enabled);
          setSchedDays(res.schedule.intervalDays);
          setSchedScope(res.schedule.syncScope);
          setSchedThreshold(res.schedule.autoApplyThreshold);
        })
        .catch(() => {
          setSchedule(null);
        });
    } else {
      setDraft(null);
      setLockedFields([]);
      setMetaSummaryDraft('');
      setSchedule(null);
    }
  }, [card?.id, card?.version, card?.updatedAt]);

  if (!card || !draft) {
    return (
      <section className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface p-8 text-center">
        <Sparkles className="mb-3 h-8 w-8 text-accent/60" />
        <h3 className="text-sm font-semibold text-content-primary">尚未选择角色卡</h3>
        <p className="mt-1 max-w-sm text-xs text-content-muted">
          在左侧历史栏点击任意角色卡即可预览、编辑字段锁定、AI 微调或一键导出 CCV3 PNG。
        </p>
      </section>
    );
  }

  const toggleFieldLock = async (field: string) => {
    if (!canUpdate) return;
    const nextLocked = lockedFields.includes(field)
      ? lockedFields.filter((f) => f !== field)
      : [...lockedFields, field];
    setLockedFields(nextLocked);
    if (!editing) {
      setBusyAction('lock');
      setError(null);
      try {
        const res = await api.updateCardContent(card.id, {
          content: card.content,
          lockedFields: nextLocked,
        });
        onCardUpdated(res.card, '已更新字段锁定状态');
      } catch (err) {
        setError(err instanceof Error ? err.message : '更新锁定失败');
      } finally {
        setBusyAction(null);
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!canUpdate) return;
    setBusyAction('save');
    setError(null);
    try {
      const res = await api.updateCardContent(card.id, {
        content: draft,
        lockedFields,
        tags: card.tags,
      });
      setEditing(false);
      onCardUpdated(res.card, `已保存版本 v${res.card.version}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddTag = async () => {
    const tag = newTag.trim();
    if (!tag || !canUpdate) return;
    if (card.tags.includes(tag)) {
      setNewTag('');
      return;
    }
    setBusyAction('tag');
    setError(null);
    try {
      const nextTags = [...card.tags, tag];
      await api.updateCardTags(card.id, nextTags);
      const refreshed = await api.getCard(card.id);
      setNewTag('');
      onCardUpdated(refreshed.card, `已添加标签「${tag}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加标签失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!canUpdate) return;
    setBusyAction('tag');
    setError(null);
    try {
      const nextTags = card.tags.filter((t) => t !== tag);
      await api.updateCardTags(card.id, nextTags);
      const refreshed = await api.getCard(card.id);
      onCardUpdated(refreshed.card, `已移除标签「${tag}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除标签失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefine = async () => {
    const instruction = refineInput.trim();
    if (instruction.length < 2 || !canUpdate) return;
    setBusyAction('refine');
    setError(null);
    try {
      const res = await api.refineCard(card.id, instruction);
      setRefineInput('');
      onCardUpdated(res.card, res.diffSummary || 'AI 微调完成');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 微调失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCompress = async () => {
    if (!canUpdate) return;
    setBusyAction('compress');
    setError(null);
    try {
      const res = await api.compressCard(card.id, 1200);
      onCardUpdated(
        res.card,
        `无损精简完成：${res.beforeTokens} → ${res.afterTokens} tokens`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '精简失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    if (!window.confirm(`确定要永久删除角色卡「${card.characterName}」吗？`)) {
      return;
    }
    setBusyAction('delete');
    setError(null);
    try {
      await api.deleteCard(card.id);
      onCardDeleted(card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExport = (format: ExportFormat, label?: string) => {
    if (!canExport) return;
    window.open(api.getExportUrl(card.id, format), '_blank', 'noopener,noreferrer');
    setExportMenuOpen(false);
    notifySuccess(`已触发「${label ?? format}」导出`);
  };

  const handlePluginExport = (plugin: DeclarativePluginManifest) => {
    if (!canExport) return;
    window.open(api.getPluginExportUrl(plugin.id, card.id), '_blank', 'noopener,noreferrer');
    setExportMenuOpen(false);
    notifySuccess(`已触发插件「${plugin.name}」导出`);
  };

  const handleGenerateTrpg = async (system: 'coc7e' | 'dnd5e') => {
    if (!canUpdate) return;
    setBusyAction(`trpg-${system}`);
    setError(null);
    try {
      const res = await api.generateCardTrpgStats(card.id, system);
      const label = system === 'coc7e' ? 'CoC 7e 调查员数据' : 'D&D 5e 冒险者数据';
      onCardUpdated(res.card, `已根据角色设定生成 ${label}`);
      notifySuccess(`已生成 ${label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成 TRPG 数据失败';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleGenerateField = async (field: CardGeneratableField, label: string) => {
    if (!canUpdate) return;
    if (lockedFields.includes(field)) {
      const msg = `「${label}」已锁定，请先解锁后再使用 AI 生成`;
      setError(msg);
      notifyError(msg);
      return;
    }
    setBusyAction(`gen-${field}`);
    setError(null);
    try {
      const res = await api.generateCardField(card.id, { field });
      onCardUpdated(res.card, res.diffSummary);
      notifySuccess(`已为「${res.fieldLabel}」生成新内容`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `AI 生成「${label}」失败`;
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const tokenMeta = getTokenBadgeMeta(card.tokenCount, card.cardType);

  const renderLockButton = (fieldKey: string) => {
    const locked = lockedFields.includes(fieldKey);
    return (
      <button
        type="button"
        disabled={!canUpdate || busyAction !== null}
        onClick={() => toggleFieldLock(fieldKey)}
        title={locked ? '已锁定（AI 微调与演化将跳过此字段），点击解锁' : '点击锁定此字段'}
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] transition ${
          locked
            ? 'bg-status-warning/15 text-status-warning'
            : 'text-content-muted hover:bg-subtle hover:text-content-primary'
        }`}
      >
        {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
        <span>{locked ? '已锁' : '锁定'}</span>
      </button>
    );
  };

  const renderFieldActions = (field: CardGeneratableField, label: string) => {
    const locked = lockedFields.includes(field);
    const isGenerating = busyAction === `gen-${field}`;
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {canUpdate && (
          <button
            type="button"
            disabled={busyAction !== null || locked}
            onClick={() => void handleGenerateField(field, label)}
            title={
              locked
                ? '该字段已锁定，解锁后可使用 AI 生成'
                : `结合角色完整设定与参考资料 AI 生成「${label}」`
            }
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-content-secondary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isGenerating ? (
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
            ) : (
              <Sparkles className="h-3 w-3 text-accent" />
            )}
            <span>{isGenerating ? '生成中...' : 'AI 生成'}</span>
          </button>
        )}
        {renderLockButton(field)}
      </div>
    );
  };

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onBackToGallery}
          className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-content-secondary transition-colors hover:border-accent/50 hover:text-content-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回角色卡库
        </button>
        <span className="text-[11px] text-content-muted">
          2:3 统一立绘 · 支持衍生 1:1 VTT Token
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-line-subtle pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="relative flex shrink-0 flex-col items-center gap-1.5">
            {card.imageUrl ? (
              <img
                src={card.imageUrl}
                alt={card.characterName}
                referrerPolicy="no-referrer"
                className="aspect-[2/3] w-24 rounded-md border border-line object-cover shadow-sm"
              />
            ) : (
              <div className="flex aspect-[2/3] w-24 items-center justify-center rounded-md border border-dashed border-line bg-subtle text-xl font-bold text-accent">
                {card.characterName.slice(0, 1)}
              </div>
            )}
            {canUpdate && (
              <div className="flex w-24 flex-col gap-1">
                <button
                  type="button"
                  onClick={onOpenPortraitModal}
                  title="裁剪或更换 2:3 角色立绘"
                  className="flex w-full items-center justify-center gap-1 rounded-sm border border-line bg-surface py-0.5 text-[10.5px] text-content-secondary hover:bg-subtle hover:text-content-primary"
                >
                  <ImageIcon className="h-3 w-3" />
                  2:3 立绘
                </button>
                {card.imageUrl && (
                  <button
                    type="button"
                    onClick={onOpenTokenModal}
                    title="从 2:3 立绘裁剪衍生 1:1 VTT Token"
                    className="flex w-full items-center justify-center gap-1 rounded-sm border border-line bg-surface py-0.5 text-[10.5px] text-content-secondary hover:border-accent/50 hover:text-accent"
                  >
                    {card.tokenImageUrl ? (
                      <img
                        src={card.tokenImageUrl}
                        alt="1:1 Token"
                        className="h-3.5 w-3.5 rounded-full border border-line object-cover"
                      />
                    ) : (
                      <CircleDot className="h-3 w-3" />
                    )}
                    1:1 Token
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-content-primary">
                {card.characterName}
              </h2>
              <span className="tabular-nums rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent">
                v{card.version}
              </span>
              <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[11px] text-content-secondary">
                模式 {card.mode}
              </span>
              <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[11px] text-content-secondary">
                {card.entityType === 'real_person' ? '现实人物' : '虚构角色'}
              </span>
              <span
                title={tokenMeta.tooltip}
                className={`tabular-nums rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium ${tokenMeta.className}`}
              >
                {card.tokenCount} tok {tokenMeta.labelSuffix}
              </span>
              <button
                type="button"
                onClick={() => void copyWithToast(JSON.stringify(card.content, null, 2), '角色卡 JSON')}
                title="复制角色卡 JSON 到剪贴板"
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-content-secondary hover:border-accent hover:text-accent"
              >
                <Copy className="h-3 w-3" />
                复制 JSON
              </button>
            </div>

            <p className="mt-1 text-xs text-content-secondary">
              出处：{card.workName || '原创设定'} · 规格：{CARD_TYPE_LABELS[card.cardType] ?? card.cardType}
            </p>

            {card.diffSummary && (
              <p className="mt-1.5 inline-flex items-center gap-1 rounded-sm bg-status-info/10 px-2 py-0.5 text-[11px] text-status-info">
                <Check className="h-3 w-3" />
                {card.diffSummary}
              </p>
            )}

            {/* Tags */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {card.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-subtle px-2 py-0.5 text-[11px] text-content-secondary"
                >
                  {tag}
                  {canUpdate && (
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-content-muted hover:text-status-danger"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              ))}
              {canUpdate && (
                <div className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAddTag();
                      }
                    }}
                    placeholder="+ 标签"
                    className="h-6 w-20 rounded-full border border-line bg-surface px-2 text-[11px] text-content-primary outline-none focus:w-28 focus:border-accent"
                  />
                  {newTag.trim() && (
                    <button
                      type="button"
                      onClick={handleAddTag}
                      className="rounded-full bg-accent p-1 text-content-inverse"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {canPlaytest && (
            <button
              type="button"
              onClick={() => onOpenPlaytest(card)}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              试聊验证
            </button>
          )}

          {canUpdate && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-primary hover:bg-subtle"
            >
              <Edit3 className="h-3.5 w-3.5" />
              编辑
            </button>
          )}

          {canUpdate && editing && (
            <>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleSaveEdit}
                className="inline-flex h-8 items-center gap-1 rounded-sm bg-status-success px-3 text-xs font-medium text-content-inverse hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                保存
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(structuredClone(card.content));
                  setLockedFields([...card.lockedFields]);
                  setEditing(false);
                }}
                className="inline-flex h-8 items-center rounded-sm border border-line px-2.5 text-xs text-content-secondary hover:bg-subtle"
              >
                取消
              </button>
            </>
          )}

          {canUpdate && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleCompress}
              title="无损压缩至约 1200 tokens（跳过锁定字段）"
              className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-secondary hover:bg-subtle hover:text-content-primary disabled:opacity-50"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              精简
            </button>
          )}

          {canDelete && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleDelete}
              title="删除角色卡"
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line text-content-muted hover:border-status-danger/40 hover:bg-status-danger/10 hover:text-status-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Export bar + AI Refine bar */}
      <div className="my-3.5 flex flex-col gap-2.5 rounded-md border border-line bg-subtle p-3 lg:flex-row lg:items-center lg:justify-between">
        {canUpdate ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              type="text"
              value={refineInput}
              onChange={(e) => setRefineInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleRefine();
                }
              }}
              placeholder="AI 定向微调指令（自动尊重已锁定字段），例如：语气更慵懒冷淡一些..."
              className="h-8 flex-1 rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={busyAction !== null || refineInput.trim().length < 2}
              onClick={handleRefine}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm bg-accent-secondary px-3 text-xs font-medium text-content-inverse hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {busyAction === 'refine' ? '微调中...' : 'AI 微调'}
            </button>
          </div>
        ) : (
          <span className="text-xs text-content-muted">当前为只读预览权限</span>
        )}

        {canExport && (
          <div className="relative flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleExport('tavern_png', 'SillyTavern CCV3 PNG')}
              className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-primary hover:border-accent hover:text-accent"
            >
              <Download className="h-3.5 w-3.5" />
              SillyTavern PNG
            </button>
            <button
              type="button"
              onClick={() => setExportMenuOpen((prev) => !prev)}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover"
            >
              <Download className="h-3.5 w-3.5" />
              <span>导出中心</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>

            {exportMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setExportMenuOpen(false)}
                />
                <div className="absolute right-0 top-10 z-40 w-80 rounded-md border border-line bg-elevated p-3 shadow-xl">
                  <div className="mb-2 flex items-center justify-between border-b border-line-subtle pb-1.5">
                    <span className="text-xs font-semibold text-content-primary">
                      按目标平台选择导出格式
                    </span>
                    <button
                      type="button"
                      onClick={() => setExportMenuOpen(false)}
                      className="text-content-muted hover:text-content-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div>
                      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-content-muted">
                        SillyTavern / AI 酒馆对话
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleExport('tavern_png', 'SillyTavern CCV3 PNG')}
                          className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                        >
                          <div className="font-medium">CCV3 PNG 卡片</div>
                          <div className="text-[10px] text-content-muted">内嵌立绘与元数据</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport('tavern_v3_json', 'SillyTavern CCV3 JSON')}
                          className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                        >
                          <div className="font-medium">CCV3 JSON</div>
                          <div className="text-[10px] text-content-muted">含关联世界书</div>
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-content-muted">
                        TRPG 跑团桌面 (VTT / 纸面)
                      </div>
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => handleExport('foundry_dnd5e_json', 'D&D 5e Foundry VTT Actor JSON')}
                          className="flex w-full items-center justify-between rounded-sm border border-line bg-surface px-2.5 py-1.5 text-left hover:border-accent hover:text-accent"
                        >
                          <div>
                            <div className="font-medium">D&amp;D 5e Foundry VTT Actor</div>
                            <div className="text-[10px] text-content-muted">标准 FVTT 导入 JSON（自动使用 1:1 Token）</div>
                          </div>
                          <Download className="h-3.5 w-3.5 shrink-0" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport('vtt_token_png', '1:1 VTT Token PNG')}
                          className="flex w-full items-center justify-between rounded-sm border border-line bg-surface px-2.5 py-1.5 text-left hover:border-accent hover:text-accent"
                        >
                          <div>
                            <div className="font-medium">1:1 VTT Token 头像</div>
                            <div className="text-[10px] text-content-muted">由 2:3 立绘衍生裁剪的 PNG</div>
                          </div>
                          <Download className="h-3.5 w-3.5 shrink-0" />
                        </button>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleExport('trpg_sheet_html', '可打印跑团车卡表 HTML')}
                            className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                          >
                            <div className="font-medium">可打印车卡表</div>
                            <div className="text-[10px] text-content-muted">HTML / 打印 PDF</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExport('trpg_sheet_md', '跑团车卡 Markdown')}
                            className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                          >
                            <div className="font-medium">车卡笔记 MD</div>
                            <div className="text-[10px] text-content-muted">CoC / D&amp;D 表格</div>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-content-muted">
                        通用文档与导出插件 ({exportPlugins.length})
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleExport('json', '标准 JSON')}
                          className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                        >
                          <div className="font-medium">标准 JSON</div>
                          <div className="text-[10px] text-content-muted">完整结构化数据</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport('markdown', 'Markdown 设定集')}
                          className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                        >
                          <div className="font-medium">Markdown</div>
                          <div className="text-[10px] text-content-muted">图文设定档案</div>
                        </button>
                      </div>
                      {exportPlugins.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {exportPlugins.map((plugin) => (
                            <button
                              key={plugin.id}
                              type="button"
                              onClick={() => handlePluginExport(plugin)}
                              className="flex w-full items-center justify-between rounded-sm border border-line bg-surface px-2.5 py-1.5 text-left hover:border-accent hover:text-accent"
                            >
                              <span className="inline-flex items-center gap-1.5 truncate font-medium">
                                <Puzzle className="h-3 w-3 shrink-0 text-accent" />
                                <span className="truncate">{plugin.name}</span>
                              </span>
                              <span className="shrink-0 font-mono text-[10px] text-content-muted">
                                .{plugin.exportSpec?.fileExtension}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {error}
        </div>
      )}

      {/* Sub-navigation */}
      <div className="mb-4 flex gap-1 border-b border-line-subtle">
        {(
          [
            ['profile', '核心设定与外貌'],
            ['dialogue', '开场白与提示词'],
            ['sources', `引用溯源 (${card.sources.length})`],
            ['evolution', `定时演化${card.scheduleEnabled ? ' · 已开启' : ''}`],
          ] as const
        ).map(([tabKey, label]) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setActiveTab(tabKey)}
            className={`border-b-2 px-3 py-2 text-xs font-medium transition ${
              activeTab === tabKey
                ? 'border-accent text-accent'
                : 'border-transparent text-content-secondary hover:text-content-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'profile' && (
        <div className="space-y-4">
          {(['summary', 'personality', 'appearance', 'background', 'scenario'] as const).map(
            (key) => {
              const meta = LOCKABLE_FIELDS.find((f) => f.key === key)!;
              return (
                <div key={key} className="rounded-md border border-line-subtle bg-canvas p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-content-primary">{meta.label}</span>
                    {renderFieldActions(key, meta.label)}
                  </div>
                  {editing ? (
                    <textarea
                      rows={key === 'background' ? 4 : 3}
                      value={draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                      className="w-full rounded-sm border border-line bg-surface p-2 text-xs leading-relaxed text-content-primary outline-none focus:border-accent"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-content-secondary">
                      {card.content[key] || '（暂无内容）'}
                    </p>
                  )}
                </div>
              );
            },
          )}

          <div className="rounded-md border border-line-subtle bg-canvas p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-content-primary">语言风格与口癖</span>
              {renderFieldActions('speech_style', '语言风格与口癖')}
            </div>
            {editing ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={draft.speech_style.tone}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      speech_style: { ...draft.speech_style, tone: e.target.value },
                    })
                  }
                  placeholder="语调特征"
                  className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary"
                />
                <input
                  type="text"
                  value={draft.speech_style.catchphrases.join('、')}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      speech_style: {
                        ...draft.speech_style,
                        catchphrases: e.target.value
                          .split(/[、,，]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                  placeholder="口头禅（顿号或逗号分隔）"
                  className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary"
                />
              </div>
            ) : (
              <div className="space-y-1 text-xs text-content-secondary">
                <p>语调：{card.content.speech_style.tone || '自然'}</p>
                {card.content.speech_style.catchphrases.length > 0 && (
                  <p>口头禅：{card.content.speech_style.catchphrases.join(' / ')}</p>
                )}
                {card.content.speech_style.habits.length > 0 && (
                  <p>习惯：{card.content.speech_style.habits.join(' / ')}</p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-md border border-line-subtle bg-canvas p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-content-primary">人际关系</span>
              {renderFieldActions('relationships', '人际关系')}
            </div>
            {card.content.relationships.length === 0 ? (
              <p className="text-xs text-content-muted">暂未记录关键人际关系</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {card.content.relationships.map((rel, idx) => (
                  <div
                    key={`${rel.target}-${idx}`}
                    className="rounded-sm border border-line bg-surface p-2 text-xs"
                  >
                    <div className="font-semibold text-content-primary">
                      {rel.target} · <span className="text-accent">{rel.relation}</span>
                    </div>
                    {rel.attitude && (
                      <div className="mt-0.5 text-[11px] text-content-secondary">{rel.attitude}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border border-line-subtle bg-canvas p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-content-primary">
                <Dice5 className="h-3.5 w-3.5 text-accent" />
                <span>TRPG 规则面板属性 (CoC 7e / D&amp;D 5e)</span>
              </div>
              {canUpdate && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleGenerateTrpg('coc7e')}
                    className="rounded-sm border border-line bg-surface px-2 py-1 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {busyAction === 'trpg-coc7e' ? '推演中...' : 'AI 推演 CoC 7e'}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleGenerateTrpg('dnd5e')}
                    className="rounded-sm border border-line bg-surface px-2 py-1 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {busyAction === 'trpg-dnd5e' ? '推演中...' : 'AI 推演 D&D 5e'}
                  </button>
                </div>
              )}
            </div>

            {typeof card.content.extensions.trpg === 'object' &&
            card.content.extensions.trpg !== null ? (
              <TrpgPanelView trpg={card.content.extensions.trpg as Record<string, unknown>} />
            ) : (
              <p className="text-xs text-content-muted">
                当前角色尚未绑定 TRPG 数值面板。点击右上角「AI 推演 CoC 7e / D&amp;D 5e」可根据人设自动生成真实属性并解锁跑团车卡表与 Foundry VTT 导出。
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'dialogue' && (
        <div className="space-y-4">
          {(['first_mes', 'mes_example', 'system_prompt', 'creator_notes'] as const).map((key) => {
            const meta = LOCKABLE_FIELDS.find((f) => f.key === key)!;
            return (
              <div key={key} className="rounded-md border border-line-subtle bg-canvas p-3">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-content-primary">{meta.label}</span>
                  {renderFieldActions(key, meta.label)}
                </div>
                {editing ? (
                  <textarea
                    rows={key === 'mes_example' ? 5 : 3}
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    className="w-full rounded-sm border border-line bg-surface p-2 font-mono text-xs leading-relaxed text-content-primary outline-none focus:border-accent"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-content-secondary">
                    {card.content[key] || '（暂无内容）'}
                  </pre>
                )}
              </div>
            );
          })}

          <div className="rounded-md border border-line-subtle bg-canvas p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-content-primary">
                备选开场白 ({card.content.alternate_greetings.length})
              </span>
              {renderFieldActions('alternate_greetings', '备选开场白')}
            </div>
            {editing ? (
              <textarea
                rows={4}
                value={draft.alternate_greetings.join('\n---\n')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    alternate_greetings: e.target.value
                      .split(/\n---\n/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="多个备选开场白请用 --- 单独一行分隔"
                className="w-full rounded-sm border border-line bg-surface p-2 text-xs text-content-primary"
              />
            ) : card.content.alternate_greetings.length === 0 ? (
              <p className="text-xs text-content-muted">暂无备选开场白</p>
            ) : (
              <div className="space-y-2">
                {card.content.alternate_greetings.map((greeting, i) => (
                  <div
                    key={i}
                    className="rounded-sm border border-line bg-surface p-2.5 text-xs text-content-secondary"
                  >
                    <span className="mr-1.5 font-mono text-[10.5px] font-semibold text-accent">
                      #{i + 1}
                    </span>
                    {greeting}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'sources' && (
        <div className="space-y-2.5">
          {card.sources.length === 0 ? (
            <p className="text-xs text-content-muted">无外部引用条目</p>
          ) : (
            card.sources.map((src, idx) => (
              <div
                key={`${src.title}-${idx}`}
                className="rounded-md border border-line-subtle bg-canvas p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
                        src.origin === 'user_provided'
                          ? 'bg-accent/15 text-accent'
                          : 'bg-status-success/15 text-status-success'
                      }`}
                    >
                      {src.origin === 'user_provided' ? '[用户提供]' : '[检索补充]'}
                    </span>
                    <span className="text-xs font-semibold text-content-primary">{src.title}</span>
                    {src.provider && (
                      <span className="font-mono text-[10.5px] text-content-muted">
                        ({src.provider})
                      </span>
                    )}
                  </div>
                  {src.url && /^https?:\/\//i.test(src.url) && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                    >
                      查看来源
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-content-secondary">
                  {src.snippet}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'evolution' && (
        <div className="space-y-4 rounded-md border border-line-subtle bg-canvas p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 font-semibold text-content-primary">
                <Clock className="h-3.5 w-3.5 text-accent" />
                定时人设演化与 Meta 隔离配置
              </h3>
              <p className="mt-0.5 text-[11.5px] text-content-muted">
                默认关闭（不消耗后台 Token）。开启后按设定周期错峰检索更新并生成审核提案；所有角色卡均默认关闭风评注入，并可按需自主开启与编辑风评层。
              </p>
            </div>
            {canUpdate && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={async () => {
                  setBusyAction('evolve');
                  setError(null);
                  try {
                    const res = await api.evolveCard(card.id);
                    if (res.skipped) {
                      onCardUpdated(
                        card,
                        res.reason === 'SOURCE_HASH_UNCHANGED'
                          ? '检索源哈希未变化，已跳过本次 LLM 演化（零消耗）'
                          : '未检索到新资料，本次未生成演化提案',
                      );
                    } else {
                      onCardUpdated(
                        card,
                        res.autoApplied
                          ? '已完成演化并自动应用（已生成 1-hop 涟漪建议）'
                          : '已生成人设演化提案，请前往「审核与同步」查看确认',
                      );
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '触发演化检视失败');
                  } finally {
                    setBusyAction(null);
                  }
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busyAction === 'evolve' ? 'animate-spin' : ''}`} />
                {busyAction === 'evolve' ? '检索演化中...' : '立即执行一次演化检视'}
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-sm border border-line bg-surface px-3 py-2">
              <span className="font-medium text-content-primary">开启定期演化任务</span>
              <input
                type="checkbox"
                disabled={!canUpdate}
                checked={schedEnabled}
                onChange={(e) => setSchedEnabled(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
            </label>

            <div className="flex items-center justify-between rounded-sm border border-line bg-surface px-3 py-2">
              <span className="font-medium text-content-primary">更新周期（天）</span>
              <input
                type="number"
                min={1}
                max={365}
                disabled={!canUpdate}
                value={schedDays}
                onChange={(e) => setSchedDays(Math.max(1, Number(e.target.value) || 7))}
                className="h-7 w-20 rounded-sm border border-line bg-canvas px-2 text-right font-mono text-xs text-content-primary"
              />
            </div>

            <div className="flex items-center justify-between rounded-sm border border-line bg-surface px-3 py-2">
              <span className="font-medium text-content-primary">同步范围</span>
              <select
                disabled={!canUpdate}
                value={schedScope}
                onChange={(e) => setSchedScope(e.target.value as SyncScope)}
                className="h-7 rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary"
              >
                <option value="canon">仅正典设定 (canon)</option>
                <option value="meta_reputation">仅社群风评 (meta)</option>
                <option value="both">正典 + 独立风评层 (both)</option>
              </select>
            </div>

            <div className="flex items-center justify-between rounded-sm border border-line bg-surface px-3 py-2">
              <span className="font-medium text-content-primary">审核策略</span>
              <select
                disabled={!canUpdate}
                value={schedThreshold}
                onChange={(e) => setSchedThreshold(e.target.value as AutoApplyThreshold)}
                className="h-7 rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary"
              >
                <option value="manual_review">人工审核后合并</option>
                <option value="auto_minor">自动应用微调</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 rounded-sm border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium text-content-primary">试聊时允许注入 Meta 风评层</span>
                <span className="ml-2 text-[11px] text-content-muted">
                  （默认关闭；开启后试聊时将附带下方风评层参考）
                </span>
              </div>
              <input
                type="checkbox"
                disabled={!canUpdate || busyAction !== null}
                checked={card.enableMetaInChat}
                onChange={async (e) => {
                  setBusyAction('meta');
                  setError(null);
                  try {
                    const res = await api.updateMetaSettings(card.id, {
                      enableMetaInChat: e.target.checked,
                    });
                    onCardUpdated(res.card, e.target.checked ? '已开启试聊 Meta 层注入' : '已关闭试聊 Meta 层注入');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '更新 Meta 设置失败');
                  } finally {
                    setBusyAction(null);
                  }
                }}
                className="h-4 w-4 accent-accent"
              />
            </div>

            <div className="space-y-1.5 border-t border-line-subtle pt-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-content-secondary">
                  当前 Meta 风评层摘要
                  {card.metaUpdatedAt
                    ? ` · 更新于 ${new Date(card.metaUpdatedAt).toLocaleString()}`
                    : ' · 暂无风评记录'}
                </span>
                {canUpdate && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={async () => {
                      setBusyAction('meta-summary');
                      setError(null);
                      try {
                        const trimmed = metaSummaryDraft.trim();
                        const res = await api.updateMetaSettings(card.id, {
                          metaSummary: trimmed || null,
                        });
                        onCardUpdated(
                          res.card,
                          trimmed ? '已保存 Meta 风评层摘要' : '已清空 Meta 风评层摘要',
                        );
                        notifySuccess(trimmed ? '已保存风评摘要' : '已清空风评摘要');
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : '保存 Meta 风评摘要失败';
                        setError(msg);
                        notifyError(msg);
                      } finally {
                        setBusyAction(null);
                      }
                    }}
                    className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-canvas px-2.5 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" />
                    {busyAction === 'meta-summary' ? '保存中...' : '保存风评摘要'}
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                disabled={!canUpdate}
                value={metaSummaryDraft}
                onChange={(e) => setMetaSummaryDraft(e.target.value)}
                placeholder="可由演化流程自动归档外部评价与社群风评，也可手动编辑；留空并保存即清空"
                className="w-full rounded-sm border border-line bg-canvas p-2 text-xs leading-relaxed text-content-primary outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-content-muted">
            <span>
              上次检测：{schedule?.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : '从未运行'}
              {' · '}
              下次预定：{schedule?.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : '未排期'}
            </span>
            {canUpdate && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={async () => {
                  setBusyAction('schedule');
                  setError(null);
                  try {
                    const res = await api.updateCardSchedule(card.id, {
                      enabled: schedEnabled,
                      intervalDays: schedDays,
                      syncScope: schedScope,
                      autoApplyThreshold: schedThreshold,
                    });
                    setSchedule(res.schedule);
                    onCardUpdated(
                      { ...card, scheduleEnabled: res.schedule.enabled },
                      res.schedule.enabled ? `已启用每 ${res.schedule.intervalDays} 天演化同步` : '已关闭定期演化任务',
                    );
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '保存演化配置失败');
                  } finally {
                    setBusyAction(null);
                  }
                }}
                className="inline-flex h-8 items-center gap-1 rounded-sm border border-accent bg-accent/10 px-3 text-xs font-medium text-accent hover:bg-accent/20"
              >
                <Save className="h-3.5 w-3.5" />
                保存周期设置
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TrpgPanelView({ trpg }: { trpg: Record<string, unknown> }) {
  const sysText = String(trpg.system ?? '');
  const isCoc =
    sysText.toLowerCase().includes('cthulhu') ||
    sysText.toLowerCase().includes('coc') ||
    (typeof trpg.characteristics === 'object' && trpg.characteristics !== null);

  const asRec = (val: unknown): Record<string, unknown> =>
    typeof val === 'object' && val !== null && !Array.isArray(val)
      ? (val as Record<string, unknown>)
      : {};
  const asArr = (val: unknown): string[] =>
    Array.isArray(val) ? val.map((x) => String(x ?? '').trim()).filter(Boolean) : [];

  if (isCoc) {
    const chars = asRec(trpg.characteristics);
    const derived = asRec(trpg.derived);
    const skills = asArr(trpg.keySkills);
    const statOrder = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'] as const;

    return (
      <div className="space-y-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-content-secondary">
          <span className="rounded bg-accent/10 px-2 py-0.5 font-medium text-accent">
            {sysText || 'Call of Cthulhu 7e'}
          </span>
          {Boolean(trpg.occupation) && (
            <span>
              职业：<strong className="text-content-primary">{String(trpg.occupation)}</strong>
            </span>
          )}
          {Boolean(trpg.era) && (
            <span>
              年代：<strong className="text-content-primary">{String(trpg.era)}</strong>
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
          {statOrder.map((k) => {
            const val = Number(chars[k] ?? 50);
            return (
              <div
                key={k}
                className="rounded-sm border border-line bg-surface px-2 py-1.5 text-center"
              >
                <div className="text-[10px] font-medium text-content-muted">{k}</div>
                <div className="font-mono text-sm font-semibold text-content-primary">{val}</div>
                <div className="font-mono text-[10px] text-content-muted">
                  {Math.floor(val / 2)} / {Math.floor(val / 5)}
                </div>
              </div>
            );
          })}
        </div>

        {Object.keys(derived).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(['HP', 'MP', 'SAN', 'Luck', 'Move'] as const).map((k) =>
              derived[k] !== undefined ? (
                <span
                  key={k}
                  className="rounded-sm border border-line bg-surface px-2 py-1 font-mono text-[11px] text-content-primary"
                >
                  {k}: <strong>{String(derived[k])}</strong>
                </span>
              ) : null,
            )}
          </div>
        )}

        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <span
                key={skill}
                className="rounded-sm bg-subtle px-2 py-0.5 text-[11px] text-content-secondary"
              >
                {skill}
              </span>
            ))}
          </div>
        )}

        <details className="text-[11px] text-content-muted">
          <summary className="cursor-pointer hover:text-content-primary">查看原始 JSON</summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm bg-surface p-2 font-mono text-[11px] text-content-secondary">
            {JSON.stringify(trpg, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  const abilities = asRec(trpg.abilityScores);
  const combat = asRec(trpg.combat);
  const proficiencies = asArr(trpg.proficiencies);
  const features = asArr(trpg.featuresAndTraits);
  const dndOrder = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;

  return (
    <div className="space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-content-secondary">
        <span className="rounded bg-accent/10 px-2 py-0.5 font-medium text-accent">
          {sysText || 'D&D 5e'}
        </span>
        {Boolean(trpg.level) && (
          <span>
            Lv.<strong className="text-content-primary">{String(trpg.level)}</strong>
          </span>
        )}
        {Boolean(trpg.race) && (
          <span>
            种族：<strong className="text-content-primary">{String(trpg.race)}</strong>
          </span>
        )}
        {Boolean(trpg.className) && (
          <span>
            职业：<strong className="text-content-primary">{String(trpg.className)}</strong>
          </span>
        )}
        {Boolean(trpg.alignment) && (
          <span>
            阵营：<strong className="text-content-primary">{String(trpg.alignment)}</strong>
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {dndOrder.map((k) => {
          const score = Number(abilities[k] ?? 10);
          const mod = Math.floor((score - 10) / 2);
          const modStr = mod >= 0 ? `+${mod}` : String(mod);
          return (
            <div
              key={k}
              className="rounded-sm border border-line bg-surface px-2 py-1.5 text-center"
            >
              <div className="text-[10px] font-medium text-content-muted">{k}</div>
              <div className="font-mono text-sm font-semibold text-content-primary">{score}</div>
              <div className="font-mono text-[11px] text-accent">{modStr}</div>
            </div>
          );
        })}
      </div>

      {Object.keys(combat).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(['AC', 'MaxHP', 'Speed', 'ProficiencyBonus'] as const).map((k) =>
            combat[k] !== undefined ? (
              <span
                key={k}
                className="rounded-sm border border-line bg-surface px-2 py-1 font-mono text-[11px] text-content-primary"
              >
                {k}: <strong>{String(combat[k])}</strong>
              </span>
            ) : null,
          )}
        </div>
      )}

      {proficiencies.length > 0 && (
        <div className="text-[11px] text-content-secondary">
          <span className="font-medium text-content-primary">熟练项：</span>
          {proficiencies.join('、')}
        </div>
      )}

      {features.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {features.map((feat) => (
            <span
              key={feat}
              className="rounded-sm bg-subtle px-2 py-0.5 text-[11px] text-content-secondary"
            >
              {feat}
            </span>
          ))}
        </div>
      )}

      <details className="text-[11px] text-content-muted">
        <summary className="cursor-pointer hover:text-content-primary">查看原始 JSON</summary>
        <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm bg-surface p-2 font-mono text-[11px] text-content-secondary">
          {JSON.stringify(trpg, null, 2)}
        </pre>
      </details>
    </div>
  );
}

