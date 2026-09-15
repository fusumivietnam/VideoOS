import type {
  MediaOperation,
  MediaTransformRequest,
  MediaWorkerPort,
} from "@videoos/contracts";

export interface MediaExecutor {
  execute(plan: MediaExecutionPlan): Promise<{ assetId: string; uri: string }>;
}

export interface MediaExecutionPlan {
  sourceAssetId: string;
  operations: MediaOperation[];
  output: MediaTransformRequest["output"];
}

export function buildExecutionPlan(request: MediaTransformRequest): MediaExecutionPlan {
  for (const operation of request.operations) {
    if (operation.type === "trim" && operation.endMs <= operation.startMs) {
      throw new Error("trim.endMs must be greater than trim.startMs");
    }
    if (operation.type === "resize" && (operation.width <= 0 || operation.height <= 0)) {
      throw new Error("resize dimensions must be positive");
    }
  }

  if (request.output.width !== undefined && request.output.width <= 0) {
    throw new Error("output.width must be positive");
  }
  if (request.output.height !== undefined && request.output.height <= 0) {
    throw new Error("output.height must be positive");
  }

  return {
    sourceAssetId: request.sourceAssetId,
    operations: [...request.operations],
    output: { ...request.output },
  };
}

export class MediaWorker implements MediaWorkerPort {
  constructor(private readonly executor: MediaExecutor) {}

  transform(request: MediaTransformRequest): Promise<{ assetId: string; uri: string }> {
    return this.executor.execute(buildExecutionPlan(request));
  }
}
