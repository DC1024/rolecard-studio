import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  PORTRAIT_STYLE_LABELS,
  type ImageSearchItem,
  type PortraitPromptStyle,
} from '@rolecard/shared';
import {
  Copy,
  Crop,
  Link as LinkIcon,
  Loader2,
  Search,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';
import { useToast } from '../hooks/useToast';

interface PortraitCropModalProps {
  open: boolean;
  card: RoleCardDto;
  onClose: () => void;
  onSaveUpload: (dataUrl: string, imagePrompt?: string) => Promise<void>;
  onSaveUrl: (imageUrl: string, imagePrompt?: string) => Promise<void>;
}

function buildInitialPrompt(card: RoleCardDto): string {
  if (card.imagePrompt?.trim()) {
    return card.imagePrompt.trim();
  }
  const workHint = card.workName ? ` from ${card.workName}` : '';
  return `anime character portrait of ${card.characterName}${workHint}, detailed lighting, clean background`;
}

export function PortraitCropModal({
  open,
  card,
  onClose,
  onSaveUpload,
  onSaveUrl,
}: PortraitCropModalProps) {
  const cardName = card.characterName;
  const { copyWithToast, notifySuccess } = useToast();
  const [tab, setTab] = useState<'upload' | 'url' | 'search' | 'ai'>('upload');
  const [aspect, setAspect] = useState<'2:3' | '1:1'>('2:3');
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState(cardName);
  const [searchResults, setSearchResults] = useState<ImageSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(() => buildInitialPrompt(card));
  const [aiStyle, setAiStyle] = useState<PortraitPromptStyle>('anime');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiNegativePrompt, setAiNegativePrompt] = useState('');
  const [aiPromptNotes, setAiPromptNotes] = useState('');
  const [promptLoadingMode, setPromptLoadingMode] = useState<'generate' | 'optimize' | null>(null);
  const [aiSize, setAiSize] = useState<'1024x1536' | '1024x1024'>('1024x1536');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearchQuery(card.characterName);
    setAiPrompt(buildInitialPrompt(card));
    setAiNegativePrompt('');
    setAiPromptNotes('');
    setAiInstruction('');
    setError(null);
  }, [open, card.id, card.characterName, card.imagePrompt, card.workName]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  const canvasW = aspect === '2:3' ? 280 : 280;
  const canvasH = aspect === '2:3' ? 420 : 280;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (!imageEl) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('请先选择本地图片进行裁剪', canvasW / 2, canvasH / 2);
      return;
    }

    const coverScale = Math.max(canvasW / imageEl.width, canvasH / imageEl.height) * zoom;
    const drawW = imageEl.width * coverScale;
    const drawH = imageEl.height * coverScale;
    const dx = (canvasW - drawW) / 2 + offsetX;
    const dy = (canvasH - drawH) / 2 + offsetY;
    ctx.drawImage(imageEl, dx, dy, drawW, drawH);
  }, [imageEl, zoom, offsetX, offsetY, canvasW, canvasH]);

  if (!open) return null;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setImageEl(img);
        setZoom(1);
        setOffsetX(0);
        setOffsetY(0);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const exportCroppedPng = (): string | null => {
    if (!imageEl) return null;
    const outW = aspect === '2:3' ? 600 : 512;
    const outH = aspect === '2:3' ? 900 : 512;
    const offscreen = document.createElement('canvas');
    offscreen.width = outW;
    offscreen.height = outH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;

    const ratio = outW / canvasW;
    const coverScale = Math.max(canvasW / imageEl.width, canvasH / imageEl.height) * zoom;
    const drawW = imageEl.width * coverScale * ratio;
    const drawH = imageEl.height * coverScale * ratio;
    const dx = ((canvasW - imageEl.width * coverScale) / 2 + offsetX) * ratio;
    const dy = ((canvasH - imageEl.height * coverScale) / 2 + offsetY) * ratio;

    ctx.drawImage(imageEl, dx, dy, drawW, drawH);
    return offscreen.toDataURL('image/png');
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (tab === 'upload') {
        const dataUrl = exportCroppedPng();
        if (!dataUrl) {
          setError('请先选择要裁剪的图片');
          setSaving(false);
          return;
        }
        await onSaveUpload(dataUrl);
      } else {
        if (!imageUrlInput.trim()) {
          setError('请输入合法的 http(s) 图片 URL');
          setSaving(false);
          return;
        }
        await onSaveUrl(imageUrlInput.trim());
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存立绘失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-line bg-elevated p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crop className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-content-primary">
              立绘与头像裁剪 — {cardName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-content-muted hover:bg-subtle hover:text-content-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-4 gap-1 rounded-md border border-line bg-subtle p-1">
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'upload'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary'
            }`}
          >
            <Upload className="h-3 w-3" />
            本地裁剪
          </button>
          <button
            type="button"
            onClick={() => setTab('url')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'url'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary'
            }`}
          >
            <LinkIcon className="h-3 w-3" />
            外部直链
          </button>
          <button
            type="button"
            onClick={() => setTab('search')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'search'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary'
            }`}
          >
            <Search className="h-3 w-3" />
            搜图代理
          </button>
          <button
            type="button"
            onClick={() => setTab('ai')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'ai'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            AI 生图
          </button>
        </div>

        {tab === 'upload' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {(['2:3', '1:1'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAspect(preset)}
                    className={`rounded-sm border px-2.5 py-1 text-xs font-medium ${
                      aspect === preset
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-line bg-surface text-content-secondary'
                    }`}
                  >
                    {preset === '2:3' ? '2:3 酒馆立绘' : '1:1 VTT Token'}
                  </button>
                ))}
              </div>

              <label className="cursor-pointer rounded-sm border border-line bg-surface px-2.5 py-1 text-xs font-medium text-content-primary hover:bg-subtle">
                选择图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex justify-center rounded-lg border border-line bg-subtle p-3">
              <canvas
                ref={canvasRef}
                width={canvasW}
                height={canvasH}
                onMouseDown={(e) => {
                  dragRef.current = {
                    active: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    baseX: offsetX,
                    baseY: offsetY,
                  };
                }}
                onMouseMove={(e) => {
                  if (!dragRef.current.active) return;
                  setOffsetX(dragRef.current.baseX + (e.clientX - dragRef.current.startX));
                  setOffsetY(dragRef.current.baseY + (e.clientY - dragRef.current.startY));
                }}
                onMouseUp={() => {
                  dragRef.current.active = false;
                }}
                onMouseLeave={() => {
                  dragRef.current.active = false;
                }}
                className="max-h-[340px] w-auto cursor-grab rounded-md border border-line active:cursor-grabbing"
              />
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="text-content-secondary">缩放</span>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
              <span className="tabular-nums w-10 text-right font-mono text-content-muted">
                {zoom.toFixed(1)}x
              </span>
            </div>
          </div>
        )}

        {tab === 'url' && (
          <div className="space-y-2 py-2">
            <label className="block text-xs font-medium text-content-secondary">
              图片外链 URL（自动经 SSRF 校验，前端防盗链加载）
            </label>
            <input
              type="url"
              value={imageUrlInput}
              onChange={(e) => setImageUrlInput(e.target.value)}
              placeholder="https://example.com/portrait.png"
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 font-mono text-xs text-content-primary outline-none focus:border-accent"
            />
          </div>
        )}

        {tab === 'search' && (
          <div className="space-y-3 py-1">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="输入关键词检索公开图库..."
                className="h-8 flex-1 rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={searching || !searchQuery.trim()}
                onClick={async () => {
                  setSearching(true);
                  setError(null);
                  try {
                    const res = await api.searchImages({ query: searchQuery.trim(), limit: 6 });
                    setSearchResults(res.items);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '搜图失败');
                  } finally {
                    setSearching(false);
                  }
                }}
                className="inline-flex h-8 items-center gap-1 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
              >
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                搜索
              </button>
            </div>
            <div className="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto">
              {searchResults.map((item) => (
                <button
                  key={item.imageUrl}
                  type="button"
                  onClick={async () => {
                    await onSaveUrl(item.imageUrl);
                    onClose();
                  }}
                  className="group overflow-hidden rounded-sm border border-line bg-surface text-left hover:border-accent"
                >
                  <img
                    src={item.thumbUrl}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="h-24 w-full object-cover"
                  />
                  <div className="truncate px-1.5 py-1 text-[10px] text-content-secondary group-hover:text-accent">
                    {item.title}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-3 py-1 text-xs">
            <div className="rounded-sm border border-line bg-canvas p-2.5 text-[11px] space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-content-primary">
                  关联角色卡设定：{card.characterName}
                  {card.workName ? ` · ${card.workName}` : ''}
                </span>
                {card.imagePrompt && (
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                    已载入上次生图提示词
                  </span>
                )}
              </div>
              <p className="line-clamp-2 text-content-muted">
                外貌参考：{card.content.appearance || '（当前角色卡暂无外貌描述，将结合性格与背景推导）'}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-content-secondary">
                  目标画风预设
                </label>
                <select
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value as PortraitPromptStyle)}
                  className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-content-primary"
                >
                  {(Object.keys(PORTRAIT_STYLE_LABELS) as PortraitPromptStyle[]).map((key) => (
                    <option key={key} value={key}>
                      {PORTRAIT_STYLE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-content-secondary">
                  补充画面要求（可选）
                </label>
                <input
                  type="text"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  placeholder="如：夜雨霓虹、仰视构图、战损披风..."
                  className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-content-secondary">
                立绘英文生图提示词
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={promptLoadingMode !== null || aiGenerating}
                  onClick={async () => {
                    setPromptLoadingMode('generate');
                    setError(null);
                    try {
                      const res = await api.generatePortraitPrompt({
                        cardId: card.id,
                        mode: 'generate',
                        style: aiStyle,
                        draftPrompt: '',
                        instruction: aiInstruction.trim(),
                        characterName: card.characterName,
                        workName: card.workName,
                        appearance: card.content.appearance,
                        personality: card.content.personality,
                        background: card.content.background,
                        scenario: card.content.scenario,
                        tags: card.tags,
                      });
                      setAiPrompt(res.prompt);
                      setAiNegativePrompt(res.negativePrompt);
                      setAiPromptNotes(res.notes);
                      notifySuccess('已结合角色设定生成生图提示词');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : '生成生图提示词失败');
                    } finally {
                      setPromptLoadingMode(null);
                    }
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] font-medium text-accent hover:bg-accent/15 disabled:opacity-50"
                >
                  {promptLoadingMode === 'generate' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  结合角色卡生成
                </button>
                <button
                  type="button"
                  disabled={promptLoadingMode !== null || aiGenerating || !aiPrompt.trim()}
                  onClick={async () => {
                    setPromptLoadingMode('optimize');
                    setError(null);
                    try {
                      const res = await api.generatePortraitPrompt({
                        cardId: card.id,
                        mode: 'optimize',
                        style: aiStyle,
                        draftPrompt: aiPrompt.trim(),
                        instruction: aiInstruction.trim(),
                        characterName: card.characterName,
                        workName: card.workName,
                        appearance: card.content.appearance,
                        personality: card.content.personality,
                        background: card.content.background,
                        scenario: card.content.scenario,
                        tags: card.tags,
                      });
                      setAiPrompt(res.prompt);
                      setAiNegativePrompt(res.negativePrompt);
                      setAiPromptNotes(res.notes);
                      notifySuccess('已结合角色设定优化提示词');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : '优化生图提示词失败');
                    } finally {
                      setPromptLoadingMode(null);
                    }
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-[11px] font-medium text-content-primary hover:bg-subtle disabled:opacity-50"
                >
                  {promptLoadingMode === 'optimize' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  AI 优化当前提示词
                </button>
              </div>
            </div>

            <textarea
              rows={4}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="点击上方「结合角色卡生成」，或输入草稿后点「AI 优化当前提示词」..."
              className="w-full rounded-sm border border-line bg-surface p-2 font-mono text-xs text-content-primary outline-none focus:border-accent"
            />

            {(aiPromptNotes || aiNegativePrompt) && (
              <div className="space-y-1.5 rounded-sm border border-status-info/35 bg-status-info/5 p-2.5 text-[11px]">
                {aiPromptNotes && (
                  <p className="text-content-primary">
                    <span className="font-semibold text-status-info">提炼/优化说明：</span>
                    {aiPromptNotes}
                  </p>
                )}
                {aiNegativePrompt && (
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 font-mono text-[10px] text-content-muted">
                      <span className="font-sans font-semibold text-content-secondary">参考反向词：</span>
                      {aiNegativePrompt}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copyWithToast(aiNegativePrompt, '反向提示词')}
                      className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-line bg-surface px-1.5 py-0.5 text-[10px] text-content-secondary hover:text-content-primary"
                    >
                      <Copy className="h-2.5 w-2.5" />
                      复制
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <select
                value={aiSize}
                onChange={(e) => setAiSize(e.target.value as '1024x1536' | '1024x1024')}
                className="h-8 rounded-sm border border-line bg-surface px-2 text-xs text-content-primary"
              >
                <option value="1024x1536">2:3 竖版立绘 (1024×1536)</option>
                <option value="1024x1024">1:1 方图头像 (1024×1024)</option>
              </select>
              <button
                type="button"
                disabled={aiGenerating || promptLoadingMode !== null || !aiPrompt.trim()}
                onClick={async () => {
                  const usedPrompt = aiPrompt.trim();
                  setAiGenerating(true);
                  setError(null);
                  try {
                    const res = await api.generateImage({ prompt: usedPrompt, size: aiSize });
                    if (res.dataUrl) {
                      await onSaveUpload(res.dataUrl, usedPrompt);
                      onClose();
                    } else if (res.imageUrl) {
                      await onSaveUrl(res.imageUrl, usedPrompt);
                      onClose();
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'AI 生图失败');
                  } finally {
                    setAiGenerating(false);
                  }
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
              >
                {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {aiGenerating ? '生成中...' : '生成并应用立绘'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-content-secondary hover:bg-subtle"
          >
            取消
          </button>
          {(tab === 'upload' || tab === 'url') && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-8 rounded-sm bg-accent px-4 text-xs font-semibold text-content-inverse hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存立绘'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
