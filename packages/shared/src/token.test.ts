import { describe, expect, it } from 'vitest';

import { estimateTokens } from './token.js';

describe('estimateTokens', () => {
  it.each([
    ['Chinese punctuation', '，。！？；：、'],
    ['CJK punctuation boundaries', '\u3000\u303f'],
    ['fullwidth forms', '\uff01\uff60'],
    ['halfwidth katakana', 'ｱｲｳ\uff66\uff9f'],
    ['CJK Extension A', '㐀㐁㐂\u4dbf'],
    ['CJK compatibility ideographs', '\uf900\ufaFF'],
    ['unified ideographs', '中文'],
    ['Japanese kana', 'あいうアイウ'],
    ['Hangul syllables', '한글'],
  ])('counts %s at the CJK rate', (_name, text) => {
    expect(estimateTokens(text)).toBe(Math.ceil(Array.from(text).length * 0.72));
  });

  it.each([
    0x20000, 0x2a6df, 0x2a700, 0x2b740, 0x2b820, 0x2ceb0,
    0x2ebf0, 0x2f800, 0x2fa1f, 0x30000, 0x31350, 0x323b0, 0x3347f,
  ])('counts supplementary Han U+%i once per code point', (code) => {
    expect(estimateTokens(String.fromCodePoint(code).repeat(10))).toBe(8);
  });

  it('advances correctly through mixed BMP, supplementary, and ASCII text', () => {
    expect(estimateTokens('A𠀀，㐀ｱ\uF900Z')).toBe(
      Math.ceil(5 * 0.72 + 2 * 0.28),
    );
  });

  it('preserves the previous estimate for ASCII text', () => {
    const ascii = Array.from({ length: 128 }, (_, code) =>
      String.fromCharCode(code),
    ).join('');
    for (const text of ['', 'Hello, world!', ' \t\r\n', ascii]) {
      expect(estimateTokens(text)).toBe(Math.ceil(text.length * 0.28));
    }
    for (let length = 0; length <= 256; length += 1) {
      expect(estimateTokens('a'.repeat(length))).toBe(Math.ceil(length * 0.28));
    }
  });
});
