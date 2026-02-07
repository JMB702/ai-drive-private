import type { FastifyInstance } from "fastify";

export async function registerRealtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/realtime/jobs/stream", async (_request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache"
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 15000);

    const listener = (job: unknown) => {
      reply.raw.write("event: job.update\n");
      reply.raw.write(`data: ${JSON.stringify(job)}\n\n`);
    };

    app.ctx.runtime.jobSubscribers.add(listener as (job: any) => void);

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      app.ctx.runtime.jobSubscribers.delete(listener as (job: any) => void);
      reply.raw.end();
    });
  });
}
