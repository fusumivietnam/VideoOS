import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildProjectObjectKey, type AssetRecord, type AssetRepository, type ObjectStore } from '@videoos/storage';
import {
  canonicalTransformJson,
  type MediaArtifactFinalizeInput,
  type MediaArtifactFinalizer,
  type MediaProbe,
} from './media-artifact.js';
import { REPRESENTATIVE_FRAME_DEFAULT_MS } from './thumbnail-executor.js';

export class ThumbnailAssetFinalizer implements MediaArtifactFinalizer {
  constructor(
    private readonly dependencies: {
      objects: ObjectStore;
      assets: AssetRepository;
      probe: MediaProbe;
      now?: () => Date;
    },
  ) {}

  async finalize(input: MediaArtifactFinalizeInput): Promise<AssetRecord> {
    const format = imageFormat(input.transform.output.container);
    if (!input.transform.frame || input.transform.operations.length) {
      throw new Error('thumbnail finalizer requires frame mode without media operations');
    }
    if (!input.result.uri.startsWith('file:')) throw new Error('thumbnail finalizer requires a local file URI');

    const filePath = fileURLToPath(input.result.uri);
    const [body, info, media] = await Promise.all([
      readFile(filePath),
      stat(filePath),
      this.dependencies.probe.probe(filePath),
    ]);
    if (!info.isFile()) throw new Error('thumbnail output is not a regular file');

    const checksumSha256 = createHash('sha256').update(body).digest('hex');
    const transformJson = canonicalTransformJson(input.transform);
    const transformHash = createHash('sha256').update(transformJson).digest('hex');
    const objectKey = buildProjectObjectKey(input.projectId, input.result.assetId, `thumbnail.${format.extension}`);

    await this.dependencies.objects.put({
      key: objectKey,
      contentType: format.contentType,
      body: new Uint8Array(body),
      checksumSha256,
    });

    const existing = await this.dependencies.assets.getById(input.result.assetId);
    if (existing) {
      if (existing.projectId !== input.projectId || existing.objectKey !== objectKey || existing.kind !== 'image') {
        throw new Error(`thumbnail asset identity collision: ${input.result.assetId}`);
      }
      return existing;
    }

    const metadata: Record<string, string | number | boolean> = {
      lineageSourceAssetId: input.sourceAssetId,
      lineageJobId: input.jobId,
      lineageTransformHash: transformHash,
      lineageTransformJson: transformJson,
      lineageExecutor: input.executor,
      manifestVersion: 1,
      outputContainer: input.transform.output.container,
      frameAtMs: input.transform.frame.atMs ?? REPRESENTATIVE_FRAME_DEFAULT_MS,
    };
    if (input.executorVersion) metadata.lineageExecutorVersion = input.executorVersion;
    if (input.transform.preset) {
      metadata.lineagePresetId = input.transform.preset.id;
      metadata.lineagePresetVersion = input.transform.preset.version;
    }
    if (media.width !== undefined) metadata.width = media.width;
    if (media.height !== undefined) metadata.height = media.height;
    if (media.videoCodec !== undefined) metadata.imageCodec = media.videoCodec;

    const asset: AssetRecord = {
      id: input.result.assetId,
      projectId: input.projectId,
      kind: 'image',
      objectKey,
      contentType: format.contentType,
      bytes: info.size,
      checksumSha256,
      createdAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
      metadata,
    };
    await this.dependencies.assets.create(asset);
    return asset;
  }
}

export class RoutedMediaArtifactFinalizer implements MediaArtifactFinalizer {
  constructor(
    private readonly video: MediaArtifactFinalizer,
    private readonly thumbnail: MediaArtifactFinalizer,
  ) {}

  finalize(input: MediaArtifactFinalizeInput): Promise<AssetRecord> {
    return input.transform.frame ? this.thumbnail.finalize(input) : this.video.finalize(input);
  }
}

function imageFormat(container: string): { extension: 'jpg' | 'png'; contentType: string } {
  const value = container.toLowerCase();
  if (value === 'jpg' || value === 'jpeg') return { extension: 'jpg', contentType: 'image/jpeg' };
  if (value === 'png') return { extension: 'png', contentType: 'image/png' };
  throw new Error(`unsupported thumbnail container: ${container}`);
}
