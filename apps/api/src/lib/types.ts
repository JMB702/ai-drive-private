import type {
  Asset,
  AssetLineageEdge,
  AssetVersion,
  AuditEvent,
  CreditTransaction,
  Folder,
  GenerationJob,
  ModerationEvent,
  PermissionGrant,
  ShareLink,
  User,
  Workspace,
  WorkspaceMember
} from "@aidrive/shared";

export interface InMemoryStore {
  users: User[];
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  folders: Folder[];
  assets: Asset[];
  versions: AssetVersion[];
  lineageEdges: AssetLineageEdge[];
  generationJobs: GenerationJob[];
  permissionGrants: PermissionGrant[];
  shareLinks: ShareLink[];
  creditTransactions: CreditTransaction[];
  moderationEvents: ModerationEvent[];
  auditEvents: AuditEvent[];
  workspaceCreditBalance: Record<string, number>;
}

export interface RuntimeEvents {
  jobSubscribers: Set<(job: GenerationJob) => void>;
}
