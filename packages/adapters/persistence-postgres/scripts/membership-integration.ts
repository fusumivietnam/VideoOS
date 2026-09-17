import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresMembershipRepository } from '../src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });
const suffix = randomUUID();
const principalA = `user:a:${suffix}`;
const principalB = `user:b:${suffix}`;
const projectA = `project:a:${suffix}`;
const projectB = `project:b:${suffix}`;
const projectC = `project:c:${suffix}`;

try {
  await pool.query(
    'INSERT INTO projects (id, name) VALUES ($1,$2),($3,$4),($5,$6)',
    [projectA, 'A', projectB, 'B', projectC, 'C'],
  );
  await pool.query(
    `INSERT INTO project_memberships (project_id, principal_id, role)
     VALUES ($1,$2,'owner'),($3,$2,'viewer'),($4,$5,'editor')`,
    [projectB, principalA, projectA, projectC, principalB],
  );

  const memberships = new PostgresMembershipRepository(pool);
  assert.deepEqual(await memberships.listByPrincipal(principalA), [
    { projectId: projectA, principalId: principalA, role: 'viewer' },
    { projectId: projectB, principalId: principalA, role: 'owner' },
  ]);
  assert.deepEqual(await memberships.listByPrincipal(principalB), [
    { projectId: projectC, principalId: principalB, role: 'editor' },
  ]);
  assert.deepEqual(await memberships.listByPrincipal(`missing:${suffix}`), []);

  console.log('PostgreSQL membership discovery integration test passed');
} finally {
  await pool.query('DELETE FROM projects WHERE id = ANY($1::text[])', [[projectA, projectB, projectC]]).catch(() => undefined);
  await pool.end();
}
