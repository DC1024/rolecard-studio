import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  ImpressionEventDto,
  NotificationChannelDto,
  NotificationChannelSettings,
  NotificationChannelType,
  RippleProposalDto,
  SyncEventDto,
  SyncEventType,
  SyncSubscriptionDto,
} from '@rolecard/shared';
import {
  Activity,
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Copy,
  GitBranch,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';

interface ReviewSyncPanelProps {
  canResolveReview: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onNotify: (msg: string) => void;
  onRefreshCards: () => Promise<void>;
}

const ALL_EVENT_TYPES: { id: SyncEventType; label: string }[] = [
  { id: 'review.pending', label: '待审核提醒 (新提案)' },
  { id: 'card.updated', label: '卡片更新' },
  { id: 'card.evolved', label: '人设演化' },
  { id: 'lorebook.updated', label: '世界书变更' },
  { id: 'ripple.approved', label: '关系涟漪生效' },
];

const CHANNEL_TYPE_META: {
  id: NotificationChannelType;
  label: string;
  hint: string;
}[] = [
  { id: 'smtp', label: '邮件 (SMTP)', hint: '原生 TLS/STARTTLS SMTP 投递，适合个人邮箱/企业邮箱' },
  { id: 'feishu', label: '飞书机器人', hint: '自定义群机器人 Webhook，可选签名密钥' },
  { id: 'wecom', label: '企业微信机器人', hint: '企业微信群机器人 Webhook URL' },
  { id: 'dingtalk', label: '钉钉机器人', hint: '钉钉自定义机器人 Webhook，支持加签 Secret' },
  { id: 'telegram', label: 'Telegram Bot', hint: '需 Bot Token 与 Chat ID（支持自定义反代 API 基址）' },
  { id: 'discord', label: 'Discord Webhook', hint: '频道 Webhook URL，直接发送富文本卡片' },
  { id: 'bark', label: 'Bark (iOS)', hint: '填入服务器地址与 Device Key 推送 iOS 通知' },
  { id: 'serverchan', label: 'Server酱', hint: '填入 SendKey 推送微信服务号消息' },
  { id: 'webhook', label: '通用 Webhook', hint: '发送标准 JSON 事件载荷，可选 HMAC-SHA256 签名' },
];

function createEmptyChannelSettings(): NotificationChannelSettings {
  return {
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    smtpTo: '',
    webhookUrl: '',
    secret: '',
    telegramBotToken: '',
    telegramChatId: '',
    telegramApiBaseUrl: 'https://api.telegram.org',
    barkServerUrl: 'https://api.day.app',
    barkDeviceKey: '',
    barkGroup: 'RoleCardStudio',
    serverChanSendKey: '',
  };
}

/**
 * 判断通知渠道表单的必填项是否已填写完整（与 handleSaveChannel 及原生 required 保持一致）。
 * 编辑已有渠道时，若服务端已保存过敏感字段（masked），输入框留空视为有效。
 */
export function computeChannelFormValid(
  name: string,
  channelType: NotificationChannelType,
  settings: NotificationChannelSettings,
  editingChannelMasked: NotificationChannelDto['settingsMasked'] | null = null,
): boolean {
  if (!name.trim()) return false;
  const filled = (value: string | undefined) => Boolean(value && value.trim());

  switch (channelType) {
    case 'smtp':
      return filled(settings.smtpHost) && filled(settings.smtpFrom) && filled(settings.smtpTo);
    case 'telegram':
      return (
        filled(settings.telegramChatId) &&
        (filled(settings.telegramBotToken) || Boolean(editingChannelMasked?.hasTelegramBotToken))
      );
    case 'bark':
      return (
        filled(settings.barkServerUrl) &&
        (filled(settings.barkDeviceKey) || Boolean(editingChannelMasked?.hasBarkDeviceKey))
      );
    case 'serverchan':
      return (
        filled(settings.serverChanSendKey) || Boolean(editingChannelMasked?.hasServerChanSendKey)
      );
    default:
      // feishu / wecom / dingtalk / discord / webhook 均依赖 Webhook URL
      return filled(settings.webhookUrl);
  }
}

function dtoToEditableSettings(ch: NotificationChannelDto): NotificationChannelSettings {
  return {
    smtpHost: ch.settingsMasked.smtpHost,
    smtpPort: ch.settingsMasked.smtpPort,
    smtpSecure: ch.settingsMasked.smtpSecure,
    smtpUser: ch.settingsMasked.smtpUser,
    smtpPass: '',
    smtpFrom: ch.settingsMasked.smtpFrom,
    smtpTo: ch.settingsMasked.smtpTo,
    webhookUrl: ch.settingsMasked.webhookUrl,
    secret: '',
    telegramBotToken: '',
    telegramChatId: ch.settingsMasked.telegramChatId,
    telegramApiBaseUrl: ch.settingsMasked.telegramApiBaseUrl || 'https://api.telegram.org',
    barkServerUrl: ch.settingsMasked.barkServerUrl || 'https://api.day.app',
    barkDeviceKey: '',
    barkGroup: ch.settingsMasked.barkGroup || 'RoleCardStudio',
    serverChanSendKey: '',
  };
}

export function ReviewSyncPanel({
  canResolveReview,
  canUpdate,
  canDelete,
  onNotify,
  onRefreshCards,
}: ReviewSyncPanelProps) {
  const { copyWithToast } = useToast();
  const [tab, setTab] = useState<'reviews' | 'notifications' | 'sync'>('reviews');
  const [impressions, setImpressions] = useState<ImpressionEventDto[]>([]);
  const [ripples, setRipples] = useState<RippleProposalDto[]>([]);
  const [subscriptions, setSubscriptions] = useState<SyncSubscriptionDto[]>([]);
  const [channels, setChannels] = useState<NotificationChannelDto[]>([]);
  const [events, setEvents] = useState<SyncEventDto[]>([]);
  const [sseConnected, setSseConnected] = useState(false);

  const [subName, setSubName] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [subEvents, setSubEvents] = useState<SyncEventType[]>(['card.updated', 'card.evolved']);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editingChannelMasked, setEditingChannelMasked] = useState<
    NotificationChannelDto['settingsMasked'] | null
  >(null);
  const [chName, setChName] = useState('');
  const [chType, setChType] = useState<NotificationChannelType>('feishu');
  const [chEnabled, setChEnabled] = useState(true);
  const [chEvents, setChEvents] = useState<SyncEventType[]>(['review.pending', 'card.evolved']);
  const [chSettings, setChSettings] = useState<NotificationChannelSettings>(
    createEmptyChannelSettings,
  );
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);

  const channelFormValid = useMemo(
    () => computeChannelFormValid(chName, chType, chSettings, editingChannelMasked),
    [chName, chType, chSettings, editingChannelMasked],
  );
  const canSubmitChannel = channelFormValid && chEvents.length > 0;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [revRes, subRes, evtRes, chRes] = await Promise.all([
        api.listReviews(),
        api.listSyncSubscriptions(),
        api.listSyncEvents(0, 30),
        api.listNotificationChannels(),
      ]);
      setImpressions(revRes.impressions);
      setRipples(revRes.ripples);
      setSubscriptions(subRes.items);
      setEvents([...evtRes.items].reverse());
      setChannels(chRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审核与同步数据失败');
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const source = new EventSource('/api/v1/sync/stream?since_cursor=0', {
      withCredentials: true,
    });
    source.onopen = () => setSseConnected(true);
    source.onerror = () => setSseConnected(false);

    const handleSyncEvt = (evt: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(evt.data)) as SyncEventDto;
        let isNewEvent = false;
        setEvents((prev) => {
          if (prev.some((p) => p.id === parsed.id)) return prev;
          isNewEvent = true;
          return [parsed, ...prev].slice(0, 30);
        });
        if (isNewEvent && parsed.eventType === 'review.pending') {
          void loadData();
        }
      } catch {
        // ignore malformed frames
      }
    };

    for (const evtType of ALL_EVENT_TYPES) {
      source.addEventListener(evtType.id, handleSyncEvt as EventListener);
    }

    return () => {
      source.close();
      setSseConnected(false);
    };
  }, [loadData]);

  const handleResolveImpression = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.resolveImpression(id, { decision });
      onNotify(
        decision === 'approve'
          ? `演化提案已应用${res.ripplesCreated ? `，并生成 ${res.ripplesCreated} 条 1-hop 涟漪建议` : ''}`
          : '已驳回该演化提案',
      );
      await loadData();
      await onRefreshCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理演化提案失败');
    } finally {
      setBusy(false);
    }
  };

  const handleResolveRipple = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      await api.resolveRipple(id, { decision });
      onNotify(decision === 'approve' ? '关系涟漪已写入目标角色卡' : '已驳回关系涟漪');
      await loadData();
      await onRefreshCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理关系涟漪失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateSubscription = async (e: FormEvent) => {
    e.preventDefault();
    if (!subName.trim() || !subUrl.trim() || subEvents.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createSyncSubscription({
        name: subName.trim(),
        webhookUrl: subUrl.trim(),
        events: subEvents,
      });
      setCreatedSecret(res.secret);
      setSubName('');
      setSubUrl('');
      onNotify('Webhook 同步订阅创建成功');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建同步订阅失败');
    } finally {
      setBusy(false);
    }
  };

  const handleRunTick = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.triggerEvolutionTick();
      onNotify(`周期巡检完成：检查 ${res.checked} 项，演化 ${res.evolved} 项，跳过 ${res.skipped} 项`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发演化巡检失败');
    } finally {
      setBusy(false);
    }
  };

  const resetChannelForm = () => {
    setEditingChannelId(null);
    setEditingChannelMasked(null);
    setChName('');
    setChType('feishu');
    setChEnabled(true);
    setChEvents(['review.pending', 'card.evolved']);
    setChSettings(createEmptyChannelSettings());
  };

  const handleEditChannel = (ch: NotificationChannelDto) => {
    setEditingChannelId(ch.id);
    setEditingChannelMasked(ch.settingsMasked);
    setChName(ch.name);
    setChType(ch.channelType);
    setChEnabled(ch.enabled);
    setChEvents(ch.events.length > 0 ? ch.events : ['review.pending']);
    setChSettings(dtoToEditableSettings(ch));
  };

  const handleSaveChannel = async (e: FormEvent) => {
    e.preventDefault();
    if (!chName.trim() || chEvents.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: chName.trim(),
        channelType: chType,
        enabled: chEnabled,
        events: chEvents,
        settings: chSettings,
      };
      if (editingChannelId) {
        await api.updateNotificationChannel(editingChannelId, payload);
        onNotify(`已更新通知渠道：${chName.trim()}`);
      } else {
        await api.createNotificationChannel(payload);
        onNotify(`已添加通知渠道：${chName.trim()}`);
      }
      resetChannelForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存通知渠道失败');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleChannelEnabled = async (ch: NotificationChannelDto) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateNotificationChannel(ch.id, {
        name: ch.name,
        channelType: ch.channelType,
        enabled: !ch.enabled,
        events: ch.events.length > 0 ? ch.events : ['review.pending'],
        settings: dtoToEditableSettings(ch),
      });
      onNotify(`${ch.name} 已${ch.enabled ? '暂停' : '启用'}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换渠道状态失败');
    } finally {
      setBusy(false);
    }
  };

  const handleTestChannel = async (ch: NotificationChannelDto) => {
    setTestingChannelId(ch.id);
    setError(null);
    try {
      const res = await api.testNotificationChannel(ch.id);
      onNotify(`测试通知发送成功 (${ch.name})：${res.message}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试通知发送失败');
      await loadData();
    } finally {
      setTestingChannelId(null);
    }
  };

  const handleDeleteChannel = async (ch: NotificationChannelDto) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteNotificationChannel(ch.id);
      if (editingChannelId === ch.id) {
        resetChannelForm();
      }
      onNotify(`已删除通知渠道：${ch.name}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除通知渠道失败');
    } finally {
      setBusy(false);
    }
  };

  const pendingCount =
    impressions.filter((i) => i.status === 'pending_review').length +
    ripples.filter((r) => r.status === 'pending_review').length;

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-content-primary">
            <Bell className="h-4 w-4 text-accent" />
            演化审核与实时同步中心
            {pendingCount > 0 && (
              <span className="rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
                {pendingCount} 待审核
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-content-muted">
            人设周期演化与 1-hop 关系涟漪均进入人工收件箱审核；变更通过 SSE 与 HMAC-SHA256 Webhook 实时下发。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              sseConnected
                ? 'border-status-success/40 bg-status-success/10 text-status-success'
                : 'border-line bg-subtle text-content-muted'
            }`}
          >
            <Radio className="h-3 w-3" />
            {sseConnected ? 'SSE 实时流已连接' : 'SSE 未连接'}
          </span>
          {canUpdate && (
            <button
              type="button"
              disabled={busy}
              onClick={handleRunTick}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-primary hover:bg-subtle disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              立即巡检到期任务
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line-subtle">
        <button
          type="button"
          onClick={() => setTab('reviews')}
          className={`border-b-2 px-3 py-2 text-xs font-medium transition ${
            tab === 'reviews'
              ? 'border-accent text-accent'
              : 'border-transparent text-content-secondary hover:text-content-primary'
          }`}
        >
          审核收件箱 ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => setTab('notifications')}
          className={`border-b-2 px-3 py-2 text-xs font-medium transition ${
            tab === 'notifications'
              ? 'border-accent text-accent'
              : 'border-transparent text-content-secondary hover:text-content-primary'
          }`}
        >
          多渠道审核通知 ({channels.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('sync')}
          className={`border-b-2 px-3 py-2 text-xs font-medium transition ${
            tab === 'sync'
              ? 'border-accent text-accent'
              : 'border-transparent text-content-secondary hover:text-content-primary'
          }`}
        >
          实时同步与 Webhook ({subscriptions.length})
        </button>
      </div>

      {error && (
        <div className="rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {error}
        </div>
      )}

      {tab === 'reviews' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-content-primary">
              <Activity className="h-3.5 w-3.5 text-accent" />
              人设演化提案 ({impressions.length})
            </h3>
            {impressions.length === 0 ? (
              <div className="rounded-md border border-dashed border-line bg-canvas p-4 text-center text-xs text-content-muted">
                暂无演化提案（定时更新默认关闭，可在角色卡详情页按需开启或手动触发）
              </div>
            ) : (
              impressions.map((imp) => (
                <div
                  key={imp.id}
                  className="space-y-2 rounded-md border border-line bg-canvas p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-content-primary">
                        {imp.characterName}
                      </span>
                      <span className="ml-2 text-[11px] text-content-muted">
                        {imp.eventType}
                      </span>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                        imp.status === 'pending_review'
                          ? 'bg-status-warning/15 text-status-warning'
                          : imp.status === 'applied'
                            ? 'bg-status-success/15 text-status-success'
                            : 'bg-subtle text-content-muted'
                      }`}
                    >
                      {imp.status === 'pending_review'
                        ? '待审核'
                        : imp.status === 'applied'
                          ? '已应用'
                          : '已驳回'}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-content-secondary">
                    变更字段：<span className="font-mono">{imp.diffSummary || '无'}</span>
                  </p>
                  <div className="rounded-sm border border-line-subtle bg-surface p-2 text-[11px] text-content-secondary">
                    新摘要预览：{imp.afterContent.summary}
                  </div>
                  {imp.status === 'pending_review' && canResolveReview && (
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolveImpression(imp.id, 'reject')}
                        className="inline-flex h-7 items-center gap-1 rounded-sm border border-line px-2.5 text-[11px] text-content-secondary hover:bg-subtle"
                      >
                        <X className="h-3 w-3" />
                        驳回
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolveImpression(imp.id, 'approve')}
                        className="inline-flex h-7 items-center gap-1 rounded-sm bg-status-success px-2.5 text-[11px] font-medium text-content-inverse hover:opacity-90"
                      >
                        <Check className="h-3 w-3" />
                        批准并生成 1-hop 涟漪
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-content-primary">
              <GitBranch className="h-3.5 w-3.5 text-accent" />
              单跳关系涟漪建议 (max_hop = 1, {ripples.length})
            </h3>
            {ripples.length === 0 ? (
              <div className="rounded-md border border-dashed border-line bg-canvas p-4 text-center text-xs text-content-muted">
                暂无关系涟漪建议（同处一个世界书的角色演化获批后会自动触发 1-hop 检视）
              </div>
            ) : (
              ripples.map((rip) => (
                <div
                  key={rip.id}
                  className="space-y-2 rounded-md border border-line bg-canvas p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-content-primary">
                      {rip.sourceCharacterName} → {rip.targetCharacterName}
                      <span className="ml-1.5 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                        hop={rip.hop}
                      </span>
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                        rip.status === 'pending_review'
                          ? 'bg-status-warning/15 text-status-warning'
                          : rip.status === 'approved'
                            ? 'bg-status-success/15 text-status-success'
                            : 'bg-subtle text-content-muted'
                      }`}
                    >
                      {rip.status === 'pending_review'
                        ? '待审核'
                        : rip.status === 'approved'
                          ? '已采纳'
                          : '已忽略'}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-content-secondary">{rip.proposedAttitude}</p>
                  <p className="text-[11px] text-content-muted">{rip.reason}</p>
                  {rip.status === 'pending_review' && canResolveReview && (
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolveRipple(rip.id, 'reject')}
                        className="inline-flex h-7 items-center gap-1 rounded-sm border border-line px-2.5 text-[11px] text-content-secondary hover:bg-subtle"
                      >
                        <X className="h-3 w-3" />
                        忽略
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResolveRipple(rip.id, 'approve')}
                        className="inline-flex h-7 items-center gap-1 rounded-sm bg-accent px-2.5 text-[11px] font-medium text-content-inverse hover:bg-accent-hover"
                      >
                        <Check className="h-3 w-3" />
                        同步至目标角色卡
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : tab === 'notifications' ? (
        <div className="space-y-4">
          <div className="rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-xs text-content-secondary">
            所有已启用的发信渠道具备<strong className="text-content-primary">相同优先级</strong>，当产生待审核提案（
            <code className="font-mono text-[11px]">review.pending</code>）或人设演化事件时将并发推送，任一渠道失败不影响其余渠道投递。
          </div>

          {canUpdate && (
            <form
              onSubmit={handleSaveChannel}
              className="space-y-3 rounded-md border border-line bg-canvas p-3.5 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-content-primary">
                  <Mail className="h-3.5 w-3.5 text-accent" />
                  {editingChannelId ? '编辑通知渠道' : '新增审核通知渠道'}
                </div>
                {editingChannelId && (
                  <button
                    type="button"
                    onClick={resetChannelForm}
                    className="inline-flex items-center gap-1 text-[11px] text-content-muted hover:text-content-primary"
                  >
                    <X className="h-3 w-3" />
                    取消编辑
                  </button>
                )}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-3">
                <input
                  type="text"
                  required
                  value={chName}
                  onChange={(e) => setChName(e.target.value)}
                  placeholder="渠道名称，如：我的邮件 / 审核飞书群"
                  className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary outline-none focus:border-accent"
                />
                <select
                  value={chType}
                  disabled={Boolean(editingChannelId)}
                  onChange={(e) => setChType(e.target.value as NotificationChannelType)}
                  className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary outline-none focus:border-accent disabled:opacity-60"
                >
                  {CHANNEL_TYPE_META.map((meta) => (
                    <option key={meta.id} value={meta.id}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                <label className="flex h-8 cursor-pointer items-center justify-between rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary">
                  <span>启用该渠道</span>
                  <input
                    type="checkbox"
                    checked={chEnabled}
                    onChange={(e) => setChEnabled(e.target.checked)}
                    className="h-4 w-4 accent-accent"
                  />
                </label>
              </div>

              <p className="text-[11px] text-content-muted">
                {CHANNEL_TYPE_META.find((m) => m.id === chType)?.hint}
              </p>

              {chType === 'smtp' && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    required
                    value={chSettings.smtpHost}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, smtpHost: e.target.value }))
                    }
                    placeholder="SMTP 主机，如 smtp.qq.com"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={chSettings.smtpPort}
                    onChange={(e) =>
                      setChSettings((prev) => ({
                        ...prev,
                        smtpPort: Number(e.target.value) || 465,
                      }))
                    }
                    placeholder="端口 (465 / 587 / 25)"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <label className="flex h-8 cursor-pointer items-center justify-between rounded-sm border border-line bg-surface px-2.5 text-xs text-content-secondary">
                    <span>TLS / STARTTLS 加密</span>
                    <input
                      type="checkbox"
                      checked={chSettings.smtpSecure}
                      onChange={(e) =>
                        setChSettings((prev) => ({ ...prev, smtpSecure: e.target.checked }))
                      }
                      className="accent-accent"
                    />
                  </label>
                  <input
                    type="text"
                    value={chSettings.smtpUser}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, smtpUser: e.target.value }))
                    }
                    placeholder="登录用户名（可选）"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="password"
                    value={chSettings.smtpPass}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, smtpPass: e.target.value }))
                    }
                    placeholder={
                      editingChannelMasked?.hasSmtpPass
                        ? `授权码/密码（已配置 ${editingChannelMasked.smtpPassMasked}，留空不修改）`
                        : 'SMTP 密码或授权码'
                    }
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="email"
                    required
                    value={chSettings.smtpFrom}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, smtpFrom: e.target.value }))
                    }
                    placeholder="发件人邮箱 From"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="text"
                    required
                    value={chSettings.smtpTo}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, smtpTo: e.target.value }))
                    }
                    placeholder="收件人邮箱 To（多个可用逗号分隔）"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary sm:col-span-3"
                  />
                </div>
              )}

              {(chType === 'feishu' ||
                chType === 'wecom' ||
                chType === 'dingtalk' ||
                chType === 'discord' ||
                chType === 'webhook') && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="url"
                    required
                    value={chSettings.webhookUrl}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, webhookUrl: e.target.value }))
                    }
                    placeholder="https://... 机器人 / Webhook 地址"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  {(chType === 'feishu' || chType === 'dingtalk' || chType === 'webhook') && (
                    <input
                      type="password"
                      value={chSettings.secret}
                      onChange={(e) =>
                        setChSettings((prev) => ({ ...prev, secret: e.target.value }))
                      }
                      placeholder={
                        editingChannelMasked?.hasSecret
                          ? `签名密钥（已配置 ${editingChannelMasked.secretMasked}，留空不修改）`
                          : '签名密钥 Secret（可选）'
                      }
                      className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                    />
                  )}
                </div>
              )}

              {chType === 'telegram' && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="password"
                    required={!editingChannelMasked?.hasTelegramBotToken}
                    value={chSettings.telegramBotToken}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, telegramBotToken: e.target.value }))
                    }
                    placeholder={
                      editingChannelMasked?.hasTelegramBotToken
                        ? `Bot Token（已配置 ${editingChannelMasked.telegramBotTokenMasked}，留空不修改）`
                        : 'Bot Token（如 123456:ABC...）'
                    }
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="text"
                    required
                    value={chSettings.telegramChatId}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, telegramChatId: e.target.value }))
                    }
                    placeholder="Chat ID（如 -100123456789）"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="url"
                    value={chSettings.telegramApiBaseUrl}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, telegramApiBaseUrl: e.target.value }))
                    }
                    placeholder="https://api.telegram.org"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                </div>
              )}

              {chType === 'bark' && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="url"
                    required
                    value={chSettings.barkServerUrl}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, barkServerUrl: e.target.value }))
                    }
                    placeholder="https://api.day.app"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="password"
                    required={!editingChannelMasked?.hasBarkDeviceKey}
                    value={chSettings.barkDeviceKey}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, barkDeviceKey: e.target.value }))
                    }
                    placeholder={
                      editingChannelMasked?.hasBarkDeviceKey
                        ? `Device Key（已配置 ${editingChannelMasked.barkDeviceKeyMasked}，留空不修改）`
                        : 'Bark Device Key'
                    }
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                  <input
                    type="text"
                    value={chSettings.barkGroup}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, barkGroup: e.target.value }))
                    }
                    placeholder="通知分组名（默认 RoleCardStudio）"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary"
                  />
                </div>
              )}

              {chType === 'serverchan' && (
                <div>
                  <input
                    type="password"
                    required={!editingChannelMasked?.hasServerChanSendKey}
                    value={chSettings.serverChanSendKey}
                    onChange={(e) =>
                      setChSettings((prev) => ({ ...prev, serverChanSendKey: e.target.value }))
                    }
                    placeholder={
                      editingChannelMasked?.hasServerChanSendKey
                        ? `Server酱 SendKey（已配置 ${editingChannelMasked.serverChanSendKeyMasked}，留空不修改）`
                        : 'Server酱 SendKey（如 SCT...）'
                    }
                    className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {ALL_EVENT_TYPES.map((evt) => {
                    const checked = chEvents.includes(evt.id);
                    return (
                      <label
                        key={evt.id}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 text-[11px] text-content-secondary"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setChEvents((prev) =>
                              checked ? prev.filter((x) => x !== evt.id) : [...prev, evt.id],
                            )
                          }
                          className="accent-accent"
                        />
                        {evt.label}
                      </label>
                    );
                  })}
                </div>

                <button
                  type="submit"
                  disabled={busy || !canSubmitChannel}
                  className="inline-flex h-8 items-center gap-1 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {editingChannelId ? '保存修改' : '添加渠道'}
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-content-primary">
              已配置通知渠道 ({channels.length})
            </h3>
            {channels.length === 0 ? (
              <p className="rounded-md border border-dashed border-line p-5 text-center text-xs text-content-muted">
                尚未配置通知渠道。上方支持添加邮件 (SMTP)、飞书、企业微信、钉钉、Telegram、Discord、Bark、Server酱与通用 Webhook。
              </p>
            ) : (
              <div className="grid gap-2.5 lg:grid-cols-2">
                {channels.map((ch) => {
                  const typeLabel =
                    CHANNEL_TYPE_META.find((m) => m.id === ch.channelType)?.label ?? ch.channelType;
                  return (
                    <div
                      key={ch.id}
                      className="flex flex-col justify-between gap-2.5 rounded-md border border-line bg-canvas p-3 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-content-primary">{ch.name}</span>
                            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                              {typeLabel}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                                ch.enabled
                                  ? 'bg-status-success/15 text-status-success'
                                  : 'bg-subtle text-content-muted'
                              }`}
                            >
                              {ch.enabled ? '已启用' : '已暂停'}
                            </span>
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-content-muted">
                            {ch.channelType === 'smtp'
                              ? `${ch.settingsMasked.smtpHost}:${ch.settingsMasked.smtpPort} -> ${ch.settingsMasked.smtpTo}`
                              : ch.channelType === 'telegram'
                                ? `Chat ${ch.settingsMasked.telegramChatId} (${ch.settingsMasked.telegramBotTokenMasked ?? ''})`
                                : ch.channelType === 'bark'
                                  ? `${ch.settingsMasked.barkServerUrl} [${ch.settingsMasked.barkGroup}]`
                                  : ch.channelType === 'serverchan'
                                    ? `SendKey ${ch.settingsMasked.serverChanSendKeyMasked ?? ''}`
                                    : ch.settingsMasked.webhookUrl}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {ch.events.map((evtId) => (
                              <span
                                key={evtId}
                                className="rounded-sm border border-line-subtle bg-surface px-1.5 py-0.5 text-[10px] text-content-secondary"
                              >
                                {ALL_EVENT_TYPES.find((e) => e.id === evtId)?.label ?? evtId}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-2">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          {ch.lastStatus === 'success' ? (
                            <span className="inline-flex items-center gap-1 text-status-success">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              最近投递成功
                              {ch.lastSentAt ? ` (${new Date(ch.lastSentAt).toLocaleTimeString()})` : ''}
                            </span>
                          ) : ch.lastStatus === 'error' ? (
                            <span
                              className="inline-flex items-center gap-1 text-status-danger"
                              title={ch.lastError ?? ''}
                            >
                              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                              <span className="max-w-[220px] truncate">
                                失败：{ch.lastError ?? '未知错误'}
                              </span>
                            </span>
                          ) : (
                            <span className="text-content-muted">尚未投递</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          {canUpdate && (
                            <>
                              <button
                                type="button"
                                disabled={busy || testingChannelId === ch.id}
                                onClick={() => void handleTestChannel(ch)}
                                className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-[11px] font-medium text-content-primary hover:border-accent hover:text-accent disabled:opacity-50"
                              >
                                <Send className="h-3 w-3" />
                                {testingChannelId === ch.id ? '发送中...' : '测试'}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleToggleChannelEnabled(ch)}
                                className="inline-flex h-7 items-center rounded-sm border border-line bg-surface px-2 text-[11px] text-content-secondary hover:text-content-primary"
                              >
                                {ch.enabled ? '暂停' : '启用'}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleEditChannel(ch)}
                                className="rounded-sm p-1.5 text-content-muted hover:bg-subtle hover:text-content-primary"
                                title="编辑渠道"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleDeleteChannel(ch)}
                              className="rounded-sm p-1.5 text-content-muted hover:bg-status-danger/10 hover:text-status-danger"
                              title="删除渠道"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {canUpdate && (
            <form
              onSubmit={handleCreateSubscription}
              className="space-y-3 rounded-md border border-line bg-canvas p-3.5 text-xs"
            >
              <div className="flex items-center gap-1.5 font-semibold text-content-primary">
                <Webhook className="h-3.5 w-3.5 text-accent" />
                新建 HMAC-SHA256 Webhook 同步订阅
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  type="text"
                  required
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  placeholder="客户端名称，如：Obsidian 设定库"
                  className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary outline-none focus:border-accent"
                />
                <input
                  type="url"
                  required
                  value={subUrl}
                  onChange={(e) => setSubUrl(e.target.value)}
                  placeholder="https://example.com/rolecard-webhook"
                  className="h-8 rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary outline-none focus:border-accent"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {ALL_EVENT_TYPES.map((evt) => {
                    const checked = subEvents.includes(evt.id);
                    return (
                      <label
                        key={evt.id}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 text-[11px] text-content-secondary"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSubEvents((prev) =>
                              checked ? prev.filter((x) => x !== evt.id) : [...prev, evt.id],
                            )
                          }
                          className="accent-accent"
                        />
                        {evt.label}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex h-8 items-center gap-1 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加订阅
                </button>
              </div>
            </form>
          )}

          {createdSecret && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
                <span className="min-w-0">
                  签名密钥（仅显示一次，用于校验{' '}
                  <code className="font-mono">X-RoleCard-Signature</code>）：
                  <code className="ml-1 inline-block break-all rounded bg-surface px-1.5 py-0.5 font-mono font-semibold text-content-primary">
                    {createdSecret}
                  </code>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void copyWithToast(createdSecret, 'Webhook 签名密钥')}
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-surface px-2.5 py-1 text-[11px] text-content-primary hover:border-accent"
                >
                  <Copy className="h-3 w-3 shrink-0" />
                  复制密钥
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedSecret(null)}
                  className="shrink-0 text-content-muted hover:text-content-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-content-primary">已注册订阅</h3>
              {subscriptions.length === 0 ? (
                <p className="rounded-md border border-dashed border-line p-4 text-center text-xs text-content-muted">
                  暂无 Webhook 订阅，也可通过{' '}
                  <code className="font-mono">GET /api/v1/external/sync/events?since_cursor=0</code>{' '}
                  拉取增量事件。
                </p>
              ) : (
                subscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-line bg-canvas p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-content-primary">{sub.name}</div>
                      <div className="truncate font-mono text-[11px] text-content-muted">
                        {sub.webhookUrl}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10.5px] text-content-secondary">
                        <span>密钥：{sub.secretMasked}</span>
                        <span>· 游标：{sub.lastCursor}</span>
                      </div>
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deleteSyncSubscription(sub.id);
                          onNotify('已删除同步订阅');
                          await loadData();
                        }}
                        className="rounded-sm p-1.5 text-content-muted hover:bg-status-danger/10 hover:text-status-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-content-primary">
                增量同步事件流 (since_cursor)
              </h3>
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-md border border-line bg-canvas p-2.5">
                {events.length === 0 ? (
                  <p className="p-3 text-center text-xs text-content-muted">暂无同步事件</p>
                ) : (
                  events.map((evt) => (
                    <div
                      key={evt.id}
                      className="flex items-center justify-between gap-2 rounded-sm border border-line-subtle bg-surface px-2.5 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono font-semibold text-accent">
                          #{evt.cursor}
                        </span>
                        <span className="font-mono text-content-primary">{evt.eventType}</span>
                        <span className="text-content-muted">
                          {evt.targetType}:{evt.targetId.slice(0, 8)} (v{evt.version})
                        </span>
                      </div>
                      <span className="text-[10px] text-content-muted">
                        {new Date(evt.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
