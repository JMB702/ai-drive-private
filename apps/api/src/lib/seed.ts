import { nanoid } from "nanoid";
import type { AppContext } from "./context.js";
import { nowIso } from "./time.js";

type SeedOptions = {
  sampleProjectCount?: number;
};

export function seedData(ctx: AppContext, options: SeedOptions = {}): void {
  const sampleProjectCount = Math.max(0, Math.trunc(options.sampleProjectCount ?? 8));
  const user = {
    id: "user_demo",
    email: "owner@example.com",
    displayName: "Demo Owner",
    createdAt: nowIso()
  };
  ctx.store.users.push(user);

  const workspace = {
    id: "ws_demo",
    name: "Demo Workspace",
    createdBy: user.id,
    createdAt: nowIso()
  };

  ctx.store.workspaces.push(workspace);
  ctx.store.workspaceMembers.push({
    workspaceId: workspace.id,
    userId: user.id,
    role: "OWNER",
    joinedAt: nowIso()
  });

  ctx.store.workspaceCreditBalance[workspace.id] = 1_000;

  if (sampleProjectCount > 0) {
    for (let i = 1; i <= sampleProjectCount; i += 1) {
      ctx.store.folders.push({
        id: nanoid(),
        workspaceId: workspace.id,
        parentId: null,
        name: `Sample Project ${String(i).padStart(2, "0")}`,
        deletedAt: null,
        createdBy: user.id,
        createdAt: nowIso()
      });
    }
  }

  ctx.store.permissionGrants.push({
    id: nanoid(),
    workspaceId: workspace.id,
    resourceType: "WORKSPACE",
    resourceId: workspace.id,
    principalType: "WORKSPACE_ROLE",
    principalId: "VIEWER",
    action: "asset:write",
    effect: "DENY"
  });
}
