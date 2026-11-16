import { useEffect, useState, type FormEvent } from 'react';
import type { LorebookDto, LorebookEntry } from '@rolecard/shared';
import { BookOpen, Check, Download, Link2, Pencil, Plus, Power, Trash2, Unlink, X } from 'lucide-react';
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

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editComment, setEditComment] = useState('');
  const [editKeys, setEditKeys] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editConstant, setEditConstant] = useState(false);
  const [editEnabled, setEditEnabled] = useState(true);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

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

  const startEditEntry = (entry: LorebookEntry) => {
    setConfirmDeleteUid(null);
    setEditingUid(entry.uid);
    setEditComment(entry.comment);
    setEditKeys(entry.keys.join(', '));
    setEditContent(entry.content);
    setEditConstant(entry.constant);
    setEditEnabled(entry.enabled);
  };

  const cancelEditEntry = () => {
    setEditingUid(null);
    setEditComment('');
    setEditKeys('');
    setEditContent('');
  };

  const handleSaveEntryEdit = async (e: FormEvent, uid: string) => {
    e.preventDefault();
    if (!activeBook || !canUpdate || !editContent.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const keys = editKeys
        .split(/[,，、\s]+/)
        .map((k) => k.trim())
        .filter(Boolean);
      const nextEntries = activeBook.entries.map((item) =>
        item.uid === uid
          ? {
              ...item,
              comment: editComment.trim() || keys[0] || item.comment || '设定词条',
              keys,
              content: editContent.trim(),
              constant: editConstant,
              enabled: editEnabled,
            }
          : item,
      );
      const res = await api.updateLorebook(activeBook.id, { entries: nextEntries });
      setBooks((prev) => prev.map((b) => (b.id === activeBook.id ? res.lorebook : b)));
      cancelEditEntry();
      onNotify('词条修改已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存词条失败');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEntryConstant = async (entry: LorebookEntry) => {
    if (!activeBook || !canUpdate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextConstant = !entry.constant;
      const nextEntries = activeBook.entries.map((item) =>
        item.uid === entry.uid ? { ...item, constant: nextConstant } : item,
      );
      const res = await api.updateLorebook(activeBook.id, { entries: nextEntries });
      setBooks((prev) => prev.map((b) => (b.id === activeBook.id ? res.lorebook : b)));
      if (!nextConstant && entry.keys.length === 0) {
        onNotify('已切换为绿灯触发（建议点击编辑补充触发关键词）');
      } else {
        onNotify(nextConstant ? '已切换为蓝灯常驻词条' : '已切换为绿灯触发词条');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换词条模式失败');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEntryEnabled = async (entry: LorebookEntry) => {
    if (!activeBook || !canUpdate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextEnabled = !entry.enabled;
      const nextEntries = activeBook.entries.map((item) =>
        item.uid === entry.uid ? { ...item, enabled: nextEnabled } : item,
      );
      const res = await api.updateLorebook(activeBook.id, { entries: nextEntries });
      setBooks((prev) => prev.map((b) => (b.id === activeBook.id ? res.lorebook : b)));
      onNotify(nextEnabled ? '词条已启用' : '词条已停用');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新词条状态失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEntry = async (entry: LorebookEntry) => {
    if (!activeBook || !canUpdate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const linked = activeBook.linkedCards.find((link) => link.entryUid === entry.uid);
      const res = linked
        ? await api.unlinkCardFromLorebook(activeBook.id, linked.cardId)
        : await api.updateLorebook(activeBook.id, {
            entries: activeBook.entries.filter((item) => item.uid !== entry.uid),
          });
      setBooks((prev) => prev.map((b) => (b.id === activeBook.id ? res.lorebook : b)));
      if (editingUid === entry.uid) {
        cancelEditEntry();
      }
      setConfirmDeleteUid(null);
      onNotify(linked ? '已删除词条并解除对应角色关联' : '词条已删除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除词条失败');
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
              onClick={() => {
                setSelectedId(book.id);
                setEditingUid(null);
                setConfirmDeleteUid(null);
              }}
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
              {activeBook.entries.length === 0 && (
                <div className="rounded-md border border-dashed border-line bg-canvas p-6 text-center text-xs text-content-muted">
                  当前世界书暂无词条，可在上方关联角色或手动添加蓝灯常驻 / 绿灯触发词条。
                </div>
              )}
              {activeBook.entries.map((entry) => {
                const isEditing = editingUid === entry.uid;
                const isConfirmingDelete = confirmDeleteUid === entry.uid;
                return (
                  <div
                    key={entry.uid}
                    className={`rounded-md border border-line-subtle bg-canvas p-3 text-xs transition ${
                      entry.enabled ? '' : 'opacity-65'
                    }`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {canUpdate ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleEntryConstant(entry)}
                            title="点击切换 蓝灯常驻 / 绿灯触发"
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition hover:opacity-80 disabled:opacity-50 ${
                              entry.constant
                                ? 'bg-status-info/15 text-status-info'
                                : 'bg-status-success/15 text-status-success'
                            }`}
                          >
                            {entry.constant ? '蓝灯常驻' : '绿灯触发'}
                          </button>
                        ) : (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              entry.constant
                                ? 'bg-status-info/15 text-status-info'
                                : 'bg-status-success/15 text-status-success'
                            }`}
                          >
                            {entry.constant ? '蓝灯常驻' : '绿灯触发'}
                          </span>
                        )}
                        <span className="font-semibold text-content-primary">
                          {entry.comment || entry.uid}
                        </span>
                        {!entry.enabled && (
                          <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] text-content-muted">
                            已停用
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {entry.keys.length > 0 && (
                          <span className="mr-1 font-mono text-[10.5px] text-content-muted">
                            keys: {entry.keys.join(', ')}
                          </span>
                        )}
                        {canUpdate && !isEditing && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleToggleEntryEnabled(entry)}
                              title={entry.enabled ? '点击停用词条' : '点击启用词条'}
                              className={`inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-[10.5px] transition disabled:opacity-50 ${
                                entry.enabled
                                  ? 'border-line bg-surface text-content-secondary hover:bg-subtle'
                                  : 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/20'
                              }`}
                            >
                              <Power className="h-3 w-3" />
                              {entry.enabled ? '启用中' : '已停用'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => startEditEntry(entry)}
                              title="编辑词条"
                              className="inline-flex h-6 items-center gap-1 rounded-sm border border-line bg-surface px-1.5 text-[10.5px] text-content-secondary hover:bg-subtle disabled:opacity-50"
                            >
                              <Pencil className="h-3 w-3" />
                              编辑
                            </button>
                            {isConfirmingDelete ? (
                              <span className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleDeleteEntry(entry)}
                                  className="inline-flex h-6 items-center rounded-sm bg-status-danger px-2 text-[10.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                                >
                                  确认删除
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirmDeleteUid(null)}
                                  className="inline-flex h-6 items-center rounded-sm border border-line bg-surface px-1.5 text-[10.5px] text-content-muted hover:bg-subtle"
                                >
                                  取消
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setEditingUid(null);
                                  setConfirmDeleteUid(entry.uid);
                                }}
                                title="删除词条"
                                aria-label={`删除词条 ${entry.comment || entry.uid}`}
                                className="inline-flex h-6 items-center gap-1 rounded-sm border border-line bg-surface px-1.5 text-[10.5px] text-content-muted hover:border-status-danger/50 hover:text-status-danger disabled:opacity-50"
                              >
                                <Trash2 className="h-3 w-3" />
                                删除
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {isEditing ? (
                      <form
                        onSubmit={(e) => handleSaveEntryEdit(e, entry.uid)}
                        className="mt-2 space-y-2 rounded-sm border border-line bg-surface p-2.5"
                      >
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            type="text"
                            value={editComment}
                            onChange={(e) => setEditComment(e.target.value)}
                            placeholder="词条标题/备注"
                            className="h-8 rounded-sm border border-line bg-canvas px-2.5 text-xs text-content-primary"
                          />
                          <input
                            type="text"
                            value={editKeys}
                            onChange={(e) => setEditKeys(e.target.value)}
                            placeholder="触发关键词（逗号分隔，蓝灯常驻可留空）"
                            className="h-8 rounded-sm border border-line bg-canvas px-2.5 text-xs text-content-primary"
                          />
                        </div>
                        <textarea
                          rows={3}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          placeholder="词条设定内容..."
                          className="w-full rounded-sm border border-line bg-canvas p-2 text-xs text-content-primary"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-4">
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-content-secondary">
                              <input
                                type="checkbox"
                                checked={editConstant}
                                onChange={(e) => setEditConstant(e.target.checked)}
                                className="accent-accent"
                              />
                              蓝灯常驻
                            </label>
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-content-secondary">
                              <input
                                type="checkbox"
                                checked={editEnabled}
                                onChange={(e) => setEditEnabled(e.target.checked)}
                                className="accent-accent"
                              />
                              启用词条
                            </label>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={cancelEditEntry}
                              className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-canvas px-2.5 text-xs text-content-secondary hover:bg-subtle"
                            >
                              <X className="h-3 w-3" />
                              取消
                            </button>
                            <button
                              type="submit"
                              disabled={busy || !editContent.trim()}
                              className="inline-flex h-7 items-center gap-1 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse disabled:opacity-50"
                            >
                              <Check className="h-3 w-3" />
                              保存修改
                            </button>
                          </div>
                        </div>
                      </form>
                    ) : (
                      <p className="whitespace-pre-wrap leading-relaxed text-content-secondary">
                        {entry.content}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
