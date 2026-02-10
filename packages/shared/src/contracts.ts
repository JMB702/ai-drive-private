export type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type Effect = "ALLOW" | "DENY";

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: Role;
  joinedAt: string;
}

export interface Folder {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  tags: string[];
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export type VersionSource = "UPLOAD" | "GENERATE" | "EDIT" | "TRANSFORM";

export interface AssetVersion {
  id: string;
  assetId: string;
  version: number;
  source: VersionSource;
  storageKey: string;
  checksum: string;
  metadata: Record<string, string | number | boolean | null>;
  createdBy: string;
  createdAt: string;
}

export interface AssetLineageEdge {
  id: string;
  workspaceId: string;
  fromVersionId: string;
  toVersionId: string;
  transformType: string;
  createdAt: string;
}

export interface AssetVersionNode {
  version: AssetVersion;
  parents: string[];
  children: string[];
}

export interface PermissionGrant {
  id: string;
  workspaceId: string;
  resourceType: "WORKSPACE" | "FOLDER" | "ASSET";
  resourceId: string;
  principalType: "USER" | "WORKSPACE_ROLE";
  principalId: string;
  action: string;
  effect: Effect;
}

export interface EffectivePermission {
  principalId: string;
  resourceType: "WORKSPACE" | "FOLDER" | "ASSET";
  resourceId: string;
  action: string;
  allowed: boolean;
  evaluatedAt: string;
}

export type GenerationType = "IMAGE" | "VIDEO";
export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type GenerationFailureCategory =
  | "SAFETY_BLOCK"
  | "CONTENT_POLICY"
  | "API_INVALID_ARGUMENT"
  | "API_AUTH"
  | "API_RATE_LIMIT"
  | "API_UNAVAILABLE"
  | "API_TIMEOUT"
  | "ASPECT_RATIO_UNSUPPORTED"
  | "ASPECT_RATIO_MISMATCH"
  | "NETWORK"
  | "UNKNOWN";

export interface GenerationFailure {
  category: GenerationFailureCategory;
  provider: string;
  statusCode: number | null;
  errorCode: string | null;
  userMessage: string;
  suggestedFix: string;
  retryable: boolean;
  rawMessage: string;
  debugContext: Record<string, string | number | boolean | null>;
}

export interface GenerationRequest {
  workspaceId: string;
  assetId?: string;
  folderId?: string;
  prompt: string;
  negativePrompt?: string;
  model: string;
  type: GenerationType;
  settings: Record<string, string | number | boolean>;
}

export interface GenerationResult {
  outputMimeType: string;
  outputBytes: number;
  providerJobId: string;
  providerMetadata: Record<string, string | number | boolean>;
  storageKey: string;
  checksum: string;
}

export interface GenerationJob {
  id: string;
  workspaceId: string;
  createdBy: string;
  status: JobStatus;
  request: GenerationRequest;
  result: GenerationResult | null;
  error: string | null;
  failure?: GenerationFailure | null;
  reservedCredits: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderAdapter {
  key: string;
  supports: string[];
  submit(request: GenerationRequest): Promise<GenerationResult>;
}

export type CreditTransactionType =
  | "RESERVE"
  | "FINALIZE"
  | "REFUND"
  | "TOP_UP"
  | "OVERAGE_CHARGE";

export interface CreditTransaction {
  id: string;
  workspaceId: string;
  jobId?: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface ShareLink {
  id: string;
  workspaceId: string;
  resourceType: "FOLDER" | "ASSET";
  resourceId: string;
  tokenHash: string;
  expiresAt: string | null;
  passcodeHash: string | null;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
}

export type ModerationStatus = "PENDING" | "APPROVED" | "REJECTED" | "QUARANTINED";

export interface ModerationEvent {
  id: string;
  workspaceId: string;
  assetVersionId: string;
  status: ModerationStatus;
  reason: string;
  actorId: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  workspaceId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export type DiagnosticSeverity = "INFO" | "WARN" | "HIGH" | "CRITICAL";

export type DiagnosticCategory =
  | "GENERATION"
  | "PROVIDER"
  | "PROXY"
  | "PERSISTENCE"
  | "REALTIME"
  | "CLIENT"
  | "SUPERVISOR"
  | "IMAGE_PROXY"
  | "SYSTEM";

export type IncidentStatus = "OPEN" | "ACKED" | "RESOLVED";

export type CauseStatus = "KNOWN" | "UNKNOWN";

export interface DiagnosticEvent {
  id: string;
  ts: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  component: string;
  eventName: string;
  message: string;
  workspaceId: string | null;
  requestId: string | null;
  traceId: string | null;
  fingerprint: string;
  context: Record<string, string | number | boolean | null>;
}

export interface DiagnosticIncident {
  id: string;
  fingerprint: string;
  status: IncidentStatus;
  severity: DiagnosticSeverity;
  causeStatus: CauseStatus;
  title: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  latestEventId: string;
}

export interface DiagnosticIncidentPrompts {
  hotspots: string[];
  triage: string;
  fix: string;
  verify: string;
}
