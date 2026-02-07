import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = await buildApp();

app.listen({ port: env.PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(`API listening on ${env.PORT}`);
});
