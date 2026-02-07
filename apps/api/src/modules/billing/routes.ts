import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { nowIso } from "../../lib/time.js";
import { requireWorkspaceMember } from "../../lib/auth.js";

const topupSchema = z.object({
  workspaceId: z.string(),
  amount: z.number().int().positive()
});

const overageSchema = z.object({
  workspaceId: z.string(),
  amount: z.number().int().positive(),
  description: z.string().min(2)
});

export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/billing/:workspaceId/balance", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspaceMember(request, workspaceId);
    return {
      workspaceId,
      balance: app.ctx.store.workspaceCreditBalance[workspaceId] ?? 0
    };
  });

  app.get("/v1/billing/:workspaceId/usage", async (request) => {
    const { workspaceId } = request.params as { workspaceId: string };
    requireWorkspaceMember(request, workspaceId);
    return {
      transactions: app.ctx.store.creditTransactions.filter((t) => t.workspaceId === workspaceId)
    };
  });

  app.post("/v1/billing/top-up", async (request, reply) => {
    const body = topupSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);
    if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
      return reply.status(403).send({ error: "Only owner/admin can top up" });
    }

    const current = app.ctx.store.workspaceCreditBalance[body.workspaceId] ?? 0;
    const next = current + body.amount;
    app.ctx.store.workspaceCreditBalance[body.workspaceId] = next;

    const tx = {
      id: nanoid(),
      workspaceId: body.workspaceId,
      type: "TOP_UP" as const,
      amount: body.amount,
      balanceAfter: next,
      occurredAt: nowIso()
    };
    app.ctx.store.creditTransactions.push(tx);

    return reply.code(201).send({ transaction: tx });
  });

  app.post("/v1/billing/overage", async (request, reply) => {
    const body = overageSchema.parse(request.body);
    const actor = requireWorkspaceMember(request, body.workspaceId);
    if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
      return reply.status(403).send({ error: "Only owner/admin can post overage" });
    }

    const current = app.ctx.store.workspaceCreditBalance[body.workspaceId] ?? 0;
    const next = current - body.amount;
    app.ctx.store.workspaceCreditBalance[body.workspaceId] = next;

    const tx = {
      id: nanoid(),
      workspaceId: body.workspaceId,
      type: "OVERAGE_CHARGE" as const,
      amount: body.amount,
      balanceAfter: next,
      occurredAt: nowIso(),
      metadata: { description: body.description }
    };
    app.ctx.store.creditTransactions.push(tx);

    return reply.code(201).send({ transaction: tx });
  });
}
