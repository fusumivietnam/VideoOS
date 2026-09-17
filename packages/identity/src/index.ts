export type ProjectRole = 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer' | 'node';
export type ProjectCapability =
  | 'project.read'
  | 'project.manage'
  | 'asset.read'
  | 'asset.write'
  | 'publish.create'
  | 'publish.manage'
  | 'analytics.read'
  | 'node.execute';

export interface Principal {
  id: string;
  kind: 'user' | 'service' | 'node';
}

export interface ProjectMembership {
  projectId: string;
  principalId: string;
  role: ProjectRole;
}

const ROLE_CAPABILITIES: Record<ProjectRole, ReadonlySet<ProjectCapability>> = {
  owner: new Set(['project.read', 'project.manage', 'asset.read', 'asset.write', 'publish.create', 'publish.manage', 'analytics.read', 'node.execute']),
  admin: new Set(['project.read', 'project.manage', 'asset.read', 'asset.write', 'publish.create', 'publish.manage', 'analytics.read', 'node.execute']),
  editor: new Set(['project.read', 'asset.read', 'asset.write', 'publish.create', 'analytics.read']),
  analyst: new Set(['project.read', 'asset.read', 'analytics.read']),
  viewer: new Set(['project.read', 'asset.read']),
  node: new Set(['project.read', 'asset.read', 'asset.write', 'node.execute']),
};

export interface MembershipRepository {
  get(projectId: string, principalId: string): Promise<ProjectMembership | null>;
  listByPrincipal(principalId: string): Promise<ProjectMembership[]>;
}

export async function authorizeProjectCapability(
  repository: MembershipRepository,
  principal: Principal,
  projectId: string,
  capability: ProjectCapability,
): Promise<ProjectMembership> {
  const membership = await repository.get(projectId, principal.id);
  if (!membership) throw new Error('project membership required');
  if (!ROLE_CAPABILITIES[membership.role].has(capability)) {
    throw new Error(`capability denied: ${capability}`);
  }
  return membership;
}

export class InMemoryMembershipRepository implements MembershipRepository {
  constructor(private readonly memberships: ProjectMembership[] = []) {}

  async get(projectId: string, principalId: string): Promise<ProjectMembership | null> {
    const membership = this.memberships.find(
      (item) => item.projectId === projectId && item.principalId === principalId,
    );
    return membership ? structuredClone(membership) : null;
  }

  async listByPrincipal(principalId: string): Promise<ProjectMembership[]> {
    return this.memberships
      .filter((item) => item.principalId === principalId)
      .map((item) => structuredClone(item))
      .sort((left, right) => left.projectId.localeCompare(right.projectId));
  }

  add(membership: ProjectMembership): void {
    const index = this.memberships.findIndex(
      (item) => item.projectId === membership.projectId && item.principalId === membership.principalId,
    );
    if (index >= 0) this.memberships[index] = structuredClone(membership);
    else this.memberships.push(structuredClone(membership));
  }
}
