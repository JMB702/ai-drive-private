import { nanoid } from "nanoid";
import type { AppContext } from "./context.js";
import { nowIso } from "./time.js";

export function seedData(ctx: AppContext): void {
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

  for (let i = 1; i <= 8; i += 1) {
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
