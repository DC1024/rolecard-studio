import type { CardType, GenerationMode } from '@rolecard/shared';
import { MessageSquare, Search, X } from 'lucide-react';
import type { CommonTagCount, RoleCardDto } from '../api/client';

interface SidebarProps {
  open: boolean;
  cards: RoleCardDto[];
  total: number;
  commonTags: CommonTagCount[];
  selectedCardId: string | null;
  searchQuery: string;
  selectedTags: string[];
  filterCardType: CardType | '';
  filterMode: GenerationMode | '';
  loading: boolean;
  onSearchChange: (q: string) => void;
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  onFilterCardTypeChange: (val: CardType | '') => void;
  onFilterModeChange: (val: GenerationMode | '') => void;
  onSelectCard: (card: RoleCardDto) => void;
  onQuickPlaytest: (card: RoleCardDto) => void;
}

export function Sidebar({
  open,
  cards,
  total,
  commonTags,
  selectedCardId,
  searchQuery,
  selectedTags,
  filterCardType,
  filterMode,
  loading,
  onSearchChange,
  onToggleTag,
  onClearTags,
  onFilterCardTypeChange,
  onFilterModeChange,
  onSelectCard,
  onQuickPlaytest,
}: SidebarProps) {
  return (
    <aside
      className={`shrink-0 border-r border-line bg-surface transition-all duration-200 ${
        open ? 'w-[276px] opacity-100' : 'w-0 overflow-hidden border-r-0 opacity-0'
      }`}
    >
      <div className="flex h-[calc(100vh-56px)] w-[276px] flex-col overflow-y-auto p-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-content-secondary">
            角色卡库 ({total})
          </span>
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={onClearTags}
              className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
            >
              <X className="h-3 w-3" />
              清除标签
            </button>
          )}
        </div>

        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜角色 / 作品 / 冷门标签..."
            className="h-8 w-full rounded-sm border border-line bg-subtle pl-8 pr-2.5 text-xs text-content-primary outline-none transition focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/15"
          />
        </div>

        <div className="mb-2.5 grid grid-cols-2 gap-1.5">
          <select
            value={filterCardType}
            onChange={(e) => onFilterCardTypeChange(e.target.value as CardType | '')}
            className="h-7 rounded-sm border border-line bg-surface px-1.5 text-xs text-content-secondary outline-none focus:border-accent"
          >
            <option value="">全部规格</option>
            <option value="sillytavern_v3">酒馆 CCV3</option>
            <option value="trpg_coc7">TRPG CoC</option>
            <option value="trpg_dnd5e">TRPG DnD</option>
            <option value="general">通用设定</option>
          </select>

          <select
            value={filterMode}
            onChange={(e) => onFilterModeChange(e.target.value as GenerationMode | '')}
            className="h-7 rounded-sm border border-line bg-surface px-1.5 text-xs text-content-secondary outline-none focus:border-accent"
          >
            <option value="">全部模式</option>
            <option value="A">模式 A · 材料</option>
            <option value="B">模式 B · 考据</option>
            <option value="C">模式 C · 混合</option>
          </select>
        </div>

        {/* Strict 1-row Common Tags Bar sorted by frequency; overflow hidden */}
        {commonTags.length > 0 && (
          <div className="mb-3 flex min-h-[24px] items-center gap-1.5">
            <span className="shrink-0 text-[11px] font-semibold text-content-muted">
              常用
            </span>
            <div className="tag-filter-bar flex-1">
              {commonTags.map((item) => {
                const active = selectedTags.includes(item.tag);
                return (
                  <button
                    key={item.tag}
                    type="button"
                    onClick={() => onToggleTag(item.tag)}
                    title={`${item.tag} (${item.count})`}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] leading-[18px] transition-colors ${
                      active
                        ? 'border-accent bg-accent font-medium text-content-inverse'
                        : 'border-line bg-canvas text-content-secondary hover:border-accent/60 hover:text-content-primary'
                    }`}
                  >
                    {item.tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1.5">
          {loading && cards.length === 0 && (
            <div className="py-8 text-center text-xs text-content-muted">
              加载角色库...
            </div>
          )}

          {!loading && cards.length === 0 && (
            <div className="rounded-md border border-dashed border-line p-4 text-center text-xs text-content-muted">
              暂无匹配角色卡，可在右侧创建或放宽筛选条件。
            </div>
          )}

          {cards.map((card) => {
            const active = card.id === selectedCardId;
            return (
              <div
                key={card.id}
                onClick={() => onSelectCard(card)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectCard(card);
                  }
                }}
                className={`group flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors ${
                  active
                    ? 'border-accent/40 bg-accent/10'
                    : 'border-transparent hover:bg-subtle'
                }`}
              >
                {card.imageUrl ? (
                  <img
                    src={card.imageUrl}
                    alt={card.characterName}
                    referrerPolicy="no-referrer"
                    className="aspect-[2/3] w-8 shrink-0 rounded-sm border border-line object-cover"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-8 shrink-0 items-center justify-center rounded-sm border border-line bg-subtle text-xs font-semibold text-accent">
                    {card.characterName.slice(0, 1)}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[13px] font-semibold text-content-primary">
                      {card.characterName}
                    </span>
                    <span className="tabular-nums shrink-0 font-mono text-[10.5px] text-content-muted">
                      v{card.version}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-content-muted">
                    <span className="truncate">
                      {card.workName || '原创设定'} · 模式{card.mode}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickPlaytest(card);
                      }}
                      title="快速试聊"
                      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10.5px] text-accent opacity-80 hover:bg-accent/10 group-hover:opacity-100"
                    >
                      <MessageSquare className="h-3 w-3" />
                      试聊
                    </button>
                  </div>

                  {card.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {card.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-line bg-subtle px-1.5 py-0 text-[10px] leading-4 text-content-secondary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
