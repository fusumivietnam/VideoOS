import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStore, PutObjectInput } from '@videoos/storage';

export interface S3ObjectStoreOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

interface CommandSender {
  send(command: unknown): Promise<unknown>;
}

interface S3ObjectStoreDependencies {
  sender: CommandSender;
  presign(command: GetObjectCommand, expiresInSeconds: number): Promise<string>;
}

export class S3ObjectStore implements ObjectStore {
  private readonly bucket: string;
  private readonly dependencies: S3ObjectStoreDependencies;

  constructor(options: S3ObjectStoreOptions, dependencies?: S3ObjectStoreDependencies) {
    this.bucket = requireValue(options.bucket, 'S3 bucket');
    requireValue(options.region, 'S3 region');
    this.dependencies = dependencies ?? createDependencies(options);
  }

  async put(input: PutObjectInput): Promise<void> {
    assertProjectScopedKey(input.key);
    const checksum = input.checksumSha256 ? checksumHexToBase64(input.checksumSha256) : undefined;

    await this.dependencies.sender.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(checksum ? { ChecksumSHA256: checksum } : {}),
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertProjectScopedKey(key);
    try {
      const output = (await this.dependencies.sender.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };

      if (!output.Body?.transformToByteArray) {
        throw new Error('S3 get-object response does not expose a byte-array body');
      }
      return new Uint8Array(await output.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertProjectScopedKey(key);
    await this.dependencies.sender.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertProjectScopedKey(key);
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 604_800) {
      throw new Error('signed read URL expiry must be an integer between 1 and 604800 seconds');
    }
    return this.dependencies.presign(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      expiresInSeconds,
    );
  }
}

function createDependencies(options: S3ObjectStoreOptions): S3ObjectStoreDependencies {
  const config: S3ClientConfig = {
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
  };
  const client = new S3Client(config);

  return {
    sender: {
      send(command: unknown) {
        return client.send(command as Parameters<S3Client['send']>[0]);
      },
    },
    presign(command, expiresInSeconds) {
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },
  };
}

function assertProjectScopedKey(key: string): void {
  if (!key.trim()) throw new Error('object key is required');
  if (key.includes('\\')) throw new Error('object key must use forward slashes');
  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('object key contains an invalid path segment');
  }
  if (segments[0] !== 'projects' || !segments[1]) {
    throw new Error('object key must be project-scoped under projects/<projectId>/');
  }
}

function checksumHexToBase64(value: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('checksumSha256 must be a 64-character hexadecimal SHA-256 digest');
  }
  return Buffer.from(value, 'hex').toString('base64');
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NoSuchKey' || candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}

function requireValue(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value;
}
