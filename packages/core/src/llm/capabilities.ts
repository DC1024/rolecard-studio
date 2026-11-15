import type { LlmProvider, LlmSlotPurpose } from '@rolecard/shared';

export type ModelCapabilityFamily =
  | 'chat_or_multimodal'
  | 'text_only_chat'
  | 'image_gen'
  | 'embedding'
  | 'audio'
  | 'unknown';

export interface SlotCapabilityValidationResult {
  ok: boolean;
  detectedFamily: ModelCapabilityFamily;
  code?: 'MODEL_CAPABILITY_MISMATCH';
  message?: string;
}

const EMBEDDING_RE =
  /(?:^|[/:_-])(text-embedding|bge-|bce-embedding|m3e-|e5-|nomic-embed|embedding|embed-)/i;
const AUDIO_RE =
  /(?:^|[/:_-])(whisper|tts-|cosyvoice|fish-speech|paraformer|sensevoice|gpt-4o-audio)/i;
const IMAGE_GEN_RE =
  /(?:^|[/:_-])(dall-e(?:-\d+)?|gpt-image(?:-[\w.]+)?|imagen(?:-[\w.]+)?|midjourney|flux(?:[.-][\w]+)*|sdxl|stable-diffusion[\w.-]*|kolors|cogview(?:-\d+)?|wanx[\w.-]*|ideogram|recraft[\w.-]*|seedream[\w.-]*|qwen-image[\w.-]*|hunyuan-dit|janus-pro|jimeng[\w.-]*|image-generation)(?:$|[/:._-])/i;
const MULTIMODAL_HINT_RE =
  /(?:vision|vl|omni|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|claude-3|claude-sonnet-4|claude-opus-4|gemini-|grok-2-vision|pixtral|llava|minicpm-v|internvl)/i;
const TEXT_ONLY_CHAT_RE =
  /(?:^|[/:_-])(deepseek-chat|deepseek-reasoner|deepseek-r\d|deepseek-v\d|qwen-?(?:plus|turbo|max|long)|qwen[\d.]+-(?:\d+b-)?instruct|qwen3|moonshot-v\d|kimi-|glm-[34](?:-flash|-air|-plus|$)|ernie-|yi-(?:large|medium|lightning)|gpt-3\.5|o[134](?:-mini|-preview)?|llama-?[\d.]+|mixtral-|mistral-(?:small|medium|large)|gemma-?\d|phi-?\d)/i;

export const SLOT_LABELS: Record<LlmSlotPurpose, string> = {
  primary: '1. 主生成模型 (Primary LLM)',
  chat: '2. 试聊沙盒模型 (Chat LLM)',
  vision: '3. 视觉识别模型 (Vision LLM)',
  image: '4. 独立生图模型 (Image Model)',
};

export function classifyModelCapabilityFamily(model: string): ModelCapabilityFamily {
  const normalized = model.trim();
  if (!normalized) return 'unknown';
  if (EMBEDDING_RE.test(normalized)) return 'embedding';
  if (AUDIO_RE.test(normalized)) return 'audio';
  if (IMAGE_GEN_RE.test(normalized)) return 'image_gen';
  if (MULTIMODAL_HINT_RE.test(normalized)) return 'chat_or_multimodal';
  if (TEXT_ONLY_CHAT_RE.test(normalized)) return 'text_only_chat';
  return 'unknown';
}

export function validateModelSlotCapability(input: {
  slotType: LlmSlotPurpose;
  provider: LlmProvider;
  model: string;
}): SlotCapabilityValidationResult {
  const model = input.model.trim();
  const family = classifyModelCapabilityFamily(model);
  const slotLabel = SLOT_LABELS[input.slotType];

  if (family === 'embedding') {
    return {
      ok: false,
      detectedFamily: family,
      code: 'MODEL_CAPABILITY_MISMATCH',
      message: `模型「${model}」属于向量嵌入 (Embedding) 模型，无法用于「${slotLabel}」`,
    };
  }

  if (family === 'audio') {
    return {
      ok: false,
      detectedFamily: family,
      code: 'MODEL_CAPABILITY_MISMATCH',
      message: `模型「${model}」属于语音识别/合成模型，无法用于「${slotLabel}」`,
    };
  }

  if (input.slotType === 'primary' || input.slotType === 'chat') {
    if (family === 'image_gen') {
      return {
        ok: false,
        detectedFamily: family,
        code: 'MODEL_CAPABILITY_MISMATCH',
        message: `模型「${model}」属于图像生成 (Text-to-Image) 模型，不能填入「${slotLabel}」；请将其配置到「4. 独立生图模型 (Image Model)」`,
      };
    }
    return { ok: true, detectedFamily: family };
  }

  if (input.slotType === 'vision') {
    if (family === 'image_gen') {
      return {
        ok: false,
        detectedFamily: family,
        code: 'MODEL_CAPABILITY_MISMATCH',
        message: `模型「${model}」属于图像生成模型，不能用于「${slotLabel}」图文反推；请配置到「4. 独立生图模型」或更换为多模态视觉模型（如 gpt-4o / qwen-vl-max）`,
      };
    }
    if (family === 'text_only_chat') {
      return {
        ok: false,
        detectedFamily: family,
        code: 'MODEL_CAPABILITY_MISMATCH',
        message: `模型「${model}」为纯文本对话模型，不支持图片视觉输入；请选用多模态视觉模型（如 gpt-4o、qwen-vl-max、claude-3-5-sonnet、gemini-2.5-flash）`,
      };
    }
    return { ok: true, detectedFamily: family };
  }

  // input.slotType === 'image'
  if (family === 'text_only_chat' || (family === 'chat_or_multimodal' && !/image/i.test(model))) {
    return {
      ok: false,
      detectedFamily: family,
      code: 'MODEL_CAPABILITY_MISMATCH',
      message: `模型「${model}」属于对话/推理模型，不支持文生图接口；请填写生图模型（如 gpt-image-1、dall-e-3、black-forest-labs/FLUX.1-schnell、Kwai-Kolors/Kolors）`,
    };
  }

  return { ok: true, detectedFamily: family };
}
