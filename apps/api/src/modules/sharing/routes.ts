import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { nowIso } from "../../lib/time.js";

const inviteSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  role: z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"])
});

const linkSchema = z.object({
  workspaceId: z.string(),
  resourceType: z.enum(["FOLDER", "ASSET"]),
  resourceId: z.string(),
  createdBy: z.string(),
  expiresAt: z.string().nullable().optional(),
  passcode: z.string().min(4).nullable().optional()
});

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function registerSharingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/sharing/invite", async (request) => {
    const body = inviteSchema.parse(request.body);
    const existing = app.ctx.store.workspaceMembers.find(
      (m) => m.workspaceId === body.workspaceId && m.userId === body.userId
    );
    if (existing) {
      existing.role = body.role;
      return { member: existing, invited: false };
    }
    const member = {
      workspaceId: body.workspaceId,
      userId: body.userId,
      role: body.role,
      joinedAt: nowIso()
    };
    app.ctx.store.workspaceMembers.push(member);
    return { member, invited: true };
  });

  app.post("/v1/sharing/links", async (request, reply) => {
    const body = linkSchema.parse(request.body);
    const token = nanoid(24);
    const shareLink = {
      id: nanoid(),
      workspaceId: body.workspaceId,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      tokenHash: hash(token),
      expiresAt: body.expiresAt ?? null,
      passcodeHash: body.passcode ? hash(body.passcode) : null,
      createdBy: body.createdBy,
      createdAt: nowIso(),
      revokedAt: null
    };
    app.ctx.store.shareLinks.push(shareLink);
    return reply.code(201).send({ shareLink, token });
  });

  app.post("/v1/sharing/links/:linkId/revoke", async (request) => {
    const { linkId } = request.params as { linkId: string };
    const link = app.ctx.store.shareLinks.find((l) => l.id === linkId);
    if (!link) {
      return { revoked: false };
    }
    link.revokedAt = nowIso();
    return { revoked: true, shareLink: link };
  });
}
