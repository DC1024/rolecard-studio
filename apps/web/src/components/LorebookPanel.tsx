import { useEffect, useState, type FormEvent } from 'react';
import type { LorebookDto, LorebookEntry } from '@rolecard/shared';
import { BookOpen, Download, Link2, Plus, Trash2, Unlink } from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';

interface LorebookPanelProps {
  cards: RoleCardDto[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
  onNotify: (msg: string) => void;
}

export function LorebookPanel({
  cards,
  canCreate,
  canUpdate,
  canDelete,
  canExport,
  onNotify,
}: LorebookPanelProps) {
  const [books, setBooks] = useState<LorebookDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const [entryKeys, setEntryKeys] = useState('');
  const [entryComment, setEntryComment] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [entryConstant, setEntryConstant] = useState(false);

  const [linkCardId, setLinkCardId] = useState('');
  const [relationRole, setRelationRole] = useState('核心人物');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshBooks = async () => {
    try {
      const res = await api.listLorebooks();
      setBooks(res.items);
      if (!selectedId && res.items[0]) {
        setSelectedId(res.items[0].id);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void refreshBooks();
  }, []);

  useEffect(() => {
    if (!linkCardId && cards[0]) {
      setLinkCardId(cards[0].id);
    }
  }, [cards, linkCardId]);

  const activeBook = books.find((b) => b.id === selectedId) ?? books[0] ?? null;

  const handleCreateBook = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createLorebook({
        name: newName.trim(),
        description: newDesc.trim(),
        worldSummary: '',
        scanDepth: 4,
        tokenBudget: 1500,
        recursiveScanning: false,
        entries: [],
        tags: [],
      });
      setBooks((prev) => [res.lorebook, ...prev]);
      setSelectedId(res.lorebook.id);
      setNewName('');
      setNewDesc('');
      onNotify(`已创建世界书「${res.lorebook.name}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建世界书失败');
    } finally {
      setBusy(false);
    }
  };

  const handleAddEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeBook || !entryContent.trim() || !canUpdate) return;
    setBusy(true);
    setError(null);
    try {
      const keys = entryKeys
        .split(/[,，、\s]+/)
        .map((k) => k.trim())
        .filter(Boolean);
      const nextEntry: LorebookEntry = {
        uid: `entry_${Date.now()}`,
        keys,
        secondary_keys: [],
        comment: entryComment.trim() || keys[0] || '设定词条',
        content: entryContent.trim(),
        constant: entryConstant,
        selective: true,
        insertion_order: 100,
        enabled: true,
        position: 'before_char',
        extensions: {},
      };
      const res = await api.updateLorebook(activeBook.id, {
        entries: [...activeBook.entries, nextEntry],
      });
      setBooks((prev) => prev.map((b) => (b.id === activeBook.id ? res.lorebook : b)));
      setEntryKeys('');
      setEntryComment('');
      setEntryContent('');
      setEntryConstant(false);
      onNotify('词条已添加至世界书');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加词条失败');
    } finally {
      setBusy(false);
    }
  };

  const handleLinkCard = async () => {
    if (!activeBook || !linkCardId || !canUpdate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.linkCardToLorebook(activeBook.id, {
        cardId: linkCardId,
        relationRole: relationRole.trim() || '核心人物',
        constant: false,
      });
      setBooks((prev) => prev.map((b) => (b.id === activeBook.id ? res.lorebook : b)));
      onNotify('已关联角色并自动生成第三方视角词条');
    } catch (err) {
      setError(err instanceof Error ? err.message : '关联角色失败');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlinkCard = async (cardId: string) => {
    if (!activeBook || !canUpdate) return;
    setBusy(true);
    try {
      const res = await api.unlinkCardFromLorebook(activeBook.id, cardId);
      setBooks((prev) => prev.map((b) => (b.id === activeBook.id ? res.lorebook : b)));
      onNotify('已解除角色关联');
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除关联失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Left Lorebook List */}
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
          <BookOpen className="h-4 w-4 text-accent" />
          独立世界书 ({books.length})
        </div>

        {canCreate && (
          <form onSubmit={handleCreateBook} className="space-y-2 rounded-md border border-line bg-subtle p-2.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新建世界书名称..."
              className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="简述世界观（可选）"
              className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary"
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-sm bg-accent text-xs font-medium text-content-inverse disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              创建世界书
            </button>
          </form>
        )}

        <div className="space-y-1.5">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              onClick={() => setSelectedId(book.id)}
              className={`w-full rounded-md border p-2.5 text-left transition ${
                activeBook?.id === book.id
                  ? 'border-accent/40 bg-accent/10'
                  : 'border-transparent hover:bg-subtle'
              }`}
            >
              <div className="truncate text-xs font-semibold text-content-primary">{book.name}</div>
              <div className="mt-0.5 text-[11px] text-content-muted">
                {book.entries.length} 词条 · {book.linkedCards.length} 关联角色
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Right Lorebook Detail */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        {!activeBook ? (
          <div className="py-16 text-center text-xs text-content-muted">
            请先在左侧新建或选择一部世界书，即可关联多个角色卡并在试聊中自动亮灯触发。
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle pb-3">
              <div>
                <h3 className="text-base font-bold text-content-primary">{activeBook.name}</h3>
                <p className="mt-0.5 text-xs text-content-secondary">
                  {activeBook.description || '独立世界观知识库（支持 M:N 角色联动与 SillyTavern 导出）'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canExport && (
                  <button
                    type="button"
                    onClick={() => {
                      window.open(api.getLorebookExportUrl(activeBook.id), '_blank', 'noopener,noreferrer');
                      onNotify(`已导出世界书「${activeBook.name}」WorldInfo JSON`);
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-content-primary hover:bg-subtle"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出 WorldInfo JSON
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={async () => {
                      await api.deleteLorebook(activeBook.id);
                      setBooks((prev) => prev.filter((b) => b.id !== activeBook.id));
                      setSelectedId(null);
                      onNotify('世界书已删除');
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line text-content-muted hover:text-status-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
                {error}
              </div>
            )}

            {/* M:N Character Linking */}
            <div className="rounded-md border border-line bg-subtle p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-content-primary">
                <Link2 className="h-3.5 w-3.5 text-accent" />
                人物关联（自动提炼第三方视角摘要词条）
              </div>
              {canUpdate && cards.length > 0 && (
                <div className="mb-2.5 flex flex-wrap gap-2">
                  <select
                    value={linkCardId}
                    onChange={(e) => setLinkCardId(e.target.value)}
                    className="h-8 flex-1 rounded-sm border border-line bg-surface px-2 text-xs"
                  >
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.characterName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={relationRole}
                    onChange={(e) => setRelationRole(e.target.value)}
                    placeholder="世界中的身份/定位"
                    className="h-8 w-40 rounded-sm border border-line bg-surface px-2.5 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleLinkCard}
                    className="h-8 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse"
                  >
                    关联角色
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {activeBook.linkedCards.map((link) => (
                  <span
                    key={link.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px]"
                  >
                    <span className="font-semibold text-content-primary">{link.characterName}</span>
                    <span className="text-content-muted">({link.relationRole})</span>
                    {canUpdate && (
                      <button
                        type="button"
                        onClick={() => handleUnlinkCard(link.cardId)}
                        className="text-content-muted hover:text-status-danger"
                      >
                        <Unlink className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Add manual entry */}
            {canUpdate && (
              <form onSubmit={handleAddEntry} className="space-y-2 rounded-md border border-line bg-canvas p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={entryComment}
                    onChange={(e) => setEntryComment(e.target.value)}
                    placeholder="词条标题/备注"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    value={entryKeys}
                    onChange={(e) => setEntryKeys(e.target.value)}
                    placeholder="触发关键词（逗号分隔，蓝灯常驻可留空）"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs"
                  />
                </div>
                <textarea
                  rows={2}
                  value={entryContent}
                  onChange={(e) => setEntryContent(e.target.value)}
                  placeholder="词条设定内容..."
                  className="w-full rounded-sm border border-line bg-surface p-2 text-xs"
                />
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-content-secondary">
                    <input
                      type="checkbox"
                      checked={entryConstant}
                      onChange={(e) => setEntryConstant(e.target.checked)}
                      className="accent-accent"
                    />
                    设为蓝灯常驻词条（每次试聊均自动注入）
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !entryContent.trim()}
                    className="h-7 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse disabled:opacity-50"
                  >
                    添加词条
                  </button>
                </div>
              </form>
            )}

            {/* Entry list */}
            <div className="space-y-2">
              {activeBook.entries.map((entry) => (
                <div key={entry.uid} className="rounded-md border border-line-subtle bg-canvas p-3 text-xs">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          entry.constant
                            ? 'bg-status-info/15 text-status-info'
                            : 'bg-status-success/15 text-status-success'
                        }`}
                      >
                        {entry.constant ? '蓝灯常驻' : '绿灯触发'}
                      </span>
                      <span className="font-semibold text-content-primary">{entry.comment || entry.uid}</span>
                    </div>
                    {entry.keys.length > 0 && (
                      <span className="font-mono text-[10.5px] text-content-muted">
                        keys: {entry.keys.join(', ')}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed text-content-secondary">
                    {entry.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
