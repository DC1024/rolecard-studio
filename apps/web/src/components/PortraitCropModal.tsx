import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Crop, Link as LinkIcon, Upload, X } from 'lucide-react';

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
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [aspect, setAspect] = useState<'2:3' | '1:1'>('2:3');
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState('');
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

        <div className="mb-3 grid grid-cols-2 gap-1 rounded-md border border-line bg-subtle p-1">
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={`flex items-center justify-center gap-1.5 rounded-sm py-1.5 text-xs font-medium ${
              tab === 'upload'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary'
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            本地裁剪上传
          </button>
          <button
            type="button"
            onClick={() => setTab('url')}
            className={`flex items-center justify-center gap-1.5 rounded-sm py-1.5 text-xs font-medium ${
              tab === 'url'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary'
            }`}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            外部图片直链
          </button>
        </div>

        {tab === 'upload' ? (
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
        ) : (
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
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-8 rounded-sm bg-accent px-4 text-xs font-semibold text-content-inverse hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存立绘'}
          </button>
        </div>
      </div>
    </div>
  );
}
