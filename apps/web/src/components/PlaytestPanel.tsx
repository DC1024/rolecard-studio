import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  PlaytestHistoryItem,
  PlaytestResponse,
  PlaytestSessionDto,
  PlaytestSessionSummaryDto,
  PlaytestStoredMessage,
  PlaytestTrpgMode,
} from '@rolecard/shared';
import {
  BookOpen,
  BookmarkPlus,
  Check,
  Dice5,
  History,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';
import { extractCardTrpgSystems } from '../utils/trpg';

interface PlaytestPanelProps {
  cards: RoleCardDto[];
  selectedCard: RoleCardDto | null;
  canPlaytest: boolean;
  canUpdate: boolean;
  onSelectCard: (card: RoleCardDto) => void;
  onCardUpdated: (card: RoleCardDto, banner?: string) => void;
  onNotify?: (message: string, kind?: 'success' | 'info' | 'error') => void;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  debug?: Pick<
    PlaytestResponse,
    'hitLorebooks' | 'metaInjected' | 'trpgSystemInjected' | 'usedModel'
  >;
}

function toChatTurns(messages: PlaytestStoredMessage[]): ChatTurn[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    debug: m.debug
      ? {
          hitLorebooks: m.debug.hitLorebooks,
          metaInjected: m.debug.metaInjected,
          trpgSystemInjected: m.debug.trpgSystemInjected ?? null,
          usedModel: m.debug.usedModel,
        }
      : undefined,
  }));
}

function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mm}`;
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}`;
}

