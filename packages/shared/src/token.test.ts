import { describe, expect, it } from 'vitest';
import { estimateTokens } from './token.js';

describe('estimateTokens', () => {
  it.each([
    ['CJK punctuation', 0x3000, 0x303f],
    ['fullwidth forms', 0xff01, 0xff60],
    ['halfwidth katakana', 0xff66, 0xff9f],
    ['CJK Extension A', 0x3400, 0x4dbf],
    ['CJK compatibility ideographs', 0xf900, 0xfaff],
    ['CJK unified ideographs', 0x4e00, 0x9fff],
    ['Japanese kana', 0x3040, 0x30ff],
    ['Hangul syllables', 0xac00, 0xd7af],
  ])('counts %s boundaries as CJK', (_name, start, end) => {
    for (const code of [start, end]) {
      expect(estimateTokens(String.fromCodePoint(code).repeat(10))).toBe(8);
    }
  });

  it.each(['，。！？；：、', '㐀㐁㐂', '\uf900\uf901\uf902', 'ｱｲｳ'])(
    'counts CJK text %s with the CJK weight',
    (text) => {
      expect(estimateTokens(text)).toBe(Math.ceil(text.length * 0.72));
    },
  );

  it.each([
    ['B', 0x20000, 0x2a6df],
    ['C', 0x2a700, 0x2b73f],
    ['D', 0x2b740, 0x2b81f],
    ['E', 0x2b820, 0x2ceaf],
    ['F', 0x2ceb0, 0x2ebef],
    ['I', 0x2ebf0, 0x2ee5f],
    ['compatibility supplement', 0x2f800, 0x2fa1f],
    ['G', 0x30000, 0x3134f],
    ['H', 0x31350, 0x323af],
    ['J', 0x323b0, 0x3347f],
  ])('counts supplementary CJK %s once per code point', (_name, start, end) => {
    for (const code of [start, end]) {
      expect(estimateTokens(String.fromCodePoint(code).repeat(10))).toBe(8);
    }
  });

  it('advances past surrogate pairs without skipping following characters', () => {
    expect(estimateTokens('𠀀A中𠀀B中')).toBe(Math.ceil(4 * 0.72 + 2 * 0.28));
    expect(estimateTokens('😀'.repeat(10))).toBe(3);
  });

  it('preserves the original estimate for ASCII inputs', () => {
    const ascii = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)).join('');
    for (const text of ['', 'Hello, world!', ' \t\r\n', ascii]) {
      for (let length = 0; length <= text.length; length++) {
        const prefix = text.slice(0, length);
        expect(estimateTokens(prefix)).toBe(Math.ceil(prefix.length * 0.28));
      }
    }
  });
});
