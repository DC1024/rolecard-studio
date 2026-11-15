import type { RoleCardContent } from './cards.js';

/**
 * Lightweight, zero-WASM cross-platform token estimator.
 * CJK characters average ~0.72 tokens/code point,
 * other characters average ~0.28 tokens/code point.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let cjkCount = 0;
  let otherCount = 0;

  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i)!;
    i += code > 0xffff ? 2 : 1;
    if (
      (code >= 0x3000 && code <= 0x30ff) || // CJK punctuation and Japanese kana
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth forms
      (code >= 0xff66 && code <= 0xff9f) || // Halfwidth katakana
      (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
      (code >= 0x2a700 && code <= 0x2ee5f) || // CJK Extensions C–F and I
      (code >= 0x2f800 && code <= 0x2fa1f) || // CJK compatibility supplement
      (code >= 0x30000 && code <= 0x3347f) // CJK Extensions G, H and J
    ) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }

  return Math.ceil(cjkCount * 0.72 + otherCount * 0.28);
}

export function estimateCardTokens(card: RoleCardContent): number {
  const parts: string[] = [
    card.name,
    card.summary,
    card.personality,
    card.appearance,
    card.background,
    card.speech_style.tone,
    ...card.speech_style.catchphrases,
    ...card.speech_style.habits,
    ...card.relationships.map((r) => `${r.target} ${r.relation} ${r.attitude}`),
    card.first_mes,
    ...card.alternate_greetings,
    card.mes_example,
    card.system_prompt,
    card.scenario,
  ];
  return estimateTokens(parts.filter(Boolean).join('\n'));
}
