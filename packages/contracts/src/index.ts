export type ISODateTime = string;
export type EntityId = string;

export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  id: EntityId;
  type: TType;
  version: number;
  occurredAt: ISODateTime;
  correlationId: EntityId;
  causationId?: EntityId;
  actorId?: EntityId;
  payload: TPayload;
}

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface JobRef {
  id: EntityId;
  projectId: EntityId;
  status: JobStatus;
  attempt: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type SocialNetwork =
  | "youtube"
  | "tiktok"
  | "facebook"
  | "instagram"
  | "x"
  | "linkedin"
  | "threads"
  | "other";

export interface PublishTarget {
  network: SocialNetwork;
  accountId: EntityId;
  channelId?: EntityId;
}

export interface PublishAsset {
  assetId: EntityId;
  uri: string;
  mimeType: string;
  durationMs?: number;
}

export interface PublishRequest {
  idempotencyKey: string;
  projectId: EntityId;
  targets: PublishTarget[];
  assets: PublishAsset[];
  caption?: string;
  scheduledAt?: ISODateTime;
  metadata?: Record<string, unknown>;
}

export interface PublishReceipt {
  target: PublishTarget;
  externalPostId?: string;
  externalUrl?: string;
  status: "accepted" | "published" | "failed";
  providerCode?: string;
  message?: string;
}

export interface MediaPresetRef {
  id: string;
  version: number;
}

export interface MediaTransformRequest {
  sourceAssetId: EntityId;
  preset?: MediaPresetRef;
  operations: MediaOperation[];
  output: {
    container: string;
    videoCodec?: string;
    audioCodec?: string;
    width?: number;
    height?: number;
    fps?: number;
  };
}

export type MediaOperation =
  | { type: "trim"; startMs: number; endMs: number }
  | { type: "resize"; width: number; height: number; fit: "cover" | "contain" }
  | { type: "normalize-audio"; targetLufs: number }
  | { type: "burn-subtitles"; subtitleAssetId: EntityId }
  | { type: "extract-frame"; atMs?: number; width?: number; height?: number };

export interface AiTaskRequest {
  task: "generate" | "summarize" | "classify" | "extract" | "review";
  modelPolicy: string;
  input: unknown;
  maxCostUsd?: number;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AiTaskResult<T = unknown> {
  provider: string;
  model: string;
  output: T;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
}

export interface AnalyticsEvent {
  name: string;
  projectId?: EntityId;
  actorId?: EntityId;
  occurredAt: ISODateTime;
  properties?: Record<string, string | number | boolean | null>;
}

export interface PublisherPort {
  publish(request: PublishRequest): Promise<PublishReceipt[]>;
}

export interface MediaWorkerPort {
  transform(request: MediaTransformRequest): Promise<{ assetId: EntityId; uri: string }>;
}

export interface AiGatewayPort {
  execute<T = unknown>(request: AiTaskRequest): Promise<AiTaskResult<T>>;
}

export interface EventBusPort {
  publish<TType extends string, TPayload>(event: EventEnvelope<TType, TPayload>): Promise<void>;
}
