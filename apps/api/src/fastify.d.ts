import "fastify";
import type { AppContext } from "./lib/context.js";

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
