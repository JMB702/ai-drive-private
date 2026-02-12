import { z } from "zod";
import fs from "fs";
import path from "path";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_BODY_LIMIT_MB: z.coerce.number().int().positive().default(8),
  AIDRIVE_CREDIT_USD_CENTS: z.coerce.number().int().positive().default(1),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  KLING_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  A2E_API_KEY: z.string().optional(),
  A2E_API_BASE_URL: z.string().optional(),
  NANO_BANANA_API_KEY: z.string().optional(),
  AIDRIVE_DATA_DIR: z.string().optional()
});

export type Env = z.infer<typeof schema>;

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readDotEnvFiles(cwd: string): Record<string, string> {
  const candidates = [
    path.join(cwd, ".env"),
    path.join(cwd, "..", ".env"),
    path.join(cwd, "..", "..", ".env"),
    path.join(cwd, "apps/api/.env")
  ];
  const merged: Record<string, string> = {};
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      Object.assign(merged, parseDotEnv(fs.readFileSync(file, "utf8")));
    } catch {
      // Ignore malformed or unreadable files and continue with process env.
    }
  }
  return merged;
}

export function loadEnv(input = process.env): Env {
  const fileEnv = readDotEnvFiles(process.cwd());
  return schema.parse({ ...fileEnv, ...input });
}
