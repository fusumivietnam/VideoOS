import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryMembershipRepository, type Principal } from '@videoos/identity';
import { InMemoryJobQueue } from '@videoos/job-queue';
import { InMemoryAssetRepository } from '@videoos/storage';
import { VideoOsApi } from '../../../services/api/src/index.js';

const userA: Principal = { id: 'user:a', kind: 'user' };
const userB: Principal = { id: 'user:b', kind: 'user' };

async function fixture() {
  const memberships = new InMemoryMembershipRepository([
    { projectId: 'project:b', principalId: userA.id, role: 'viewer' },
    { projectId: 'project:a', principalId: userA.id, role: 'owner' },
    { projectId: 'project:c', principalId: userB.id, role: 'editor' },
  ]);
  const assets = new InMemoryAssetRepository();
  const jobs = new InMemoryJobQueue();
  const createdAt = '2026-09-17T00:00:00.000Z';

  await assets.create({
    id: 'asset:a', projectId: 'project:a', kind: 'source-video', objectKey: 'a.mp4',
    contentType: 'video/mp4', bytes: 10, createdAt,
  });
  await assets.create({
    id: 'asset:c', projectId: 'project:c', kind: 'source-video', objectKey: 'c.mp4',
    contentType: 'video/mp4', bytes: 20, createdAt,
  });
  await jobs.enqueue('media', 'job:a', { projectId: 'project:a', assetId: 'asset:a' });
  await jobs.enqueue('media', 'job:c', { projectId: 'project:c', assetId: 'asset:c' });

  return { api: new VideoOsApi({ memberships, assets, jobs }) };
}

test('project discovery is principal-scoped and deterministic', async () => {
  const { api } = await fixture();
  assert.deepEqual(await api.listProjects(userA), [
    { projectId: 'project:a', role: 'owner' },
    { projectId: 'project:b', role: 'viewer' },
  ]);
  assert.deepEqual(await api.listProjects(userB), [
    { projectId: 'project:c', role: 'editor' },
  ]);
});

test('asset reads require project membership', async () => {
  const { api } = await fixture();
  assert.deepEqual((await api.listAssets(userA, 'project:a')).map((asset) => asset.id), ['asset:a']);
  await assert.rejects(api.listAssets(userA, 'project:c'), /project membership required/);
});

test('job status cannot cross project boundaries', async () => {
  const { api } = await fixture();
  assert.equal((await api.getJobStatus(userA, 'project:a', 'job:a'))?.jobId, 'job:a');
  assert.equal(await api.getJobStatus(userA, 'project:a', 'job:c'), null);
  await assert.rejects(api.getJobStatus(userA, 'project:c', 'job:c'), /project membership required/);
});
