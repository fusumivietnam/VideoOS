import type {
  MediaOperation,
  MediaTransformRequest,
  MediaWorkerPort,
} from "@videoos/contracts";

export interface MediaExecutionContext {
  projectId: string;
  jobId: string;
  sourceObjectKey: string;
}

export interface MediaExecutor {
  execute(plan: MediaExecutionPlan): Promise<{ assetId: string; uri: string }>;
}

export interface MediaExecutionPlan {
  sourceAssetId: string;
  preset?: MediaTransformRequest["preset"];
  frame?: MediaTransformRequest["frame"];
  operations: MediaOperation[];
  output: MediaTransformRequest["output"];
  context?: MediaExecutionContext;
}

export function buildExecutionPlan(
  request: MediaTransformRequest,
  context?: MediaExecutionContext,
): MediaExecutionPlan {
  for (const operation of request.operations) {
    if (operation.type === "trim" && operation.endMs <= operation.startMs) {
      throw new Error("trim.endMs must be greater than trim.startMs");
    }
    if (operation.type === "resize" && (operation.width <= 0 || operation.height <= 0)) {
      throw new Error("resize dimensions must be positive");
    }
  }

  if (request.frame) {
    if (request.operations.length) throw new Error("frame extraction cannot be combined with media operations");
    if (request.frame.atMs !== undefined && (!Number.isFinite(request.frame.atMs) || request.frame.atMs < 0)) {
      throw new Error("frame.atMs must be non-negative");
    }
    if ((request.frame.width === undefined) !== (request.frame.height === undefined)) {
      throw new Error("frame width and height must be provided together");
    }
    if ((request.frame.width !== undefined && request.frame.width <= 0) || (request.frame.height !== undefined && request.frame.height <= 0)) {
      throw new Error("frame dimensions must be positive");
    }
  }

  if (request.output.width !== undefined && request.output.width <= 0) {
    throw new Error("output.width must be positive");
  }
  if (request.output.height !== undefined && request.output.height <= 0) {
    throw new Error("output.height must be positive");
  }
  if (request.preset && (!request.preset.id.trim() || !Number.isInteger(request.preset.version) || request.preset.version <= 0)) {
    throw new Error("preset id/version must be valid");
  }

  return {
    sourceAssetId: request.sourceAssetId,
    ...(request.preset ? { preset: { ...request.preset } } : {}),
    ...(request.frame ? { frame: { ...request.frame } } : {}),
    operations: [...request.operations],
    output: { ...request.output },
    ...(context ? { context: { ...context } } : {}),
  };
}

export class MediaWorker implements MediaWorkerPort {
  constructor(private readonly executor: MediaExecutor) {}

  transform(
    request: MediaTransformRequest,
    context?: MediaExecutionContext,
  ): Promise<{ assetId: string; uri: string }> {
    return this.executor.execute(buildExecutionPlan(request, context));
  }
}
