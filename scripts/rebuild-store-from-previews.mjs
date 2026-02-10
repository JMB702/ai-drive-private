#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";

const projectRoot = process.cwd();
const previewsDir = path.resolve(
  process.env.PREVIEWS_DIR || path.join(projectRoot, "apps", "api", ".data", "previews")
);
const outputDir = path.resolve(process.env.RECOVERY_OUT_DIR || path.join(projectRoot, ".recovery-data"));
const folderName = (process.env.RECOVERY_FOLDER_NAME || "Recovered Images").trim() || "Recovered Images";
const userId = "user_demo";
const workspaceId = "ws_demo";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function ratioString(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "1:1";
  const d = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

function parsePngDimensions(bytes) {
  if (bytes.length < 24) return null;
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function parseJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    const isSof =
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 ||
      marker === 0xca || marker === 0xcb || marker === 0xcd || marker === 0xce || marker === 0xcf;
    if (isSof) {
      return {
        width: bytes.readUInt16BE(offset + 7),
        height: bytes.readUInt16BE(offset + 5)
      };
    }
    offset += 2 + length;
  }
  return null;
}

function parseWebpDimensions(bytes) {
  if (bytes.length < 30) return null;
  if (bytes.toString("ascii", 0, 4) !== "RIFF") return null;
  if (bytes.toString("ascii", 8, 12) !== "WEBP") return null;

  function readVp8X(offset) {
    if (offset + 18 > bytes.length) return null;
    return {
      width: 1 + bytes.readUIntLE(offset + 12, 3),
      height: 1 + bytes.readUIntLE(offset + 15, 3)
    };
  }

  function readVp8L(offset) {
    if (offset + 13 > bytes.length) return null;
    if (bytes[offset + 8] !== 0x2f) return null;
    const b0 = bytes[offset + 9];
    const b1 = bytes[offset + 10];
    const b2 = bytes[offset + 11];
    const b3 = bytes[offset + 12];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }

  function readVp8(offset) {
    if (offset + 30 > bytes.length) return null;
    const width = bytes.readUInt16LE(offset + 26) & 0x3fff;
    const height = bytes.readUInt16LE(offset + 28) & 0x3fff;
    return { width, height };
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    if (chunkType === "VP8X") return readVp8X(offset);
    if (chunkType === "VP8L") return readVp8L(offset);
    if (chunkType === "VP8 ") return readVp8(offset);
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return null;
}

function dimensionsFromBytes(extension, bytes) {
  const ext = extension.toLowerCase();
  if (ext === "png") return parsePngDimensions(bytes);
  if (ext === "jpg" || ext === "jpeg") return parseJpegDimensions(bytes);
  if (ext === "webp") return parseWebpDimensions(bytes);
  return null;
}

function mimeTypeForExtension(extension) {
  const ext = extension.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "avif") return "image/avif";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function checksumForFile(bytes) {
  return createHash("sha1").update(bytes).digest("hex").slice(0, 20);
}

function clearOutputDir(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function ensurePreviewBlobKey(name) {
  if (!/^[a-f0-9]{40}\.[a-z0-9]+$/i.test(name)) return null;
  return name.toLowerCase();
}

function buildStore(previewFiles) {
  const createdAt = nowIso();
  const folderId = randomUUID();
  const store = {
    users: [
      {
        id: userId,
        email: "owner@example.com",
        displayName: "Recovered Owner",
        createdAt
      }
    ],
    workspaces: [
      {
        id: workspaceId,
        name: "Recovered Workspace",
        createdBy: userId,
        createdAt
      }
    ],
    workspaceMembers: [
      {
        workspaceId,
        userId,
        role: "OWNER",
        joinedAt: createdAt
      }
    ],
    folders: [
      {
        id: folderId,
        workspaceId,
        parentId: null,
        name: folderName,
        deletedAt: null,
        createdBy: userId,
        createdAt
      }
    ],
    assets: [],
    versions: [],
    lineageEdges: [],
    generationJobs: [],
    permissionGrants: [],
    shareLinks: [],
    creditTransactions: [],
    moderationEvents: [],
    auditEvents: [],
    workspaceCreditBalance: { [workspaceId]: 1000 },
    folderLayouts: { [folderId]: [] },
    workspaceFolderOrder: { [workspaceId]: [folderId] }
  };

  const sortedByTime = [...previewFiles].sort((left, right) => right.mtimeMs - left.mtimeMs);

  let index = 1;
  for (const preview of sortedByTime) {
    const assetId = randomUUID();
    const versionId = randomUUID();
    const baseName = `recovered-${String(index).padStart(4, "0")}.${preview.extension}`;
    const isoTime = new Date(preview.mtimeMs).toISOString();
    const aspectRatio = ratioString(preview.width, preview.height);

    store.assets.push({
      id: assetId,
      workspaceId,
      folderId,
      name: baseName,
      mimeType: preview.mimeType,
      tags: ["recovered", "preview-blob"],
      deletedAt: null,
      createdBy: userId,
      createdAt: isoTime
    });

    store.versions.push({
      id: versionId,
      assetId,
      version: 1,
      source: "UPLOAD",
      storageKey: `previews/${preview.blobKey}`,
      checksum: preview.checksum,
      metadata: {
        previewBlob: preview.blobKey,
        previewUrl: `/v1/previews/${preview.blobKey}`,
        aspectRatio,
        resolution: "1K",
        recovered: true
      },
      createdBy: userId,
      createdAt: isoTime
    });

    store.folderLayouts[folderId].push(assetId);
    index += 1;
  }

  return store;
}

function main() {
  if (!fs.existsSync(previewsDir)) {
    fail(`Previews directory not found: ${previewsDir}`);
  }

  const entries = fs.readdirSync(previewsDir, { withFileTypes: true });
  const previewFiles = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const blobKey = ensurePreviewBlobKey(entry.name);
    if (!blobKey) continue;
    const extension = blobKey.split(".").pop() || "png";
    const filePath = path.join(previewsDir, blobKey);
    const bytes = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    const dims = dimensionsFromBytes(extension, bytes);
    previewFiles.push({
      blobKey,
      extension,
      mimeType: mimeTypeForExtension(extension),
      checksum: checksumForFile(bytes),
      width: dims?.width ?? 1024,
      height: dims?.height ?? 1024,
      mtimeMs: stat.mtimeMs,
      bytes
    });
  }

  if (previewFiles.length === 0) {
    fail(`No preview blobs found in ${previewsDir}`);
  }

  clearOutputDir(outputDir);
  const outPreviewsDir = path.join(outputDir, "previews");
  fs.mkdirSync(outPreviewsDir, { recursive: true });

  for (const file of previewFiles) {
    fs.writeFileSync(path.join(outPreviewsDir, file.blobKey), file.bytes);
  }

  const store = buildStore(previewFiles);
  fs.writeFileSync(path.join(outputDir, "api-store.json"), JSON.stringify(store), "utf8");

  log(`Recovered dataset written: ${outputDir}`);
  log(`Recovered assets: ${store.assets.length}`);
  log(`Source previews: ${previewsDir}`);
}

main();
