import { useEffect, useState } from 'react';
import type {
  AutoApplyThreshold,
  ExportFormat,
  RoleCardContent,
  SyncScheduleDto,
  SyncScope,
} from '@rolecard/shared';
import {
  Check,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Minimize2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';

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
}: CardDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RoleCardContent | null>(null);
  const [lockedFields, setLockedFields] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [refineInput, setRefineInput] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'dialogue' | 'sources' | 'evolution'>('profile');
  const [schedule, setSchedule] = useState<SyncScheduleDto | null>(null);
  const [schedEnabled, setSchedEnabled] = useState(false);
  const [schedDays, setSchedDays] = useState(7);
  const [schedScope, setSchedScope] = useState<SyncScope>('canon');
  const [schedThreshold, setSchedThreshold] = useState<AutoApplyThreshold>('manual_review');

  useEffect(() => {
    if (card) {
      setDraft(structuredClone(card.content));
      setLockedFields([...card.lockedFields]);
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
      onCardUpdated(refreshed.card);
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
      onCardUpdated(refreshed.card);
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

  const handleExport = (format: ExportFormat) => {
    if (!canExport) return;
    window.open(api.getExportUrl(card.id, format), '_blank', 'noopener,noreferrer');
  };

  const renderLockButton = (fieldKey: string) => {
    const locked = lockedFields.includes(fieldKey);
    return (
      <button
        type="button"
        disabled={!canUpdate || busyAction !== null}
        onClick={() => toggleFieldLock(fieldKey)}
        title={locked ? '已锁定（AI 微调与演化将跳过此字段），点击解锁' : '点击锁定此字段'}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition ${
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

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-line-subtle pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3.5">
          <div className="relative shrink-0">
            {card.imageUrl ? (
              <img
                src={card.imageUrl}
                alt={card.characterName}
                referrerPolicy="no-referrer"
                className="h-24 w-16 rounded-md border border-line object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-24 w-16 items-center justify-center rounded-md border border-dashed border-line bg-subtle text-lg font-bold text-accent">
                {card.characterName.slice(0, 1)}
              </div>
            )}
            {canUpdate && (
              <button
                type="button"
                onClick={onOpenPortraitModal}
                title="裁剪或更换角色立绘"
                className="mt-1 flex w-16 items-center justify-center gap-1 rounded-sm border border-line bg-surface py-0.5 text-[10.5px] text-content-secondary hover:bg-subtle hover:text-content-primary"
              >
                <ImageIcon className="h-3 w-3" />
                立绘
              </button>
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
              <span className="tabular-nums rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-content-muted">
                {card.tokenCount} tok
              </span>
            </div>

            <p className="mt-1 text-xs text-content-secondary">
              出处：{card.workName || '原创设定'} · 规格：{card.cardType}
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
        <div className="flex flex-wrap items-center gap-1.5">
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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-content-muted">导出：</span>
            {(
              [
                ['tavern_png', 'CCV3 PNG'],
                ['tavern_v3_json', 'V3 JSON'],
                ['json', '标准 JSON'],
                ['markdown', 'Markdown'],
              ] as const
            ).map(([fmt, label]) => (
              <button
                key={fmt}
                type="button"
                onClick={() => handleExport(fmt)}
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent"
              >
                <Download className="h-3 w-3" />
                {label}
              </button>
            ))}
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
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-content-primary">{meta.label}</span>
                    {renderLockButton(key)}
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
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-content-primary">语言风格与口癖</span>
              {renderLockButton('speech_style')}
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
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-content-primary">人际关系</span>
              {renderLockButton('relationships')}
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

          {typeof card.content.extensions.trpg === 'object' &&
            card.content.extensions.trpg !== null && (
              <div className="rounded-md border border-line-subtle bg-canvas p-3">
                <div className="mb-1.5 text-xs font-semibold text-content-primary">
                  TRPG 规则面板属性 (CoC 7e / D&amp;D 5e)
                </div>
                <pre className="overflow-x-auto rounded-sm border border-line bg-surface p-2.5 font-mono text-[11px] text-content-secondary">
                  {JSON.stringify(card.content.extensions.trpg, null, 2)}
                </pre>
              </div>
            )}
        </div>
      )}

      {activeTab === 'dialogue' && (
        <div className="space-y-4">
          {(['first_mes', 'mes_example', 'system_prompt', 'creator_notes'] as const).map((key) => {
            const meta = LOCKABLE_FIELDS.find((f) => f.key === key)!;
            return (
              <div key={key} className="rounded-md border border-line-subtle bg-canvas p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-content-primary">{meta.label}</span>
                  {renderLockButton(key)}
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
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-content-primary">
                备选开场白 ({card.content.alternate_greetings.length})
              </span>
              {renderLockButton('alternate_greetings')}
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
                默认关闭（不消耗后台 Token）。开启后按设定周期错峰检索更新并生成审核提案；「真实/历史人物」强制仅用正典且禁用风评。
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
                disabled={!canUpdate || card.entityType === 'real_person'}
                value={card.entityType === 'real_person' ? 'canon' : schedScope}
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
                <option value="auto_minor">自动应用微调（虚构角色）</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line bg-surface px-3 py-2">
            <div>
              <span className="font-medium text-content-primary">试聊时允许注入 Meta 风评层</span>
              {card.entityType === 'real_person' && (
                <span className="ml-2 text-[11px] text-status-warning">
                  （现实/历史人物卡合规锁死：禁止收集与注入主观风评）
                </span>
              )}
            </div>
            <input
              type="checkbox"
              disabled={!canUpdate || card.entityType === 'real_person'}
              checked={card.entityType === 'real_person' ? false : card.enableMetaInChat}
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
                      syncScope: card.entityType === 'real_person' ? 'canon' : schedScope,
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
