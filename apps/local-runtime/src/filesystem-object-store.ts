import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';

import type { ObjectStore, PutObjectInput } from '@videoos/storage';

/**
 * Local development ObjectStore implementation.
 *
 * This intentionally lives at the application edge instead of becoming a
 * workspace adapter package: it has no provider SDK dependency and keeps the
 * local development path available without changing the dependency lockfile.
 */
export class FileSystemObjectStore implements ObjectStore {
  private readonly rootDir: string;
  private readonly rootPrefix: string;

  constructor(rootDir: string) {
    if (!rootDir.trim()) throw new Error('filesystem object-store root is required');
    this.rootDir = resolve(rootDir);
    this.rootPrefix = this.rootDir.endsWith(sep) ? this.rootDir : `${this.rootDir}${sep}`;
  }

  async put(input: PutObjectInput): Promise<void> {
    const target = this.pathForKey(input.key);

    if (input.checksumSha256) {
      const actual = createHash('sha256').update(input.body).digest('hex');
      if (actual !== input.checksumSha256.toLowerCase()) {
        throw new Error(`object checksum mismatch for key: ${input.key}`);
      }
    }

    await mkdir(dirname(target), { recursive: true });
    const temp = resolve(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);

    try {
      await writeFile(temp, input.body, { flag: 'wx' });
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const target = this.pathForKey(key);
    try {
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.pathForKey(key);
    try {
      await unlink(target);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async signedReadUrl(_key: string, _expiresInSeconds: number): Promise<string> {
    throw new Error('signed read URLs are not supported by the filesystem object store');
  }

  private pathForKey(key: string): string {
    if (!key.trim()) throw new Error('object key is required');
    if (key.indexOf(String.fromCharCode(0)) >= 0) {
      throw new Error('object key contains a null byte');
    }
    if (key.includes('\\')) throw new Error('object key must use forward slashes');
    if (isAbsolute(key)) throw new Error('absolute object keys are not allowed');

    const segments = key.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error('object key contains an invalid path segment');
    }

    const target = resolve(this.rootDir, ...segments);
    if (target !== this.rootDir && !target.startsWith(this.rootPrefix)) {
      throw new Error('object key escapes the configured root');
    }
    return target;
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
