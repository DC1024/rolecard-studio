import { useState, type FormEvent } from 'react';
import { Lock, X } from 'lucide-react';

interface LoginModalProps {
  open: boolean;
  blocking: boolean;
  onClose: () => void;
  onSubmit: (username: string, password: string) => Promise<void>;
}

export function LoginModal({ open, blocking, onClose, onSubmit }: LoginModalProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-line bg-elevated p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-content-primary">
                {blocking ? '需要登录访问工作台' : '登录 RoleCard Studio'}
              </h3>
              <p className="text-xs text-content-muted">
                {blocking ? '管理员已启用登录访问限制' : '登录后解锁管理员或授权操作'}
              </p>
            </div>
          </div>
          {!blocking && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm p-1 text-content-muted hover:bg-subtle hover:text-content-primary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-medium text-content-secondary">
              用户名
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-content-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-content-secondary">
              密码
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="首次启动密码见服务端控制台输出"
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-content-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>

          {error && (
            <div className="rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-9 w-full rounded-sm bg-accent text-sm font-semibold text-content-inverse transition hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? '验证中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
