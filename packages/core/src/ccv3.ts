import { deflateSync } from 'node:zlib';
import {
  CharaCardV3Schema,
  type CharacterBook,
  type CharaCardV3,
  type RoleCardContent,
  type SourceEntry,
} from '@rolecard/shared';
import { type CoreError, type Result, err, ok } from './types.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Precomputed IEEE 802.3 CRC32 lookup table for PNG chunks
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export type DetectedImageFormat = 'png' | 'jpeg' | 'webp';

export function detectImageMagicBytes(buf: Buffer): DetectedImageFormat | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function isSafeImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/uploads/')) {
    return !trimmed.includes('..');
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface PngChunk {
  type: string;
  data: Buffer;
}

export function extractPngChunks(pngBuffer: Buffer): Result<PngChunk[], CoreError> {
  if (pngBuffer.length < 8 || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return err({
      code: 'INVALID_PNG',
      message: '输入文件不是合法的 PNG 图片（Magic Bytes 校验失败）',
      status: 400,
    });
  }

  const chunks: PngChunk[] = [];
  let offset = 8;

  while (offset + 12 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (crcEnd > pngBuffer.length) {
      return err({
        code: 'CORRUPT_PNG',
        message: 'PNG 文件块长度越界，已损坏',
        status: 400,
      });
    }

    const data = pngBuffer.subarray(dataStart, dataEnd);
    chunks.push({ type, data: Buffer.from(data) });
    offset = crcEnd;
    if (type === 'IEND') {
      break;
    }
  }

  return ok(chunks);
}

export function encodePngChunks(chunks: readonly PngChunk[]): Buffer {
  const parts: Buffer[] = [PNG_SIGNATURE];

  for (const chunk of chunks) {
    const typeBuf = Buffer.from(chunk.type, 'ascii');
    if (typeBuf.length !== 4) {
      throw new Error(`Invalid PNG chunk type: ${chunk.type}`);
    }
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(chunk.data.length, 0);

    const crcInput = Buffer.concat([typeBuf, chunk.data]);
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);

    parts.push(lenBuf, typeBuf, chunk.data, crcBuf);
  }

  return Buffer.concat(parts);
}

function createTextChunk(keyword: string, text: string): PngChunk {
  const keyBuf = Buffer.from(keyword, 'latin1');
  const sep = Buffer.from([0x00]);
  const valBuf = Buffer.from(text, 'latin1');
  return {
    type: 'tEXt',
    data: Buffer.concat([keyBuf, sep, valBuf]),
  };
}

export function extractPngTextChunks(pngBuffer: Buffer): Result<Record<string, string>, CoreError> {
  const parsed = extractPngChunks(pngBuffer);
  if (!parsed.ok) return parsed;

  const map: Record<string, string> = {};
  for (const chunk of parsed.value) {
    if (chunk.type === 'tEXt') {
      const zeroIdx = chunk.data.indexOf(0x00);
      if (zeroIdx > 0) {
        const keyword = chunk.data.subarray(0, zeroIdx).toString('latin1');
        const value = chunk.data.subarray(zeroIdx + 1).toString('latin1');
        map[keyword.toLowerCase()] = value;
      }
    }
  }
  return ok(map);
}

/**
 * Generates a clean 64x96 portrait placeholder PNG (solid Slate-Blue card badge)
 * so PNG export works immediately even before a user uploads custom artwork.
 */
export function createDefaultPortraitPng(width = 64, height = 96): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      const isBorder = x < 3 || x >= width - 3 || y < 3 || y >= height - 3;
      raw[px] = isBorder ? 37 : 241;
      raw[px + 1] = isBorder ? 99 : 245;
      raw[px + 2] = isBorder ? 235 : 249;
    }
  }

  const idat = deflateSync(raw);
  return encodePngChunks([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: idat },
    { type: 'IEND', data: Buffer.alloc(0) },
  ]);
}

