import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { nowIso } from "../../lib/time.js";
import { getActorId, requireWorkspaceMember } from "../../lib/auth.js";

const createWorkspaceSchema = z.object({
  name: z.string().min(2)
});

const memberSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"])
});

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/workspaces", async (request) => {
    const actorId = getActorId(request);
    const workspaceIds = new Set(
      app.ctx.store.workspaceMembers.filter((m) => m.userId === actorId).map((m) => m.workspaceId)
    );
    return { workspaces: app.ctx.store.workspaces.filter((w) => workspaceIds.has(w.id)) };
  });

  app.post("/v1/workspaces", async (request, reply) => {
    const body = createWorkspaceSchema.parse(request.body);
    const actorId = getActorId(request);
    const workspace = {
      id: nanoid(),
      name: body.name,
      createdBy: actorId,
      createdAt: nowIso()
    };
    app.ctx.store.workspaces.push(workspace);
    app.ctx.store.workspaceMembers.push({
      workspaceId: workspace.id,
      userId: actorId,
      role: "OWNER",
      joinedAt: nowIso()
    });
    app.ctx.store.workspaceCreditBalance[workspace.id] = 0;
    return reply.code(201).send({ workspace });
  });

  app.get("/v1/workspaces/:workspaceId/members", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspaceMember(request, workspaceId);
    return {
      members: app.ctx.store.workspaceMembers.filter((m) => m.workspaceId === workspaceId)
    };
  });

  app.put("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
    const body = memberSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, workspaceId);
    if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
      return reply.status(403).send({ error: "Only owner/admin can update members" });
    }

    const existing = app.ctx.store.workspaceMembers.find((m) => m.workspaceId === workspaceId && m.userId === userId);
    if (existing) {
      existing.role = body.role;
      return { member: existing };
    }

    const userExists = app.ctx.store.users.some((u) => u.id === userId);
    if (!userExists) {
      return reply.status(404).send({ error: "User not found" });
    }

    const member = {
      workspaceId,
      userId,
      role: body.role,
      joinedAt: nowIso()
    };
    app.ctx.store.workspaceMembers.push(member);
    return { member };
  });
}
