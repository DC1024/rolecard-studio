import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidebarSource = readFileSync(resolve(__dirname, 'Sidebar.tsx'), 'utf8');
const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
const gallerySource = readFileSync(resolve(__dirname, 'CardGallery.tsx'), 'utf8');

const asideTag = sidebarSource.match(/<aside[^>]*className=\{`([^`]*)`\}/)?.[1] ?? '';
const mainTag = appSource.match(/<main className="([^"]*)"/)?.[1] ?? '';

describe('Sidebar is an overlay drawer, not a flex sibling of main', () => {
  it('positions the aside as a fixed overlay', () => {
    expect(asideTag).toContain('fixed');
    expect(asideTag).not.toContain('shrink-0');
  });

  it('hides via transform instead of animating its width', () => {
    expect(asideTag).toContain('-translate-x-full');
    expect(asideTag).toContain('translate-x-0');
    expect(asideTag).not.toContain('w-0');
    expect(asideTag).not.toContain('transition-all');
  });

  it('keeps a constant drawer width', () => {
    expect(asideTag).toContain('w-[276px]');
  });

  it('renders a click-to-close backdrop for the mobile overlay', () => {
    expect(sidebarSource).toContain('bg-black/30');
    expect(sidebarSource).toContain('onClick={onClose}');
  });
});

describe('main area width is independent of the sidebar state', () => {
  it('does not wrap Sidebar and main in a flex row', () => {
    const sidebarIndex = appSource.indexOf('<Sidebar');
    const mainIndex = appSource.indexOf('<main');
    expect(sidebarIndex).toBeGreaterThan(-1);
    expect(mainIndex).toBeGreaterThan(sidebarIndex);
    expect(appSource.slice(sidebarIndex - 200, mainIndex)).not.toContain('className="flex"');
  });

  it('makes main full width rather than flex-1', () => {
    expect(mainTag).toContain('w-full');
    expect(mainTag).not.toContain('flex-1');
  });

  it('centers content with mx-auto inside main', () => {
    expect(appSource).toContain('mx-auto max-w-7xl');
  });

  it('closes the drawer from App', () => {
    expect(appSource).toContain('onClose={() => setSidebarOpen(false)}');
  });
});

describe('card grid stays responsive in the full-width main area', () => {
  it('keeps responsive column breakpoints on both gallery grids', () => {
    const grids = gallerySource.match(/className="grid grid-cols-2 gap-4[^"]*"/g) ?? [];
    expect(grids.length).toBeGreaterThanOrEqual(2);
    for (const grid of grids) {
      expect(grid).toContain('sm:grid-cols-3');
      expect(grid).toContain('2xl:grid-cols-5');
    }
  });
});
