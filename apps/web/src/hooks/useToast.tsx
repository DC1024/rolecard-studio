import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'info' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
  notifySuccess: (message: string) => void;
  notifyInfo: (message: string) => void;
  notifyError: (message: string) => void;
  copyWithToast: (text: string, label?: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let nextToastId = 1;

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = nextToastId++;
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => {
        dismiss(id);
      }, 3500);
    },
    [dismiss],
  );

  const notifySuccess = useCallback(
    (message: string) => showToast(message, 'success'),
    [showToast],
  );
  const notifyInfo = useCallback(
    (message: string) => showToast(message, 'info'),
    [showToast],
  );
  const notifyError = useCallback(
    (message: string) => showToast(message, 'error'),
    [showToast],
  );

  const copyWithToast = useCallback(
    async (text: string, label = '内容'): Promise<boolean> => {
      const ok = await writeClipboardText(text);
      if (ok) {
        showToast(`已复制${label}到剪贴板`, 'success');
      } else {
        showToast(`复制${label}失败，请手动复制`, 'error');
      }
      return ok;
    },
    [showToast],
  );

  return (
    <ToastContext.Provider
      value={{ showToast, notifySuccess, notifyInfo, notifyError, copyWithToast }}
    >
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-5 right-5 z-[90] flex max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => {
          const styleClass =
            item.kind === 'error'
              ? 'border-status-danger/40 bg-elevated text-status-danger'
              : item.kind === 'info'
                ? 'border-status-info/40 bg-elevated text-status-info'
                : 'border-status-success/40 bg-elevated text-status-success';

          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur-sm ${styleClass}`}
            >
              {item.kind === 'error' ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : item.kind === 'info' ? (
                <Info className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span className="text-content-primary">{item.message}</span>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="ml-1 rounded p-0.5 text-content-muted hover:bg-subtle hover:text-content-primary"
                aria-label="关闭提示"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
