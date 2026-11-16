import type { RoleCardContent } from './cards.js';

/**
 * Lightweight, zero-WASM cross-platform token estimator.
 * CJK characters average ~0.72 tokens/char,
 * Latin/ASCII characters average ~0.28 tokens/char.
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
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0x2eff) ||
      (code >= 0x2f00 && code <= 0x2fdf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x3100 && code <= 0x312f) ||
      (code >= 0x31a0 && code <= 0x31bf) ||
      (code >= 0x3200 && code <= 0x32ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xff66 && code <= 0xff9f) ||
      (code >= 0x20000 && code <= 0x2fa1f) ||
      (code >= 0x30000 && code <= 0x3347f)
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
