import path from "path";
import { fileURLToPath } from "url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiRootDirectory = path.resolve(moduleDirectory, "..", "..");

export function resolveApiDataDirectory(): string {
  const configured = process.env.AIDRIVE_DATA_DIR;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return path.resolve(configured.trim());
  }
  return path.join(apiRootDirectory, ".data");
}

export function resolveApiDataPath(...segments: string[]): string {
  return path.join(resolveApiDataDirectory(), ...segments);
}
