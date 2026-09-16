import type {
  PublishReceipt,
  PublishRequest,
  PublisherPort,
  SocialNetwork,
} from "@videoos/contracts";

export interface NetworkPublisherAdapter {
  readonly network: SocialNetwork;
  publish(request: PublishRequest): Promise<PublishReceipt[]>;
}

export interface IdempotencyStore {
  get(key: string): Promise<PublishReceipt[] | undefined>;
  put(key: string, receipts: PublishReceipt[]): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly values = new Map<string, PublishReceipt[]>();

  async get(key: string): Promise<PublishReceipt[] | undefined> {
    return this.values.get(key);
  }

  async put(key: string, receipts: PublishReceipt[]): Promise<void> {
    this.values.set(key, receipts);
  }
}

export class PublisherService implements PublisherPort {
  private readonly adapters = new Map<SocialNetwork, NetworkPublisherAdapter>();

  constructor(
    adapters: NetworkPublisherAdapter[],
    private readonly idempotency: IdempotencyStore,
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.network)) {
        throw new Error(`Duplicate publisher adapter: ${adapter.network}`);
      }
      this.adapters.set(adapter.network, adapter);
    }
  }

  async publish(request: PublishRequest): Promise<PublishReceipt[]> {
    if (request.targets.length === 0) {
      throw new Error("PublishRequest requires at least one target");
    }
    if (request.assets.length === 0) {
      throw new Error("PublishRequest requires at least one asset");
    }

    const cached = await this.idempotency.get(request.idempotencyKey);
    if (cached) return cached;

    const byNetwork = new Map<SocialNetwork, PublishRequest["targets"]>();
    for (const target of request.targets) {
      const targets = byNetwork.get(target.network) ?? [];
      targets.push(target);
      byNetwork.set(target.network, targets);
    }

    const receipts: PublishReceipt[] = [];
    for (const [network, targets] of byNetwork) {
      const adapter = this.adapters.get(network);
      if (!adapter) {
        receipts.push(
          ...targets.map((target) => ({
            target,
            status: "failed" as const,
            providerCode: "adapter_missing",
            message: `No publisher adapter registered for ${network}`,
          })),
        );
        continue;
      }

      const scopedRequest: PublishRequest = { ...request, targets };
      const result = await adapter.publish(scopedRequest);
      receipts.push(...result);
    }

    await this.idempotency.put(request.idempotencyKey, receipts);
    return receipts;
  }
}
