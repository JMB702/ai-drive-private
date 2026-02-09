import { nanoid } from "nanoid";
import type {
  Asset,
  AssetLineageEdge,
  AssetVersion,
  CreditTransaction,
  Effect,
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  ModerationEvent,
  ModerationStatus,
  PermissionGrant,
  ProviderAdapter,
  Role
} from "@aidrive/shared";
import type { InMemoryStore } from "./types.js";
import { DomainError } from "./errors.js";
import { nowIso } from "./time.js";
import { diagnoseGenerationFailure } from "./generation-failure.js";
import { previewBlobKeyFromStorageKey, previewBlobUrl, sanitizeInlinePreviewMetadata } from "./media-preview.js";

const roleActionMap: Record<Role, string[]> = {
  OWNER: ["workspace:*", "asset:*", "folder:*", "generate:*", "billing:*"],
  ADMIN: ["workspace:read", "workspace:update", "asset:*", "folder:*", "generate:*"],
  EDITOR: ["workspace:read", "asset:read", "asset:write", "folder:read", "folder:write", "generate:create"],
  VIEWER: ["workspace:read", "asset:read", "folder:read"]
};

export function canRole(role: Role, action: string): boolean {
  const granted = roleActionMap[role] ?? [];
  return granted.includes(action) || granted.includes(action.replace(/:[^:]+$/, ":*"));
}

export function resolveEffectivePermission(params: {
  grants: PermissionGrant[];
  role: Role;
  principalId: string;
  action: string;
  resourceType: "WORKSPACE" | "FOLDER" | "ASSET";
  resourceId: string;
}): boolean {
  const roleAllowed = canRole(params.role, params.action);
  const grantList = Array.isArray(params.grants) ? params.grants : [];
  const matching = grantList.filter((g) =>
    g &&
    g.resourceType === params.resourceType &&
    g.resourceId === params.resourceId &&
    g.action === params.action &&
    ((g.principalType === "USER" && g.principalId === params.principalId) ||
      (g.principalType === "WORKSPACE_ROLE" && g.principalId === params.role))
  );

  let decision = roleAllowed;
  for (const grant of matching) {
    if (grant.effect === "DENY") {
      decision = false;
    }
    if (grant.effect === "ALLOW") {
      decision = true;
    }
  }

  return decision;
}

export function createAssetVersion(params: {
  store: InMemoryStore;
  assetId: string;
  source: AssetVersion["source"];
  storageKey: string;
  checksum: string;
  metadata: AssetVersion["metadata"];
  createdBy: string;
  parentVersionId?: string;
  transformType?: string;
}): AssetVersion {
  const asset = params.store.assets.find((a) => a.id === params.assetId);
  if (!asset) {
    throw new DomainError("Asset not found", 404);
  }

  const nextVersion = params.store.versions.filter((v) => v.assetId === params.assetId).length + 1;

  const storagePreviewBlob = previewBlobKeyFromStorageKey(params.storageKey);
  if (storagePreviewBlob && typeof params.metadata.previewBlob !== "string") {
    params.metadata.previewBlob = storagePreviewBlob;
    if (typeof params.metadata.previewUrl !== "string" || params.metadata.previewUrl.length === 0) {
      params.metadata.previewUrl = previewBlobUrl(storagePreviewBlob);
    }
  }

  sanitizeInlinePreviewMetadata(params.metadata);
  let resolvedStorageKey = params.storageKey;
  const previewBlob = typeof params.metadata.previewBlob === "string"
    ? params.metadata.previewBlob
    : null;
  if (
    previewBlob &&
    /^(generated|failed|blocked)\//.test(resolvedStorageKey)
  ) {
    const normalizedPreviewBlob = previewBlobKeyFromStorageKey(`previews/${previewBlob}`);
    if (normalizedPreviewBlob) {
      resolvedStorageKey = `previews/${normalizedPreviewBlob}`;
    }
  }

  const version: AssetVersion = {
    id: nanoid(),
    assetId: params.assetId,
    version: nextVersion,
    source: params.source,
    storageKey: resolvedStorageKey,
    checksum: params.checksum,
    metadata: params.metadata,
    createdBy: params.createdBy,
    createdAt: nowIso()
  };

  params.store.versions.push(version);

  if (params.parentVersionId) {
    const edge: AssetLineageEdge = {
      id: nanoid(),
      workspaceId: asset.workspaceId,
      fromVersionId: params.parentVersionId,
      toVersionId: version.id,
      transformType: params.transformType ?? params.source,
      createdAt: nowIso()
    };
    params.store.lineageEdges.push(edge);
  }

  return version;
}

export function buildLineageGraph(store: InMemoryStore, assetId: string) {
  const versions = store.versions.filter((v) => v.assetId === assetId);
  const edges = store.lineageEdges.filter((e) => {
    const from = versions.find((v) => v.id === e.fromVersionId);
    const to = versions.find((v) => v.id === e.toVersionId);
    return Boolean(from && to);
  });

  return versions.map((version) => ({
    version,
    parents: edges.filter((e) => e.toVersionId === version.id).map((e) => e.fromVersionId),
    children: edges.filter((e) => e.fromVersionId === version.id).map((e) => e.toVersionId)
  }));
}