export function buildCardDescriptionBlock(content: RoleCardContent): string {
  const lines: string[] = [content.summary];
  if (content.appearance.trim()) {
    lines.push(`\n[外貌特征]\n${content.appearance.trim()}`);
  }
  if (content.background.trim()) {
    lines.push(`\n[背景经历]\n${content.background.trim()}`);
  }
  const speechParts: string[] = [];
  if (content.speech_style.tone.trim()) {
    speechParts.push(`语调：${content.speech_style.tone.trim()}`);
  }
  if (content.speech_style.catchphrases.length > 0) {
    speechParts.push(`口癖：${content.speech_style.catchphrases.join(' / ')}`);
  }
  if (content.speech_style.habits.length > 0) {
    speechParts.push(`习惯：${content.speech_style.habits.join(' / ')}`);
  }
  if (speechParts.length > 0) {
    lines.push(`\n[说话风格]\n${speechParts.join('\n')}`);
  }
  if (content.relationships.length > 0) {
    lines.push(
      `\n[人际关系]\n${content.relationships
        .map((r) => `- ${r.target}（${r.relation}）：${r.attitude}`)
        .join('\n')}`,
    );
  }
  return lines.join('\n').trim();
}

export function toCharaCardV3(
  content: RoleCardContent,
  options: {
    version?: number;
    characterBook?: CharacterBook;
    sources?: SourceEntry[];
  } = {},
): CharaCardV3 {
  const description = buildCardDescriptionBlock(content);
  const v3: CharaCardV3 = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: content.name,
      description,
      personality: content.personality,
      scenario: content.scenario,
      first_mes: content.first_mes,
      mes_example: content.mes_example,
      creator_notes: content.creator_notes,
      system_prompt: content.system_prompt,
      post_history_instructions: '',
      alternate_greetings: content.alternate_greetings,
      tags: content.tags,
      creator: 'RoleCard Studio',
      character_version: `${options.version ?? 1}.0.0`,
      ...(options.characterBook ? { character_book: options.characterBook } : {}),
      extensions: {
        ...content.extensions,
        rolecard_studio: {
          sources_count: options.sources?.length ?? 0,
        },
      },
    },
  };
  return CharaCardV3Schema.parse(v3);
}

export function toCharaCardV2Payload(v3: CharaCardV3): Record<string, unknown> {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: v3.data.name,
      description: v3.data.description,
      personality: v3.data.personality,
      scenario: v3.data.scenario,
      first_mes: v3.data.first_mes,
      mes_example: v3.data.mes_example,
      creator_notes: v3.data.creator_notes,
      system_prompt: v3.data.system_prompt,
      post_history_instructions: v3.data.post_history_instructions,
      alternate_greetings: v3.data.alternate_greetings,
      tags: v3.data.tags,
      creator: v3.data.creator,
      character_version: v3.data.character_version,
      ...(v3.data.character_book ? { character_book: v3.data.character_book } : {}),
      extensions: v3.data.extensions,
    },
  };
}

/**
 * Dual-writes both `ccv3` and `chara` tEXt chunks into a PNG buffer
 * for full SillyTavern + RisuAI compatibility.
 */
export function embedCardIntoPng(
  basePngBuffer: Buffer,
  v3Card: CharaCardV3,
): Result<Buffer, CoreError> {
  const extracted = extractPngChunks(basePngBuffer);
  if (!extracted.ok) {
    return extracted;
  }

  const v3Base64 = Buffer.from(JSON.stringify(v3Card), 'utf8').toString('base64');
  const v2Base64 = Buffer.from(JSON.stringify(toCharaCardV2Payload(v3Card)), 'utf8').toString(
    'base64',
  );

  const filtered = extracted.value.filter((chunk) => {
    if (chunk.type !== 'tEXt') return true;
    const zeroIdx = chunk.data.indexOf(0x00);
    if (zeroIdx <= 0) return true;
    const key = chunk.data.subarray(0, zeroIdx).toString('latin1').toLowerCase();
    return key !== 'chara' && key !== 'ccv3';
  });

  const iendIndex = filtered.findIndex((c) => c.type === 'IEND');
  const insertAt = iendIndex === -1 ? filtered.length : iendIndex;

  filtered.splice(
    insertAt,
    0,
    createTextChunk('chara', v2Base64),
    createTextChunk('ccv3', v3Base64),
  );

  return ok(encodePngChunks(filtered));
}

