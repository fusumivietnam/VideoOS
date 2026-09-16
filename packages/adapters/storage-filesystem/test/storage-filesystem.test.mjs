import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileSystemObjectStore } from '../.test-dist/index.js';

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'videoos-object-store-'));
  try {
    await run(new FileSystemObjectStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('filesystem object store round-trips nested objects and deletes idempotently', async () => {
  await withStore(async (store, root) => {
    const body = new TextEncoder().encode('hello VideoOS');
    const checksumSha256 = createHash('sha256').update(body).digest('hex');
    const key = 'projects/project-1/assets/asset-1/source.txt';

    await store.put({ key, contentType: 'text/plain', body, checksumSha256 });
    assert.deepEqual(await store.get(key), body);
    assert.equal((await readFile(join(root, key))).toString('utf8'), 'hello VideoOS');

    await store.delete(key);
    assert.equal(await store.get(key), null);
    await store.delete(key);
  });
});

test('filesystem object store rejects unsafe object keys', async () => {
  await withStore(async (store) => {
    const body = new Uint8Array([1]);
    for (const key of ['../escape.bin', '/absolute.bin', 'projects//asset.bin', 'projects/./asset.bin', 'projects/../asset.bin', 'projects\\asset.bin']) {
      await assert.rejects(
        store.put({ key, contentType: 'application/octet-stream', body }),
        /object key|absolute object keys/,
      );
    }
  });
});

test('checksum mismatch is rejected before any object is committed', async () => {
  await withStore(async (store) => {
    const key = 'projects/project-1/assets/asset-2/output.bin';
    await assert.rejects(
      store.put({
        key,
        contentType: 'application/octet-stream',
        body: new Uint8Array([1, 2, 3]),
        checksumSha256: '0'.repeat(64),
      }),
      /checksum mismatch/,
    );
    assert.equal(await store.get(key), null);
  });
});

test('filesystem object store does not pretend local file paths are signed URLs', async () => {
  await withStore(async (store) => {
    await assert.rejects(
      store.signedReadUrl('projects/project-1/assets/asset-1/source.txt', 60),
      /signed read URLs are not supported/,
    );
  });
});