export function reserveCredits(store: InMemoryStore, workspaceId: string, jobId: string, amount: number): CreditTransaction {
  const current = store.workspaceCreditBalance[workspaceId] ?? 0;
  if (current < amount) {
    throw new DomainError("Insufficient credits", 402);
  }
  const balanceAfter = current - amount;
  store.workspaceCreditBalance[workspaceId] = balanceAfter;

  const transaction: CreditTransaction = {
    id: nanoid(),
    workspaceId,
    jobId,
    type: "RESERVE",
    amount,
    balanceAfter,
    occurredAt: nowIso()
  };
  store.creditTransactions.push(transaction);
  return transaction;
}

export function finalizeCredits(
  store: InMemoryStore,
  workspaceId: string,
  jobId: string,
  reservedAmount: number,
  actualAmount: number
): CreditTransaction[] {
  const transactions: CreditTransaction[] = [];

  const finalizeTx: CreditTransaction = {
    id: nanoid(),
    workspaceId,
    jobId,
    type: "FINALIZE",
    amount: actualAmount,
    balanceAfter: store.workspaceCreditBalance[workspaceId] ?? 0,
    occurredAt: nowIso()
  };
  transactions.push(finalizeTx);

  if (actualAmount < reservedAmount) {
    const refund = reservedAmount - actualAmount;
    const after = (store.workspaceCreditBalance[workspaceId] ?? 0) + refund;
    store.workspaceCreditBalance[workspaceId] = after;
    transactions.push({
      id: nanoid(),
      workspaceId,
      jobId,
      type: "REFUND",
      amount: refund,
      balanceAfter: after,
      occurredAt: nowIso()
    });
  }

  store.creditTransactions.push(...transactions);
  return transactions;
}

export function transitionModeration(
  store: InMemoryStore,
  params: {
    workspaceId: string;
    assetVersionId: string;
    from: ModerationStatus;
    to: ModerationStatus;
    actorId: string;
    reason: string;
  }
): ModerationEvent {
  const valid: Record<ModerationStatus, ModerationStatus[]> = {
    PENDING: ["APPROVED", "REJECTED", "QUARANTINED"],
    APPROVED: ["QUARANTINED"],
    REJECTED: [],
    QUARANTINED: ["APPROVED", "REJECTED"]
  };

  if (!valid[params.from].includes(params.to)) {
    throw new DomainError(`Invalid moderation transition: ${params.from} -> ${params.to}`, 409);
  }

  const event: ModerationEvent = {
    id: nanoid(),
    workspaceId: params.workspaceId,
    assetVersionId: params.assetVersionId,
    status: params.to,
    reason: params.reason,
    actorId: params.actorId,
    createdAt: nowIso()
  };

  store.moderationEvents.push(event);
  return event;
}

export function estimateCredits(req: GenerationRequest): number {
  const base = req.type === "VIDEO" ? 20 : 4;
  const qualityMultiplier = typeof req.settings.quality === "number" ? Number(req.settings.quality) : 1;
  return Math.max(1, Math.ceil(base * qualityMultiplier));
}

export function selectAdapter(adapters: ProviderAdapter[], model: string): ProviderAdapter {
  const matched = adapters.find((a) => a.supports.includes(model));
  if (!matched) {
    throw new DomainError(`Unsupported model '${model}'`, 400);
  }
  return matched;
}

export async function executeGeneration(
  store: InMemoryStore,
  adapters: ProviderAdapter[],
  job: GenerationJob
): Promise<GenerationJob> {
  job.status = "RUNNING";
  job.updatedAt = nowIso();
  job.failure = null;
  let provider = "unknown";
  try {
    const adapter = selectAdapter(adapters, job.request.model);
    provider = adapter.key;
    const result: GenerationResult = await adapter.submit(job.request);
    sanitizeInlinePreviewMetadata(result.providerMetadata);
    job.status = "SUCCEEDED";
    job.result = {
      ...result
    };
    job.error = null;
    job.failure = null;
    job.updatedAt = nowIso();
    return job;
  } catch (error) {
    const failure = diagnoseGenerationFailure({
      request: job.request,
      provider,
      error
    });
    job.status = "FAILED";
    job.error = failure.userMessage;
    job.failure = failure;
    job.updatedAt = nowIso();
    return job;
  }
}

export function createGenerationJob(params: {
  workspaceId: string;
  createdBy: string;
  request: GenerationRequest;
  reservedCredits: number;
}): GenerationJob {
  const now = nowIso();
  return {
    id: nanoid(),
    workspaceId: params.workspaceId,
    createdBy: params.createdBy,
    status: "QUEUED",
    request: params.request,
    result: null,
    error: null,
    failure: null,
    reservedCredits: params.reservedCredits,
    createdAt: now,
    updatedAt: now
  };
}

export function createAsset(params: {
  workspaceId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  createdBy: string;
  tags?: string[];
}): Asset {
  return {
    id: nanoid(),
    workspaceId: params.workspaceId,
    folderId: params.folderId,
    name: params.name,
    mimeType: params.mimeType,
    tags: params.tags ?? [],
    deletedAt: null,
    createdBy: params.createdBy,
    createdAt: nowIso()
  };
}

export function evaluateGrantEffect(grants: PermissionGrant[]): Effect | null {
  if (grants.some((g) => g.effect === "DENY")) {
    return "DENY";
  }
  if (grants.some((g) => g.effect === "ALLOW")) {
    return "ALLOW";
  }
  return null;
}
