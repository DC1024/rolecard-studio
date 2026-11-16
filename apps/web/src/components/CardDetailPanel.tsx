import { useEffect, useRef, useState } from 'react';
import type {
  AutoApplyThreshold,
  CardGeneratableField,
  CardRevisionSummary,
  DeclarativePluginManifest,
  ExportFormat,
  RoleCardContent,
  SourceEntry,
  SyncScheduleDto,
  SyncScope,
  TrpgSystemKey,
} from '@rolecard/shared';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock,
  Copy,
  Dice5,
  Download,
  Edit3,
  ExternalLink,
  Globe,
  History,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  MessageSquare,
  Minimize2,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
  Wand2,
  X,
} from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';
import { useToast } from '../hooks/useToast';
import { extractCardTrpgSystems } from '../utils/trpg';

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
  { key: 'tags', label: '角色标签' },
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

  // Sources management & AI generation context states
  const [selectedSourceIndices, setSelectedSourceIndices] = useState<number[]>([]);
  const [sourceInputMode, setSourceInputMode] = useState<'text' | 'url' | 'search'>('search');
  const [textSourceTitle, setTextSourceTitle] = useState('');
  const [textSourceContent, setTextSourceContent] = useState('');
  const [urlSourceInput, setUrlSourceInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDeep, setSearchDeep] = useState(true);
  const [searchResults, setSearchResults] = useState<SourceEntry[]>([]);
  const [searchMeta, setSearchMeta] = useState<{
    query: string;
    layer1Hits: number;
    layer2Hits: number;
  } | null>(null);
  const [selectedSearchIndices, setSelectedSearchIndices] = useState<number[]>([]);

  // Streaming progress & thinking states for top AI Refine / Regenerate, per-field AI Generate, and TRPG
  const [cardStreamMode, setCardStreamMode] = useState<'refine' | 'regenerate' | null>(null);
  const [refineProgressText, setRefineProgressText] = useState('');
  const [refineThinkingText, setRefineThinkingText] = useState('');
  const [refineThinkingExpanded, setRefineThinkingExpanded] = useState(true);
  const refineThinkingBoxRef = useRef<HTMLPreElement | null>(null);

  const [fieldStreamTarget, setFieldStreamTarget] = useState<{
    field: CardGeneratableField;
    label: string;
  } | null>(null);
  const [fieldProgressText, setFieldProgressText] = useState('');
  const [fieldThinkingText, setFieldThinkingText] = useState('');
  const [fieldThinkingExpanded, setFieldThinkingExpanded] = useState(true);
  const fieldThinkingBoxRef = useRef<HTMLPreElement | null>(null);

  const [trpgStreamSystem, setTrpgStreamSystem] = useState<'coc7e' | 'dnd5e' | null>(null);
  const [trpgProgressText, setTrpgProgressText] = useState('');
  const [trpgThinkingText, setTrpgThinkingText] = useState('');
  const [trpgThinkingExpanded, setTrpgThinkingExpanded] = useState(true);
  const trpgThinkingBoxRef = useRef<HTMLPreElement | null>(null);
  const [selectedTrpgTab, setSelectedTrpgTab] = useState<TrpgSystemKey>('coc7e');

  // Confirm modals, revisions rollback, and source item collapse/expand
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [regenerateInstruction, setRegenerateInstruction] = useState('');
  const [compressModalOpen, setCompressModalOpen] = useState(false);
  const [revisions, setRevisions] = useState<CardRevisionSummary[]>([]);
  const [revisionMenuOpen, setRevisionMenuOpen] = useState(false);
  const [expandedSourceIndices, setExpandedSourceIndices] = useState<number[]>([]);

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
      api
        .listCardRevisions(card.id)
        .then((res) => {
          setRevisions(res.revisions);
        })
        .catch(() => {
          setRevisions([]);
        });
    } else {
      setDraft(null);
      setLockedFields([]);
      setMetaSummaryDraft('');
      setSchedule(null);
      setRevisions([]);
    }
  }, [card?.id, card?.version, card?.updatedAt]);

  useEffect(() => {
    if (card) {
      setSearchQuery(card.workName ? `${card.characterName} ${card.workName}` : card.characterName);
      setSearchResults([]);
      setSearchMeta(null);
      setSelectedSearchIndices([]);
      setSelectedSourceIndices([]);
      setTextSourceTitle('');
      setTextSourceContent('');
      setUrlSourceInput('');
      const extracted = extractCardTrpgSystems(card.content, card.cardType);
      setSelectedTrpgTab(extracted.activeSystem ?? 'coc7e');
    } else {
      setSelectedSourceIndices([]);
      setSearchResults([]);
      setSearchMeta(null);
      setSelectedSearchIndices([]);
      setSelectedTrpgTab('coc7e');
    }
    setCardStreamMode(null);
    setRefineProgressText('');
    setRefineThinkingText('');
    setRefineThinkingExpanded(true);
    setFieldStreamTarget(null);
    setFieldProgressText('');
    setFieldThinkingText('');
    setFieldThinkingExpanded(true);
    setTrpgStreamSystem(null);
    setTrpgProgressText('');
    setTrpgThinkingText('');
    setTrpgThinkingExpanded(true);
    setRegenerateModalOpen(false);
    setRegenerateInstruction('');
    setCompressModalOpen(false);
    setRevisionMenuOpen(false);
    setExpandedSourceIndices([]);
  }, [card?.id]);

  useEffect(() => {
    if (refineThinkingExpanded && refineThinkingBoxRef.current) {
      refineThinkingBoxRef.current.scrollTop = refineThinkingBoxRef.current.scrollHeight;
    }
  }, [refineThinkingText, refineThinkingExpanded]);

  useEffect(() => {
    if (fieldThinkingExpanded && fieldThinkingBoxRef.current) {
      fieldThinkingBoxRef.current.scrollTop = fieldThinkingBoxRef.current.scrollHeight;
    }
  }, [fieldThinkingText, fieldThinkingExpanded]);

  useEffect(() => {
    if (trpgThinkingExpanded && trpgThinkingBoxRef.current) {
      trpgThinkingBoxRef.current.scrollTop = trpgThinkingBoxRef.current.scrollHeight;
    }
  }, [trpgThinkingText, trpgThinkingExpanded]);

  useEffect(() => {
    if (!card) return;
    setSelectedSourceIndices((prev) => prev.filter((idx) => idx >= 0 && idx < card.sources.length));
    setExpandedSourceIndices((prev) => prev.filter((idx) => idx >= 0 && idx < card.sources.length));
  }, [card?.sources.length]);

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

  const trpgInfo = extractCardTrpgSystems(card.content, card.cardType);
  const selectedTrpgData = selectedTrpgTab === 'coc7e' ? trpgInfo.coc7e : trpgInfo.dnd5e;
  const isSelectedTrpgActive = trpgInfo.activeSystem === selectedTrpgTab;

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
    setCardStreamMode('refine');
    setRefineProgressText('正在准备调用模型执行整卡局部微调...');
    setRefineThinkingText('');
    setRefineThinkingExpanded(true);
    try {
      const res = await api.refineCardSse(
        card.id,
        instruction,
        selectedSourceIndices.length > 0 ? selectedSourceIndices : undefined,
        {
          onProgress: (message) => {
            setRefineProgressText(message);
          },
          onThinking: (delta) => {
            setRefineThinkingText((prev) => prev + delta);
          },
        },
      );
      setRefineInput('');
      setRefineProgressText('');
      setRefineThinkingExpanded(false);
      onCardUpdated(res.card, res.diffSummary || 'AI 微调完成');
      notifySuccess('已完成 AI 微调');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 微调失败';
      setRefineProgressText('');
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmRegenerate = async () => {
    if (!canUpdate) return;
    setRegenerateModalOpen(false);
    setBusyAction('regenerate');
    setError(null);
    setCardStreamMode('regenerate');
    setRefineProgressText('正在准备调用模型一键生成未锁定区块...');
    setRefineThinkingText('');
    setRefineThinkingExpanded(true);
    try {
      const res = await api.regenerateCardSse(
        card.id,
        {
          instruction: regenerateInstruction.trim(),
          sourceIndices: selectedSourceIndices.length > 0 ? selectedSourceIndices : undefined,
        },
        {
          onProgress: (message) => {
            setRefineProgressText(message);
          },
          onThinking: (delta) => {
            setRefineThinkingText((prev) => prev + delta);
          },
        },
      );
      setRegenerateInstruction('');
      setRefineProgressText('');
      setRefineThinkingExpanded(false);
      onCardUpdated(res.card, res.diffSummary || '一键 AI 生成完成');
      notifySuccess(res.diffSummary || '已完成一键 AI 生成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '一键 AI 生成失败';
      setRefineProgressText('');
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmCompress = async () => {
    if (!canUpdate) return;
    setCompressModalOpen(false);
    setBusyAction('compress');
    setError(null);
    try {
      const res = await api.compressCard(card.id, 1200);
      const summary = `语义精简完成：${res.beforeTokens} → ${res.afterTokens} tokens（已保留锁定字段与 TRPG 面板）`;
      onCardUpdated(res.card, summary);
      notifySuccess(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '语义精简失败';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRollback = async (revisionId?: string) => {
    if (!canUpdate) return;
    setRevisionMenuOpen(false);
    setBusyAction('rollback');
    setError(null);
    try {
      const res = await api.rollbackCardRevision(card.id, revisionId);
      onCardUpdated(res.card, res.card.diffSummary || '已撤回至历史版本');
      notifySuccess(res.card.diffSummary || '已撤回至历史版本');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '撤回版本失败';
      setError(msg);
      notifyError(msg);
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

  const handleExport = (format: ExportFormat, label?: string, trpgSystem?: TrpgSystemKey) => {
    if (!canExport) return;
    window.open(api.getExportUrl(card.id, format, trpgSystem), '_blank', 'noopener,noreferrer');
    setExportMenuOpen(false);
    notifySuccess(`已触发「${label ?? format}」导出`);
  };

  const handlePluginExport = (plugin: DeclarativePluginManifest) => {
    if (!canExport) return;
    window.open(api.getPluginExportUrl(plugin.id, card.id), '_blank', 'noopener,noreferrer');
    setExportMenuOpen(false);
    notifySuccess(`已触发插件「${plugin.name}」导出`);
  };

  const handleGenerateTrpg = async (system: TrpgSystemKey) => {
    if (!canUpdate) return;
    const systemLabel = system === 'coc7e' ? 'CoC 7e 调查员规则面板' : 'D&D 5e 冒险者规则面板';
    const shouldActivate = !trpgInfo.activeSystem || trpgInfo.activeSystem === system;
    setSelectedTrpgTab(system);
    setBusyAction(`trpg-${system}`);
    setError(null);
    setTrpgStreamSystem(system);
    setTrpgProgressText(`正在准备调用模型推演「${systemLabel}」...`);
    setTrpgThinkingText('');
    setTrpgThinkingExpanded(true);
    try {
      const res = await api.generateCardTrpgStatsSse(
        card.id,
        system,
        {
          onProgress: (message) => {
            setTrpgProgressText(message);
          },
          onThinking: (delta) => {
            setTrpgThinkingText((prev) => prev + delta);
          },
        },
        shouldActivate,
      );
      setTrpgProgressText('');
      setTrpgThinkingExpanded(false);
      setSelectedTrpgTab(system);
      onCardUpdated(res.card, `已根据角色设定推演 ${systemLabel}`);
      notifySuccess(`已生成 ${systemLabel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成 TRPG 数据失败';
      setTrpgProgressText('');
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSwitchActiveTrpg = async (system: TrpgSystemKey) => {
    if (!canUpdate || busyAction !== null) return;
    const systemLabel = system === 'coc7e' ? 'CoC 7e' : 'D&D 5e';
    setBusyAction(`switch-trpg-${system}`);
    setError(null);
    try {
      const res = await api.switchActiveTrpgSystem(card.id, system);
      setSelectedTrpgTab(system);
      onCardUpdated(res.card, `已将默认 TRPG 规则切换为 ${systemLabel}`);
      notifySuccess(`已将默认 TRPG 规则切换为 ${systemLabel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '切换默认 TRPG 规则失败';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveTrpg = async (system: TrpgSystemKey, nextTrpg: Record<string, unknown>) => {
    if (!canUpdate) return;
    setBusyAction('save-trpg');
    setError(null);
    try {
      const nextBucket: Record<string, unknown> = {
        ...(trpgInfo.coc7e ? { coc7e: trpgInfo.coc7e } : {}),
        ...(trpgInfo.dnd5e ? { dnd5e: trpgInfo.dnd5e } : {}),
        [system]: nextTrpg,
      };
      const nextActive = trpgInfo.activeSystem ?? system;
      const nextContent: RoleCardContent = {
        ...card.content,
        extensions: {
          ...card.content.extensions,
          trpgSystems: nextBucket,
          activeTrpgSystem: nextActive,
          trpg:
            nextActive === system
              ? nextTrpg
              : ((nextBucket[nextActive] as Record<string, unknown> | undefined) ?? nextTrpg),
        },
      };
      const res = await api.updateCardContent(card.id, {
        content: nextContent,
        lockedFields,
        tags: card.tags,
      });
      onCardUpdated(
        res.card,
        `已手动更新 ${system === 'coc7e' ? 'CoC 7e' : 'D&D 5e'} TRPG 规则面板属性`,
      );
      notifySuccess('已保存 TRPG 规则面板修改');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存 TRPG 属性失败';
      setError(msg);
      notifyError(msg);
      throw err;
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
    setFieldStreamTarget({ field, label });
    setFieldProgressText(`正在准备调用模型生成「${label}」...`);
    setFieldThinkingText('');
    setFieldThinkingExpanded(true);
    try {
      const res = await api.generateCardFieldSse(
        card.id,
        {
          field,
          sourceIndices:
            selectedSourceIndices.length > 0 ? selectedSourceIndices : undefined,
        },
        {
          onProgress: (message) => {
            setFieldProgressText(message);
          },
          onThinking: (delta) => {
            setFieldThinkingText((prev) => prev + delta);
          },
        },
      );
      setFieldProgressText('');
      setFieldThinkingExpanded(false);
      onCardUpdated(res.card, res.diffSummary);
      notifySuccess(
        field === 'tags'
          ? res.diffSummary
          : `已为「${res.fieldLabel}」生成新内容`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : `AI 生成「${label}」失败`;
      setFieldProgressText('');
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const toggleSourceIndex = (idx: number) => {
    setSelectedSourceIndices((prev) =>
      prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx].sort((a, b) => a - b),
    );
  };

  const handleAddTextSource = async () => {
    const content = textSourceContent.trim();
    if (!content || !canUpdate) return;
    setBusyAction('add-source-text');
    setError(null);
    try {
      const prevLen = card.sources.length;
      const res = await api.addCardSources(card.id, {
        textSources: [
          {
            title: textSourceTitle.trim() || '用户补充设定',
            content,
          },
        ],
      });
      if (res.card.sources.length > prevLen) {
        const addedIndices: number[] = [];
        for (let i = prevLen; i < res.card.sources.length; i += 1) {
          addedIndices.push(i);
        }
        setSelectedSourceIndices((prev) => [...new Set([...prev, ...addedIndices])]);
      }
      setTextSourceTitle('');
      setTextSourceContent('');
      onCardUpdated(
        res.card,
        res.addedCount > 0 ? `已新增 ${res.addedCount} 条文本引用` : '该文本引用已存在',
      );
      if (res.addedCount > 0) {
        notifySuccess(`已新增 ${res.addedCount} 条文本引用（已自动勾选用于 AI 生成/微调）`);
      } else {
        notifySuccess('该引用内容已存在于引用库中');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '添加文本引用失败';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddUrlSources = async () => {
    const urls = urlSourceInput
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0 || !canUpdate) return;
    setBusyAction('add-source-url');
    setError(null);
    try {
      const prevLen = card.sources.length;
      const res = await api.addCardSources(card.id, { urls: urls.slice(0, 5) });
      if (res.card.sources.length > prevLen) {
        const addedIndices: number[] = [];
        for (let i = prevLen; i < res.card.sources.length; i += 1) {
          addedIndices.push(i);
        }
        setSelectedSourceIndices((prev) => [...new Set([...prev, ...addedIndices])]);
      }
      setUrlSourceInput('');
      onCardUpdated(res.card, `已抓取并新增 ${res.addedCount} 条网页引用`);
      if (res.failedUrls.length > 0) {
        notifyError(
          `部分链接抓取失败：${res.failedUrls.map((f) => f.url).join(', ')}`,
        );
      } else {
        notifySuccess(`已新增 ${res.addedCount} 条网页引用（已自动勾选用于 AI 生成/微调）`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '抓取参考链接失败';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteSource = async (index: number, title: string) => {
    if (!canUpdate) return;
    setBusyAction(`del-source-${index}`);
    setError(null);
    try {
      const res = await api.deleteCardSource(card.id, index);
      setSelectedSourceIndices((prev) =>
        prev
          .filter((idx) => idx !== index)
          .map((idx) => (idx > index ? idx - 1 : idx)),
      );
      onCardUpdated(res.card, `已移除引用「${title}」`);
      notifySuccess(`已移除引用「${title}」`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '移除引用失败';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSearchSources = async () => {
    const q = searchQuery.trim();
    if (!q || !canUpdate) return;
    setBusyAction('search-sources');
    setError(null);
    try {
      const res = await api.searchCardSources(card.id, {
        query: q,
        deepSearch: searchDeep,
        appendToCard: false,
      });
      setSearchResults(res.sources);
      setSearchMeta({
        query: res.query,
        layer1Hits: res.layer1Hits,
        layer2Hits: res.layer2Hits,
      });
      setSelectedSearchIndices(res.sources.map((_, idx) => idx));
      if (res.sources.length === 0) {
        notifyError('未检索到新资料，可尝试调整关键词或开启商用搜索 API');
      } else {
        notifySuccess(`检索完成：共命中 ${res.sources.length} 条资料，请勾选入库`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '联网检索失败';
      setError(msg);
      notifyError(msg);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAdoptSearchResults = async () => {
    if (!canUpdate || selectedSearchIndices.length === 0) return;
    const entries = selectedSearchIndices
      .map((idx) => searchResults[idx])
      .filter((item): item is SourceEntry => Boolean(item));
    if (entries.length === 0) return;

    setBusyAction('adopt-search-sources');
    setError(null);
    try {
      const prevLen = card.sources.length;
      const res = await api.addCardSources(card.id, { entries });
      const newLen = res.card.sources.length;
      if (newLen > prevLen) {
        const addedIndices: number[] = [];
        for (let i = prevLen; i < newLen; i += 1) {
          addedIndices.push(i);
        }
        setSelectedSourceIndices((prev) => [...new Set([...prev, ...addedIndices])]);
      }
      setSearchResults([]);
      setSearchMeta(null);
      setSelectedSearchIndices([]);
      onCardUpdated(
        res.card,
        res.addedCount > 0
          ? `已将 ${res.addedCount} 条检索资料加入引用库并勾选`
          : '所选资料已存在于引用库中',
      );
      notifySuccess(
        res.addedCount > 0
          ? `已加入 ${res.addedCount} 条检索资料（已自动勾选用于 AI 生成/微调）`
          : '所选资料已存在',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存检索资料失败';
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

  const renderFieldStreamPanel = (field: CardGeneratableField) => {
    const isCurrentField = fieldStreamTarget?.field === field;
    const isGenerating = busyAction === `gen-${field}`;
    if (!isCurrentField && !isGenerating) return null;
    if (!isGenerating && !fieldProgressText && !fieldThinkingText) return null;

    return (
      <div className="mb-2 space-y-2 rounded-sm border border-line bg-surface p-2.5 text-xs">
        {(isGenerating || fieldProgressText) && (
          <div className="flex items-center gap-2 font-medium text-status-info">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span>{fieldProgressText || `正在调用模型生成「${fieldStreamTarget?.label ?? field}」...`}</span>
          </div>
        )}
        {fieldThinkingText && (
          <div className="rounded-sm border border-line-subtle bg-canvas">
            <div className="flex items-center justify-between px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => setFieldThinkingExpanded((prev) => !prev)}
                className="flex flex-1 items-center justify-between text-left text-[11px] font-semibold text-content-secondary hover:text-content-primary"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-accent" />
                  模型思考过程（{fieldThinkingText.length} 字）
                </span>
                {fieldThinkingExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              {!isGenerating && (
                <button
                  type="button"
                  title="关闭思考记录"
                  onClick={() => {
                    setFieldStreamTarget(null);
                    setFieldThinkingText('');
                    setFieldProgressText('');
                  }}
                  className="ml-2 text-content-muted hover:text-content-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {fieldThinkingExpanded && (
              <pre
                ref={fieldThinkingBoxRef}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line-subtle px-2.5 py-2 font-mono text-[11px] leading-relaxed text-content-secondary"
              >
                {fieldThinkingText}
              </pre>
            )}
          </div>
        )}
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

      {/* Header (方案 A：左侧缩略图 + 右侧全宽信息与标签，操作栏独立成行) */}
      <div className="border-b border-line-subtle pb-4">
        <div className="flex items-start gap-4">
          <div className="relative flex shrink-0 flex-col items-center gap-1.5">
            {card.imageUrl ? (
              <img
                src={api.resolveImageDisplayUrl(card.imageUrl) ?? card.imageUrl}
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

          <div className="min-w-0 flex-1">
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

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-secondary">
              <span>
                出处：{card.workName || '原创设定'} · 规格：{CARD_TYPE_LABELS[card.cardType] ?? card.cardType}
              </span>
              {(trpgInfo.coc7e || trpgInfo.dnd5e) && (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {trpgInfo.coc7e && (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${
                        trpgInfo.activeSystem === 'coc7e'
                          ? 'border-accent/40 bg-accent/10 text-accent'
                          : 'border-line bg-subtle text-content-secondary'
                      }`}
                    >
                      CoC 7e{trpgInfo.activeSystem === 'coc7e' ? ' · 默认' : ''}
                    </span>
                  )}
                  {trpgInfo.dnd5e && (
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${
                        trpgInfo.activeSystem === 'dnd5e'
                          ? 'border-accent/40 bg-accent/10 text-accent'
                          : 'border-line bg-subtle text-content-secondary'
                      }`}
                    >
                      D&amp;D 5e{trpgInfo.activeSystem === 'dnd5e' ? ' · 默认' : ''}
                    </span>
                  )}
                </span>
              )}
            </div>

            {card.diffSummary && (
              <p className="mt-1.5 inline-flex items-center gap-1 rounded-sm bg-status-info/10 px-2 py-0.5 text-[11px] text-status-info">
                <Check className="h-3 w-3" />
                {card.diffSummary}
              </p>
            )}

            {/* Tags */}
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
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
                  <>
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
                    <button
                      type="button"
                      disabled={busyAction !== null || lockedFields.includes('tags')}
                      onClick={() => void handleGenerateField('tags', '角色标签')}
                      title={
                        lockedFields.includes('tags')
                          ? '标签已锁定，解锁后可使用 AI 生成'
                          : '结合人设与资料 AI 生成标签（保留已有标签并追加去重）'
                      }
                      className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface px-2 text-[11px] font-medium text-content-secondary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {busyAction === 'gen-tags' ? (
                        <Loader2 className="h-3 w-3 animate-spin text-accent" />
                      ) : (
                        <Sparkles className="h-3 w-3 text-accent" />
                      )}
                      <span>{busyAction === 'gen-tags' ? '生成中...' : 'AI 生成标签'}</span>
                    </button>
                    {renderLockButton('tags')}
                  </>
                )}
              </div>
              {renderFieldStreamPanel('tags')}
            </div>
          </div>
        </div>

        {/* Dedicated Actions Toolbar */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-3">
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

            {canUpdate && !editing && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => setRegenerateModalOpen(true)}
                title="一键协同重写除已锁定区块外的全部设定"
                className="inline-flex h-8 items-center gap-1 rounded-sm border border-accent/50 bg-accent/10 px-2.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                {busyAction === 'regenerate' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                一键 AI 生成
              </button>
            )}

            {canUpdate && !editing && (
              <div className="relative flex items-center">
                <button
                  type="button"
                  disabled={busyAction !== null || revisions.length === 0}
                  onClick={() => void handleRollback(revisions[0]?.id)}
                  title={
                    revisions[0]
                      ? `撤回至上一版本：${revisions[0].summary || revisions[0].action}`
                      : '暂无可撤回的历史版本（执行编辑/AI 生成/精简后将自动留存快照）'
                  }
                  className="inline-flex h-8 items-center gap-1 rounded-l-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-secondary hover:bg-subtle hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busyAction === 'rollback' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Undo2 className="h-3.5 w-3.5" />
                  )}
                  撤回上一版
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null || revisions.length === 0}
                  onClick={() => setRevisionMenuOpen((prev) => !prev)}
                  title="查看并选择历史版本快照"
                  className="inline-flex h-8 items-center gap-1 rounded-r-sm border border-l-0 border-line bg-surface px-1.5 text-[11px] text-content-muted hover:bg-subtle hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <History className="h-3.5 w-3.5" />
                  {revisions.length > 0 && (
                    <span className="font-mono text-[10px]">{revisions.length}</span>
                  )}
                </button>

                {revisionMenuOpen && revisions.length > 0 && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setRevisionMenuOpen(false)}
                    />
                    <div className="absolute left-0 top-9 z-40 w-80 rounded-md border border-line bg-elevated p-2.5 shadow-xl">
                      <div className="mb-2 flex items-center justify-between border-b border-line-subtle pb-1.5">
                        <span className="text-xs font-semibold text-content-primary">
                          历史版本快照（最近 {revisions.length} 条）
                        </span>
                        <button
                          type="button"
                          onClick={() => setRevisionMenuOpen(false)}
                          className="text-content-muted hover:text-content-primary"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5 text-xs">
                        {revisions.map((rev, idx) => (
                          <div
                            key={rev.id}
                            className="flex items-start justify-between gap-2 rounded-sm border border-line-subtle bg-surface p-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {idx === 0 && (
                                  <span className="shrink-0 whitespace-nowrap rounded bg-accent/15 px-1 py-0.5 text-[10px] font-semibold text-accent">
                                    上一版
                                  </span>
                                )}
                                <span className="truncate font-medium text-content-primary">
                                  {rev.summary || rev.action}
                                </span>
                              </div>
                              <div className="mt-0.5 font-mono text-[10px] text-content-muted">
                                {new Date(rev.createdAt).toLocaleString()} · {rev.tokenCount} tok
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleRollback(rev.id)}
                              className="shrink-0 rounded-sm border border-line bg-canvas px-2 py-1 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent"
                            >
                              恢复
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {canUpdate && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => setCompressModalOpen(true)}
                title="有损语义精简至约 1200 tokens（跳过锁定字段与 TRPG 面板，可能影响角色细节精准度）"
                className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-secondary hover:bg-subtle hover:text-content-primary disabled:opacity-50"
              >
                <Minimize2 className="h-3.5 w-3.5" />
                {busyAction === 'compress' ? '精简中...' : '精简'}
              </button>
            )}
          </div>

          {canDelete && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={handleDelete}
              title="删除角色卡"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-line text-content-muted hover:border-status-danger/40 hover:bg-status-danger/10 hover:text-status-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Export bar + AI Refine bar */}
      <div className="my-3.5 flex flex-col gap-2.5 rounded-md border border-line bg-subtle p-3 lg:flex-row lg:items-center lg:justify-between">
        {canUpdate ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
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
              placeholder="AI 定向微调指令（自动参考已选/最新引用，尊重已锁字段），例如：结合新增考据重写背景..."
              className="h-8 min-w-[220px] flex-1 rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none focus:border-accent"
            />
            {selectedSourceIndices.length > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab('sources')}
                title="点击管理已勾选的参考引用条目"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] font-medium text-accent hover:bg-accent/15"
              >
                <BookOpen className="h-3 w-3" />
                <span>已选 {selectedSourceIndices.length} 条引用</span>
              </button>
            ) : card.sources.length > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab('sources')}
                title="未指定引用时将自动优先参考最新补充的资料，点击前往勾选或新增资料"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-[11px] text-content-muted hover:border-accent/50 hover:text-accent"
              >
                <BookOpen className="h-3 w-3" />
                <span>参考 {card.sources.length} 条引用</span>
              </button>
            ) : null}
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
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleExport(
                                  'trpg_sheet_html',
                                  `可打印跑团车卡表 (${selectedTrpgTab === 'dnd5e' ? 'D&D 5e' : 'CoC 7e'})`,
                                  selectedTrpgData ? selectedTrpgTab : (trpgInfo.activeSystem ?? undefined),
                                )
                              }
                              className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                            >
                              <div className="font-medium">可打印车卡表</div>
                              <div className="text-[10px] text-content-muted">
                                {trpgInfo.hasDual
                                  ? `当前：${selectedTrpgTab === 'dnd5e' ? 'D&D 5e' : 'CoC 7e'} · HTML`
                                  : 'HTML / 打印 PDF'}
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleExport(
                                  'trpg_sheet_md',
                                  `跑团车卡 Markdown (${selectedTrpgTab === 'dnd5e' ? 'D&D 5e' : 'CoC 7e'})`,
                                  selectedTrpgData ? selectedTrpgTab : (trpgInfo.activeSystem ?? undefined),
                                )
                              }
                              className="rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:border-accent hover:text-accent"
                            >
                              <div className="font-medium">车卡笔记 MD</div>
                              <div className="text-[10px] text-content-muted">
                                {trpgInfo.hasDual
                                  ? `当前：${selectedTrpgTab === 'dnd5e' ? 'D&D 5e' : 'CoC 7e'} · MD`
                                  : 'CoC / D&D 表格'}
                              </div>
                            </button>
                          </div>
                          {trpgInfo.hasDual && (
                            <div className="flex flex-wrap items-center justify-between gap-1 rounded-sm border border-line-subtle bg-canvas px-2 py-1 text-[10px]">
                              <span className="text-content-muted">指定双规则车卡导出：</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleExport('trpg_sheet_html', 'CoC 7e 可打印车卡表 HTML', 'coc7e')}
                                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-content-secondary hover:border-accent hover:text-accent"
                                >
                                  CoC HTML
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleExport('trpg_sheet_html', 'D&D 5e 可打印车卡表 HTML', 'dnd5e')}
                                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-content-secondary hover:border-accent hover:text-accent"
                                >
                                  D&amp;D HTML
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleExport('trpg_sheet_md', 'CoC 7e 车卡 MD', 'coc7e')}
                                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-content-secondary hover:border-accent hover:text-accent"
                                >
                                  CoC MD
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleExport('trpg_sheet_md', 'D&D 5e 车卡 MD', 'dnd5e')}
                                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-content-secondary hover:border-accent hover:text-accent"
                                >
                                  D&amp;D MD
                                </button>
                              </div>
                            </div>
                          )}
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

      {(busyAction === 'refine' ||
        busyAction === 'regenerate' ||
        refineProgressText ||
        refineThinkingText) && (
        <div className="mb-3 space-y-2 rounded-md border border-line bg-subtle p-3 text-xs">
          {(busyAction === 'refine' || busyAction === 'regenerate' || refineProgressText) && (
            <div className="flex items-center gap-2 font-medium text-status-info">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>
                {refineProgressText ||
                  (cardStreamMode === 'regenerate'
                    ? '正在调用模型一键生成未锁定区块...'
                    : '正在调用模型执行 AI 微调...')}
              </span>
            </div>
          )}
          {refineThinkingText && (
            <div className="rounded-sm border border-line bg-surface">
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setRefineThinkingExpanded((prev) => !prev)}
                  className="flex flex-1 items-center justify-between text-left text-[11px] font-semibold text-content-secondary hover:text-content-primary"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Brain className="h-3.5 w-3.5 text-accent" />
                    {cardStreamMode === 'regenerate' ? '一键 AI 生成思考过程' : 'AI 微调思考过程'}（
                    {refineThinkingText.length} 字）
                  </span>
                  {refineThinkingExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {busyAction !== 'refine' && busyAction !== 'regenerate' && (
                  <button
                    type="button"
                    title="关闭思考记录"
                    onClick={() => {
                      setCardStreamMode(null);
                      setRefineThinkingText('');
                      setRefineProgressText('');
                    }}
                    className="ml-2 text-content-muted hover:text-content-primary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {refineThinkingExpanded && (
                <pre
                  ref={refineThinkingBoxRef}
                  className="max-h-44 overflow-y-auto whitespace-pre-wrap border-t border-line-subtle bg-canvas px-2.5 py-2 font-mono text-[11px] leading-relaxed text-content-secondary"
                >
                  {refineThinkingText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

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
                  {renderFieldStreamPanel(key)}
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
            {renderFieldStreamPanel('speech_style')}
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
            {renderFieldStreamPanel('relationships')}
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
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-content-primary">
                <Dice5 className="h-3.5 w-3.5 text-accent" />
                <span>TRPG 规则面板属性 (CoC 7e / D&amp;D 5e)</span>
                <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] font-normal text-content-muted">
                  支持双规则共存 · 已豁免精简 · 支持手工修改
                </span>
              </div>
              {canUpdate && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleGenerateTrpg('coc7e')}
                    className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {busyAction === 'trpg-coc7e' && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
                    {busyAction === 'trpg-coc7e'
                      ? '推演中...'
                      : trpgInfo.coc7e
                        ? '重新推演 CoC 7e'
                        : 'AI 推演 CoC 7e'}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => handleGenerateTrpg('dnd5e')}
                    className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {busyAction === 'trpg-dnd5e' && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
                    {busyAction === 'trpg-dnd5e'
                      ? '推演中...'
                      : trpgInfo.dnd5e
                        ? '重新推演 D&D 5e'
                        : 'AI 推演 D&D 5e'}
                  </button>
                </div>
              )}
            </div>

            {/* Dual-system Tabs + Default Rule Switcher */}
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-2">
              <div className="inline-flex rounded-sm border border-line bg-surface p-0.5 text-[11px]">
                {(
                  [
                    { key: 'coc7e' as const, label: 'CoC 7e 调查员', exists: Boolean(trpgInfo.coc7e) },
                    { key: 'dnd5e' as const, label: 'D&D 5e 冒险者', exists: Boolean(trpgInfo.dnd5e) },
                  ] as const
                ).map((tab) => {
                  const isSelected = selectedTrpgTab === tab.key;
                  const isActiveDefault = trpgInfo.activeSystem === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setSelectedTrpgTab(tab.key)}
                      className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-medium transition ${
                        isSelected
                          ? 'bg-accent text-content-inverse'
                          : 'text-content-secondary hover:text-content-primary'
                      }`}
                    >
                      <span>{tab.label}</span>
                      {tab.exists ? (
                        <span
                          className={`rounded px-1 py-0 text-[9.5px] ${
                            isSelected
                              ? 'bg-white/20 text-content-inverse'
                              : isActiveDefault
                                ? 'bg-accent/15 text-accent'
                                : 'bg-subtle text-content-muted'
                          }`}
                        >
                          {isActiveDefault ? '当前默认' : '已生成'}
                        </span>
                      ) : (
                        <span
                          className={`text-[9.5px] ${
                            isSelected ? 'text-content-inverse/80' : 'text-content-muted'
                          }`}
                        >
                          未生成
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                {selectedTrpgData && isSelectedTrpgActive && (
                  <span className="inline-flex items-center gap-1 rounded-sm border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10.5px] font-medium text-accent">
                    <Check className="h-3 w-3" />
                    当前默认规则（试聊与默认导出优先使用）
                  </span>
                )}
                {selectedTrpgData && !isSelectedTrpgActive && canUpdate && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleSwitchActiveTrpg(selectedTrpgTab)}
                    className="inline-flex items-center gap-1 rounded-sm border border-accent/50 bg-surface px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    {busyAction === `switch-trpg-${selectedTrpgTab}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    设为当前默认规则
                  </button>
                )}
              </div>
            </div>

            {(busyAction === 'trpg-coc7e' ||
              busyAction === 'trpg-dnd5e' ||
              trpgProgressText ||
              trpgThinkingText) && (
              <div className="mb-2.5 space-y-2 rounded-sm border border-line bg-surface p-2.5 text-xs">
                {(busyAction === 'trpg-coc7e' ||
                  busyAction === 'trpg-dnd5e' ||
                  trpgProgressText) && (
                  <div className="flex items-center gap-2 font-medium text-status-info">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span>
                      {trpgProgressText ||
                        `正在调用模型推演 ${trpgStreamSystem === 'dnd5e' ? 'D&D 5e' : 'CoC 7e'} 规则面板...`}
                    </span>
                  </div>
                )}
                {trpgThinkingText && (
                  <div className="rounded-sm border border-line-subtle bg-canvas">
                    <div className="flex items-center justify-between px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => setTrpgThinkingExpanded((prev) => !prev)}
                        className="flex flex-1 items-center justify-between text-left text-[11px] font-semibold text-content-secondary hover:text-content-primary"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Brain className="h-3.5 w-3.5 text-accent" />
                          TRPG 规则推演思考过程（{trpgThinkingText.length} 字）
                        </span>
                        {trpgThinkingExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {busyAction !== 'trpg-coc7e' && busyAction !== 'trpg-dnd5e' && (
                        <button
                          type="button"
                          title="关闭思考记录"
                          onClick={() => {
                            setTrpgStreamSystem(null);
                            setTrpgThinkingText('');
                            setTrpgProgressText('');
                          }}
                          className="ml-2 text-content-muted hover:text-content-primary"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {trpgThinkingExpanded && (
                      <pre
                        ref={trpgThinkingBoxRef}
                        className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line-subtle px-2.5 py-2 font-mono text-[11px] leading-relaxed text-content-secondary"
                      >
                        {trpgThinkingText}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {selectedTrpgData ? (
              <TrpgPanelView
                key={`${card.id}-${selectedTrpgTab}`}
                systemKind={selectedTrpgTab}
                trpg={selectedTrpgData}
                canEdit={canUpdate && !editing && busyAction === null}
                saving={busyAction === 'save-trpg'}
                onSave={(nextTrpg) => handleSaveTrpg(selectedTrpgTab, nextTrpg)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-dashed border-line bg-surface p-3 text-xs text-content-muted">
                <span>
                  尚未生成{' '}
                  <strong className="text-content-secondary">
                    {selectedTrpgTab === 'coc7e' ? 'CoC 7e 调查员' : 'D&D 5e 冒险者'}
                  </strong>{' '}
                  规则面板（可与另一套规则共存保存）。
                </span>
                {canUpdate && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleGenerateTrpg(selectedTrpgTab)}
                    className="inline-flex items-center gap-1 rounded-sm border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3" />
                    AI 推演 {selectedTrpgTab === 'coc7e' ? 'CoC 7e' : 'D&D 5e'}
                  </button>
                )}
              </div>
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
                {renderFieldStreamPanel(key)}
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
            {renderFieldStreamPanel('alternate_greetings')}
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
        <div className="space-y-4">
          {canUpdate && (
            <div className="rounded-md border border-line-subtle bg-canvas p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-content-primary">
                    <Globe className="h-3.5 w-3.5 text-accent" />
                    补充新资料与联网搜索
                  </h3>
                  <p className="mt-0.5 text-[11px] text-content-muted">
                    为已有角色卡补充新设定、抓取网页正文或联网搜索资料；入库后可直接使用「AI 微调」或各区块「AI 生成」结合新资料重写内容。
                  </p>
                </div>
                <div className="inline-flex rounded-sm border border-line bg-surface p-0.5 text-[11px]">
                  {(
                    [
                      ['search', '联网搜料'],
                      ['text', '粘贴文本'],
                      ['url', '抓取链接'],
                    ] as const
                  ).map(([modeKey, modeLabel]) => (
                    <button
                      key={modeKey}
                      type="button"
                      onClick={() => setSourceInputMode(modeKey)}
                      className={`rounded-sm px-2.5 py-1 font-medium transition ${
                        sourceInputMode === modeKey
                          ? 'bg-accent text-content-inverse'
                          : 'text-content-secondary hover:text-content-primary'
                      }`}
                    >
                      {modeLabel}
                    </button>
                  ))}
                </div>
              </div>

              {sourceInputMode === 'search' && (
                <div className="space-y-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleSearchSources();
                        }
                      }}
                      placeholder="输入检索关键词，例如：角色名 作品名 新剧情/版本..."
                      className="h-8 flex-1 rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none focus:border-accent"
                    />
                    <label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-content-secondary">
                      <input
                        type="checkbox"
                        checked={searchDeep}
                        onChange={(e) => setSearchDeep(e.target.checked)}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      <span>联动商用搜索 (Layer-2)</span>
                    </label>
                    <button
                      type="button"
                      disabled={busyAction !== null || !searchQuery.trim()}
                      onClick={handleSearchSources}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busyAction === 'search-sources' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                      {busyAction === 'search-sources' ? '检索中...' : '联网搜料'}
                    </button>
                  </div>

                  {searchMeta && (
                    <div className="rounded-sm border border-line bg-surface p-2.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-2 text-[11px]">
                        <span className="text-content-secondary">
                          关键词 <strong className="text-content-primary">「{searchMeta.query}」</strong>
                          ：公开百科命中 {searchMeta.layer1Hits} 条 · 商用搜索命中 {searchMeta.layer2Hits} 条（展示 {searchResults.length} 条）
                        </span>
                        <div className="flex items-center gap-2">
                          {searchResults.length > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedSearchIndices(
                                    selectedSearchIndices.length === searchResults.length
                                      ? []
                                      : searchResults.map((_, i) => i),
                                  )
                                }
                                className="text-accent hover:underline"
                              >
                                {selectedSearchIndices.length === searchResults.length
                                  ? '取消全选'
                                  : '全选'}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  busyAction !== null || selectedSearchIndices.length === 0
                                }
                                onClick={handleAdoptSearchResults}
                                className="inline-flex items-center gap-1 rounded-sm bg-status-success px-2.5 py-1 text-[11px] font-medium text-content-inverse hover:opacity-90 disabled:opacity-50"
                              >
                                <Plus className="h-3 w-3" />
                                {busyAction === 'adopt-search-sources'
                                  ? '入库中...'
                                  : `将选中 (${selectedSearchIndices.length}) 加入引用库`}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSearchResults([]);
                              setSearchMeta(null);
                              setSelectedSearchIndices([]);
                            }}
                            className="text-content-muted hover:text-content-primary"
                          >
                            关闭
                          </button>
                        </div>
                      </div>

                      {searchResults.length === 0 ? (
                        <p className="py-2 text-center text-[11px] text-content-muted">
                          未命中相关条目。建议精简关键词（仅留角色核心名）或在设置中启用商用搜索引擎。
                        </p>
                      ) : (
                        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                          {searchResults.map((item, idx) => {
                            const checked = selectedSearchIndices.includes(idx);
                            return (
                              <label
                                key={`${item.title}-${idx}`}
                                className={`flex cursor-pointer items-start gap-2 rounded-sm border p-2 transition ${
                                  checked
                                    ? 'border-accent/50 bg-accent/5'
                                    : 'border-line-subtle bg-canvas hover:border-line'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedSearchIndices((prev) =>
                                      prev.includes(idx)
                                        ? prev.filter((i) => i !== idx)
                                        : [...prev, idx].sort((a, b) => a - b),
                                    )
                                  }
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className="font-semibold text-content-primary">
                                      {item.title}
                                    </span>
                                    {item.provider && (
                                      <span className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-content-muted">
                                        {item.provider}
                                      </span>
                                    )}
                                    {item.url && /^https?:\/\//i.test(item.url) && (
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-0.5 text-[10.5px] text-accent hover:underline"
                                      >
                                        来源 <ExternalLink className="h-2.5 w-2.5" />
                                      </a>
                                    )}
                                  </div>
                                  <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-content-secondary">
                                    {item.snippet}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {sourceInputMode === 'text' && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={textSourceTitle}
                    onChange={(e) => setTextSourceTitle(e.target.value)}
                    placeholder="资料标题（可选，例如：官方设定集补充 / 新版本剧情）"
                    className="h-8 w-full rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none focus:border-accent"
                  />
                  <textarea
                    rows={3}
                    value={textSourceContent}
                    onChange={(e) => setTextSourceContent(e.target.value)}
                    placeholder="粘贴新设定文本、台词摘录、人物新经历或考据段落..."
                    className="w-full rounded-sm border border-line bg-surface p-2.5 text-xs leading-relaxed text-content-primary outline-none focus:border-accent"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={busyAction !== null || !textSourceContent.trim()}
                      onClick={handleAddTextSource}
                      className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busyAction === 'add-source-text' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {busyAction === 'add-source-text' ? '保存中...' : '添加到引用库'}
                    </button>
                  </div>
                </div>
              )}

              {sourceInputMode === 'url' && (
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={urlSourceInput}
                    onChange={(e) => setUrlSourceInput(e.target.value)}
                    placeholder="输入网页链接（支持一行一个，最多 5 个，例如百科词条、设定公告 URL）"
                    className="w-full rounded-sm border border-line bg-surface p-2.5 text-xs leading-relaxed text-content-primary outline-none focus:border-accent"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[11px] text-content-muted">
                      <Link2 className="h-3 w-3" />
                      将自动做 SSRF 安全校验与正文提纯，支持已配置的搜索代理
                    </span>
                    <button
                      type="button"
                      disabled={busyAction !== null || !urlSourceInput.trim()}
                      onClick={handleAddUrlSources}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
                    >
                      {busyAction === 'add-source-url' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Globe className="h-3.5 w-3.5" />
                      )}
                      {busyAction === 'add-source-url' ? '抓取中...' : '抓取并加入引用'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {card.sources.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line-subtle bg-subtle px-3 py-2 text-[11px] text-content-secondary">
              <span>
                {selectedSourceIndices.length > 0
                  ? `已勾选 ${selectedSourceIndices.length} / ${card.sources.length} 条引用，将精准注入「AI 微调」与各区块「AI 生成」`
                  : `共 ${card.sources.length} 条引用（默认折叠展示，点击单条「展开」可阅读全文；未勾选时优先参考最新资料）`}
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSourceIndices(
                      expandedSourceIndices.length === card.sources.length
                        ? []
                        : card.sources.map((_, idx) => idx),
                    )
                  }
                  className="text-content-secondary hover:text-accent"
                >
                  {expandedSourceIndices.length === card.sources.length ? '全部折叠' : '全部展开'}
                </button>
                {canUpdate && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedSourceIndices(card.sources.map((_, idx) => idx))}
                      className="text-accent hover:underline"
                    >
                      全选用于生成
                    </button>
                    {selectedSourceIndices.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedSourceIndices([])}
                        className="text-content-muted hover:text-content-primary"
                      >
                        清空勾选
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            {card.sources.length === 0 ? (
              <p className="text-xs text-content-muted">
                暂无引用条目，可在上方通过「联网搜料」「粘贴文本」或「抓取链接」补充参考资料。
              </p>
            ) : (
              card.sources.map((src, idx) => {
                const isSelected = selectedSourceIndices.includes(idx);
                const isExpanded = expandedSourceIndices.includes(idx);
                return (
                  <div
                    key={`${src.title}-${idx}`}
                    className={`rounded-md border p-3 transition ${
                      isSelected
                        ? 'border-accent/60 bg-accent/5'
                        : 'border-line-subtle bg-canvas'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {canUpdate && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSourceIndex(idx)}
                            title="勾选此引用，供「AI 微调」或单区块「AI 生成」优先参考"
                            className="h-3.5 w-3.5 shrink-0 accent-accent"
                          />
                        )}
                        <span className="font-mono text-[10.5px] text-content-muted">
                          #{idx + 1}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${
                            src.origin === 'user_provided'
                              ? 'bg-accent/15 text-accent'
                              : 'bg-status-success/15 text-status-success'
                          }`}
                        >
                          {src.origin === 'user_provided' ? '[用户提供]' : '[检索补充]'}
                        </span>
                        <span className="truncate text-xs font-semibold text-content-primary">
                          {src.title}
                        </span>
                        {src.provider && (
                          <span className="shrink-0 font-mono text-[10.5px] text-content-muted">
                            ({src.provider})
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSourceIndices((prev) =>
                              prev.includes(idx)
                                ? prev.filter((item) => item !== idx)
                                : [...prev, idx],
                            )
                          }
                          className="inline-flex items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-content-secondary hover:border-accent hover:text-accent"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="h-3 w-3" />
                              收起
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-3 w-3" />
                              展开 ({src.snippet.length} 字)
                            </>
                          )}
                        </button>
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
                        {canUpdate && (
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => void handleDeleteSource(idx, src.title)}
                            title="从引用库删除此条"
                            className="inline-flex items-center rounded p-1 text-content-muted transition hover:bg-status-danger/10 hover:text-status-danger disabled:opacity-45"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {isExpanded ? (
                      <p className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-sm border border-line-subtle bg-surface p-2.5 text-xs leading-relaxed text-content-secondary">
                        {src.snippet}
                      </p>
                    ) : (
                      <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-content-secondary">
                        {src.snippet}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
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

      {/* Regenerate confirmation modal */}
      {regenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-lg border border-line bg-elevated p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-content-primary">
                  确认执行「一键 AI 生成」？
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRegenerateModalOpen(false)}
                className="text-content-muted hover:text-content-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2.5 text-xs text-content-secondary">
              <p>
                将结合当前人设、已锁定区块以及
                {selectedSourceIndices.length > 0
                  ? `已勾选的 ${selectedSourceIndices.length} 条参考资料`
                  : '最新参考资料'}
                ，协同重写所有<strong className="text-content-primary">未锁定</strong>的角色卡区块。
              </p>

              <div className="rounded-sm border border-line-subtle bg-canvas p-2.5 space-y-1.5 text-[11px]">
                <div>
                  <span className="font-semibold text-content-primary">即将重写的区块：</span>
                  {LOCKABLE_FIELDS.filter((f) => !lockedFields.includes(f.key)).length > 0
                    ? LOCKABLE_FIELDS.filter((f) => !lockedFields.includes(f.key))
                        .map((f) => f.label)
                        .join('、')
                    : '（无，所有区块均已锁定）'}
                </div>
                {lockedFields.length > 0 && (
                  <div className="text-status-warning">
                    <span className="font-semibold">已锁定（跳过保护）：</span>
                    {LOCKABLE_FIELDS.filter((f) => lockedFields.includes(f.key))
                      .map((f) => f.label)
                      .join('、') || lockedFields.join('、')}
                  </div>
                )}
                <div className="text-content-muted">
                  注：角色名称与 TRPG 规则面板属性将自动原样保留；生成前会保存历史快照，随时可点击「撤回上一版」恢复。
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-content-primary">
                  补充整体生成要求（可选）
                </label>
                <textarea
                  rows={2}
                  value={regenerateInstruction}
                  onChange={(e) => setRegenerateInstruction(e.target.value)}
                  placeholder="例如：整体文风更偏冷峻写实，强化后期剧情转折..."
                  className="w-full rounded-sm border border-line bg-surface p-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRegenerateModalOpen(false)}
                className="h-8 rounded-sm border border-line px-3 text-xs text-content-secondary hover:bg-subtle"
              >
                取消
              </button>
              <button
                type="button"
                disabled={
                  LOCKABLE_FIELDS.filter((f) => !lockedFields.includes(f.key)).length === 0
                }
                onClick={() => void handleConfirmRegenerate()}
                className="inline-flex h-8 items-center gap-1 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
              >
                <Wand2 className="h-3.5 w-3.5" />
                确认开始生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lossy semantic compress warning modal */}
      {compressModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-lg border border-line bg-elevated p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-status-warning" />
                <h3 className="text-sm font-semibold text-content-primary">
                  有损语义精简风险提示
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCompressModalOpen(false)}
                className="text-content-muted hover:text-content-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2.5 text-xs leading-relaxed text-content-secondary">
              <div className="rounded-sm border border-status-warning/40 bg-status-warning/10 p-2.5 text-status-warning">
                <strong>注意：精简并非“无损压缩”。</strong>
                系统将调用大模型把正文浓缩至约 1200 tokens，过程中可能会删减部分背景细节、对话范例或口癖描写，<strong>角色扮演精准度可能会受到一定影响</strong>。
              </div>
              <p>
                当前角色卡约 <strong className="font-mono text-content-primary">{card.tokenCount} tokens</strong>。
              </p>
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-content-muted">
                <li>「TRPG 规则面板属性 (CoC 7e / D&amp;D 5e)」不计入上下文 Token，本次精简将<strong>完整豁免</strong>，不会被改写。</li>
                <li>所有已锁定的区块将保持原样，不参与精简。</li>
                <li>精简前系统会自动保存当前版本快照，若效果不理想可随时点击「撤回上一版」。</li>
              </ul>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompressModalOpen(false)}
                className="h-8 rounded-sm border border-line px-3 text-xs text-content-secondary hover:bg-subtle"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCompress()}
                className="inline-flex h-8 items-center gap-1 rounded-sm bg-status-warning px-3 text-xs font-medium text-content-inverse hover:opacity-90"
              >
                <Minimize2 className="h-3.5 w-3.5" />
                已知晓风险，确认精简
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TrpgPanelView({
  systemKind,
  trpg,
  canEdit,
  saving,
  onSave,
}: {
  systemKind?: TrpgSystemKey;
  trpg: Record<string, unknown>;
  canEdit: boolean;
  saving: boolean;
  onSave: (nextTrpg: Record<string, unknown>) => Promise<void>;
}) {
  const sysText = String(trpg.system ?? '');
  const isCoc = systemKind
    ? systemKind === 'coc7e'
    : sysText.toLowerCase().includes('cthulhu') ||
      sysText.toLowerCase().includes('coc') ||
      (typeof trpg.characteristics === 'object' && trpg.characteristics !== null);

  const asRec = (val: unknown): Record<string, unknown> =>
    typeof val === 'object' && val !== null && !Array.isArray(val)
      ? (val as Record<string, unknown>)
      : {};
  const asArr = (val: unknown): string[] =>
    Array.isArray(val) ? val.map((x) => String(x ?? '').trim()).filter(Boolean) : [];

  const [editingTrpg, setEditingTrpg] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [trpgDraft, setTrpgDraft] = useState<Record<string, unknown>>(() => structuredClone(trpg));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(trpg, null, 2));
  const [trpgEditError, setTrpgEditError] = useState<string | null>(null);

  useEffect(() => {
    setTrpgDraft(structuredClone(trpg));
    setJsonText(JSON.stringify(trpg, null, 2));
    setEditingTrpg(false);
    setJsonMode(false);
    setTrpgEditError(null);
  }, [trpg, systemKind]);

  const handleEnterEdit = () => {
    setTrpgDraft(structuredClone(trpg));
    setJsonText(JSON.stringify(trpg, null, 2));
    setTrpgEditError(null);
    setEditingTrpg(true);
  };

  const handleSaveTrpgEdit = async () => {
    setTrpgEditError(null);
    let payload: Record<string, unknown> = trpgDraft;
    if (jsonMode) {
      try {
        const parsed = JSON.parse(jsonText);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setTrpgEditError('JSON 根节点必须是对象');
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch (err) {
        setTrpgEditError(err instanceof Error ? `JSON 格式无效：${err.message}` : 'JSON 格式无效');
        return;
      }
    }
    try {
      await onSave(payload);
      setEditingTrpg(false);
    } catch {
      // Error already surfaced via parent handler
    }
  };

  if (editingTrpg) {
    const cocOrder = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'] as const;
    const cocDerivedOrder = ['HP', 'MP', 'SAN', 'Luck', 'Move'] as const;
    const dndOrder = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;
    const dndCombatOrder = ['AC', 'MaxHP', 'Speed', 'ProficiencyBonus'] as const;

    const draftChars = asRec(trpgDraft.characteristics);
    const draftDerived = asRec(trpgDraft.derived);
    const draftAbilities = asRec(trpgDraft.abilityScores);
    const draftCombat = asRec(trpgDraft.combat);

    return (
      <div className="space-y-3 rounded-sm border border-accent/40 bg-surface p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-2">
          <span className="font-semibold text-content-primary">
            编辑 {isCoc ? 'CoC 7e 调查员' : 'D&D 5e 冒险者'}属性
          </span>
          <button
            type="button"
            onClick={() => {
              if (!jsonMode) {
                setJsonText(JSON.stringify(trpgDraft, null, 2));
                setJsonMode(true);
              } else {
                try {
                  const parsed = JSON.parse(jsonText);
                  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    setTrpgDraft(parsed as Record<string, unknown>);
                  }
                } catch {
                  // Ignore invalid intermediate JSON when switching back
                }
                setJsonMode(false);
              }
              setTrpgEditError(null);
            }}
            className="rounded border border-line bg-canvas px-2 py-0.5 text-[11px] text-content-secondary hover:border-accent hover:text-accent"
          >
            {jsonMode ? '切换表单编辑' : '切换原始 JSON'}
          </button>
        </div>

        {trpgEditError && (
          <div className="rounded-sm border border-status-danger/40 bg-status-danger/10 px-2.5 py-1.5 text-[11px] text-status-danger">
            {trpgEditError}
          </div>
        )}

        {jsonMode ? (
          <textarea
            rows={12}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="w-full rounded-sm border border-line bg-canvas p-2 font-mono text-[11px] leading-relaxed text-content-primary outline-none focus:border-accent"
          />
        ) : isCoc ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[11px] text-content-muted">职业 (occupation)</span>
                <input
                  type="text"
                  value={String(trpgDraft.occupation ?? '')}
                  onChange={(e) => setTrpgDraft({ ...trpgDraft, occupation: e.target.value })}
                  className="h-7 w-full rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-content-muted">年代 (era)</span>
                <input
                  type="text"
                  value={String(trpgDraft.era ?? '')}
                  onChange={(e) => setTrpgDraft({ ...trpgDraft, era: e.target.value })}
                  className="h-7 w-full rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-content-muted">基础属性 (0-99)</span>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {cocOrder.map((k) => {
                  const val = Number(draftChars[k] ?? 50);
                  return (
                    <div key={k} className="rounded-sm border border-line bg-canvas p-1.5 text-center">
                      <div className="text-[10px] font-medium text-content-muted">{k}</div>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={Number.isFinite(val) ? val : 50}
                        onChange={(e) => {
                          const nextVal = Math.max(0, Number(e.target.value) || 0);
                          setTrpgDraft({
                            ...trpgDraft,
                            characteristics: { ...draftChars, [k]: nextVal },
                          });
                        }}
                        className="mt-0.5 h-6 w-full rounded-sm border border-line bg-surface text-center font-mono text-xs font-semibold text-content-primary outline-none focus:border-accent"
                      />
                      <div className="mt-0.5 font-mono text-[10px] text-content-muted">
                        {Math.floor(val / 2)} / {Math.floor(val / 5)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-content-muted">派生属性</span>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {cocDerivedOrder.map((k) => (
                  <label key={k} className="space-y-0.5">
                    <span className="block text-[10px] text-content-muted">{k}</span>
                    <input
                      type="number"
                      value={Number(draftDerived[k] ?? 0)}
                      onChange={(e) =>
                        setTrpgDraft({
                          ...trpgDraft,
                          derived: { ...draftDerived, [k]: Number(e.target.value) || 0 },
                        })
                      }
                      className="h-7 w-full rounded-sm border border-line bg-canvas px-2 font-mono text-xs text-content-primary outline-none focus:border-accent"
                    />
                  </label>
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="block text-[11px] text-content-muted">核心技能（逗号、顿号或换行分隔）</span>
              <textarea
                rows={2}
                value={asArr(trpgDraft.keySkills).join('、')}
                onChange={(e) =>
                  setTrpgDraft({
                    ...trpgDraft,
                    keySkills: e.target.value
                      .split(/[、,，\n]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full rounded-sm border border-line bg-canvas p-2 text-xs text-content-primary outline-none focus:border-accent"
              />
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="space-y-1">
                <span className="block text-[11px] text-content-muted">等级 (level)</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={Number(trpgDraft.level ?? 1)}
                  onChange={(e) =>
                    setTrpgDraft({ ...trpgDraft, level: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="h-7 w-full rounded-sm border border-line bg-canvas px-2 font-mono text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-content-muted">种族 (race)</span>
                <input
                  type="text"
                  value={String(trpgDraft.race ?? '')}
                  onChange={(e) => setTrpgDraft({ ...trpgDraft, race: e.target.value })}
                  className="h-7 w-full rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-content-muted">职业 (className)</span>
                <input
                  type="text"
                  value={String(trpgDraft.className ?? '')}
                  onChange={(e) => setTrpgDraft({ ...trpgDraft, className: e.target.value })}
                  className="h-7 w-full rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-content-muted">阵营 (alignment)</span>
                <input
                  type="text"
                  value={String(trpgDraft.alignment ?? '')}
                  onChange={(e) => setTrpgDraft({ ...trpgDraft, alignment: e.target.value })}
                  className="h-7 w-full rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-content-muted">六维属性 (1-30)</span>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {dndOrder.map((k) => {
                  const score = Number(draftAbilities[k] ?? 10);
                  const mod = Math.floor((score - 10) / 2);
                  return (
                    <div key={k} className="rounded-sm border border-line bg-canvas p-1.5 text-center">
                      <div className="text-[10px] font-medium text-content-muted">{k}</div>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={Number.isFinite(score) ? score : 10}
                        onChange={(e) => {
                          const nextScore = Math.max(1, Number(e.target.value) || 1);
                          setTrpgDraft({
                            ...trpgDraft,
                            abilityScores: { ...draftAbilities, [k]: nextScore },
                          });
                        }}
                        className="mt-0.5 h-6 w-full rounded-sm border border-line bg-surface text-center font-mono text-xs font-semibold text-content-primary outline-none focus:border-accent"
                      />
                      <div className="mt-0.5 font-mono text-[10px] text-accent">
                        {mod >= 0 ? `+${mod}` : String(mod)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] text-content-muted">战斗数值</span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {dndCombatOrder.map((k) => (
                  <label key={k} className="space-y-0.5">
                    <span className="block text-[10px] text-content-muted">{k}</span>
                    <input
                      type="text"
                      value={String(draftCombat[k] ?? '')}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const parsed = k === 'Speed' ? raw : Number(raw);
                        setTrpgDraft({
                          ...trpgDraft,
                          combat: {
                            ...draftCombat,
                            [k]: k !== 'Speed' && raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw,
                          },
                        });
                      }}
                      className="h-7 w-full rounded-sm border border-line bg-canvas px-2 font-mono text-xs text-content-primary outline-none focus:border-accent"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="block text-[11px] text-content-muted">熟练项（顿号、逗号或换行分隔）</span>
                <textarea
                  rows={2}
                  value={asArr(trpgDraft.proficiencies).join('、')}
                  onChange={(e) =>
                    setTrpgDraft({
                      ...trpgDraft,
                      proficiencies: e.target.value
                        .split(/[、,，\n]+/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full rounded-sm border border-line bg-canvas p-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-content-muted">特性与专长（顿号、逗号或换行分隔）</span>
                <textarea
                  rows={2}
                  value={asArr(trpgDraft.featuresAndTraits).join('、')}
                  onChange={(e) =>
                    setTrpgDraft({
                      ...trpgDraft,
                      featuresAndTraits: e.target.value
                        .split(/[、,，\n]+/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full rounded-sm border border-line bg-canvas p-2 text-xs text-content-primary outline-none focus:border-accent"
                />
              </label>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line-subtle pt-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditingTrpg(false)}
            className="h-7 rounded-sm border border-line px-2.5 text-[11px] text-content-secondary hover:bg-subtle"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveTrpgEdit()}
            className="inline-flex h-7 items-center gap-1 rounded-sm bg-status-success px-2.5 text-[11px] font-medium text-content-inverse hover:opacity-90 disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {saving ? '保存中...' : '保存 TRPG 属性'}
          </button>
        </div>
      </div>
    );
  }

  if (isCoc) {
    const chars = asRec(trpg.characteristics);
    const derived = asRec(trpg.derived);
    const skills = asArr(trpg.keySkills);
    const statOrder = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU'] as const;

    return (
      <div className="space-y-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-content-secondary">
          <div className="flex flex-wrap items-center gap-2">
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
          {canEdit && (
            <button
              type="button"
              onClick={handleEnterEdit}
              className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-content-secondary hover:border-accent hover:text-accent"
            >
              <Edit3 className="h-3 w-3" />
              编辑属性
            </button>
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
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-content-secondary">
        <div className="flex flex-wrap items-center gap-2">
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
        {canEdit && (
          <button
            type="button"
            onClick={handleEnterEdit}
            className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-content-secondary hover:border-accent hover:text-accent"
          >
            <Edit3 className="h-3 w-3" />
            编辑属性
          </button>
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

