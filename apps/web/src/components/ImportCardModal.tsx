import { useState, type ChangeEvent, type DragEvent } from 'react';
import type { CardType } from '@rolecard/shared';
import { FileUp, X } from 'lucide-react';
import { api, type RoleCardDto } from '../api/client';

interface ImportCardModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (card: RoleCardDto, message: string) => void;
}

export function ImportCardModal({ open, onClose, onImported }: ImportCardModalProps) {
  const [targetCardType, setTargetCardType] = useState<CardType>('sillytavern_v3');
  const [importBook, setImportBook] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const processFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const isPng = file.name.toLowerCase().endsWith('.png') || file.type === 'image/png';
      if (isPng) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('读取 PNG 文件失败'));
          reader.readAsDataURL(file);
        });
        const res = await api.importCard({
          filename: file.name,
          format: 'png',
          pngBase64: dataUrl,
          targetCardType,
          importEmbeddedLorebook: importBook,
          tags: [],
        });
        onImported(
          res.card,
          `已从 ${res.upgradedFrom} PNG 升级导入「${res.card.characterName}」${res.importedLorebookId ? '（含随卡世界书）' : ''}`,
        );
      } else {
        const jsonText = await file.text();
        const res = await api.importCard({
          filename: file.name,
          format: 'json',
          jsonText,
          targetCardType,
          importEmbeddedLorebook: importBook,
          tags: [],
        });
        onImported(
          res.card,
          `已从 ${res.upgradedFrom} JSON 升级导入「${res.card.characterName}」`,
        );
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-line bg-elevated p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <FileUp className="h-4 w-4 text-accent" />
            导入旧版角色卡并升级至 CCV3
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-content-muted hover:bg-subtle hover:text-content-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 space-y-2.5 text-xs">
          <div>
            <label className="mb-1 block font-medium text-content-secondary">目标规格</label>
            <select
              value={targetCardType}
              onChange={(e) => setTargetCardType(e.target.value as CardType)}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs"
            >
              <option value="sillytavern_v3">SillyTavern CCV3</option>
              <option value="trpg_coc7">TRPG CoC 7e（自动补齐属性）</option>
              <option value="trpg_dnd5e">TRPG DnD 5e（自动补齐属性）</option>
              <option value="general">通用设定卡</option>
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-content-secondary">
            <input
              type="checkbox"
              checked={importBook}
              onChange={(e) => setImportBook(e.target.checked)}
              className="accent-accent"
            />
            若卡内包含 character_book，自动拆出并关联为独立世界书
          </label>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-subtle p-6 text-center"
        >
          <FileUp className="mb-2 h-7 w-7 text-accent" />
          <p className="text-xs font-medium text-content-primary">
            拖入 SillyTavern PNG（V2/V3）或 JSON 文件
          </p>
          <p className="mt-1 text-[11px] text-content-muted">
            自动识别 chara / ccv3 元数据块并提取立绘
          </p>
          <label className="mt-3 cursor-pointer rounded-sm bg-accent px-4 py-1.5 text-xs font-medium text-content-inverse hover:bg-accent-hover">
            {busy ? '解析升级中...' : '选择本地文件'}
            <input
              type="file"
              accept=".png,.json,image/png,application/json"
              onChange={handleFileChange}
              disabled={busy}
              className="hidden"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
