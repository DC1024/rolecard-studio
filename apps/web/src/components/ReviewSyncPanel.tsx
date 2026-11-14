import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  ImpressionEventDto,
  RippleProposalDto,
  SyncEventDto,
  SyncEventType,
  SyncSubscriptionDto,
} from '@rolecard/shared';
import {
  Activity,
  Bell,
  Check,
  GitBranch,
  KeyRound,
  Plus,
  Radio,
  RefreshCw,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { api } from '../api/client';

interface ReviewSyncPanelProps {
  canResolveReview: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onNotify: (msg: string) => void;
  onRefreshCards: () => Promise<void>;
}

const ALL_EVENT_TYPES: { id: SyncEventType; label: string }[] = [
  { id: 'card.updated', label: '卡片更新' },
  { id: 'card.evolved', label: '人设演化' },
  { id: 'lorebook.updated', label: '世界书变更' },
  { id: 'ripple.approved', label: '关系涟漪生效' },
];

export function ReviewSyncPanel({
  canResolveReview,
  canUpdate,
  canDelete,
  onNotify,
  onRefreshCards,
}: ReviewSyncPanelProps) {
  const [tab, setTab] = useState<'reviews' | 'sync'>('reviews');
  const [impressions, setImpressions] = useState<ImpressionEventDto[]>([]);
  const [ripples, setRipples] = useState<RippleProposalDto[]>([]);
  const [subscriptions, setSubscriptions] = useState<SyncSubscriptionDto[]>([]);
  const [events, setEvents] = useState<SyncEventDto[]>([]);
  const [sseConnected, setSseConnected] = useState(false);

  const [subName, setSubName] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [subEvents, setSubEvents] = useState<SyncEventType[]>(['card.updated', 'card.evolved']);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [revRes, subRes, evtRes] = await Promise.all([
        api.listReviews(),
        api.listSyncSubscriptions(),
        api.listSyncEvents(0, 30),
      ]);
      setImpressions(revRes.impressions);
      setRipples(revRes.ripples);
      setSubscriptions(subRes.items);
      setEvents([...evtRes.items].reverse());
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
        setEvents((prev) => {
          if (prev.some((p) => p.id === parsed.id)) return prev;
          return [parsed, ...prev].slice(0, 30);
        });
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
  }, []);

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

      <div className="flex gap-1 border-b border-line-subtle">
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
            <div className="flex items-center justify-between gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-status-warning" />
                <span>
                  签名密钥（仅显示一次，用于校验{' '}
                  <code className="font-mono">X-RoleCard-Signature</code>）：
                  <code className="ml-1 rounded bg-surface px-1.5 py-0.5 font-mono font-semibold text-content-primary">
                    {createdSecret}
                  </code>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCreatedSecret(null)}
                className="text-content-muted hover:text-content-primary"
              >
                <X className="h-4 w-4" />
              </button>
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
