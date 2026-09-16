import assert from 'node:assert/strict';
import test from 'node:test';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3ObjectStore } from '../src/index.js';

function createHarness() {
  const commands: unknown[] = [];
  let getBody = new Uint8Array([1, 2, 3]);
  let getError: unknown;
  let signedUrl = 'https://storage.example.invalid/signed';
  let signedExpiry = 0;

  const store = new S3ObjectStore(
    { bucket: 'videoos-dev', region: 'us-east-1' },
    {
      sender: {
        async send(command: unknown) {
          commands.push(command);
          if (command instanceof GetObjectCommand) {
            if (getError) throw getError;
            return { Body: { transformToByteArray: async () => getBody } };
          }
          return {};
        },
      },
      async presign(command, expiresInSeconds) {
        commands.push(command);
        signedExpiry = expiresInSeconds;
        return signedUrl;
      },
    },
  );

  return {
    store,
    commands,
    setGetBody(value: Uint8Array) {
      getBody = new Uint8Array(value);
    },
    setGetError(value: unknown) {
      getError = value;
    },
    setSignedUrl(value: string) {
      signedUrl = value;
    },
    signedExpiry: () => signedExpiry,
  };
}

test('put sends project-scoped object metadata and translates SHA-256 hex checksum to S3 base64', async () => {
  const harness = createHarness();
  const body = new Uint8Array([1, 2, 3]);
  await harness.store.put({
    key: 'projects/project-1/assets/asset-1/source.mp4',
    contentType: 'video/mp4',
    body,
    checksumSha256: '00'.repeat(32),
  });

  const command = harness.commands[0];
  assert.ok(command instanceof PutObjectCommand);
  assert.equal(command.input.Bucket, 'videoos-dev');
  assert.equal(command.input.Key, 'projects/project-1/assets/asset-1/source.mp4');
  assert.equal(command.input.ContentType, 'video/mp4');
  assert.equal(command.input.ChecksumSHA256, Buffer.alloc(32).toString('base64'));
  assert.deepEqual(command.input.Body, body);
});

test('get returns bytes and translates missing objects to null', async () => {
  const harness = createHarness();
  harness.setGetBody(new Uint8Array([7, 8, 9]));
  assert.deepEqual(
    await harness.store.get('projects/project-1/assets/asset-1/source.mp4'),
    new Uint8Array([7, 8, 9]),
  );

  harness.setGetError({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
  assert.equal(await harness.store.get('projects/project-1/assets/missing/source.mp4'), null);
});

test('delete is delegated to S3 and signed read URLs use bounded expiry', async () => {
  const harness = createHarness();
  await harness.store.delete('projects/project-1/assets/asset-1/source.mp4');
  assert.ok(harness.commands[0] instanceof DeleteObjectCommand);

  harness.setSignedUrl('https://cdn.example.invalid/read-token');
  const url = await harness.store.signedReadUrl('projects/project-1/assets/asset-1/source.mp4', 300);
  assert.equal(url, 'https://cdn.example.invalid/read-token');
  assert.equal(harness.signedExpiry(), 300);
  assert.ok(harness.commands[1] instanceof GetObjectCommand);

  await assert.rejects(
    harness.store.signedReadUrl('projects/project-1/assets/asset-1/source.mp4', 604_801),
    /expiry/,
  );
});

test('unsafe or non-project-scoped keys and malformed checksums are rejected before S3 calls', async () => {
  const harness = createHarness();
  const body = new Uint8Array([1]);

  for (const key of ['asset.bin', '../asset.bin', 'projects//asset.bin', 'projects/project-1/../asset.bin', 'projects\\project-1\\asset.bin']) {
    await assert.rejects(
      harness.store.put({ key, contentType: 'application/octet-stream', body }),
      /object key|project-scoped/,
    );
  }

  await assert.rejects(
    harness.store.put({
      key: 'projects/project-1/assets/asset-1/output.bin',
      contentType: 'application/octet-stream',
      body,
      checksumSha256: 'not-a-checksum',
    }),
    /checksumSha256/,
  );
  assert.equal(harness.commands.length, 0);
});
