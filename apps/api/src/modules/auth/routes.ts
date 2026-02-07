import { nanoid } from "nanoid";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { nowIso } from "../../lib/time.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const user = {
      id: nanoid(),
      email: body.email,
      displayName: body.displayName,
      createdAt: nowIso()
    };
    app.ctx.store.users.push(user);

    return reply.code(201).send({ user, token: `dev-token-${user.id}` });
  });

  app.post("/v1/auth/login", async () => ({ token: "dev-token-user_demo", refreshToken: "dev-refresh" }));
  app.post("/v1/auth/token/refresh", async () => ({ token: "dev-token-user_demo" }));
  app.get("/v1/auth/oauth/:provider/callback", async (request) => ({
    provider: (request.params as { provider: string }).provider,
    token: "oauth-dev-token"
  }));
}
