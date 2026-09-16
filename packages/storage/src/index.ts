export type AssetKind = 'source-video' | 'derived-video' | 'image' | 'audio' | 'subtitle' | 'project-file' | 'other';

export interface AssetRecord {
  id: string;
  projectId: string;
  kind: AssetKind;
  objectKey: string;
  contentType: string;
  bytes: number;
  checksumSha256?: string;
  createdAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface PutObjectInput {
  key: string;
  contentType: string;
  body: Uint8Array;
  checksumSha256?: string;
}

export interface ObjectStore {
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  signedReadUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Uint8Array>();

  async put(input: PutObjectInput): Promise<void> {
    this.objects.set(input.key, new Uint8Array(input.body));
  }

  async get(key: string): Promise<Uint8Array | null> {
    const body = this.objects.get(key);
    return body ? new Uint8Array(body) : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async signedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw new Error(`object not found: ${key}`);
    if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error('expiresInSeconds must be a positive integer');
    }
    return `memory://object/${encodeURIComponent(key)}?expiresIn=${expiresInSeconds}`;
  }
}

export interface AssetRepository {
  create(asset: AssetRecord): Promise<void>;
  getById(id: string): Promise<AssetRecord | null>;
  listByProject(projectId: string): Promise<AssetRecord[]>;
}

export class InMemoryAssetRepository implements AssetRepository {
  private readonly assets = new Map<string, AssetRecord>();

  async create(asset: AssetRecord): Promise<void> {
    if (this.assets.has(asset.id)) throw new Error(`asset already exists: ${asset.id}`);
    this.assets.set(asset.id, structuredClone(asset));
  }

  async getById(id: string): Promise<AssetRecord | null> {
    const asset = this.assets.get(id);
    return asset ? structuredClone(asset) : null;
  }

  async listByProject(projectId: string): Promise<AssetRecord[]> {
    return [...this.assets.values()]
      .filter((asset) => asset.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((asset) => structuredClone(asset));
  }
}

export function buildProjectObjectKey(projectId: string, assetId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `projects/${projectId}/assets/${assetId}/${safeName}`;
}
