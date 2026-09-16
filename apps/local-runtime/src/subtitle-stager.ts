import { createHash } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import type { AssetRepository, ObjectStore } from '@videoos/storage';
import type { MediaExecutionPlan } from '../../../services/media-worker/src/index.js';

export interface SubtitleStager {
  stage(subtitleAssetId: string, plan: MediaExecutionPlan): Promise<string>;
}

export class ObjectStoreSubtitleStager implements SubtitleStager {
  constructor(
    private readonly dependencies: {
      assets: AssetRepository;
      objects: ObjectStore;
      sandboxRoot: string;
      maxSubtitleBytes?: number;
    },
  ) {}

  async stage(subtitleAssetId: string, plan: MediaExecutionPlan): Promise<string> {
    const context = plan.context;
    if (!context?.projectId || !context.jobId) throw new Error('subtitle staging requires project/job context');

    const asset = await this.dependencies.assets.getById(subtitleAssetId);
    if (!asset || asset.projectId !== context.projectId || asset.kind !== 'subtitle') {
      throw new Error('subtitle asset not found in project');
    }

    const body = await this.dependencies.objects.get(asset.objectKey);
    if (!body) throw new Error('subtitle object is missing');
    const maxBytes = this.dependencies.maxSubtitleBytes ?? 4 * 1024 * 1024;
    if (body.byteLength > maxBytes) throw new Error('subtitle asset exceeds staging size limit');

    const root = await canonicalRoot(this.dependencies.sandboxRoot);
    const stageDir = resolve(root, 'work', safeSegment(context.projectId), safeSegment(context.jobId), 'subtitles');
    await mkdir(stageDir, { recursive: true });
    const canonicalDir = await realpath(stageDir);
    assertInside(root, canonicalDir);

    const extension = subtitleExtension(asset.objectKey, asset.contentType);
    const name = createHash('sha256').update(`${asset.id}:${asset.checksumSha256 ?? asset.objectKey}`).digest('hex');
    const stagedPath = resolve(canonicalDir, `${name}.${extension}`);
    assertInside(root, stagedPath);
    await writeFile(stagedPath, body, { flag: 'w' });
    return stagedPath;
  }
}

function subtitleExtension(objectKey: string, contentType: string): 'srt' | 'vtt' | 'ass' {
  const extension = extname(objectKey).slice(1).toLowerCase();
  if (extension === 'srt' || extension === 'vtt' || extension === 'ass') return extension;
  if (contentType === 'text/vtt') return 'vtt';
  if (contentType === 'text/x-ssa' || contentType === 'text/x-ass') return 'ass';
  if (contentType === 'application/x-subrip' || contentType === 'text/plain') return 'srt';
  throw new Error('unsupported subtitle format');
}

async function canonicalRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return realpath(root);
}

function assertInside(root: string, candidate: string): void {
  const relation = relative(root, candidate);
  if (relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))) return;
  throw new Error('subtitle staging path escapes sandbox');
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!normalized || normalized === '.' || normalized === '..') throw new Error('invalid subtitle staging segment');
  return normalized;
}
