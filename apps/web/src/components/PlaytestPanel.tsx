import { useEffect, useState, type FormEvent } from 'react';
import type { PlaytestHistoryItem, PlaytestResponse } from '@rolecard/shared';
import { BookOpen, BookmarkPlus, Loader2, Send, Sparkles } from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';

interface PlaytestPanelProps {
  cards: RoleCardDto[];
  selectedCard: RoleCardDto | null;
  canPlaytest: boolean;
  canUpdate: boolean;
  onSelectCard: (card: RoleCardDto) => void;
  onCardUpdated: (card: RoleCardDto, banner?: string) => void;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  debug?: Pick<PlaytestResponse, 'hitLorebooks' | 'metaInjected' | 'usedModel'>;
}

export function PlaytestPanel({
  cards,
  selectedCard,
  canPlaytest,
  canUpdate,
  onSelectCard,
  onCardUpdated,
}: PlaytestPanelProps) {
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [userName, setUserName] = useState('旅行者');
  const [userPersona, setUserPersona] = useState('');
  const [modelOverride, setModelOverride] = useState('');
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [adoptingIdx, setAdoptingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const greetings = selectedCard
    ? [
        selectedCard.content.first_mes || `（我是 ${selectedCard.characterName}，很高兴见到你。）`,
        ...selectedCard.content.alternate_greetings,
      ]
    : [];

  useEffect(() => {
    setGreetingIndex(0);
    setMessages([]);
    setError(null);
  }, [selectedCard?.id]);

  if (!selectedCard) {
    return (
      <section className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface p-8 text-center">
        <Sparkles className="mb-3 h-8 w-8 text-accent/60" />
        <h3 className="text-sm font-semibold text-content-primary">选择角色卡开始快速试聊</h3>
        <p className="mt-1 max-w-sm text-xs text-content-muted">
          试聊沙盒会实时预览开场白、测试口癖与性格还原度，并支持把优质回复一键采纳进对话示例。
        </p>
      </section>
    );
  }

  const activeGreeting = greetings[greetingIndex] ?? greetings[0] ?? '';

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
        userName: userName.trim() || '旅行者',
        userPersona: userPersona.trim(),
        greetingIndex,
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
            usedModel: res.usedModel,
          },
        },
      ]);
    } catch (err) {
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
    <section className="flex flex-col rounded-lg border border-line bg-surface shadow-sm">
      {/* Control Header */}
      <div className="grid gap-2.5 border-b border-line-subtle bg-subtle/60 p-4 sm:grid-cols-4">
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
              setGreetingIndex(Number(e.target.value));
              setMessages([]);
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
      </div>

      {/* Chat Stream */}
      <div className="flex max-h-[460px] min-h-[300px] flex-col gap-3 overflow-y-auto p-4">
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
            key={idx}
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
                </div>

                {canUpdate && idx > 0 && (
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
    </section>
  );
}
