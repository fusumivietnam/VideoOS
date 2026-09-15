import type {
  AiGatewayPort,
  AiTaskRequest,
  AiTaskResult,
} from "@videoos/contracts";

export interface AiProviderAdapter {
  readonly name: string;
  supports(modelPolicy: string): boolean;
  execute<T>(request: AiTaskRequest): Promise<AiTaskResult<T>>;
}

export interface AiUsageSink {
  record(entry: {
    provider: string;
    model: string;
    task: AiTaskRequest["task"];
    costUsd?: number;
  }): Promise<void>;
}

export class AiGateway implements AiGatewayPort {
  constructor(
    private readonly providers: AiProviderAdapter[],
    private readonly usageSink?: AiUsageSink,
  ) {}

  async execute<T = unknown>(request: AiTaskRequest): Promise<AiTaskResult<T>> {
    const provider = this.providers.find((candidate) =>
      candidate.supports(request.modelPolicy),
    );

    if (!provider) {
      throw new Error(`No AI provider satisfies policy: ${request.modelPolicy}`);
    }

    const result = await provider.execute<T>(request);

    if (
      request.maxCostUsd !== undefined &&
      result.usage?.costUsd !== undefined &&
      result.usage.costUsd > request.maxCostUsd
    ) {
      throw new Error(
        `AI task exceeded cost ceiling: ${result.usage.costUsd} > ${request.maxCostUsd}`,
      );
    }

    await this.usageSink?.record({
      provider: result.provider,
      model: result.model,
      task: request.task,
      ...(result.usage?.costUsd !== undefined
        ? { costUsd: result.usage.costUsd }
        : {}),
    });

    return result;
  }
}
