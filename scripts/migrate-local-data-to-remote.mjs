#!/usr/bin/env node

import fs from "fs";
import path from "path";

const targetUrl = (process.env.TARGET_URL || "https://ai-drive-private.onrender.com").replace(/\/+$/, "");
const username = process.env.APP_ACCESS_USERNAME;
const password = process.env.APP_ACCESS_PASSWORD;
const localDataDir = path.resolve(process.env.LOCAL_DATA_DIR || path.join(process.cwd(), "apps", "api", ".data"));
const storePath = path.join(localDataDir, "api-store.json");
const previewsDir = path.join(localDataDir, "previews");
const includeJobs = process.env.MIGRATE_INCLUDE_JOBS === "1";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Failed to read JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function isPreviewBlobKey(value) {
  return typeof value === "string" && /^[a-f0-9]{40}\.[a-z0-9]+$/i.test(value);
}

function previewBlobFromStorageKey(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^previews\/([a-f0-9]{40}\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function buildSnapshot(store) {
  const snapshot = {
    users: Array.isArray(store.users) ? store.users : [],
    workspaces: Array.isArray(store.workspaces) ? store.workspaces : [],
    workspaceMembers: Array.isArray(store.workspaceMembers) ? store.workspaceMembers : [],
    folders: Array.isArray(store.folders) ? store.folders : [],
    assets: Array.isArray(store.assets) ? store.assets : [],
    versions: Array.isArray(store.versions) ? store.versions : [],
    lineageEdges: Array.isArray(store.lineageEdges) ? store.lineageEdges : [],
    permissionGrants: Array.isArray(store.permissionGrants) ? store.permissionGrants : [],
    shareLinks: Array.isArray(store.shareLinks) ? store.shareLinks : [],
    creditTransactions: Array.isArray(store.creditTransactions) ? store.creditTransactions : [],
    moderationEvents: Array.isArray(store.moderationEvents) ? store.moderationEvents : [],
    auditEvents: Array.isArray(store.auditEvents) ? store.auditEvents : [],
    workspaceCreditBalance:
      store.workspaceCreditBalance && typeof store.workspaceCreditBalance === "object"
        ? store.workspaceCreditBalance
        : {},
    folderLayouts:
      store.folderLayouts && typeof store.folderLayouts === "object"
        ? store.folderLayouts
        : {},
    workspaceFolderOrder:
      store.workspaceFolderOrder && typeof store.workspaceFolderOrder === "object"
        ? store.workspaceFolderOrder
        : {}
  };

  if (includeJobs) {
    snapshot.generationJobs = Array.isArray(store.generationJobs) ? store.generationJobs : [];
  }

  return snapshot;
}

function collectPreviewKeys(versions) {
  const keys = new Set();
  for (const version of versions) {
    if (!version || typeof version !== "object") continue;
    const metadata = version.metadata && typeof version.metadata === "object" ? version.metadata : {};
    const previewBlob = metadata.previewBlob;
    if (isPreviewBlobKey(previewBlob)) {
      keys.add(previewBlob.toLowerCase());
      continue;
    }
    const storageBlob = previewBlobFromStorageKey(version.storageKey);
    if (storageBlob) {
      keys.add(storageBlob);
    }
  }
  return [...keys].sort();
}

function extractAccessCookie(setCookieHeader) {
  if (typeof setCookieHeader !== "string") return null;
  const match = setCookieHeader.match(/aidrive_access=[^;]+/);
  return match ? match[0] : null;
}

async function login() {
  const response = await fetch(`${targetUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    const body = await response.text();
    fail(`Login failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const cookie = extractAccessCookie(response.headers.get("set-cookie"));
  if (!cookie) {
    fail("Login succeeded but access cookie was not returned.");
  }
  return cookie;
}

async function authedJson(cookie, routePath, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("cookie", cookie);
  if (!headers.has("content-type") && init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${targetUrl}${routePath}`, {
    ...init,
    headers
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail = parsed ? JSON.stringify(parsed) : text;
    throw new Error(`${routePath} failed (${response.status}): ${detail.slice(0, 800)}`);
  }
  return parsed;
}

async function uploadPreview(cookie, blobKey, dataBase64) {
  return authedJson(cookie, "/api/proxy/v1/admin/import/preview", {
    method: "POST",
    body: JSON.stringify({ blobKey, dataBase64 })
  });
}

async function main() {
  if (!username || !password) {
    fail("Set APP_ACCESS_USERNAME and APP_ACCESS_PASSWORD before running this script.");
  }
  if (!fs.existsSync(storePath)) {
    fail(`Missing local store file: ${storePath}`);
  }

  const store = readJson(storePath);
  const snapshot = buildSnapshot(store);
  const previewKeys = collectPreviewKeys(snapshot.versions);
  const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");

  log(`Target: ${targetUrl}`);
  log(`Local store: ${storePath}`);
  log(`Snapshot size: ${(snapshotBytes / 1024 / 1024).toFixed(2)} MB`);
  log(
    `Counts => users:${count(snapshot.users)} workspaces:${count(snapshot.workspaces)} folders:${count(snapshot.folders)} assets:${count(snapshot.assets)} versions:${count(snapshot.versions)}`
  );
  log(`Preview blobs referenced: ${previewKeys.length}`);

  const missingLocalPreviewKeys = previewKeys.filter((blobKey) => !fs.existsSync(path.join(previewsDir, blobKey)));
  if (missingLocalPreviewKeys.length > 0) {
    log(`Warning: ${missingLocalPreviewKeys.length} preview blobs are referenced but missing locally.`);
  }

  const cookie = await login();
  log("Authenticated with remote app.");

  const before = await authedJson(cookie, "/api/proxy/v1/admin/import/status", { method: "GET" });
  log(`Remote before import => assets:${before?.counts?.assets ?? 0} versions:${before?.counts?.versions ?? 0} previews:${before?.previewBlobCount ?? 0}`);

  await authedJson(cookie, "/api/proxy/v1/admin/import/snapshot", {
    method: "POST",
    body: JSON.stringify({ replace: true, snapshot })
  });
  log("Snapshot imported.");

  const uploadKeys = previewKeys.filter((blobKey) => fs.existsSync(path.join(previewsDir, blobKey)));
  for (let i = 0; i < uploadKeys.length; i += 1) {
    const blobKey = uploadKeys[i];
    const filePath = path.join(previewsDir, blobKey);
    const dataBase64 = fs.readFileSync(filePath).toString("base64");
    await uploadPreview(cookie, blobKey, dataBase64);
    if ((i + 1) % 5 === 0 || i + 1 === uploadKeys.length) {
      log(`Uploaded previews: ${i + 1}/${uploadKeys.length}`);
    }
  }

  const after = await authedJson(cookie, "/api/proxy/v1/admin/import/status", { method: "GET" });
  log(`Remote after import => assets:${after?.counts?.assets ?? 0} versions:${after?.counts?.versions ?? 0} previews:${after?.previewBlobCount ?? 0}`);
  log("Migration complete.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
