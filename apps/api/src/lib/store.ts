import type { InMemoryStore, RuntimeEvents } from "./types.js";

export function createStore(): InMemoryStore {
  return {
    users: [],
    workspaces: [],
    workspaceMembers: [],
    folders: [],
    assets: [],
    versions: [],
    lineageEdges: [],
    generationJobs: [],
    permissionGrants: [],
    shareLinks: [],
    creditTransactions: [],
    moderationEvents: [],
    auditEvents: [],
    workspaceCreditBalance: {},
    folderLayouts: {},
    workspaceFolderOrder: {}
  };
}

export function createRuntimeEvents(): RuntimeEvents {
  return { jobSubscribers: new Set() };
}