export function extractCardJsonFromPng(pngBuffer: Buffer): Result<{
  format: 'ccv3' | 'chara';
  raw: unknown;
}, CoreError> {
  const texts = extractPngTextChunks(pngBuffer);
  if (!texts.ok) return texts;

  const ccv3B64 = texts.value.ccv3;
  if (ccv3B64) {
    try {
      const jsonText = Buffer.from(ccv3B64, 'base64').toString('utf8');
      return ok({ format: 'ccv3', raw: JSON.parse(jsonText) as unknown });
    } catch {
      return err({
        code: 'INVALID_CCV3_CHUNK',
        message: 'PNG 中的 ccv3 元数据解码失败',
        status: 400,
      });
    }
  }

  const charaB64 = texts.value.chara;
  if (charaB64) {
    try {
      const jsonText = Buffer.from(charaB64, 'base64').toString('utf8');
      return ok({ format: 'chara', raw: JSON.parse(jsonText) as unknown });
    } catch {
      return err({
        code: 'INVALID_CHARA_CHUNK',
        message: 'PNG 中的 chara 元数据解码失败',
        status: 400,
      });
    }
  }

  return err({
    code: 'NO_CARD_METADATA',
    message: 'PNG 中未发现 ccv3 或 chara 角色卡元数据块',
    status: 400,
  });
}

export function exportCardToMarkdown(
  content: RoleCardContent,
  options: {
    workName?: string;
    mode?: string;
    version?: number;
    sources?: SourceEntry[];
  } = {},
): string {
  const lines: string[] = [
    `# ${content.name}${options.workName ? `（${options.workName}）` : ''}`,
    '',
    `> 模式: ${options.mode ?? 'A'} | 版本: v${options.version ?? 1} | 标签: ${content.tags.join(', ') || '无'}`,
    '',
    '## 一句话定位',
    content.summary,
    '',
    '## 性格特征',
    content.personality,
    '',
  ];

  if (content.appearance.trim()) {
    lines.push('## 外貌与特征', content.appearance, '');
  }
  if (content.background.trim()) {
    lines.push('## 背景故事', content.background, '');
  }
  lines.push(
    '## 说话风格',
    `- 语调：${content.speech_style.tone || '自然'}`,
    `- 口癖：${content.speech_style.catchphrases.join(' / ') || '无'}`,
    `- 习惯：${content.speech_style.habits.join(' / ') || '无'}`,
    '',
  );

  if (content.relationships.length > 0) {
    lines.push('## 人际关系');
    for (const rel of content.relationships) {
      lines.push(`- **${rel.target}**（${rel.relation}）：${rel.attitude}`);
    }
    lines.push('');
  }

  if (content.first_mes.trim()) {
    lines.push('## 默认开场白', content.first_mes, '');
  }
  if (content.alternate_greetings.length > 0) {
    lines.push('## 备选开场白');
    content.alternate_greetings.forEach((g, idx) => {
      lines.push(`### 开场白 #${idx + 1}`, g, '');
    });
  }
  if (content.mes_example.trim()) {
    lines.push('## 对话示例', '```', content.mes_example, '```', '');
  }
  if (options.sources && options.sources.length > 0) {
    lines.push('## 引用溯源');
    for (const src of options.sources) {
      const badge = src.origin === 'user_provided' ? '[用户提供]' : '[检索补充]';
      lines.push(`- ${badge} **${src.title}**${src.url ? ` (${src.url})` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
