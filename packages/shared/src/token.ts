import type { RoleCardContent } from './cards.js';

/**
 * Lightweight, zero-WASM cross-platform token estimator.
 * CJK characters average ~0.67 tokens/char (~1.5 chars/token),
 * Latin/ASCII characters average ~0.25 tokens/char (~4 chars/token).
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let cjkCount = 0;
  let otherCount = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
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
