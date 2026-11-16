import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./components/CardDetailPanel.tsx', import.meta.url)),
  'utf8',
);

// The revision-menu badge is a flex item inside a narrow (w-80) popover.
// It used to be compressible and wrap "上一版" onto two lines.
function badgeClassName(): string {
  const match = source.match(/<span className="([^"]*)">\s*上一版\s*<\/span>/);
  expect(match, '未找到「上一版」徽标').not.toBeNull();
  return match![1];
}

describe('历史版本快照「上一版」徽标', () => {
  it('不允许被 flex 压缩（shrink-0）', () => {
    expect(badgeClassName()).toContain('shrink-0');
  });

  it('保持单行显示（whitespace-nowrap）', () => {
    expect(badgeClassName()).toContain('whitespace-nowrap');
  });

  it('保留原有徽标样式', () => {
    const cls = badgeClassName();
    expect(cls).toContain('rounded');
    expect(cls).toContain('bg-accent/15');
    expect(cls).toContain('text-accent');
  });
});
