import type { MediaTransformRequest } from '@videoos/contracts';

export type MediaPresetId = 'vertical-short' | 'landscape-hd' | 'square-social';

export interface CompileMediaPresetOptions {
  subtitleAssetId?: string;
  normalizeAudio?: boolean;
}

const PRESET_VERSION = 1;

export function compileMediaPreset(
  sourceAssetId: string,
  presetId: MediaPresetId,
  options: CompileMediaPresetOptions = {},
): MediaTransformRequest {
  const dimensions = presetDimensions(presetId);
  const operations: MediaTransformRequest['operations'] = [
    { type: 'resize', width: dimensions.width, height: dimensions.height, fit: 'cover' },
  ];
  if (options.normalizeAudio ?? true) {
    operations.push({ type: 'normalize-audio', targetLufs: -14 });
  }
  if (options.subtitleAssetId) {
    operations.push({ type: 'burn-subtitles', subtitleAssetId: options.subtitleAssetId });
  }

  return {
    sourceAssetId,
    preset: { id: presetId, version: PRESET_VERSION },
    operations,
    output: {
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: dimensions.width,
      height: dimensions.height,
      fps: 30,
    },
  };
}

function presetDimensions(presetId: MediaPresetId): { width: number; height: number } {
  switch (presetId) {
    case 'vertical-short':
      return { width: 1080, height: 1920 };
    case 'landscape-hd':
      return { width: 1920, height: 1080 };
    case 'square-social':
      return { width: 1080, height: 1080 };
  }
}
