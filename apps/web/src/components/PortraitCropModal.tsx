import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  BUILTIN_PORTRAIT_STYLE_PRESETS,
  type ImageSearchItem,
  type PortraitStylePresetDto,
  type TokenCrop,
} from '@rolecard/shared';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Copy,
  Crop,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';
import { useToast } from '../hooks/useToast';

export type PortraitModalTab = 'upload' | 'token' | 'url' | 'search' | 'ai';

interface PortraitCropModalProps {
  open: boolean;
  card: RoleCardDto;
  initialTab?: PortraitModalTab;
  onClose: () => void;
  onSaveUpload: (
    dataUrl: string,
    options?: {
      imagePrompt?: string;
      tokenDataUrl?: string;
      tokenCrop?: TokenCrop;
    },
  ) => Promise<void>;
  onSaveUrl: (
    imageUrl: string,
    options?: {
      imagePrompt?: string;
      tokenDataUrl?: string;
      tokenCrop?: TokenCrop;
    },
  ) => Promise<void>;
  onSaveToken: (tokenDataUrl: string, tokenCrop: TokenCrop) => Promise<void>;
}

const DEFAULT_TOKEN_CROP: TokenCrop = {
  x: 0,
  y: 0.05,
  size: 1,
};

function clampTokenCrop(crop: TokenCrop, width: number, height: number): TokenCrop {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const size = Math.max(0.35, Math.min(1, crop.size));
  const minDim = Math.min(safeW, safeH);
  const sidePx = minDim * size;
  const maxX = Math.max(0, (safeW - sidePx) / safeW);
  const maxY = Math.max(0, (safeH - sidePx) / safeH);
  return {
    size,
    x: Math.max(0, Math.min(maxX, crop.x)),
    y: Math.max(0, Math.min(maxY, crop.y)),
  };
}

function resolveCropPixels(crop: TokenCrop, width: number, height: number) {
  const clamped = clampTokenCrop(crop, width, height);
  const side = Math.min(width, height) * clamped.size;
  const sx = Math.max(0, Math.min(width - side, clamped.x * width));
  const sy = Math.max(0, Math.min(height - side, clamped.y * height));
  return { sx, sy, side, clamped };
}

function canvasToSafeDataUrl(canvas: HTMLCanvasElement): string {
  const pngUrl = canvas.toDataURL('image/png');
  if (pngUrl.length <= 3_600_000) {
    return pngUrl;
  }
  const webpUrl = canvas.toDataURL('image/webp', 0.92);
  if (webpUrl.length <= 3_600_000) {
    return webpUrl;
  }
  return canvas.toDataURL('image/jpeg', 0.9);
}

function renderTokenDataUrlFromSource(
  source: HTMLImageElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  crop: TokenCrop,
  outSize = 512,
): string {
  const { sx, sy, side } = resolveCropPixels(crop, srcW, srcH);
  const out = document.createElement('canvas');
  out.width = outSize;
  out.height = outSize;
  const ctx = out.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, outSize, outSize);
  return canvasToSafeDataUrl(out);
}

