
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('CardDetailPanel revision snapshot badge', () => {
  const source = readFileSync(resolve(__dirname, 'CardDetailPanel.tsx'), 'utf8');

  // Extract the "上一版" badge span so we assert only on the badge markup.
  const badgeMatch = source.match(
    /<span className="([^"]*)">\s*上一版\s*<\/span>/,
  );

  it('renders a "上一版" badge', () => {
    expect(badgeMatch).not.toBeNull();
  });

  it('keeps the badge on a single line (no wrapping)', () => {
    const classes = badgeMatch?.[1] ?? '';
    expect(classes).toContain('whitespace-nowrap');
    expect(classes).toContain('shrink-0');
  });
});
