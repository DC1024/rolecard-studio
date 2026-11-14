import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ImageSearchItem } from '@rolecard/shared';
import { Crop, Link as LinkIcon, Loader2, Search, Sparkles, Upload, X } from 'lucide-react';
import { api } from '../api/client';

interface PortraitCropModalProps {
  open: boolean;
  cardName: string;
  onClose: () => void;
  onSaveUpload: (dataUrl: string) => Promise<void>;
  onSaveUrl: (imageUrl: string) => Promise<void>;
}

export function PortraitCropModal({
  open,
  cardName,
  onClose,
  onSaveUpload,
  onSaveUrl,
}: PortraitCropModalProps) {
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
  const [aiPrompt, setAiPrompt] = useState(
    `anime character portrait of ${cardName}, detailed lighting, clean background`,
  );
  const [aiSize, setAiSize] = useState<'1024x1536' | '1024x1024'>('1024x1536');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <label className="block font-medium text-content-secondary">
              立绘生成提示词（调用已配置的生图兼容端点）
            </label>
            <textarea
              rows={3}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="w-full rounded-sm border border-line bg-surface p-2 font-mono text-xs text-content-primary outline-none focus:border-accent"
            />
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
                disabled={aiGenerating || !aiPrompt.trim()}
                onClick={async () => {
                  setAiGenerating(true);
                  setError(null);
                  try {
                    const res = await api.generateImage({ prompt: aiPrompt.trim(), size: aiSize });
                    if (res.dataUrl) {
                      await onSaveUpload(res.dataUrl);
                      onClose();
                    } else if (res.imageUrl) {
                      await onSaveUrl(res.imageUrl);
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