function renderPortrait2By3DataUrl(
  img: HTMLImageElement,
  targetW = 600,
  targetH = 900,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const scale = Math.max(targetW / img.width, targetH / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const dx = (targetW - drawW) / 2;
  const dy = (targetH - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return canvasToSafeDataUrl(canvas);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

async function localizeRemoteImageTo2By3AndToken(
  remoteUrl: string,
  fallbackUrl?: string,
): Promise<{ portraitDataUrl: string; tokenDataUrl?: string }> {
  let img: HTMLImageElement;
  try {
    img = await loadImageElement(api.getImageProxyUrl(remoteUrl));
  } catch (primaryErr) {
    if (fallbackUrl && fallbackUrl !== remoteUrl) {
      img = await loadImageElement(api.getImageProxyUrl(fallbackUrl));
    } else {
      throw primaryErr;
    }
  }
  const portraitDataUrl = renderPortrait2By3DataUrl(img, 600, 900);
  if (!portraitDataUrl) {
    throw new Error('立绘本地化编码失败');
  }
  const tokenDataUrl = renderTokenDataUrlFromSource(
    img,
    img.width,
    img.height,
    DEFAULT_TOKEN_CROP,
    512,
  );
  return {
    portraitDataUrl,
    ...(tokenDataUrl ? { tokenDataUrl } : {}),
  };
}

function buildInitialPrompt(card: RoleCardDto): string {
  if (card.imagePrompt?.trim()) {
    return card.imagePrompt.trim();
  }
  const workHint = card.workName ? ` from ${card.workName}` : '';
  return `character portrait of ${card.characterName}${workHint}, vertical 2:3 composition, detailed lighting, clean background`;
}

const LAST_STYLE_STORAGE_KEY = 'rc_last_portrait_style_id';

const FALLBACK_STYLE_PRESETS: PortraitStylePresetDto[] = BUILTIN_PORTRAIT_STYLE_PRESETS.map(
  (def) => ({
    id: def.id,
    name: def.name,
    stylePrompt: def.stylePrompt,
    negativePromptHint: def.negativePromptHint,
    instructionHint: def.instructionHint,
    isBuiltin: true,
    isCustomized: false,
    sortOrder: def.sortOrder,
    createdAt: '',
    updatedAt: '',
  }),
);

function readSavedStyleId(): string {
  try {
    return window.localStorage.getItem(LAST_STYLE_STORAGE_KEY) || 'anime';
  } catch {
    return 'anime';
  }
}

function writeSavedStyleId(id: string): void {
  try {
    window.localStorage.setItem(LAST_STYLE_STORAGE_KEY, id);
  } catch {
    // ignore storage errors
  }
}

export function PortraitCropModal({
  open,
  card,
  initialTab = 'upload',
  onClose,
  onSaveUpload,
  onSaveUrl,
  onSaveToken,
}: PortraitCropModalProps) {
  const cardName = card.characterName;
  const { copyWithToast, notifySuccess } = useToast();

  const [tab, setTab] = useState<PortraitModalTab>(initialTab);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);

  const [syncTokenOnUpload, setSyncTokenOnUpload] = useState(true);
  const [tokenCrop, setTokenCrop] = useState<TokenCrop>(card.tokenCrop ?? DEFAULT_TOKEN_CROP);
  const [sourcePortraitEl, setSourcePortraitEl] = useState<HTMLImageElement | null>(null);
  const [loadingSourcePortrait, setLoadingSourcePortrait] = useState(false);

  const [imageUrlInput, setImageUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState(cardName);
  const [searchResults, setSearchResults] = useState<ImageSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingSearchUrl, setApplyingSearchUrl] = useState<string | null>(null);
  const [failedThumbUrls, setFailedThumbUrls] = useState<Record<string, boolean>>({});
  const [aiPrompt, setAiPrompt] = useState(() => buildInitialPrompt(card));
  const [stylePresets, setStylePresets] = useState<PortraitStylePresetDto[]>(FALLBACK_STYLE_PRESETS);
  const [selectedStyleId, setSelectedStyleId] = useState<string>(() => readSavedStyleId());
  const [draftStylePrompt, setDraftStylePrompt] = useState<string>('');
  const [draftNegativeHint, setDraftNegativeHint] = useState<string>('');
  const [draftInstructionHint, setDraftInstructionHint] = useState<string>('');
  const [styleEditorOpen, setStyleEditorOpen] = useState<boolean>(false);
  const [styleActionMode, setStyleActionMode] = useState<
    'none' | 'create' | 'save_as' | 'rename' | 'delete_confirm'
  >('none');
  const [styleNameInput, setStyleNameInput] = useState<string>('');
  const [styleBusy, setStyleBusy] = useState<boolean>(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiNegativePrompt, setAiNegativePrompt] = useState('');
  const [aiPromptNotes, setAiPromptNotes] = useState('');
  const [promptLoadingMode, setPromptLoadingMode] = useState<'generate' | 'optimize' | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedStyle =
    stylePresets.find((item) => item.id === selectedStyleId) ?? stylePresets[0] ?? null;

  const isStyleDirty =
    selectedStyle !== null &&
    (draftStylePrompt.trim() !== selectedStyle.stylePrompt.trim() ||
      draftNegativeHint.trim() !== selectedStyle.negativePromptHint.trim() ||
      draftInstructionHint.trim() !== selectedStyle.instructionHint.trim());

  const applySelectedPreset = (preset: PortraitStylePresetDto, openIfBlank = false) => {
    setSelectedStyleId(preset.id);
    writeSavedStyleId(preset.id);
    setDraftStylePrompt(preset.stylePrompt);
    setDraftNegativeHint(preset.negativePromptHint);
    setDraftInstructionHint(preset.instructionHint);
    setStyleActionMode('none');
    if (openIfBlank && preset.id === 'blank') {
      setStyleEditorOpen(true);
    }
  };

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setSearchQuery(card.characterName);
    setAiPrompt(buildInitialPrompt(card));
    setAiNegativePrompt('');
    setAiPromptNotes('');
    setAiInstruction('');
    setStyleActionMode('none');
    setApplyingSearchUrl(null);
    setFailedThumbUrls({});
    setTokenCrop(card.tokenCrop ?? DEFAULT_TOKEN_CROP);
    setError(null);

    let cancelled = false;
    api
      .listPortraitStyles()
      .then((res) => {
        if (cancelled || !Array.isArray(res.styles) || res.styles.length === 0) return;
        setStylePresets(res.styles);
        const preferredId = readSavedStyleId();
        const found =
          res.styles.find((item) => item.id === preferredId) ??
          res.styles.find((item) => item.id === 'anime') ??
          res.styles[0];
        if (found) {
          setSelectedStyleId(found.id);
          setDraftStylePrompt(found.stylePrompt);
          setDraftNegativeHint(found.negativePromptHint);
          setDraftInstructionHint(found.instructionHint);
        }
      })
      .catch(() => {
        // Keep fallback built-in presets if style list fails to load
        const preferredId = readSavedStyleId();
        const found =
          FALLBACK_STYLE_PRESETS.find((item) => item.id === preferredId) ??
          FALLBACK_STYLE_PRESETS.find((item) => item.id === 'anime') ??
          FALLBACK_STYLE_PRESETS[0];
        if (found) {
          setSelectedStyleId(found.id);
          setDraftStylePrompt(found.stylePrompt);
          setDraftNegativeHint(found.negativePromptHint);
          setDraftInstructionHint(found.instructionHint);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, initialTab, card.id, card.characterName, card.imagePrompt, card.workName, card.tokenCrop]);

  // Load existing 2:3 portrait via same-origin proxy for CORS-free 1:1 Token cropping
  useEffect(() => {
    if (!open || tab !== 'token' || !card.imageUrl) {
      return;
    }
    let cancelled = false;
    setLoadingSourcePortrait(true);
    setError(null);

    const sourceUrl = `${api.getPortraitSourceUrl(card.id)}?v=${encodeURIComponent(card.updatedAt)}`;
    loadImageElement(sourceUrl)
      .then((img) => {
        if (!cancelled) {
          setSourcePortraitEl(img);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSourcePortraitEl(null);
          setError(err instanceof Error ? err.message : '加载当前 2:3 立绘失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSourcePortrait(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, tab, card.id, card.imageUrl, card.updatedAt]);

  const uploadCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadTokenPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const tokenCropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tokenCirclePreviewRef = useRef<HTMLCanvasElement | null>(null);

  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  const tokenDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    baseCropX: number;
    baseCropY: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    baseCropX: 0,
    baseCropY: 0,
  });

  // Strict 2:3 canvas dimensions
  const canvasW = 240;
  const canvasH = 360;

  // Draw Upload 2:3 preview + derived 1:1 preview
  useEffect(() => {
    const canvas = uploadCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (!imageEl) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('选择本地图片裁剪为 2:3 立绘', canvasW / 2, canvasH / 2);

      const tPrev = uploadTokenPreviewRef.current?.getContext('2d');
      if (tPrev) {
        tPrev.clearRect(0, 0, 128, 128);
        tPrev.fillStyle = '#0f172a';
        tPrev.fillRect(0, 0, 128, 128);
      }
      return;
    }

    const coverScale = Math.max(canvasW / imageEl.width, canvasH / imageEl.height) * zoom;
    const drawW = imageEl.width * coverScale;
    const drawH = imageEl.height * coverScale;
    const dx = (canvasW - drawW) / 2 + offsetX;
    const dy = (canvasH - drawH) / 2 + offsetY;
    ctx.drawImage(imageEl, dx, dy, drawW, drawH);

    if (syncTokenOnUpload) {
      const { sx, sy, side } = resolveCropPixels(tokenCrop, canvasW, canvasH);
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx, sy, side, side);
      ctx.restore();

      const previewCanvas = uploadTokenPreviewRef.current;
      const pCtx = previewCanvas?.getContext('2d');
      if (previewCanvas && pCtx) {
        pCtx.clearRect(0, 0, 128, 128);
        pCtx.drawImage(canvas, sx, sy, side, side, 0, 0, 128, 128);
      }
    }
  }, [imageEl, zoom, offsetX, offsetY, syncTokenOnUpload, tokenCrop]);

  // Draw Token Cropper (derived from existing 2:3 portrait)
  useEffect(() => {
    if (tab !== 'token') return;
    const canvas = tokenCropCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvasW, canvasH);

    if (!sourcePortraitEl) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        loadingSourcePortrait ? '加载 2:3 原立绘...' : '当前角色卡暂无立绘',
        canvasW / 2,
        canvasH / 2,
      );
      return;
    }

    // Fit 2:3 source portrait inside 240x360 with cover
    const scale = Math.max(canvasW / sourcePortraitEl.width, canvasH / sourcePortraitEl.height);
    const drawW = sourcePortraitEl.width * scale;
    const drawH = sourcePortraitEl.height * scale;
    const dx = (canvasW - drawW) / 2;
    const dy = (canvasH - drawH) / 2;
    ctx.drawImage(sourcePortraitEl, dx, dy, drawW, drawH);

    const { sx, sy, side } = resolveCropPixels(tokenCrop, canvasW, canvasH);

    // Draw live previews before painting overlay
    const circleCanvas = tokenCirclePreviewRef.current;
    const circleCtx = circleCanvas?.getContext('2d');
    if (circleCanvas && circleCtx) {
      circleCtx.clearRect(0, 0, 128, 128);
      circleCtx.drawImage(canvas, sx, sy, side, side, 0, 0, 128, 128);
    }

    // Dim outside 1:1 region
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, canvasW, canvasH);
    ctx.rect(sx, sy, side, side);
    ctx.fill('evenodd');

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, side, side);

    // Circular VTT guide ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(sx + side / 2, sy + side / 2, side / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [tab, sourcePortraitEl, loadingSourcePortrait, tokenCrop]);

  if (!open) return null;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setImageEl(img);
        setZoom(1);
        setOffsetX(0);
        setOffsetY(0);
        setTokenCrop(DEFAULT_TOKEN_CROP);
        setError(null);
      };
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const exportCropped2By3AndToken = (): {
    portraitDataUrl: string;
    tokenDataUrl?: string;
    clampedCrop?: TokenCrop;
  } | null => {
    if (!imageEl) return null;
    const outW = 600;
    const outH = 900;
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
    const portraitDataUrl = offscreen.toDataURL('image/png');

    if (!syncTokenOnUpload) {
      return { portraitDataUrl };
    }

    const clampedCrop = clampTokenCrop(tokenCrop, outW, outH);
    const tokenDataUrl = renderTokenDataUrlFromSource(offscreen, outW, outH, clampedCrop, 512);
    return { portraitDataUrl, tokenDataUrl, clampedCrop };
  };

  const exportDerivedTokenFromSource = (): {
    tokenDataUrl: string;
    clampedCrop: TokenCrop;
  } | null => {
    if (!sourcePortraitEl) return null;
    // First normalize source portrait into a clean 600x900 2:3 cover canvas so coordinates match preview 240x360
    const baseW = 600;
    const baseH = 900;
    const offscreen = document.createElement('canvas');
    offscreen.width = baseW;
    offscreen.height = baseH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;
    const scale = Math.max(baseW / sourcePortraitEl.width, baseH / sourcePortraitEl.height);
    const drawW = sourcePortraitEl.width * scale;
    const drawH = sourcePortraitEl.height * scale;
    ctx.drawImage(sourcePortraitEl, (baseW - drawW) / 2, (baseH - drawH) / 2, drawW, drawH);

    const clampedCrop = clampTokenCrop(tokenCrop, baseW, baseH);
    const tokenDataUrl = renderTokenDataUrlFromSource(offscreen, baseW, baseH, clampedCrop, 512);
    return { tokenDataUrl, clampedCrop };
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (tab === 'upload') {
        const exported = exportCropped2By3AndToken();
        if (!exported) {
          setError('请先选择要裁剪的图片');
          setSaving(false);
          return;
        }
        await onSaveUpload(exported.portraitDataUrl, {
          ...(exported.tokenDataUrl ? { tokenDataUrl: exported.tokenDataUrl } : {}),
          ...(exported.clampedCrop ? { tokenCrop: exported.clampedCrop } : {}),
        });
      } else if (tab === 'token') {
        const derived = exportDerivedTokenFromSource();
        if (!derived) {
          setError('当前角色卡尚无可用的 2:3 立绘，请先上传或生成 2:3 立绘');
          setSaving(false);
          return;
        }
        await onSaveToken(derived.tokenDataUrl, derived.clampedCrop);
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
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setFailedThumbUrls({});
    setError(null);
    try {
      const res = await api.searchImages({ query: q, limit: 6 });
      setSearchResults(res.items);
      if (res.items.length === 0) {
        setError('未找到匹配的 Wikimedia 开源图片，可尝试英文关键词');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜图失败');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-elevated p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crop className="h-4 w-4 text-accent" />
            <div>
              <h3 className="text-sm font-semibold text-content-primary">
                2:3 角色立绘与 1:1 VTT Token 裁剪 — {cardName}
              </h3>
              <p className="text-[11px] text-content-muted">
                主立绘统一采用 2:3 竖版比例；1:1 VTT Token 均由 2:3 立绘裁剪衍生
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-content-muted hover:bg-subtle hover:text-content-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 grid grid-cols-5 gap-1 rounded-md border border-line bg-subtle p-1">
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'upload'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            <Upload className="h-3 w-3" />
            2:3 上传裁剪
          </button>
          <button
            type="button"
            onClick={() => setTab('token')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'token'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            <CircleDot className="h-3 w-3" />
            1:1 Token
          </button>
          <button
            type="button"
            onClick={() => setTab('ai')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'ai'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            AI 生图
          </button>
          <button
            type="button"
            onClick={() => setTab('search')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'search'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            <Search className="h-3 w-3" />
            搜图代理
          </button>
          <button
            type="button"
            onClick={() => setTab('url')}
            className={`flex items-center justify-center gap-1 rounded-sm py-1.5 text-[11px] font-medium ${
              tab === 'url'
                ? 'bg-surface text-content-primary shadow-sm'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            <LinkIcon className="h-3 w-3" />
            外部直链
          </button>
        </div>

        {tab === 'upload' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                  2:3 统一主立绘 (600×900)
                </span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-content-secondary">
                  <input
                    type="checkbox"
                    checked={syncTokenOnUpload}
                    onChange={(e) => setSyncTokenOnUpload(e.target.checked)}
                    className="accent-accent"
                  />
                  同步从 2:3 裁剪 1:1 VTT Token
                </label>
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

            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center rounded-lg border border-line bg-subtle p-3">
                <canvas
                  ref={uploadCanvasRef}
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
                  className="w-[200px] cursor-grab rounded-md border border-line active:cursor-grabbing"
                />
                <div className="mt-2.5 flex w-full items-center gap-2 text-xs">
                  <span className="text-[11px] text-content-secondary">缩放</span>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.05}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="flex-1 accent-accent"
                  />
                  <span className="tabular-nums w-9 text-right font-mono text-[11px] text-content-muted">
                    {zoom.toFixed(1)}x
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-lg border border-line bg-canvas p-3 text-xs">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-content-primary">
                      衍生 1:1 VTT Token 实时取景 (512×512)
                    </div>
                    <p className="mt-0.5 text-[11px] text-content-muted">
                      蓝色虚线框即生成的 1:1 VTT Token 区域，默认靠上取景避免裁切头部。
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <canvas
                      ref={uploadTokenPreviewRef}
                      width={128}
                      height={128}
                      className="h-24 w-24 rounded-full border-2 border-accent/60 bg-subtle shadow-sm"
                    />
                    <div className="flex-1 space-y-2 text-[11px]">
                      <div>
                        <div className="mb-0.5 flex justify-between text-content-secondary">
                          <span>上下位置</span>
                          <span className="font-mono">{Math.round(tokenCrop.y * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={0.34}
                          step={0.01}
                          disabled={!syncTokenOnUpload}
                          value={tokenCrop.y}
                          onChange={(e) =>
                            setTokenCrop((prev) => ({ ...prev, y: Number(e.target.value) }))
                          }
                          className="w-full accent-accent"
                        />
                      </div>
                      <div>
                        <div className="mb-0.5 flex justify-between text-content-secondary">
                          <span>取景范围</span>
                          <span className="font-mono">{Math.round(tokenCrop.size * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.45}
                          max={1}
                          step={0.02}
                          disabled={!syncTokenOnUpload}
                          value={tokenCrop.size}
                          onChange={(e) =>
                            setTokenCrop((prev) => ({ ...prev, size: Number(e.target.value) }))
                          }
                          className="w-full accent-accent"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-sm border border-line-subtle bg-subtle px-2.5 py-2 text-[11px] text-content-muted">
                  保存后同时写入 2:3 主立绘与 1:1 VTT Token，Foundry VTT 导出将自动引用 1:1 Token。
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'token' && (
          <div className="space-y-3">
            {!card.imageUrl ? (
              <div className="rounded-lg border border-dashed border-line bg-subtle p-6 text-center text-xs text-content-muted">
                当前角色卡尚未设置 2:3 立绘，请先在「2:3 上传裁剪」或「AI 生图」设置主立绘后再裁剪 1:1 VTT Token。
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <div className="flex flex-col items-center rounded-lg border border-line bg-subtle p-3">
                  <canvas
                    ref={tokenCropCanvasRef}
                    width={canvasW}
                    height={canvasH}
                    onMouseDown={(e) => {
                      tokenDragRef.current = {
                        active: true,
                        startX: e.clientX,
                        startY: e.clientY,
                        baseCropX: tokenCrop.x,
                        baseCropY: tokenCrop.y,
                      };
                    }}
                    onMouseMove={(e) => {
                      if (!tokenDragRef.current.active) return;
                      const dxNorm = (e.clientX - tokenDragRef.current.startX) / 200;
                      const dyNorm = (e.clientY - tokenDragRef.current.startY) / 300;
                      setTokenCrop((prev) =>
                        clampTokenCrop(
                          {
                            ...prev,
                            x: tokenDragRef.current.baseCropX + dxNorm,
                            y: tokenDragRef.current.baseCropY + dyNorm,
                          },
                          canvasW,
                          canvasH,
                        ),
                      );
                    }}
                    onMouseUp={() => {
                      tokenDragRef.current.active = false;
                    }}
                    onMouseLeave={() => {
                      tokenDragRef.current.active = false;
                    }}
                    className="w-[200px] cursor-move rounded-md border border-line"
                  />
                  <span className="mt-1.5 text-[11px] text-content-muted">
                    在 2:3 原立绘上拖动蓝色方框以调整 1:1 取景区域
                  </span>
                </div>

                <div className="flex flex-col justify-between rounded-lg border border-line bg-canvas p-3.5 text-xs">
                  <div className="space-y-3">
                    <div>
                      <div className="font-semibold text-content-primary">
                        从 2:3 立绘衍生 1:1 VTT Token
                      </div>
                      <p className="mt-0.5 text-[11px] text-content-muted">
                        不影响原 2:3 主立绘展示，仅导出并更新 512×512 1:1 Token 头像用于 VTT 棋子与列表引用。
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <canvas
                          ref={tokenCirclePreviewRef}
                          width={128}
                          height={128}
                          className="h-24 w-24 rounded-full border-2 border-accent shadow-sm"
                        />
                        <span className="mt-1 block text-[10.5px] text-content-muted">圆形 Token 预览</span>
                      </div>
                      <div className="flex-1 space-y-2.5 text-[11px]">
                        <div>
                          <div className="mb-1 flex justify-between text-content-secondary">
                            <span>取景框大小</span>
                            <span className="font-mono">{Math.round(tokenCrop.size * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.4}
                            max={1}
                            step={0.02}
                            value={tokenCrop.size}
                            onChange={(e) =>
                              setTokenCrop((prev) =>
                                clampTokenCrop(
                                  { ...prev, size: Number(e.target.value) },
                                  canvasW,
                                  canvasH,
                                ),
                              )
                            }
                            className="w-full accent-accent"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setTokenCrop(DEFAULT_TOKEN_CROP)}
                          className="rounded-sm border border-line bg-surface px-2.5 py-1 text-[11px] text-content-secondary hover:bg-subtle hover:text-content-primary"
                        >
                          重置为头肩默认取景
                        </button>
                      </div>
                    </div>
                  </div>

                  {card.tokenImageUrl && (
                    <div className="mt-3 flex items-center gap-2 rounded-sm border border-line-subtle bg-subtle px-2.5 py-1.5 text-[11px] text-content-secondary">
                      <img
                        src={api.resolveImageDisplayUrl(card.tokenImageUrl) ?? card.tokenImageUrl}
                        alt="当前 1:1 Token"
                        className="h-7 w-7 rounded-full border border-line object-cover"
                      />
                      <span>当前已存在已裁剪的 1:1 VTT Token，保存将覆盖更新。</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'url' && (
          <div className="space-y-2 py-2">
            <label className="block text-xs font-medium text-content-secondary">
              2:3 立绘外链 URL（自动经 SSRF 校验；保存后可切至「1:1 Token」衍生裁剪）
            </label>
            <input
              type="url"
              value={imageUrlInput}
              onChange={(e) => setImageUrlInput(e.target.value)}
              placeholder="https://example.com/portrait-2x3.png"
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSearch();
                  }
                }}
                placeholder="输入角色名 / 英文名搜索 Wikimedia 开源图片..."
                className="h-8 flex-1 rounded-sm border border-line bg-surface px-3 text-xs text-content-primary outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={searching}
                className="h-8 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
              >
                {searching ? '搜索中...' : '搜索'}
              </button>
            </div>

            <p className="text-[11px] text-content-muted">
              缩略图经服务端同源媒体代理加载；点击任一结果将自动转存为本地 2:3 立绘与 1:1 Token。
            </p>

            <div className="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto">
              {searchResults.map((item) => {
                const isApplying = applyingSearchUrl === item.imageUrl;
                const thumbFailed = Boolean(failedThumbUrls[item.imageUrl]);
                return (
                  <button
                    key={item.imageUrl}
                    type="button"
                    disabled={saving || applyingSearchUrl !== null}
                    onClick={async () => {
                      setSaving(true);
                      setApplyingSearchUrl(item.imageUrl);
                      setError(null);
                      try {
                        const localized = await localizeRemoteImageTo2By3AndToken(
                          item.imageUrl,
                          item.thumbUrl,
                        );
                        await onSaveUpload(localized.portraitDataUrl, {
                          ...(localized.tokenDataUrl
                            ? {
                                tokenDataUrl: localized.tokenDataUrl,
                                tokenCrop: DEFAULT_TOKEN_CROP,
                              }
                            : {}),
                        });
                        onClose();
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : '转存搜索立绘失败，请检查代理链路或改选其他结果',
                        );
                      } finally {
                        setApplyingSearchUrl(null);
                        setSaving(false);
                      }
                    }}
                    className="group relative overflow-hidden rounded-md border border-line bg-surface text-left hover:border-accent disabled:cursor-wait disabled:opacity-75"
                  >
                    {thumbFailed ? (
                      <div className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-1 bg-subtle px-2 text-center text-[10px] text-content-muted">
                        <span>缩略图加载失败</span>
                        <span className="text-[9px] text-content-muted/80">仍可点击尝试转存</span>
                      </div>
                    ) : (
                      <img
                        src={api.getImageProxyUrl(item.thumbUrl)}
                        alt={item.title}
                        onError={() =>
                          setFailedThumbUrls((prev) => ({
                            ...prev,
                            [item.imageUrl]: true,
                          }))
                        }
                        className="aspect-[2/3] w-full object-cover"
                      />
                    )}
                    {isApplying && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-canvas/75 text-[11px] font-medium text-content-primary backdrop-blur-[1px]">
                        <Loader2 className="h-4 w-4 animate-spin text-accent" />
                        <span>拉取并转存中...</span>
                      </div>
                    )}
                    <div className="truncate px-1.5 py-1 text-[10px] text-content-secondary group-hover:text-accent">
                      {item.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-3 py-1 text-xs">
            <div className="space-y-1 rounded-sm border border-line bg-canvas p-2.5 text-[11px]">
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

            <div className="space-y-2 rounded-sm border border-line bg-subtle/40 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <label className="shrink-0 text-[11px] font-medium text-content-secondary">
                    画风预设
                  </label>
                  <select
                    value={selectedStyleId}
                    onChange={(e) => {
                      const next = stylePresets.find((item) => item.id === e.target.value);
                      if (next) applySelectedPreset(next, true);
                    }}
                    className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 text-xs text-content-primary"
                  >
                    <optgroup label="系统预设">
                      {stylePresets
                        .filter((item) => item.isBuiltin)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                            {item.isCustomized ? '（已修改）' : ''}
                          </option>
                        ))}
                    </optgroup>
                    {stylePresets.some((item) => !item.isBuiltin) && (
                      <optgroup label="我的自定义风格">
                        {stylePresets
                          .filter((item) => !item.isBuiltin)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    disabled={styleBusy}
                    onClick={() => {
                      setStyleActionMode((prev) => (prev === 'create' ? 'none' : 'create'));
                      setStyleNameInput('');
                      setError(null);
                    }}
                    title="新建一条完全空白的自定义风格预设"
                    className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-surface px-2 text-[11px] font-medium text-content-primary hover:bg-subtle disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    新建空白
                  </button>

                  <button
                    type="button"
                    disabled={styleBusy || !selectedStyle || !isStyleDirty}
                    onClick={async () => {
                      if (!selectedStyle) return;
                      setStyleBusy(true);
                      setError(null);
                      try {
                        const res = await api.updatePortraitStyle(selectedStyle.id, {
                          stylePrompt: draftStylePrompt,
                          negativePromptHint: draftNegativeHint,
                          instructionHint: draftInstructionHint,
                        });
                        setStylePresets((prev) =>
                          prev.map((item) => (item.id === res.style.id ? res.style : item)),
                        );
                        applySelectedPreset(res.style);
                        notifySuccess(`已保存风格「${res.style.name}」`);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : '保存风格预设失败');
                      } finally {
                        setStyleBusy(false);
                      }
                    }}
                    className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-[11px] font-medium disabled:opacity-45 ${
                      isStyleDirty
                        ? 'border-accent bg-accent text-content-inverse hover:bg-accent-hover'
                        : 'border-line bg-surface text-content-secondary'
                    }`}
                  >
                    <Save className="h-3 w-3" />
                    保存
                  </button>

                  <button
                    type="button"
                    disabled={styleBusy}
                    onClick={() => {
                      setStyleActionMode((prev) => (prev === 'save_as' ? 'none' : 'save_as'));
                      setStyleNameInput(
                        selectedStyle ? `${selectedStyle.name} 副本` : '我的自定义风格',
                      );
                      setError(null);
                    }}
                    className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-surface px-2 text-[11px] font-medium text-content-primary hover:bg-subtle disabled:opacity-50"
                  >
                    <Copy className="h-3 w-3" />
                    另存为
                  </button>

                  {selectedStyle && (
                    <button
                      type="button"
                      disabled={styleBusy}
                      onClick={() => {
                        setStyleActionMode((prev) => (prev === 'rename' ? 'none' : 'rename'));
                        setStyleNameInput(selectedStyle.name);
                        setError(null);
                      }}
                      className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-surface px-2 text-[11px] font-medium text-content-primary hover:bg-subtle disabled:opacity-50"
                    >
                      <Pencil className="h-3 w-3" />
                      重命名
                    </button>
                  )}

                  {selectedStyle?.isBuiltin && selectedStyle.isCustomized && (
                    <button
                      type="button"
                      disabled={styleBusy}
                      onClick={async () => {
                        setStyleBusy(true);
                        setError(null);
                        try {
                          const res = await api.resetPortraitStyle(selectedStyle.id);
                          setStylePresets((prev) =>
                            prev.map((item) => (item.id === res.style.id ? res.style : item)),
                          );
                          applySelectedPreset(res.style);
                          notifySuccess(`已将「${res.style.name}」恢复为系统默认设定`);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : '恢复默认设定失败');
                        } finally {
                          setStyleBusy(false);
                        }
                      }}
                      className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-status-warning/50 bg-status-warning/10 px-2 text-[11px] font-medium text-status-warning hover:bg-status-warning/15 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" />
                      恢复默认
                    </button>
                  )}

                  {selectedStyle && !selectedStyle.isBuiltin && (
                    <button
                      type="button"
                      disabled={styleBusy}
                      onClick={() => {
                        setStyleActionMode((prev) =>
                          prev === 'delete_confirm' ? 'none' : 'delete_confirm',
                        );
                        setError(null);
                      }}
                      className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-status-danger/40 bg-status-danger/10 px-2 text-[11px] font-medium text-status-danger hover:bg-status-danger/15 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setStyleEditorOpen((prev) => !prev)}
                    className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-line bg-surface px-2 text-[11px] text-content-secondary hover:text-content-primary"
                  >
                    {styleEditorOpen ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        收起设定
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        编辑风格{isStyleDirty ? ' *' : ''}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {styleActionMode !== 'none' && (
                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface p-2">
                  {styleActionMode === 'delete_confirm' && selectedStyle ? (
                    <>
                      <span className="flex-1 text-[11px] text-status-danger">
                        确认删除自定义风格「{selectedStyle.name}」吗？此操作不可撤销。
                      </span>
                      <button
                        type="button"
                        disabled={styleBusy}
                        onClick={async () => {
                          setStyleBusy(true);
                          setError(null);
                          try {
                            await api.deletePortraitStyle(selectedStyle.id);
                            const remaining = stylePresets.filter(
                              (item) => item.id !== selectedStyle.id,
                            );
                            setStylePresets(remaining);
                            const fallback =
                              remaining.find((item) => item.id === 'anime') ?? remaining[0];
                            if (fallback) applySelectedPreset(fallback);
                            setStyleActionMode('none');
                            notifySuccess(`已删除风格「${selectedStyle.name}」`);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : '删除风格失败');
                          } finally {
                            setStyleBusy(false);
                          }
                        }}
                        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-status-danger px-2.5 text-[11px] font-medium text-content-inverse disabled:opacity-50"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setStyleActionMode('none')}
                        className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-sm border border-line bg-surface px-2 text-[11px] text-content-secondary hover:bg-subtle"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="shrink-0 text-[11px] font-medium text-content-secondary">
                        {styleActionMode === 'create'
                          ? '新空白风格名称：'
                          : styleActionMode === 'save_as'
                            ? '另存为新风格：'
                            : '重命名风格：'}
                      </span>
                      <input
                        type="text"
                        value={styleNameInput}
                        onChange={(e) => setStyleNameInput(e.target.value)}
                        placeholder="输入风格名称，如：赛博霓虹厚涂..."
                        className="h-7 min-w-[160px] flex-1 rounded-sm border border-line bg-canvas px-2 text-xs text-content-primary outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        disabled={styleBusy || !styleNameInput.trim()}
                        onClick={async () => {
                          const name = styleNameInput.trim();
                          if (!name) return;
                          setStyleBusy(true);
                          setError(null);
                          try {
                            if (styleActionMode === 'create') {
                              const res = await api.createPortraitStyle({
                                name,
                                stylePrompt: '',
                                negativePromptHint: '',
                                instructionHint: '',
                              });
                              setStylePresets((prev) => [...prev, res.style]);
                              applySelectedPreset(res.style);
                              setStyleEditorOpen(true);
                              notifySuccess(`已新建空白风格「${res.style.name}」`);
                            } else if (styleActionMode === 'save_as') {
                              const res = await api.createPortraitStyle({
                                name,
                                stylePrompt: draftStylePrompt,
                                negativePromptHint: draftNegativeHint,
                                instructionHint: draftInstructionHint,
                              });
                              setStylePresets((prev) => [...prev, res.style]);
                              applySelectedPreset(res.style);
                              notifySuccess(`已另存为风格「${res.style.name}」`);
                            } else if (styleActionMode === 'rename' && selectedStyle) {
                              const res = await api.updatePortraitStyle(selectedStyle.id, { name });
                              setStylePresets((prev) =>
                                prev.map((item) => (item.id === res.style.id ? res.style : item)),
                              );
                              applySelectedPreset(res.style);
                              notifySuccess(`已重命名为「${res.style.name}」`);
                            }
                          } catch (err) {
                            setError(err instanceof Error ? err.message : '操作风格预设失败');
                          } finally {
                            setStyleBusy(false);
                          }
                        }}
                        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-accent px-2.5 text-[11px] font-medium text-content-inverse hover:bg-accent-hover disabled:opacity-50"
                      >
                        <Check className="h-3 w-3" />
                        确认
                      </button>
                      <button
                        type="button"
                        onClick={() => setStyleActionMode('none')}
                        className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-sm border border-line bg-surface px-2 text-[11px] text-content-secondary hover:bg-subtle"
                      >
                        取消
                      </button>
                    </>
                  )}
                </div>
              )}

              {styleEditorOpen && (
                <div className="space-y-2 rounded-sm border border-line bg-surface p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-content-primary">
                      当前画风基底设定{selectedStyle ? ` · ${selectedStyle.name}` : ''}
                    </span>
                    {isStyleDirty && (
                      <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-status-warning">
                        有未保存修改（本次生成将直接使用当前编辑内容）
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-content-secondary">
                      画风描述词（中英文均可；留空代表完全自由风格，不强制限定画风）
                    </label>
                    <textarea
                      rows={2}
                      value={draftStylePrompt}
                      onChange={(e) => setDraftStylePrompt(e.target.value)}
                      placeholder="例如：cinematic cyberpunk concept art, neon rain reflections, painterly brushwork（留空则不限制画风）"
                      className="w-full rounded-sm border border-line bg-canvas p-2 font-mono text-[11px] text-content-primary outline-none focus:border-accent"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-content-secondary">
                        风格避让反向词参考（可选）
                      </label>
                      <input
                        type="text"
                        value={draftNegativeHint}
                        onChange={(e) => setDraftNegativeHint(e.target.value)}
                        placeholder="如：anime, cartoon, 3d render"
                        className="h-8 w-full rounded-sm border border-line bg-canvas px-2 font-mono text-[11px] text-content-primary outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-content-secondary">
                        预设默认画面要求（可选）
                      </label>
                      <input
                        type="text"
                        value={draftInstructionHint}
                        onChange={(e) => setDraftInstructionHint(e.target.value)}
                        placeholder="如：半身特写、戏剧性逆光"
                        className="h-8 w-full rounded-sm border border-line bg-canvas px-2 text-[11px] text-content-primary outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-[11px] font-medium text-content-secondary">
                  本次补充画面要求（可选）
                </label>
                <input
                  type="text"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  placeholder="如：夜雨霓虹、仰视构图、战损披风（选空白预设时也可在此自由指定画风）..."
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
                      const combinedInstruction = [
                        draftInstructionHint.trim(),
                        aiInstruction.trim(),
                      ]
                        .filter(Boolean)
                        .join('；');
                      const res = await api.generatePortraitPrompt({
                        cardId: card.id,
                        mode: 'generate',
                        style: selectedStyleId,
                        stylePresetId: selectedStyleId,
                        customStylePrompt: draftStylePrompt,
                        customNegativeHint: draftNegativeHint,
                        draftPrompt: '',
                        instruction: combinedInstruction,
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
                  className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] font-medium text-accent hover:bg-accent/15 disabled:opacity-50"
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
                      const combinedInstruction = [
                        draftInstructionHint.trim(),
                        aiInstruction.trim(),
                      ]
                        .filter(Boolean)
                        .join('；');
                      const res = await api.generatePortraitPrompt({
                        cardId: card.id,
                        mode: 'optimize',
                        style: selectedStyleId,
                        stylePresetId: selectedStyleId,
                        customStylePrompt: draftStylePrompt,
                        customNegativeHint: draftNegativeHint,
                        draftPrompt: aiPrompt.trim(),
                        instruction: combinedInstruction,
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent">
                固定 2:3 竖版立绘 (1024×1536) · 自动衍生 1:1 Token
              </span>
              <button
                type="button"
                disabled={aiGenerating || promptLoadingMode !== null || !aiPrompt.trim()}
                onClick={async () => {
                  const usedPrompt = aiPrompt.trim();
                  setAiGenerating(true);
                  setError(null);
                  try {
                    const res = await api.generateImage({
                      prompt: usedPrompt,
                      size: '1024x1536',
                    });
                    if (res.dataUrl) {
                      const img = await loadImageElement(res.dataUrl);
                      const portrait2x3 = renderPortrait2By3DataUrl(img, 600, 900);
                      const derivedToken = renderTokenDataUrlFromSource(
                        img,
                        img.width,
                        img.height,
                        DEFAULT_TOKEN_CROP,
                        512,
                      );
                      await onSaveUpload(portrait2x3 || res.dataUrl, {
                        imagePrompt: usedPrompt,
                        ...(derivedToken ? { tokenDataUrl: derivedToken, tokenCrop: DEFAULT_TOKEN_CROP } : {}),
                      });
                      onClose();
                    } else if (res.imageUrl) {
                      try {
                        const localized = await localizeRemoteImageTo2By3AndToken(res.imageUrl);
                        await onSaveUpload(localized.portraitDataUrl, {
                          imagePrompt: usedPrompt,
                          ...(localized.tokenDataUrl
                            ? {
                                tokenDataUrl: localized.tokenDataUrl,
                                tokenCrop: DEFAULT_TOKEN_CROP,
                              }
                            : {}),
                        });
                      } catch {
                        await onSaveUrl(res.imageUrl, { imagePrompt: usedPrompt });
                      }
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
                {aiGenerating ? '生成中...' : '生成 2:3 立绘并应用'}
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
          {(tab === 'upload' || tab === 'url' || (tab === 'token' && Boolean(card.imageUrl))) && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-8 rounded-sm bg-accent px-4 text-xs font-semibold text-content-inverse hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? '保存中...' : tab === 'token' ? '保存 1:1 Token' : '保存立绘'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
