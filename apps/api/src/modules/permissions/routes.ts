import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getActorId, requireWorkspaceMember } from "../../lib/auth.js";
import { nowIso } from "../../lib/time.js";
import { resolveEffectivePermission } from "../../lib/services.js";

const grantSchema = z.object({
  workspaceId: z.string(),
  resourceType: z.enum(["WORKSPACE", "FOLDER", "ASSET"]),
  resourceId: z.string(),
  principalType: z.enum(["USER", "WORKSPACE_ROLE"]),
  principalId: z.string(),
  action: z.string(),
  effect: z.enum(["ALLOW", "DENY"])
});

const checkSchema = z.object({
  workspaceId: z.string(),
  resourceType: z.enum(["WORKSPACE", "FOLDER", "ASSET"]),
  resourceId: z.string(),
  action: z.string()
});

export async function registerPermissionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/permissions/grants", async (request, reply) => {
    const body = grantSchema.parse(request.body);
    const { role } = requireWorkspaceMember(request, body.workspaceId);
    if (role !== "OWNER" && role !== "ADMIN") {
      return reply.status(403).send({ error: "Only owner/admin can grant permissions" });
    }

    const grant = {
      id: nanoid(),
      ...body
    };

    app.ctx.store.permissionGrants.push(grant);
    app.ctx.store.auditEvents.push({
      id: nanoid(),
      workspaceId: body.workspaceId,
      actorId: getActorId(request),
      action: "permission.grant.created",
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      metadata: { action: body.action, effect: body.effect, principalId: body.principalId },
      createdAt: nowIso()
    });

    return reply.code(201).send({ grant });
  });

  app.post("/v1/permissions/check", async (request) => {
    const body = checkSchema.parse(request.body);
    const { actorId, role } = requireWorkspaceMember(request, body.workspaceId);
    const allowed = resolveEffectivePermission({
      grants: app.ctx.store.permissionGrants,
      role,
      principalId: actorId,
      action: body.action,
      resourceType: body.resourceType,
      resourceId: body.resourceId
    });

    return {
      principalId: actorId,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      action: body.action,
      allowed,
      evaluatedAt: nowIso()
    };
  });
}
