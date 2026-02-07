import type { FastifyRequest } from "fastify";
import { DomainError } from "./errors.js";

export function getActorId(request: FastifyRequest): string {
  const header = request.headers["x-user-id"];
  const userId = typeof header === "string" ? header : "user_demo";
  return userId;
}

export function requireWorkspaceMember(request: FastifyRequest, workspaceId: string) {
  const actorId = getActorId(request);
  const member = request.server.ctx.store.workspaceMembers.find(
    (m) => m.workspaceId === workspaceId && m.userId === actorId
  );
  if (!member) {
    throw new DomainError("Not a workspace member", 403);
  }
  return { actorId, role: member.role };
}
