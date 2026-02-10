#!/usr/bin/env node

import fs from "fs";
import path from "path";

const targetUrl = (process.env.TARGET_URL || "https://ai-drive-private.onrender.com").replace(/\/+$/, "");
const username = process.env.APP_ACCESS_USERNAME;
const password = process.env.APP_ACCESS_PASSWORD;
const explicitLocalDataDir = process.env.LOCAL_DATA_DIR?.trim();
const configuredDataDir = process.env.AIDRIVE_DATA_DIR?.trim();
const explicitAccessCookie = process.env.APP_ACCESS_COOKIE?.trim();
const includeJobs = process.env.MIGRATE_INCLUDE_JOBS === "1";
const dryRun = process.env.MIGRATE_DRY_RUN === "1";
const allowEmpty = process.env.MIGRATE_ALLOW_EMPTY === "1";

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

function snapshotCounts(snapshot) {
  return {
    users: count(snapshot.users),
    workspaces: count(snapshot.workspaces),
    folders: count(snapshot.folders),
    assets: count(snapshot.assets),
    versions: count(snapshot.versions),
    jobs: includeJobs ? count(snapshot.generationJobs) : 0
  };
}

function recordCountFromCounts(counts) {
  return counts.assets + counts.versions + counts.folders + counts.jobs;
}

function discoverLocalDataDirs() {
  const candidates = [];
  const add = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) return;
    const resolved = path.resolve(value.trim());
    if (!candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  if (explicitLocalDataDir) {
    add(explicitLocalDataDir);
    return candidates;
  }

  add(configuredDataDir);
  add(path.join(process.cwd(), "apps", "api", ".data"));
  add(path.join(process.cwd(), ".data"));
  add(path.join(process.cwd(), "..", ".data"));
  return candidates;
}

function loadLocalCandidate(localDataDir) {
  const storePath = path.join(localDataDir, "api-store.json");
  if (!fs.existsSync(storePath)) return null;
  const store = readJson(storePath);
  const snapshot = buildSnapshot(store);
  const counts = snapshotCounts(snapshot);
  const stat = fs.statSync(storePath);
  return {
    localDataDir,
    storePath,
    previewsDir: path.join(localDataDir, "previews"),
    store,
    snapshot,
    counts,
    recordCount: recordCountFromCounts(counts),
    mtimeMs: stat.mtimeMs
  };
}

function chooseBestLocalCandidate(candidates) {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((left, right) => {
    if (left.recordCount !== right.recordCount) {
      return right.recordCount - left.recordCount;
    }
    return right.mtimeMs - left.mtimeMs;
  });
  return sorted[0];
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

function isLikelySampleOnlySnapshot(snapshot) {
  const assets = count(snapshot.assets);
  const versions = count(snapshot.versions);
  if (assets > 0 || versions > 0) return false;

  const folders = Array.isArray(snapshot.folders) ? snapshot.folders : [];
  if (folders.length === 0) return true;
  if (folders.length > 12) return false;
  return folders.every((folder) => /^sample project \d{2}$/i.test(String(folder?.name ?? "")));
}

function extractAccessCookie(setCookieHeader) {
  if (typeof setCookieHeader !== "string") return null;
  const match = setCookieHeader.match(/aidrive_access=[^;]+/);
  return match ? match[0] : null;
}

async function login() {
  if (explicitAccessCookie && explicitAccessCookie.length > 0) {
    return explicitAccessCookie.includes("aidrive_access=")
      ? explicitAccessCookie
      : `aidrive_access=${explicitAccessCookie}`;
  }

  const form = new URLSearchParams({
    username: String(username),
    password: String(password),
    returnTo: "/"
  });
  const response = await fetch(`${targetUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual"
  });

  if (response.status < 300 || response.status >= 400) {
    const body = await response.text();
    fail(`Login failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const location = response.headers.get("location") ?? "";
  if (location.includes("error=invalid_credentials")) {
    fail("Login failed: invalid credentials for deployed app. Update APP_ACCESS_USERNAME/APP_ACCESS_PASSWORD or set APP_ACCESS_COOKIE.");
  }

  const cookie = extractAccessCookie(response.headers.get("set-cookie"));
  if (!cookie) {
    fail(`Login did not return access cookie (redirected to ${location || "(unknown)"}).`);
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
  if (!dryRun && !explicitAccessCookie && (!username || !password)) {
    fail("Set APP_ACCESS_USERNAME and APP_ACCESS_PASSWORD, or set APP_ACCESS_COOKIE.");
  }

  const localDirs = discoverLocalDataDirs();
  const candidates = localDirs
    .map((localDataDir) => loadLocalCandidate(localDataDir))
    .filter((candidate) => Boolean(candidate));
  if (candidates.length === 0) {
    fail(`No local store found. Checked:\n- ${localDirs.join("\n- ")}`);
  }
  const selected = chooseBestLocalCandidate(candidates);
  if (!selected) {
    fail("No valid local store candidate was found.");
  }
  const storePath = selected.storePath;
  const previewsDir = selected.previewsDir;
  const snapshot = selected.snapshot;

  log(`Target: ${targetUrl}`);
  log("Local store candidates:");
  for (const candidate of candidates) {
    log(
      `- ${candidate.storePath} (assets:${candidate.counts.assets} versions:${candidate.counts.versions} folders:${candidate.counts.folders} jobs:${candidate.counts.jobs} score:${candidate.recordCount})`
    );
  }
  log(`Selected local store: ${storePath}`);

  const counts = selected.counts;
  if (!allowEmpty && (selected.recordCount === 0 || isLikelySampleOnlySnapshot(snapshot))) {
    fail("Selected local store looks empty/sample-only. Set LOCAL_DATA_DIR to your real data folder, or set MIGRATE_ALLOW_EMPTY=1 to continue anyway.");
  }

  const previewKeys = collectPreviewKeys(snapshot.versions);
  const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");

  log(`Snapshot size: ${(snapshotBytes / 1024 / 1024).toFixed(2)} MB`);
  log(`Counts => users:${counts.users} workspaces:${counts.workspaces} folders:${counts.folders} assets:${counts.assets} versions:${counts.versions}`);
  log(`Preview blobs referenced: ${previewKeys.length}`);

  const missingLocalPreviewKeys = previewKeys.filter((blobKey) => !fs.existsSync(path.join(previewsDir, blobKey)));
  if (missingLocalPreviewKeys.length > 0) {
    log(`Warning: ${missingLocalPreviewKeys.length} preview blobs are referenced but missing locally.`);
  }

  if (dryRun) {
    log("Dry run enabled (MIGRATE_DRY_RUN=1). No remote changes were made.");
    return;
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