export function PlaytestPanel({
  cards,
  selectedCard,
  canPlaytest,
  canUpdate,
  onSelectCard,
  onCardUpdated,
  onNotify,
}: PlaytestPanelProps) {
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [userName, setUserName] = useState('旅行者');
  const [userPersona, setUserPersona] = useState('');
  const [modelOverride, setModelOverride] = useState('');
  const [trpgMode, setTrpgMode] = useState<PlaytestTrpgMode>('auto');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [adoptingIdx, setAdoptingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<PlaytestSessionSummaryDto[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [mutatingSessionId, setMutatingSessionId] = useState<string | null>(null);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const applySessionDetail = useCallback(
    (session: PlaytestSessionDto, greetingCount: number) => {
      const safeGreeting =
        session.greetingIndex >= 0 && session.greetingIndex < greetingCount
          ? session.greetingIndex
          : 0;
      setActiveSessionId(session.id);
      setGreetingIndex(safeGreeting);
      setUserName(session.userName || '旅行者');
      setUserPersona(session.userPersona || '');
      setTrpgMode(session.trpgMode || 'auto');
      setModelOverride(session.modelOverride || '');
      setMessages(toChatTurns(session.messages));
      setError(null);
    },
    [],
  );

  const refreshSessions = useCallback(async (cardId: string) => {
    try {
      const res = await api.listPlaytestSessions(cardId);
      setSessions(res.items);
      return res.items;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    const cardId = selectedCard?.id;
    if (!cardId) {
      setSessions([]);
      setActiveSessionId(null);
      setMessages([]);
      return;
    }

    let cancelled = false;
    const greetingCount = 1 + (selectedCard.content.alternate_greetings?.length ?? 0);

    setGreetingIndex(0);
    setUserName('旅行者');
    setUserPersona('');
    setModelOverride('');
    setTrpgMode('auto');
    setMessages([]);
    setActiveSessionId(null);
    setRenamingId(null);
    setConfirmDeleteId(null);
    setError(null);
    setLoadingSessions(true);

    void (async () => {
      try {
        const listRes = await api.listPlaytestSessions(cardId);
        if (cancelled) return;
        setSessions(listRes.items);

        const latest = listRes.items[0];
        if (latest) {
          setLoadingSessionId(latest.id);
          try {
            const detailRes = await api.getPlaytestSession(latest.id);
            if (!cancelled) {
              applySessionDetail(detailRes.session, greetingCount);
            }
          } catch {
            // Keep clean session state if loading latest fails
          } finally {
            if (!cancelled) setLoadingSessionId(null);
          }
        }
      } catch {
        if (!cancelled) setSessions([]);
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCard?.id, applySessionDetail]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length, sending, activeSessionId]);

  if (!selectedCard) {
    return (
      <section className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface p-8 text-center">
        <Sparkles className="mb-3 h-8 w-8 text-accent/60" />
        <h3 className="text-sm font-semibold text-content-primary">选择角色卡开始快速试聊</h3>
        <p className="mt-1 max-w-sm text-xs text-content-muted">
          试聊沙盒会实时预览开场白、测试口癖与性格还原度，支持历史会话持久化与断点续聊，并可把优质回复一键采纳进对话示例。
        </p>
      </section>
    );
  }

  const greetings = [
    selectedCard.content.first_mes || `（我是 ${selectedCard.characterName}，很高兴见到你。）`,
    ...selectedCard.content.alternate_greetings,
  ];
  const activeGreeting = greetings[greetingIndex] ?? greetings[0] ?? '';
  const trpgInfo = extractCardTrpgSystems(selectedCard.content, selectedCard.cardType);
  const activeSessionSummary = sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleStartNewSession = () => {
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
    setRenamingId(null);
    setConfirmDeleteId(null);
  };

  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId && messages.length > 0) return;
    setLoadingSessionId(sessionId);
    setError(null);
    setRenamingId(null);
    setConfirmDeleteId(null);
    try {
      const res = await api.getPlaytestSession(sessionId);
      applySessionDetail(res.session, greetings.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史会话失败');
    } finally {
      setLoadingSessionId(null);
    }
  };

  const startRenameSession = (session: PlaytestSessionSummaryDto) => {
    setConfirmDeleteId(null);
    setRenamingId(session.id);
    setRenameTitle(session.title);
  };

  const handleSaveRename = async (sessionId: string) => {
    const trimmed = renameTitle.trim();
    if (!trimmed) {
      setError('会话标题不能为空');
      return;
    }
    setMutatingSessionId(sessionId);
    setError(null);
    try {
      const res = await api.updatePlaytestSession(sessionId, { title: trimmed });
      setSessions((prev) =>
        prev.map((item) => (item.id === sessionId ? res.session : item)),
      );
      setRenamingId(null);
      onNotify?.('已重命名试聊会话', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重命名会话失败');
    } finally {
      setMutatingSessionId(null);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setMutatingSessionId(sessionId);
    setError(null);
    try {
      await api.deletePlaytestSession(sessionId);
      const remaining = sessions.filter((item) => item.id !== sessionId);
      setSessions(remaining);
      setConfirmDeleteId(null);
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
      onNotify?.('已删除试聊会话', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除会话失败');
    } finally {
      setMutatingSessionId(null);
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const msg = inputText.trim();
    if (!msg || !canPlaytest || sending) return;

    const history: PlaytestHistoryItem[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setInputText('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setSending(true);

    try {
      const res = await api.playtestCard(selectedCard.id, {
        message: msg,
        history,
        ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        userName: userName.trim() || '旅行者',
        userPersona: userPersona.trim(),
        greetingIndex,
        ...(trpgMode !== 'auto' ? { trpgSystem: trpgMode } : {}),
        modelOverride: modelOverride.trim() ? { model: modelOverride.trim() } : undefined,
      });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.reply,
          debug: {
            hitLorebooks: res.hitLorebooks,
            metaInjected: res.metaInjected,
            trpgSystemInjected: res.trpgSystemInjected,
            usedModel: res.usedModel,
          },
        },
      ]);

      if (res.sessionId) {
        setActiveSessionId(res.sessionId);
        void refreshSessions(selectedCard.id);
      }
    } catch (err) {
      setMessages((prev) => prev.slice(0, -1));
      setInputText(msg);
      setError(err instanceof Error ? err.message : '试聊请求失败');
    } finally {
      setSending(false);
    }
  };

  const handleAdopt = async (assistantIdx: number) => {
    const assistantTurn = messages[assistantIdx];
    const userTurn = messages[assistantIdx - 1];
    if (!assistantTurn || !userTurn || userTurn.role !== 'user' || !canUpdate) return;

    setAdoptingIdx(assistantIdx);
    setError(null);
    try {
      const res = await api.adoptMesExample(
        selectedCard.id,
        userTurn.content,
        assistantTurn.content,
      );
      onCardUpdated(res.card, '已将本轮对话采纳至角色卡 mes_example');
    } catch (err) {
      setError(err instanceof Error ? err.message : '采纳失败');
    } finally {
      setAdoptingIdx(null);
    }
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm lg:flex-row">
      {/* History Sessions Sidebar */}
      {historyOpen && (
        <aside className="flex w-full shrink-0 flex-col border-b border-line-subtle bg-subtle/40 lg:w-72 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-3.5 py-2.5">
            <div className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-content-primary">
                试聊历史 ({sessions.length})
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleStartNewSession}
                className="inline-flex items-center gap-1 rounded-sm bg-accent px-2 py-1 text-[11px] font-medium text-content-inverse hover:bg-accent-hover"
                title="开启一段新试聊"
              >
                <MessageSquarePlus className="h-3 w-3" />
                新试聊
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="rounded-sm p-1 text-content-muted hover:bg-subtle hover:text-content-primary"
                title="收起历史列表"
                aria-label="收起历史列表"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto p-2.5 lg:max-h-[600px] lg:flex-1">
            {loadingSessions && (
              <div className="flex items-center gap-2 px-2 py-4 text-xs text-content-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在加载历史会话...
              </div>
            )}

            {!loadingSessions && sessions.length === 0 && (
              <div className="rounded-md border border-dashed border-line bg-surface/60 p-3 text-center text-[11px] leading-relaxed text-content-muted">
                暂无历史试聊记录。发送第一条消息后将自动保存，随时可回来继续对话。
              </div>
            )}

            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isRenaming = renamingId === session.id;
              const isConfirmDelete = confirmDeleteId === session.id;
              const isBusy =
                loadingSessionId === session.id || mutatingSessionId === session.id;

              return (
                <div
                  key={session.id}
                  className={`group rounded-md border p-2.5 transition-colors ${
                    isActive
                      ? 'border-accent bg-accent/8'
                      : 'border-line-subtle bg-surface hover:border-line'
                  }`}
                >
                  {isRenaming ? (
                    <div className="flex flex-col gap-1.5">
                      <input
                        type="text"
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleSaveRename(session.id);
                          } else if (e.key === 'Escape') {
                            setRenamingId(null);
                          }
                        }}
                        autoFocus
                        maxLength={120}
                        className="h-7 w-full rounded-sm border border-accent bg-surface px-2 text-xs text-content-primary outline-none"
                      />
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSaveRename(session.id)}
                          className="inline-flex items-center gap-1 rounded-sm bg-accent px-2 py-0.5 text-[10.5px] font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
                        >
                          <Check className="h-2.5 w-2.5" />
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-0.5 text-[10.5px] text-content-secondary hover:bg-subtle"
                        >
                          <X className="h-2.5 w-2.5" />
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSelectSession(session.id)}
                        className="flex w-full flex-col gap-1 text-left"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="line-clamp-1 text-xs font-medium text-content-primary">
                            {session.title}
                          </span>
                          {loadingSessionId === session.id && (
                            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
                          )}
                        </div>
                        <p className="line-clamp-2 text-[11px] leading-snug text-content-muted">
                          {session.lastMessagePreview || '暂无消息预览'}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-content-muted">
                          <span>{session.messageCount} 条</span>
                          <span>·</span>
                          <span>{formatSessionTime(session.updatedAt)}</span>
                          {session.trpgMode !== 'auto' && (
                            <span className="rounded bg-accent/12 px-1 py-0.2 text-[9.5px] font-medium text-accent">
                              {session.trpgMode === 'coc7e'
                                ? 'CoC 7e'
                                : session.trpgMode === 'dnd5e'
                                  ? 'D&D 5e'
                                  : '无规则'}
                            </span>
                          )}
                        </div>
                      </button>

                      {canPlaytest && (
                        <div className="mt-1.5 flex items-center justify-end gap-1 border-t border-line-subtle/70 pt-1.5">
                          {isConfirmDelete ? (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleDeleteSession(session.id)}
                                className="rounded-sm bg-status-danger px-2 py-0.5 text-[10px] font-medium text-content-inverse hover:opacity-90 disabled:opacity-50"
                              >
                                确认删除
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded-sm border border-line bg-surface px-2 py-0.5 text-[10px] text-content-secondary hover:bg-subtle"
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startRenameSession(session)}
                                className="inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-[10.5px] text-content-muted hover:bg-subtle hover:text-content-primary"
                                title="重命名会话"
                              >
                                <Pencil className="h-2.5 w-2.5" />
                                重命名
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingId(null);
                                  setConfirmDeleteId(session.id);
                                }}
                                className="inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-[10.5px] text-content-muted hover:bg-status-danger/10 hover:text-status-danger"
                                title="删除会话"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main Playtest Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Session Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle bg-surface px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {!historyOpen && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="inline-flex items-center gap-1 rounded-sm border border-line bg-subtle px-2 py-1 text-[11px] font-medium text-content-secondary hover:text-content-primary"
                title="展开试聊历史"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
                历史 ({sessions.length})
              </button>
            )}
            <span className="truncate text-xs font-medium text-content-primary">
              {activeSessionSummary
                ? `续聊中：${activeSessionSummary.title}`
                : '新试聊会话（发送首条消息自动保存）'}
            </span>
          </div>
          {activeSessionId && (
            <button
              type="button"
              onClick={handleStartNewSession}
              className="inline-flex items-center gap-1 rounded-sm border border-line bg-subtle px-2.5 py-1 text-[11px] font-medium text-content-secondary hover:border-accent hover:text-accent"
            >
              <MessageSquarePlus className="h-3 w-3" />
              开启新对话
            </button>
          )}
        </div>

        {/* Control Header */}
        <div className="grid gap-2.5 border-b border-line-subtle bg-subtle/60 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-content-secondary">
              试聊角色卡
            </label>
            <select
              value={selectedCard.id}
              onChange={(e) => {
                const found = cards.find((c) => c.id === e.target.value);
                if (found) onSelectCard(found);
              }}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-content-primary outline-none focus:border-accent"
            >
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.characterName} (v{c.version})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-content-secondary">
              开场白版本
            </label>
            <select
              value={greetingIndex}
              onChange={(e) => {
                const nextIdx = Number(e.target.value);
                setGreetingIndex(nextIdx);
                if (activeSessionId && messages.length > 0) {
                  setActiveSessionId(null);
                  setMessages([]);
                }
              }}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-content-primary outline-none focus:border-accent"
            >
              {greetings.map((_, idx) => (
                <option key={idx} value={idx}>
                  {idx === 0 ? '主开场白 (first_mes)' : `备选开场白 #${idx}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-content-secondary">
              你的扮演称呼
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-content-secondary">
              临时模型覆盖（可选）
            </label>
            <input
              type="text"
              value={modelOverride}
              onChange={(e) => setModelOverride(e.target.value)}
              placeholder="留空则用试聊/主模型"
              className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-content-secondary">
              TRPG 规则注入
            </label>
            <select
              value={trpgMode}
              onChange={(e) => setTrpgMode(e.target.value as PlaytestTrpgMode)}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-content-primary outline-none focus:border-accent"
            >
              <option value="auto">
                {trpgInfo.activeSystem
                  ? `自动（默认：${trpgInfo.activeSystem === 'coc7e' ? 'CoC 7e' : 'D&D 5e'}）`
                  : '自动（无绑定规则）'}
              </option>
              <option value="coc7e" disabled={!trpgInfo.coc7e}>
                CoC 7e 调查员{trpgInfo.coc7e ? '' : '（未生成）'}
              </option>
              <option value="dnd5e" disabled={!trpgInfo.dnd5e}>
                D&amp;D 5e 冒险者{trpgInfo.dnd5e ? '' : '（未生成）'}
              </option>
              <option value="none">不注入 TRPG 数值</option>
            </select>
          </div>
        </div>

        {/* Chat Stream */}
        <div
          ref={chatScrollRef}
          className="flex max-h-[460px] min-h-[300px] flex-col gap-3 overflow-y-auto p-4"
        >
          <div className="max-w-[85%] self-start rounded-lg border border-line bg-subtle p-3 text-xs leading-relaxed text-content-primary">
            <div className="mb-1 text-[11px] font-semibold text-accent">
              {selectedCard.characterName} · 开场白
            </div>
            <p className="whitespace-pre-wrap">
              {activeGreeting
                .replaceAll('{{char}}', selectedCard.characterName)
                .replaceAll('{{user}}', userName || '旅行者')}
            </p>
          </div>

          {messages.map((turn, idx) => (
            <div
              key={`${turn.createdAt ?? 'turn'}-${idx}`}
              className={`flex max-w-[85%] flex-col gap-1.5 rounded-lg p-3 text-xs leading-relaxed ${
                turn.role === 'user'
                  ? 'self-end bg-accent text-content-inverse'
                  : 'self-start border border-line bg-canvas text-content-primary'
              }`}
            >
              <div className="flex items-center justify-between gap-3 text-[10.5px] opacity-80">
                <span className="font-semibold">
                  {turn.role === 'user' ? userName || '旅行者' : selectedCard.characterName}
                </span>
                {turn.role === 'assistant' && turn.debug && (
                  <span className="font-mono">{turn.debug.usedModel}</span>
                )}
              </div>

              <p className="whitespace-pre-wrap">{turn.content}</p>

              {turn.role === 'assistant' && (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-line-subtle pt-1.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {turn.debug?.hitLorebooks.map((hit) => (
                      <span
                        key={hit.uid}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          hit.mode === 'blue_constant'
                            ? 'bg-status-info/15 text-status-info'
                            : 'bg-status-success/15 text-status-success'
                        }`}
                      >
                        <BookOpen className="h-2.5 w-2.5" />
                        {hit.mode === 'blue_constant' ? '蓝灯' : '绿灯'}: {hit.comment || hit.uid}
                      </span>
                    ))}
                    {turn.debug?.metaInjected && (
                      <span className="rounded bg-accent-secondary/15 px-1.5 py-0.5 text-[10px] text-accent-secondary">
                        Meta 彩蛋已注入
                      </span>
                    )}
                    {turn.debug?.trpgSystemInjected && (
                      <span className="inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        <Dice5 className="h-2.5 w-2.5" />
                        {turn.debug.trpgSystemInjected === 'coc7e' ? 'CoC 7e' : 'D&D 5e'} 规则已注入
                      </span>
                    )}
                  </div>

                  {canUpdate && messages[idx - 1]?.role === 'user' && (
                    <button
                      type="button"
                      disabled={adoptingIdx === idx}
                      onClick={() => handleAdopt(idx)}
                      className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-0.5 text-[10.5px] font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                    >
                      <BookmarkPlus className="h-3 w-3" />
                      {adoptingIdx === idx ? '采纳中...' : '采纳为对话示例'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="inline-flex items-center gap-2 self-start rounded-lg border border-line bg-subtle px-3 py-2 text-xs text-content-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              <span>{selectedCard.characterName} 正在思考回复...</span>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {error}
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSend} className="border-t border-line-subtle p-3">
          <div className="mb-2">
            <input
              type="text"
              value={userPersona}
              onChange={(e) => setUserPersona(e.target.value)}
              placeholder="可选：简述你在本场对话中的人设背景（如：受伤的骑士）"
              className="h-7 w-full rounded-sm border border-line bg-subtle px-2.5 text-[11px] text-content-secondary outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={!canPlaytest || sending}
              placeholder={
                canPlaytest ? `以「${userName || '旅行者'}」的身份发送对话...` : '当前权限不可试聊'
              }
              className="h-9 flex-1 rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!canPlaytest || sending || !inputText.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm bg-accent px-4 text-xs font-semibold text-content-inverse hover:bg-accent-hover disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              发送
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
