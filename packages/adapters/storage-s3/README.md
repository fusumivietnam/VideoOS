# S3-compatible ObjectStore adapter

`@videoos/adapter-storage-s3` implements the provider-neutral `ObjectStore` contract with AWS SDK v3. The adapter is compatible with AWS S3-style APIs such as MinIO and Cloudflare R2 by changing only application-edge configuration.

The package does not read environment variables itself and does not expose AWS SDK command/client types through the core storage contract. Credentials must be resolved by the application/deployment edge and passed to `S3ObjectStore`.

## AWS S3

```ts
import { S3ObjectStore } from '@videoos/adapter-storage-s3';

const objects = new S3ObjectStore({
  bucket: process.env.OBJECT_BUCKET!,
  region: process.env.AWS_REGION!,
});
```

When `credentials` are omitted, the AWS SDK default credential provider chain is used.

## MinIO / local S3-compatible service

```ts
const objects = new S3ObjectStore({
  bucket: 'videoos',
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY!,
    secretAccessKey: process.env.MINIO_SECRET_KEY!,
  },
});
```

MinIO is optional. The dependency-free `FileSystemObjectStore` in `apps/local-runtime` remains the cheapest local development path.

## Cloudflare R2

```ts
const objects = new S3ObjectStore({
  bucket: process.env.R2_BUCKET!,
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
```

## Safety and semantics

- Object keys must be under `projects/<projectId>/...` and may not contain traversal/ambiguous path segments.
- Optional `checksumSha256` values are validated as 64-character hexadecimal digests and sent to S3 as `ChecksumSHA256`.
- Missing objects are mapped to `null` for the `ObjectStore.get` contract.
- Signed read URLs are provider-generated through AWS SigV4 and are limited to 1–604800 seconds.
- Delete delegates to S3's idempotent delete-object operation.
- Provider credentials stay out of browser/public contracts and should be injected only at a trusted runtime/deployment edge.
