import type { CardType, GenerationMode } from '@rolecard/shared';
import {
  CircleDot,
  FileUp,
  LayoutGrid,
  MessageSquare,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';

interface CardGalleryProps {
  cards: RoleCardDto[];
  total: number;
  loading: boolean;
  canCreate: boolean;
  hasActiveFilters: boolean;
  searchQuery: string;
  selectedTags: string[];
  filterCardType: CardType | '';
  filterMode: GenerationMode | '';
  onResetFilters: () => void;
  onSelectCard: (card: RoleCardDto) => void;
  onQuickPlaytest: (card: RoleCardDto) => void;
  onGoGenerate: () => void;
  onOpenImport: () => void;
}

const CARD_TYPE_SHORT: Record<CardType, string> = {
  'sillytavern_v3': 'CCV3',
  'trpg_coc7': 'CoC 7e',
  'trpg_dnd5e': 'D&D 5e',
  general: '通用',
  custom: '自定义',
};

export function CardGallery({
  cards,
  total,
  loading,
  canCreate,
  hasActiveFilters,
  searchQuery,
  selectedTags,
  filterCardType,
  filterMode,
  onResetFilters,
  onSelectCard,
  onQuickPlaytest,
  onGoGenerate,
  onOpenImport,
}: CardGalleryProps) {
  return (
    <section className="space-y-4">
      {/* Gallery Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
            <LayoutGrid className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-content-primary">角色卡库</h1>
              <span className="tabular-nums rounded-full border border-line bg-subtle px-2 py-0.5 font-mono text-[11px] text-content-secondary">
                {cards.length} / {total}
              </span>
            </div>
            <p className="text-[11px] text-content-muted">
              统一 2:3 竖版立绘展示 · 点击任意卡片进入详情与衍生 1:1 VTT Token 裁剪
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-canvas px-2.5 text-xs text-content-secondary hover:border-accent/50 hover:text-content-primary"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              清空筛选
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={onGoGenerate}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse transition-colors hover:bg-accent-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              生成新卡
            </button>
          )}
        </div>
      </div>

      {/* Active Filter Chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-content-secondary">
          <span className="text-content-muted">当前筛选：</span>
          {searchQuery.trim() && (
            <span className="rounded-full border border-line bg-surface px-2 py-0.5">
              关键词「{searchQuery.trim()}」
            </span>
          )}
          {filterCardType && (
            <span className="rounded-full border border-line bg-surface px-2 py-0.5">
              规格 {CARD_TYPE_SHORT[filterCardType] ?? filterCardType}
            </span>
          )}
          {filterMode && (
            <span className="rounded-full border border-line bg-surface px-2 py-0.5">
              模式 {filterMode}
            </span>
          )}
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && cards.length === 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm"
            >
              <div className="aspect-[2/3] w-full animate-pulse bg-subtle" />
              <div className="space-y-2 p-3">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-subtle" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-subtle" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && cards.length === 0 && (
        <div className="flex min-h-[380px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface p-8 text-center">
          <Sparkles className="mb-3 h-9 w-9 text-accent/70" />
          <h3 className="text-sm font-semibold text-content-primary">
            {hasActiveFilters ? '没有符合当前筛选条件的角色卡' : '角色卡库还是空的'}
          </h3>
          <p className="mt-1 max-w-md text-xs text-content-muted">
            {hasActiveFilters
              ? '尝试调整左侧搜索关键词、规格/模式筛选或取消部分常用标签。'
              : '点击「生成新卡」结合材料/百科考据创建结构化角色卡，或直接导入旧版 PNG/JSON 角色卡升级。'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={onResetFilters}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-canvas px-3 text-xs font-medium text-content-primary hover:bg-subtle"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                清空筛选
              </button>
            )}
            {canCreate && (
              <>
                <button
                  type="button"
                  onClick={onGoGenerate}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  生成新卡
                </button>
                <button
                  type="button"
                  onClick={onOpenImport}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-content-primary hover:bg-subtle"
                >
                  <FileUp className="h-3.5 w-3.5 text-accent" />
                  导入旧卡升级
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 2:3 Portrait Card Grid */}
      {cards.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {cards.map((card) => (
            <div
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectCard(card)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectCard(card);
                }
              }}
              className="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-line bg-surface text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {/* Strict 2:3 Portrait Frame */}
              <div className="relative aspect-[2/3] w-full overflow-hidden bg-subtle">
                {card.imageUrl ? (
                  <img
                    src={api.resolveImageDisplayUrl(card.imageUrl) ?? card.imageUrl}
                    alt={card.characterName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-subtle via-canvas to-subtle p-4 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-2xl font-bold text-accent">
                      {card.characterName.slice(0, 1)}
                    </div>
                    <span className="mt-2.5 text-[11px] font-medium text-content-muted">
                      2:3 待补充立绘
                    </span>
                  </div>
                )}

                {/* Top Badges */}
                <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-1">
                  <span className="rounded bg-canvas/85 px-1.5 py-0.5 text-[10px] font-semibold text-content-primary shadow-sm backdrop-blur-sm">
                    {CARD_TYPE_SHORT[card.cardType] ?? card.cardType}
                  </span>
                  <div className="flex items-center gap-1">
                    {card.tokenImageUrl && (
                      <span
                        title="已衍生 1:1 VTT Token"
                        className="inline-flex items-center gap-0.5 rounded bg-accent/90 px-1.5 py-0.5 text-[10px] font-medium text-content-inverse shadow-sm"
                      >
                        <CircleDot className="h-2.5 w-2.5" />
                        1:1
                      </span>
                    )}
                    <span className="tabular-nums rounded bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] font-medium text-content-secondary shadow-sm backdrop-blur-sm">
                      v{card.version}
                    </span>
                  </div>
                </div>

                {/* Bottom Gradient Overlay */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent px-3 pb-2.5 pt-10 text-white">
                  <h3 className="truncate text-sm font-bold leading-snug tracking-tight">
                    {card.characterName}
                  </h3>
                  <p className="truncate text-[11px] text-slate-200/90">
                    {card.workName || '原创设定'} · 模式 {card.mode}
                  </p>
                </div>
              </div>

              {/* Card Footer */}
              <div className="flex flex-1 flex-col justify-between gap-2 p-2.5">
                {card.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {card.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="max-w-[90px] truncate rounded border border-line bg-subtle px-1.5 py-0 text-[10px] leading-4 text-content-secondary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="line-clamp-1 text-[11px] text-content-muted">
                    {card.content.summary || '点击查看完整角色卡档案'}
                  </p>
                )}

                <div className="flex items-center justify-between border-t border-line-subtle pt-2 text-[11px]">
                  <span className="tabular-nums font-mono text-content-muted">
                    {card.tokenCount} tok
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickPlaytest(card);
                    }}
                    className="inline-flex items-center gap-1 rounded-sm border border-line bg-canvas px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:border-accent/60 hover:bg-accent/10"
                  >
                    <MessageSquare className="h-3 w-3" />
                    快速试聊
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
