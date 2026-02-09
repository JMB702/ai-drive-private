import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 4210);
const MAX_BODY_BYTES = 25_000_000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function resolveMasterControlPath() {
  if (process.env.MASTER_CONTROL_PATH) {
    return path.resolve(process.env.MASTER_CONTROL_PATH);
  }
  return path.resolve(__dirname, "..", "..", "docs", "master-control.md");
}

const DEFAULT_MASTER_CONTROL_PATH = resolveMasterControlPath();
const DEFAULT_PROJECT_ROOT = resolveRepoRoot(DEFAULT_MASTER_CONTROL_PATH);
const DEFAULT_MASTER_PROMPT_PATH = resolveMasterPromptPath(DEFAULT_MASTER_CONTROL_PATH);

function resolveRepoRoot(masterControlPath) {
  return path.resolve(path.dirname(masterControlPath), "..");
}

function resolveMasterPromptPath(masterControlPath) {
  if (process.env.MASTER_PROMPT_PATH) {
    return path.resolve(process.env.MASTER_PROMPT_PATH);
  }
  return path.join(resolveRepoRoot(masterControlPath), "MASTER_CONTROL_HANDOFF.md");
}

function resolveProjectContext(url, body = null) {
  const queryProjectRoot = cleanLine(url.searchParams.get("projectRoot"), "");
  const bodyProjectRoot = body && typeof body.projectRoot === "string" ? cleanLine(body.projectRoot, "") : "";
  const explicitProjectRoot = queryProjectRoot || bodyProjectRoot;
  if (explicitProjectRoot) {
    const projectRoot = path.resolve(explicitProjectRoot);
    const masterControlPath = path.join(projectRoot, "docs", "master-control.md");
    const masterPromptPath = path.join(projectRoot, "MASTER_CONTROL_HANDOFF.md");
    return { projectRoot, masterControlPath, masterPromptPath, delegationRoot: resolveDelegationRoot(masterControlPath) };
  }

  return {
    projectRoot: DEFAULT_PROJECT_ROOT,
    masterControlPath: DEFAULT_MASTER_CONTROL_PATH,
    masterPromptPath: DEFAULT_MASTER_PROMPT_PATH,
    delegationRoot: resolveDelegationRoot(DEFAULT_MASTER_CONTROL_PATH)
  };
}

function resolveDelegationRoot(masterControlPath) {
  return path.join(resolveRepoRoot(masterControlPath), "docs", "master-control-delegations");
}

function resolveOpsBaseUrl() {
  if (process.env.MASTER_CONTROL_OPS_URL) {
    return String(process.env.MASTER_CONTROL_OPS_URL).replace(/\/+$/, "");
  }
  return `http://localhost:${PORT}`;
}

function safePackageId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(id)) {
    throw new HttpError(400, "Invalid package id");
  }
  return id;
}

function resolvePackageDir(masterControlPath, packageId) {
  return path.join(resolveDelegationRoot(masterControlPath), safePackageId(packageId));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

async function resolveBootstrapInstallerPath() {
  const envPath = cleanLine(process.env.MASTER_CONTROL_BOOTSTRAP_SCRIPT || "", "");
  const candidates = [
    envPath,
    path.resolve(__dirname, "..", "..", "scripts", "install-master-control.sh"),
    path.resolve(__dirname, "..", "..", "..", "Coding Projects", "Master Control", "scripts", "install-master-control.sh"),
    path.resolve(DEFAULT_PROJECT_ROOT, "..", "Master Control", "scripts", "install-master-control.sh")
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new HttpError(500, "Master Control bootstrap installer not found. Set MASTER_CONTROL_BOOTSTRAP_SCRIPT.");
}

function buildBootstrapCommand(installerPath, targetRepoPath = "") {
  const cleanTarget = cleanLine(targetRepoPath, "");
  if (cleanTarget) {
    return `bash ${shellQuote(installerPath)} ${shellQuote(path.resolve(cleanTarget))} --existing-project-safe`;
  }
  return `bash ${shellQuote(installerPath)} "$PWD" --existing-project-safe`;
}

function buildBootstrapStartPacket({ installerPath, targetRepoPath = "" }) {
  const cleanTarget = cleanLine(targetRepoPath, "");
  const resolvedTarget = cleanTarget ? path.resolve(cleanTarget) : "$PWD";
  const command = buildBootstrapCommand(installerPath, targetRepoPath);
  const opsBase = resolveOpsBaseUrl();
  const scopedOpsUrl = cleanTarget
    ? `${opsBase}/?projectRoot=${encodeURIComponent(path.resolve(cleanTarget))}`
    : `${opsBase}`;

  return [
    "# Master Control Project Manager Starter Packet",
    "",
    "Paste this into the Project manager thread in the new project.",
    "Start now. This is initial setup, not a normal task packet.",
    "This packet routes the Project manager thread into Master Control Ops first.",
    "Run all terminal/bootstrap steps yourself in this thread. Do not ask the user to run setup commands.",
    "Use this packet for Project manager thread initialization only (one-time per project context).",
    "After bootstrap succeeds, sub-threads should receive Task Packets only (no bootstrap).",
    "",
    `Target repo: ${resolvedTarget}`,
    "",
    "Action:",
    `1. Open Master Control Ops scoped to this repo: ${scopedOpsUrl}`,
    `2. In "Start Another Project Thread", set target repo path to: ${resolvedTarget}`,
    "3. Copy the bootstrap command from Ops and run it in this thread terminal (backend/setup bootstrap).",
    `4. Verify setup files exist in ${resolvedTarget}:`,
    `   - docs/master-control.md`,
    "   - MASTER_CONTROL_HANDOFF.md",
    "   - AGENTS.md",
    "5. Use Master Control workflow for all project prompts in this thread.",
    "6. Follow Master Control instructions for next actions (including any Task Packet creation when needed).",
    "7. Append completion summaries to docs/master-control.md when instructed by Master Control.",
    "",
    "Fallback (if Ops UI is unavailable):",
    `- Run: ${command}`,
    "",
    "Begin setup immediately."
  ].join("\n");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(payload);
}

function cleanLine(value, fallback) {
  if (typeof value !== "string") return fallback;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 0 ? compact : fallback;
}

function cleanMultiline(value, fallback) {
  if (typeof value !== "string") return fallback;
  const compact = value.trim();
  return compact.length > 0 ? compact : fallback;
}

function slugify(value, fallback = "task") {
  if (typeof value !== "string") return fallback;
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function safeFileName(value, index) {
  const base = (value || `asset-${index + 1}`)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `asset-${index + 1}`;
}

function packageIdFromTitle(title) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `${stamp}-${slugify(title, "delegated-task")}`;
}

function appendSummaryBlock(content, payload) {
  const date = new Date().toISOString().slice(0, 10);
  const thread = cleanLine(payload.thread, "unknown");
  const task = cleanLine(payload.task, "not provided");
  const outcome = cleanLine(payload.outcome, "not provided");
  const files = cleanLine(payload.files, "none");
  const openItems = cleanLine(payload.openItems, "none");
  const block = [
    "",
    `- Date: ${date}`,
    `  Thread: ${thread}`,
    `  Task: ${task}`,
    `  Outcome: ${outcome}`,
    `  Files: ${files}`,
    `  Open items: ${openItems}`
  ].join("\n");

  if (content.includes("## Thread Summaries (Optional Read)")) {
    return `${content.trimEnd()}${block}\n`;
  }

  return `${content.trimEnd()}\n\n## Thread Summaries (Optional Read)\n${block}\n`;
}

function extractFocusedThreads(content) {
  const lines = String(content || "").split(/\r?\n/);
  const names = [];
  let inFocusedSection = false;
  let inCurrentFocusedBlock = false;
  let inThreadMapSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const lower = line.toLowerCase();

    if (/^#{1,6}\s+/.test(line)) {
      inFocusedSection = /focused threads/.test(lower);
      inThreadMapSection = /thread map/.test(lower);
      inCurrentFocusedBlock = false;
      continue;
    }

    if (/^current focused threads\s*:?$/.test(lower)) {
      inCurrentFocusedBlock = true;
      inFocusedSection = true;
      continue;
    }

    const inScope = inFocusedSection || inCurrentFocusedBlock || inThreadMapSection;
    if (!inScope) continue;

    const match = rawLine.match(/^[-*]\s+(.+)$/);
    if (match) {
      const rawName = match[1].trim();
      const tickName = rawName.match(/^`([^`]+)`/);
      const plainName = rawName.split(/\s{2,}|\s+-\s+|\s+\(/)[0].trim();
      const name = (tickName ? tickName[1] : plainName).trim();
      if (name) names.push(name);
      continue;
    }

    if (inCurrentFocusedBlock && line.length > 0) {
      inCurrentFocusedBlock = false;
      inFocusedSection = false;
    }
  }

  return Array.from(new Set(names));
}

function tokensForMatching(text) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "when",
    "then",
    "than",
    "only",
    "thread",
    "rules",
    "task",
    "work",
    "master",
    "control"
  ]);
  const parts = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 3 && !stopWords.has(part));
  return new Set(parts);
}

function scoreThreadName(threadName, contextText) {
  const name = cleanLine(threadName, "").toLowerCase();
  if (!name) return 0;

  const context = cleanMultiline(contextText, "").toLowerCase();
  if (!context) return 0;

  let score = 0;
  if (context.includes(name)) score += 6;

  const nameTokens = Array.from(tokensForMatching(name));
  const contextTokens = tokensForMatching(context);
  for (const token of nameTokens) {
    if (contextTokens.has(token)) score += 2;
  }

  const hasUiSignal = /( ui | ux |frontend|front end|user interface|layout|visual|screen|panel|css|tailwind|component)/.test(` ${context} `);
  if (hasUiSignal && (name.includes(" ui") || name.endsWith("ui") || name.includes("ux"))) {
    score += 8;
  }

  return score;
}

function pickRecommendedThread(focusedThreads, contextText) {
  let bestName = "";
  let bestScore = 0;
  for (const name of focusedThreads) {
    const score = scoreThreadName(name, contextText);
    if (score > bestScore) {
      bestName = name;
      bestScore = score;
    }
  }
  if (!bestName) return null;
  return { name: bestName, score: bestScore };
}

function getThreadSuggestion(masterControlContent, targetThread, context = {}) {
  const cleanTarget = cleanLine(targetThread, "");
  const focusedThreads = extractFocusedThreads(masterControlContent);
  const contextText = [
    cleanLine(context.title, ""),
    cleanLine(context.targetThread, ""),
    cleanMultiline(context.problem, ""),
    cleanMultiline(context.fullPrompt, ""),
    cleanMultiline(context.doneCriteria, ""),
    cleanMultiline(context.reportBack, "")
  ]
    .filter(Boolean)
    .join("\n");
  const recommended = pickRecommendedThread(focusedThreads, contextText);

  if (!cleanTarget) {
    if (recommended && recommended.score >= 3) {
      return {
        shouldCreate: false,
        message: `No target thread specified. Recommended existing thread: "${recommended.name}".`,
        knownThreads: focusedThreads,
        recommendedThread: recommended.name,
        recommendationType: "use-existing"
      };
    }
    return {
      shouldCreate: true,
      message: "No target thread specified and no clear match found. Suggest creating a focused thread before dispatch.",
      knownThreads: focusedThreads,
      recommendedThread: "",
      recommendationType: "create-new"
    };
  }
  const hasThread = focusedThreads.some((name) => name.toLowerCase() === cleanTarget.toLowerCase());
  if (hasThread) {
    if (recommended && recommended.name.toLowerCase() !== cleanTarget.toLowerCase()) {
      const targetScore = scoreThreadName(cleanTarget, contextText);
      if (recommended.score >= targetScore + 4 && recommended.score >= 5) {
        return {
          shouldCreate: false,
          message: `Target thread "${cleanTarget}" is valid, but context appears closer to "${recommended.name}". Consider rerouting.`,
          knownThreads: focusedThreads,
          recommendedThread: recommended.name,
          recommendationType: "reroute"
        };
      }
    }
    return {
      shouldCreate: false,
      message: "",
      knownThreads: focusedThreads,
      recommendedThread: cleanTarget,
      recommendationType: "exact"
    };
  }
  if (recommended && recommended.score >= 3) {
    return {
      shouldCreate: false,
      message: `Target thread "${cleanTarget}" is not listed. Recommended existing thread: "${recommended.name}".`,
      knownThreads: focusedThreads,
      recommendedThread: recommended.name,
      recommendationType: "use-existing"
    };
  }
  return {
    shouldCreate: true,
    message: `Target thread "${cleanTarget}" is not listed and no close existing match was found. Suggest creating a new focused thread before dispatch.`,
    knownThreads: focusedThreads,
    recommendedThread: cleanTarget,
    recommendationType: "create-new"
  };
}

function autoModelSuggestion(payload) {
  const title = cleanLine(payload.title, "");
  const targetThread = cleanLine(payload.targetThread, "");
  const text = [
    title,
    targetThread,
    cleanMultiline(payload.problem, ""),
    cleanMultiline(payload.fullPrompt, ""),
    cleanMultiline(payload.doneCriteria, ""),
    cleanMultiline(payload.reportBack, "")
  ].join("\n");
  const assetsCount = Number(payload.assetsCount || 0);
  const lower = text.toLowerCase();

  let score = text.length + assetsCount * 700;
  const hardSignals = ["investigate", "root cause", "architecture", "cross-cutting", "migration", "refactor"];
  for (const signal of hardSignals) {
    if (lower.includes(signal)) score += 500;
  }
  if (targetThread.toLowerCase().includes("project manager")) score += 700;

  if (score >= 1800) {
    return {
      model: "gpt-5",
      reason: "High complexity or cross-cutting work. Use the strongest reasoning model.",
      source: "auto",
      effort: score >= 3200 ? "extra-high" : "high"
    };
  }
  if (score >= 900) {
    return {
      model: "gpt-5-mini",
      reason: "Moderate implementation scope with some reasoning depth.",
      source: "auto",
      effort: "medium"
    };
  }
  return {
    model: "gpt-5-nano",
    reason: "Narrow and well-scoped task where fast iteration is enough.",
    source: "auto",
    effort: "low"
  };
}

function effortFromModel(model) {
  const lower = cleanLine(model, "").toLowerCase();
  if (lower.includes("nano")) return "low";
  if (lower.includes("mini")) return "medium";
  return "high";
}

function codexUiModelName(model) {
  const lower = cleanLine(model, "").toLowerCase();
  if (lower.includes("nano")) return "Codex mini";
  if (lower.includes("mini")) return "Codex mini";
  return "GPT-5.3-Codex";
}

function withUiModelName(modelSuggestion) {
  const base = modelSuggestion || {};
  return {
    ...base,
    uiModel: codexUiModelName(base.model)
  };
}

function resolveModelSuggestion(payload, suggestedModel, modelReason, sourceHint = "", suggestedEffort = "") {
  const manualModel = cleanLine(suggestedModel, "");
  const manualReason = cleanMultiline(modelReason, "");
  const manualEffort = cleanLine(suggestedEffort, "");
  if (manualModel) {
    const source = cleanLine(sourceHint, "") === "auto" ? "auto" : "user";
    return withUiModelName({
      model: manualModel,
      reason: manualReason || "User-selected model override.",
      source,
      effort: manualEffort || effortFromModel(manualModel)
    });
  }
  return withUiModelName(autoModelSuggestion(payload));
}

function buildOperatorInstructions(modelSuggestion, targetThread = "") {
  const model = cleanLine(modelSuggestion && modelSuggestion.model, "gpt-5");
  const uiModel = cleanLine(modelSuggestion && modelSuggestion.uiModel, codexUiModelName(model));
  const effort = cleanLine(modelSuggestion && modelSuggestion.effort, effortFromModel(model));
  const reason = cleanMultiline(modelSuggestion && modelSuggestion.reason, "");
  const pasteThread = cleanLine(targetThread, "");
  return [
    pasteThread ? `Paste into thread: ${pasteThread}` : "",
    `Select model in Codex: ${uiModel}`,
    `Set effort: ${effort}`,
    reason ? `Why: ${reason}` : "",
    "Effort scale:",
    "low = quick/small task",
    "medium = scoped feature/fix",
    "high = complex multi-file work",
    "extra-high = ambiguous/high-risk architecture or root-cause work"
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTargetPrompt({ body, packageId, packageDir, assetsDir, masterControlPath }) {
  const title = cleanLine(body.title, "Delegated task");
  const targetThread = cleanLine(body.targetThread, "Focused thread");
  const problem = cleanMultiline(body.problem, "Not provided.");
  const prompt = cleanMultiline(body.fullPrompt, "No prompt was provided.");
  const doneCriteria = cleanMultiline(body.doneCriteria, "Provide concrete deliverables and verification steps.");
  const reportBack = cleanMultiline(
    body.reportBack,
    "Append a summary entry in Master Control with: scope completed, files changed, unresolved risks, and follow-up recommendations."
  );
  const suggestedModel = cleanLine(body.suggestedModel, "gpt-5");
  const suggestedEffort = cleanLine(body.suggestedEffort, effortFromModel(suggestedModel));
  const modelReason = cleanMultiline(body.modelReason, "Use the strongest available reasoning model if uncertainty is high.");

  const hasAssets = Array.isArray(body.assets) && body.assets.length > 0;
  const lines = [
    "# Delegation Package",
    "",
    `Package ID: ${packageId}`,
    `Title: ${title}`,
    `Target thread: ${targetThread}`,
    "",
    "## Hard Problem Context",
    problem,
    "",
    "## Task Prompt",
    prompt,
    "",
    "## Suggested Model For This Thread",
    `- Model: ${suggestedModel}`,
    `- Effort: ${suggestedEffort}`,
    `- Why: ${modelReason}`,
    "",
    "## Done Criteria",
    doneCriteria,
    "",
    "## Required Inputs",
    `- Master Control source of truth: \`${masterControlPath}\``,
    `- Package directory: \`${packageDir}\``,
    `- Package metadata: \`${path.join(packageDir, "package.json")}\``
  ];

  if (hasAssets) {
    lines.push(`- Asset directory: \`${assetsDir}\``);
    lines.push("- Review all asset files before implementing.");
  } else {
    lines.push("- No assets were attached to this package.");
  }

  lines.push(
    "",
    "## Required Return Update To Project Manager",
    reportBack,
    "",
    "Always append a summary in Master Control after completion. Use this summary structure:",
    "- Date: YYYY-MM-DD",
    `  Thread: ${targetThread}`,
    `  Task: ${title}`,
    "  Outcome: <what changed and what passed>",
    "  Files: <comma-separated file paths>",
    "  Open items: <remaining risks/follow-ups or none>",
    "",
    "If the task cannot be completed, still append a summary with blockers and a recommended next action."
  );

  return `${lines.join("\n")}\n`;
}

function buildTaskPacket({ targetThread, packageId, title, promptFile, taskPacketFile, masterControlPath, projectRoot }) {
  const taskTitle = cleanLine(title, "Delegated task");
  const opsBaseUrl = resolveOpsBaseUrl();
  const scopedProjectRoot = path.resolve(projectRoot || resolveRepoRoot(masterControlPath));
  const encodedProjectRoot = encodeURIComponent(scopedProjectRoot);
  const scopedOpsUrl = `${opsBaseUrl}/?projectRoot=${encodedProjectRoot}`;
  const packageApi = `${opsBaseUrl}/api/delegation-packages/${encodeURIComponent(packageId)}?projectRoot=${encodedProjectRoot}`;
  return [
    "# Task Packet",
    "",
    `Task: ${taskTitle}`,
    "",
    "Start now. Do not stop at analysis.",
    "Fetch the latest prompt from Master Control Ops and execute immediately.",
    "",
    `Package: ${packageId}`,
    `Ops URL: ${scopedOpsUrl}`,
    `Package API: ${packageApi}`,
    "",
    "Action:",
    `1. Fetch \`prompt\` from ${packageApi} (or open package ${packageId} in Ops UI).`,
    "2. Execute immediately.",
    `3. Append completion summary to ${masterControlPath} (standard fields).`,
    "",
    "Begin implementation now."
  ].join("\n");
}

function resolveTaskPacketFile(packageDir) {
  return path.join(packageDir, "TASK_PACKET.md");
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readText(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeText(filePath, content) {
  await ensureParentDir(filePath);
  await writeFile(filePath, content, "utf8");
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function listDelegationPackages(masterControlPath) {
  const root = resolveDelegationRoot(masterControlPath);
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }

  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageId = entry.name;
    const packageDir = path.join(root, packageId);
    const metadataFile = path.join(packageDir, "package.json");
    let metadata = {};

    try {
      const text = await readFile(metadataFile, "utf8");
      metadata = JSON.parse(text || "{}");
    } catch {
      metadata = {};
    }

    let createdAt = metadata.createdAt;
    if (!createdAt) {
      try {
        const info = await stat(packageDir);
        createdAt = info.mtime.toISOString();
      } catch {
        createdAt = "";
      }
    }

    packages.push({
      packageId,
      title: cleanLine(metadata.title, packageId),
      targetThread: cleanLine(metadata.targetThread, ""),
      suggestedModel: cleanLine(metadata.suggestedModel, ""),
      suggestedEffort: cleanLine(metadata.suggestedEffort, ""),
      createdAt,
      packageDir,
      promptFile: path.join(packageDir, "TARGET_THREAD_PROMPT.md"),
      assetCount: Array.isArray(metadata.assets) ? metadata.assets.length : 0
    });
  }

  packages.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return packages;
}

async function loadPackageDetail(masterControlPath, packageId) {
  const packageDir = resolvePackageDir(masterControlPath, packageId);
  const promptFile = path.join(packageDir, "TARGET_THREAD_PROMPT.md");
  const taskPacketFile = resolveTaskPacketFile(packageDir);
  const metadataFile = path.join(packageDir, "package.json");
  const masterControlContent = await readText(masterControlPath, "");

  const prompt = await readText(promptFile, "");
  if (!prompt) {
    throw new HttpError(404, "Delegation package prompt not found");
  }

  let metadata = {};
  try {
    metadata = JSON.parse(await readFile(metadataFile, "utf8"));
  } catch {
    metadata = {};
  }

  const modelSuggestion = resolveModelSuggestion(
    {
      title: metadata.title,
      targetThread: metadata.targetThread,
      problem: metadata.problem,
      fullPrompt: metadata.fullPrompt,
      doneCriteria: metadata.doneCriteria,
      reportBack: metadata.reportBack,
      assetsCount: Array.isArray(metadata.assets) ? metadata.assets.length : 0
    },
    metadata.suggestedModel,
    metadata.modelReason,
    metadata.modelSource,
    metadata.suggestedEffort
  );

  if (!cleanLine(metadata.suggestedModel, "")) {
    metadata.suggestedModel = modelSuggestion.model;
  }
  if (!cleanMultiline(metadata.modelReason, "")) {
    metadata.modelReason = modelSuggestion.reason;
  }
  if (!cleanLine(metadata.suggestedEffort, "")) {
    metadata.suggestedEffort = modelSuggestion.effort;
  }

  let taskPacket = await readText(taskPacketFile, "");
  if (!taskPacket) {
    taskPacket = buildTaskPacket({
      targetThread: metadata.targetThread,
      packageId,
      title: metadata.title,
      promptFile,
      taskPacketFile,
      masterControlPath,
      projectRoot: resolveRepoRoot(masterControlPath)
    });
    await writeText(taskPacketFile, `${taskPacket}\n`);
  }

  const dispatchPrompt = taskPacket;

  return {
    packageId,
    packageDir,
    promptFile,
    taskPacketFile,
    metadataFile,
    prompt,
    taskPacket,
    targetThread: metadata.targetThread,
    dispatchPrompt,
    metadata,
    copyCommand: `cat \"${taskPacketFile}\"`,
    threadSuggestion: getThreadSuggestion(masterControlContent, metadata.targetThread, {
      title: metadata.title,
      targetThread: metadata.targetThread,
      problem: metadata.problem,
      fullPrompt: metadata.fullPrompt,
      doneCriteria: metadata.doneCriteria,
      reportBack: metadata.reportBack
    }),
    modelSuggestion,
    operatorInstructions: buildOperatorInstructions(modelSuggestion, metadata.targetThread)
  };
}

async function createDelegationPackage(masterControlPath, body) {
  const masterControlContent = await readText(masterControlPath, "");
  const title = cleanLine(body.title, "");
  const targetThread = cleanLine(body.targetThread, "");
  const fullPrompt = cleanMultiline(body.fullPrompt, "");

  if (!title || !targetThread || !fullPrompt) {
    throw new HttpError(400, "title, targetThread, and fullPrompt are required");
  }

  const delegationRoot = resolveDelegationRoot(masterControlPath);
  const packageId = packageIdFromTitle(title);
  const packageDir = path.join(delegationRoot, packageId);
  const assetsDir = path.join(packageDir, "assets");

  await mkdir(assetsDir, { recursive: true });

  const rawAssets = Array.isArray(body.assets) ? body.assets : [];
  const assetRecords = [];
  for (let i = 0; i < rawAssets.length; i += 1) {
    const asset = rawAssets[i] || {};
    const name = safeFileName(asset.name, i);
    const mimeType = cleanLine(asset.type, "application/octet-stream");
    const dataBase64 = typeof asset.dataBase64 === "string" ? asset.dataBase64 : "";
    if (!dataBase64) continue;

    const fileOut = path.join(assetsDir, name);
    const bytes = Buffer.from(dataBase64, "base64");
    await writeFile(fileOut, bytes);
    assetRecords.push({ name, mimeType, path: fileOut, bytes: bytes.length });
  }

  const modelSuggestion = resolveModelSuggestion(
    {
      title,
      targetThread,
      problem: body.problem,
      fullPrompt,
      doneCriteria: body.doneCriteria,
      reportBack: body.reportBack,
      assetsCount: assetRecords.length
    },
    body.suggestedModel,
    body.modelReason,
    "",
    body.suggestedEffort
  );

  const metadata = {
    packageId,
    createdAt: new Date().toISOString(),
    title,
    targetThread,
    problem: cleanMultiline(body.problem, ""),
    fullPrompt,
    doneCriteria: cleanMultiline(body.doneCriteria, ""),
    reportBack: cleanMultiline(body.reportBack, ""),
    suggestedModel: modelSuggestion.model,
    modelReason: modelSuggestion.reason,
    suggestedEffort: modelSuggestion.effort,
    modelSource: modelSuggestion.source,
    masterControlPath,
    assets: assetRecords
  };

  const promptFile = path.join(packageDir, "TARGET_THREAD_PROMPT.md");
  const taskPacketFile = resolveTaskPacketFile(packageDir);
  const metadataFile = path.join(packageDir, "package.json");
  const promptContent = buildTargetPrompt({
    body: {
      ...body,
      title,
      targetThread,
      suggestedModel: modelSuggestion.model,
      modelReason: modelSuggestion.reason,
      suggestedEffort: modelSuggestion.effort,
      assets: assetRecords
    },
    packageId,
    packageDir,
    assetsDir,
      masterControlPath
  });

  await writeText(promptFile, promptContent);
  await writeText(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);

  const threadSuggestion = getThreadSuggestion(masterControlContent, targetThread, {
    title,
    targetThread,
    problem: body.problem,
    fullPrompt,
    doneCriteria: body.doneCriteria,
    reportBack: body.reportBack
  });
  const taskPacket = buildTaskPacket({
    targetThread,
    packageId,
    title,
    promptFile,
    taskPacketFile,
    masterControlPath,
    projectRoot: resolveRepoRoot(masterControlPath)
  });
  await writeText(taskPacketFile, `${taskPacket}\n`);

  const dispatchPrompt = taskPacket;

  return {
    ok: true,
    packageId,
    packageDir,
    promptFile,
    taskPacketFile,
    assetsDir,
    copyCommand: `cat \"${taskPacketFile}\"`,
    taskPacket,
    dispatchPrompt,
    threadSuggestion,
    modelSuggestion,
    operatorInstructions: buildOperatorInstructions(modelSuggestion, targetThread)
  };
}

function normalizeBulkPackageItem(rawItem, index) {
  const source = rawItem && typeof rawItem === "object" ? rawItem : {};
  return {
    index,
    title: cleanLine(source.title, ""),
    targetThread: cleanLine(source.targetThread, ""),
    problem: cleanMultiline(source.problem, ""),
    fullPrompt: cleanMultiline(source.fullPrompt, ""),
    doneCriteria: cleanMultiline(source.doneCriteria, ""),
    reportBack: cleanMultiline(source.reportBack, ""),
    suggestedModel: cleanLine(source.suggestedModel, ""),
    modelReason: cleanMultiline(source.modelReason, ""),
    suggestedEffort: cleanLine(source.suggestedEffort, ""),
    assets: Array.isArray(source.assets) ? source.assets : [],
    parallelSafe: Boolean(source.parallelSafe)
  };
}

function validateParallelBatchItems(items) {
  const issues = [];
  const byThread = new Map();

  for (const item of items) {
    if (!item.title) {
      issues.push(`Item ${item.index + 1}: title is required.`);
    }
    if (!item.targetThread) {
      issues.push(`Item ${item.index + 1}: targetThread is required.`);
    }
    if (!item.fullPrompt) {
      issues.push(`Item ${item.index + 1}: fullPrompt is required.`);
    }
    if (!item.parallelSafe) {
      issues.push(`Item ${item.index + 1}: must be marked parallelSafe=true to allow parallel dispatch.`);
    }

    const key = item.targetThread.toLowerCase();
    if (key) {
      const current = byThread.get(key) || [];
      current.push(item.index + 1);
      byThread.set(key, current);
    }
  }

  for (const [threadName, positions] of byThread.entries()) {
    if (positions.length > 1) {
      issues.push(
        `Target thread "${threadName}" is repeated in items ${positions.join(", ")}. Parallel batch requires one package per thread.`
      );
    }
  }

  return issues;
}

async function createDelegationPackageBatch(masterControlPath, body) {
  const rawItems = Array.isArray(body && body.items) ? body.items : [];
  if (rawItems.length < 2) {
    throw new HttpError(400, "Bulk creation requires at least 2 items.");
  }
  if (rawItems.length > 20) {
    throw new HttpError(400, "Bulk creation supports up to 20 items per request.");
  }

  const items = rawItems.map((item, index) => normalizeBulkPackageItem(item, index));
  const issues = validateParallelBatchItems(items);
  if (issues.length > 0) {
    throw new HttpError(400, `Parallel batch validation failed:\n- ${issues.join("\n- ")}`);
  }

  const created = [];
  for (const item of items) {
    const result = await createDelegationPackage(masterControlPath, item);
    created.push({
      index: item.index,
      title: item.title,
      targetThread: item.targetThread,
      packageId: result.packageId,
      packageDir: result.packageDir,
      taskPacketFile: result.taskPacketFile,
      taskPacket: result.taskPacket,
      dispatchPrompt: result.dispatchPrompt,
      copyCommand: result.copyCommand,
      operatorInstructions: result.operatorInstructions,
      threadSuggestion: result.threadSuggestion,
      modelSuggestion: result.modelSuggestion
    });
  }

  return {
    ok: true,
    createdCount: created.length,
    created,
    dispatchPackets: created.map((entry) => entry.taskPacket).join("\n\n"),
    dispatchCommands: created.map((entry) => entry.copyCommand).join("\n")
  };
}

async function updateDelegationPackageMetadata(masterControlPath, packageId, body) {
  const packageDir = resolvePackageDir(masterControlPath, packageId);
  const metadataFile = path.join(packageDir, "package.json");
  const promptFile = path.join(packageDir, "TARGET_THREAD_PROMPT.md");
  const taskPacketFile = resolveTaskPacketFile(packageDir);
  const assetsDir = path.join(packageDir, "assets");
  const masterControlContent = await readText(masterControlPath, "");

  let existing = {};
  try {
    existing = JSON.parse(await readFile(metadataFile, "utf8"));
  } catch {
    throw new HttpError(404, "Delegation package metadata not found");
  }

  const title = Object.prototype.hasOwnProperty.call(body, "title")
    ? cleanLine(body.title, "")
    : cleanLine(existing.title, "");
  const targetThread = Object.prototype.hasOwnProperty.call(body, "targetThread")
    ? cleanLine(body.targetThread, "")
    : cleanLine(existing.targetThread, "");
  const problem = Object.prototype.hasOwnProperty.call(body, "problem")
    ? cleanMultiline(body.problem, "")
    : cleanMultiline(existing.problem, "");
  const fullPrompt = Object.prototype.hasOwnProperty.call(body, "fullPrompt")
    ? cleanMultiline(body.fullPrompt, "")
    : cleanMultiline(existing.fullPrompt, "");
  const doneCriteria = Object.prototype.hasOwnProperty.call(body, "doneCriteria")
    ? cleanMultiline(body.doneCriteria, "")
    : cleanMultiline(existing.doneCriteria, "");
  const reportBack = Object.prototype.hasOwnProperty.call(body, "reportBack")
    ? cleanMultiline(body.reportBack, "")
    : cleanMultiline(existing.reportBack, "");
  const suggestedModelInput = Object.prototype.hasOwnProperty.call(body, "suggestedModel")
    ? cleanLine(body.suggestedModel, "")
    : cleanLine(existing.suggestedModel, "");
  const modelReasonInput = Object.prototype.hasOwnProperty.call(body, "modelReason")
    ? cleanMultiline(body.modelReason, "")
    : cleanMultiline(existing.modelReason, "");
  const suggestedEffortInput = Object.prototype.hasOwnProperty.call(body, "suggestedEffort")
    ? cleanLine(body.suggestedEffort, "")
    : cleanLine(existing.suggestedEffort, "");
  const regeneratePrompt = Boolean(body.regeneratePrompt);

  const modelSuggestion = resolveModelSuggestion(
    {
      title,
      targetThread,
      problem,
      fullPrompt,
      doneCriteria,
      reportBack,
      assetsCount: Array.isArray(existing.assets) ? existing.assets.length : 0
    },
    suggestedModelInput,
    modelReasonInput,
    Object.prototype.hasOwnProperty.call(body, "suggestedModel") ? "user" : cleanLine(existing.modelSource, ""),
    suggestedEffortInput
  );

  const next = {
    ...existing,
    packageId,
    title,
    targetThread,
    problem,
    fullPrompt,
    doneCriteria,
    reportBack,
    suggestedModel: modelSuggestion.model,
    modelReason: modelSuggestion.reason,
    suggestedEffort: modelSuggestion.effort,
    modelSource: modelSuggestion.source,
    masterControlPath
  };

  await writeText(metadataFile, `${JSON.stringify(next, null, 2)}\n`);

  if (regeneratePrompt) {
    const promptContent = buildTargetPrompt({
      body: {
        title,
        targetThread,
        problem,
        fullPrompt,
        doneCriteria,
        reportBack,
        suggestedModel: modelSuggestion.model,
        modelReason: modelSuggestion.reason,
        suggestedEffort: modelSuggestion.effort,
        assets: Array.isArray(next.assets) ? next.assets : []
      },
      packageId,
      packageDir,
      assetsDir,
      masterControlPath
    });
    await writeText(promptFile, promptContent);
  }

  const taskPacket = buildTaskPacket({
    targetThread,
    packageId,
    title,
    promptFile,
    taskPacketFile,
    masterControlPath,
    projectRoot: resolveRepoRoot(masterControlPath)
  });
  await writeText(taskPacketFile, `${taskPacket}\n`);

  return {
    ok: true,
    packageId,
    metadataFile,
    promptFile,
    taskPacketFile,
    taskPacket,
    dispatchPrompt: taskPacket,
    copyCommand: `cat \"${taskPacketFile}\"`,
    regenerated: regeneratePrompt,
    threadSuggestion: getThreadSuggestion(masterControlContent, targetThread, {
      title,
      targetThread,
      problem,
      fullPrompt,
      doneCriteria,
      reportBack
    }),
    modelSuggestion,
    operatorInstructions: buildOperatorInstructions(modelSuggestion, targetThread),
    metadata: next
  };
}

function htmlPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Master Control Ops</title>
  <style>
    :root { color-scheme: dark; --bg:#0b1220; --panel:#111a2b; --line:#2a3956; --ink:#e7eefb; --muted:#93a5c3; --accent:#ff982f; --danger:#ff709d; --ok:#49d89f; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:var(--ink); background:linear-gradient(180deg,#070c16,#0c1526); }
    main { max-width:1280px; margin:0 auto; padding:18px; display:grid; gap:14px; }
    h1 { margin:0; font-size:1.4rem; }
    h2 { margin:0; font-size:1.05rem; }
    p { margin:6px 0 0; color:var(--muted); }
    .panel { border:1px solid var(--line); border-radius:14px; background:rgba(17,26,43,.86); padding:12px; display:grid; gap:10px; }
    .starter-panel { border-color:rgba(255,152,47,.75); }
    .status { font-size:.9rem; margin:0; min-height:1.2em; }
    .status.info { color:var(--muted); }
    .status.ok { color:var(--ok); }
    .status.warn { color:var(--accent); }
    .status.error { color:var(--danger); }
    .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:.82rem; color:var(--muted); }
    .btn { border:1px solid var(--line); border-radius:10px; background:#18243b; color:var(--ink); padding:8px 12px; font-weight:600; cursor:pointer; }
    .btn.accent { border-color:rgba(255,152,47,.5); box-shadow:0 0 0 1px rgba(255,152,47,.22) inset; }
    textarea { width:100%; min-height:260px; resize:vertical; border:1px solid var(--line); border-radius:10px; background:#0a1220; color:var(--ink); padding:10px; line-height:1.4; }
    textarea.small { min-height:100px; }
    textarea.tiny { min-height:74px; }
    .grid-two { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .grid-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    label { display:grid; gap:6px; color:var(--muted); font-size:.92rem; }
    input, select { border:1px solid var(--line); border-radius:10px; background:#101b2d; color:var(--ink); padding:9px 10px; }
    .error { color:var(--danger); margin:0; }
    .warn { color:var(--accent); margin:0; }
    .ok { color:var(--ok); margin:0; }
    .packages-layout { display:grid; grid-template-columns:320px minmax(0,1fr); gap:12px; }
    .list { border:1px solid var(--line); border-radius:10px; background:#0a1220; max-height:480px; overflow:auto; }
    .list button { width:100%; text-align:left; border:0; border-bottom:1px solid #1d2b43; background:transparent; color:var(--ink); padding:10px; cursor:pointer; }
    .list button:last-child { border-bottom:0; }
    .list button.active { background:#1a2740; }
    .subtle { color:var(--muted); font-size:.82rem; }
    .parallel-list { display:grid; gap:10px; }
    .parallel-row { border:1px solid var(--line); border-radius:10px; background:#0a1220; padding:10px; display:grid; gap:8px; }
    .checkbox-inline { display:flex; gap:8px; align-items:center; color:var(--muted); font-size:.9rem; }
    .checkbox-inline input { width:16px; height:16px; }
    @media (max-width: 980px) {
      .grid-two, .grid-form, .packages-layout { grid-template-columns:1fr; }
      textarea { min-height:220px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Master Control Ops</h1>
      <p>View and edit the Project manager prompt, Master Control memory, and all sub-thread prompts.</p>
    </header>

    <section class="panel">
      <h2>Project Isolation</h2>
      <p>All reads and writes are scoped to this repo root to prevent cross-project package mixing.</p>
      <div class="grid-form">
        <label>Active project root
          <input id="projectRootInput" placeholder="/absolute/path/to/repo" />
        </label>
        <label>Delegation package root
          <input id="projectDelegationRoot" readonly />
        </label>
      </div>
      <div class="row">
        <button class="btn accent" id="projectApplyBtn">Apply Project Root</button>
        <button class="btn" id="projectDefaultBtn">Use Server Default</button>
      </div>
    </section>

    <section class="panel starter-panel">
      <h2>Project Manager Starter Packet</h2>
      <p>Copy this packet into the Project manager thread in a new project. It sends that thread to Master Control Ops first, then follows tool setup instructions.</p>
      <label>Starter packet (copy this first)
        <textarea id="bootstrapStartPacket" spellcheck="false" readonly></textarea>
      </label>
      <p id="bootstrapStatus" class="status info subtle" hidden aria-live="polite"></p>
      <div class="row">
        <button class="btn accent" id="bootstrapCopyPacketBtn">Copy Starter Packet</button>
      </div>
      <div class="grid-form">
        <label>Optional explicit target repo path
          <input id="bootstrapTargetRepo" placeholder="/absolute/path/to/target repo" />
        </label>
        <label>Copy-ready bootstrap command
          <textarea id="bootstrapCommand" class="tiny" spellcheck="false" readonly></textarea>
        </label>
      </div>
      <div class="row">
        <button class="btn" id="bootstrapRefreshBtn">Refresh Command</button>
        <button class="btn accent" id="bootstrapCopyBtn">Copy Bootstrap Command</button>
      </div>
    </section>

    <section class="panel">
      <p class="error" id="errorText" hidden></p>
      <p class="ok" id="okText" hidden></p>
    </section>

    <section class="grid-two">
      <section class="panel">
        <h2>Master Control Document</h2>
        <div class="row">
          <button class="btn" id="masterControlReloadBtn">Reload</button>
          <button class="btn accent" id="masterControlSaveBtn">Save</button>
          <span class="mono" id="masterControlPath"></span>
        </div>
        <textarea id="masterControlEditor" spellcheck="false"></textarea>
      </section>

      <section class="panel">
        <h2>Project Manager Prompt</h2>
        <div class="row">
          <button class="btn" id="masterPromptReloadBtn">Reload</button>
          <button class="btn accent" id="masterPromptSaveBtn">Save</button>
          <button class="btn" id="masterPromptCopyBtn">Copy Prompt</button>
          <span class="mono" id="masterPromptPath"></span>
        </div>
        <textarea id="masterPromptEditor" spellcheck="false"></textarea>
      </section>
    </section>

    <section class="panel">
      <h2>Append Summary Entry</h2>
      <div class="grid-form">
        <label>Thread <input id="summaryThread" value="Project manager" /></label>
        <label>Task <input id="summaryTask" /></label>
        <label>Outcome <input id="summaryOutcome" /></label>
        <label>Files (optional) <input id="summaryFiles" placeholder="path1, path2" /></label>
        <label>Open items (optional) <input id="summaryOpenItems" placeholder="none" /></label>
      </div>
      <div class="row">
        <button class="btn accent" id="summaryAppendBtn">Append Summary</button>
      </div>
    </section>

    <section class="panel">
      <h2>Create Sub-thread Prompt Package</h2>
      <div class="grid-form">
        <label>Package title <input id="createTitle" placeholder="Fix photo grid layout regressions" /></label>
        <label>Target thread <input id="createThread" placeholder="Image Grids" /></label>
      </div>
      <label>Hard problem context
        <textarea id="createProblem" class="small" spellcheck="false" placeholder="What the Project manager knows and why this is hard."></textarea>
      </label>
      <label>Full task prompt for target thread
        <textarea id="createPrompt" class="small" spellcheck="false" placeholder="Exact instructions for the target thread."></textarea>
      </label>
      <div class="grid-form">
        <label>Done criteria
          <textarea id="createDone" class="tiny" spellcheck="false" placeholder="What counts as complete."></textarea>
        </label>
        <label>Required return update
          <textarea id="createReport" class="tiny" spellcheck="false" placeholder="How target thread must report back to Master Control."></textarea>
        </label>
      </div>
      <div class="grid-form">
        <label>Suggested model (optional override)
          <input id="createSuggestedModel" placeholder="auto: gpt-5 / gpt-5-mini / gpt-5-nano" />
        </label>
        <label>Model reason (optional)
          <textarea id="createModelReason" class="tiny" spellcheck="false" placeholder="Why this model is a good fit."></textarea>
        </label>
      </div>
      <label>Reference assets (images/screenshots/files)
        <input id="createAssets" type="file" multiple />
      </label>
      <div class="row">
        <button class="btn accent" id="createPackageBtn">Create Package</button>
      </div>
      <p class="warn" id="createThreadWarning" hidden></p>
      <p class="subtle" id="createModelSuggestion"></p>
      <label>Operator instructions (outside copy window)
        <textarea id="createOperatorInstructions" class="tiny" spellcheck="false" readonly></textarea>
      </label>
      <label>Task packet (copy/paste this into the target sub-thread)
        <textarea id="createTaskPacket" class="small" spellcheck="false" readonly></textarea>
      </label>
      <div class="row">
        <button class="btn accent" id="createCopyTaskPacketBtn">Copy Task Packet</button>
        <button class="btn" id="createCopyCommandBtn">Copy Terminal Command</button>
      </div>
      <label>Optional terminal helper command (do not paste into sub-thread)
        <textarea id="createCommand" class="tiny" spellcheck="false" readonly></textarea>
      </label>
      <label>Created package path
        <input id="createPackagePath" readonly />
      </label>
    </section>

    <section class="panel">
      <h2>Create Parallel Task Packets</h2>
      <p>Use this when tasks can run independently in different threads. Every row must be marked parallel-safe.</p>
      <div id="parallelRows" class="parallel-list"></div>
      <div class="row">
        <button class="btn" id="parallelAddRowBtn">Add Row</button>
        <button class="btn accent" id="parallelCreateBtn">Create Parallel Packets</button>
        <button class="btn" id="parallelCopyCommandsBtn">Copy All Task Packets</button>
      </div>
      <p class="warn" id="parallelValidationWarning" hidden></p>
      <label>Task packets (copy each block into its target thread)
        <textarea id="parallelDispatchCommands" class="small" spellcheck="false" readonly></textarea>
      </label>
    </section>

    <section class="panel">
      <h2>Sub-thread Prompt Packages</h2>
      <div class="packages-layout">
        <div>
          <div class="row">
            <button class="btn" id="packagesReloadBtn">Reload Packages</button>
          </div>
          <div class="list" id="packageList"></div>
        </div>
        <div>
          <label>Selected package
            <input id="selectedPackageId" readonly />
          </label>
          <div class="row">
            <button class="btn" id="packageReloadBtn">Reload Selected Prompt</button>
            <button class="btn accent" id="packageSaveBtn">Save Selected Prompt</button>
            <button class="btn accent" id="packageCopyTaskPacketBtn">Copy Task Packet</button>
            <button class="btn" id="packageCopyPromptBtn">Copy Prompt</button>
            <button class="btn" id="packageCopyCommandBtn">Copy Terminal Command</button>
          </div>
          <label>Task packet (copy/paste this into the sub-thread)
            <textarea id="selectedTaskPacket" class="small" spellcheck="false" readonly></textarea>
          </label>
          <label>Optional terminal helper command (do not paste into sub-thread)
            <textarea id="selectedCopyCommand" class="tiny" spellcheck="false" readonly></textarea>
          </label>
          <label>Operator instructions (outside copy window)
            <textarea id="selectedOperatorInstructions" class="tiny" spellcheck="false" readonly></textarea>
          </label>
          <div class="row subtle" id="selectedPackageMeta"></div>
          <p class="warn" id="selectedThreadWarning" hidden></p>
          <div class="grid-form">
            <label>Title
              <input id="selectedMetaTitle" />
            </label>
            <label>Target thread
              <input id="selectedMetaThread" />
            </label>
          </div>
          <label>Hard problem context
            <textarea id="selectedMetaProblem" class="small" spellcheck="false"></textarea>
          </label>
          <label>Task prompt body
            <textarea id="selectedMetaFullPrompt" class="small" spellcheck="false"></textarea>
          </label>
          <div class="grid-form">
            <label>Done criteria
              <textarea id="selectedMetaDone" class="tiny" spellcheck="false"></textarea>
            </label>
            <label>Required return update
              <textarea id="selectedMetaReport" class="tiny" spellcheck="false"></textarea>
            </label>
          </div>
          <div class="grid-form">
            <label>Suggested model
              <input id="selectedMetaModel" />
            </label>
            <label>Model reason
              <textarea id="selectedMetaModelReason" class="tiny" spellcheck="false"></textarea>
            </label>
          </div>
          <div class="row">
            <button class="btn" id="packageSaveMetaBtn">Save Metadata</button>
            <button class="btn accent" id="packageSaveMetaRegenBtn">Save Metadata + Regenerate Prompt</button>
          </div>
          <label>Selected sub-thread prompt
            <textarea id="selectedPromptEditor" spellcheck="false"></textarea>
          </label>
        </div>
      </div>
    </section>
  </main>

  <script>
    const errorText = document.getElementById("errorText");
    const okText = document.getElementById("okText");
    const projectRootInput = document.getElementById("projectRootInput");
    const projectDelegationRoot = document.getElementById("projectDelegationRoot");
    const projectApplyBtn = document.getElementById("projectApplyBtn");
    const projectDefaultBtn = document.getElementById("projectDefaultBtn");
    const bootstrapTargetRepo = document.getElementById("bootstrapTargetRepo");
    const bootstrapCommand = document.getElementById("bootstrapCommand");
    const bootstrapStartPacket = document.getElementById("bootstrapStartPacket");
    const bootstrapStatus = document.getElementById("bootstrapStatus");
    const bootstrapRefreshBtn = document.getElementById("bootstrapRefreshBtn");
    const bootstrapCopyBtn = document.getElementById("bootstrapCopyBtn");
    const bootstrapCopyPacketBtn = document.getElementById("bootstrapCopyPacketBtn");

    const masterControlPath = document.getElementById("masterControlPath");
    const masterControlEditor = document.getElementById("masterControlEditor");
    const masterControlReloadBtn = document.getElementById("masterControlReloadBtn");
    const masterControlSaveBtn = document.getElementById("masterControlSaveBtn");

    const masterPromptPath = document.getElementById("masterPromptPath");
    const masterPromptEditor = document.getElementById("masterPromptEditor");
    const masterPromptReloadBtn = document.getElementById("masterPromptReloadBtn");
    const masterPromptSaveBtn = document.getElementById("masterPromptSaveBtn");
    const masterPromptCopyBtn = document.getElementById("masterPromptCopyBtn");

    const summaryThread = document.getElementById("summaryThread");
    const summaryTask = document.getElementById("summaryTask");
    const summaryOutcome = document.getElementById("summaryOutcome");
    const summaryFiles = document.getElementById("summaryFiles");
    const summaryOpenItems = document.getElementById("summaryOpenItems");
    const summaryAppendBtn = document.getElementById("summaryAppendBtn");

    const createTitle = document.getElementById("createTitle");
    const createThread = document.getElementById("createThread");
    const createProblem = document.getElementById("createProblem");
    const createPrompt = document.getElementById("createPrompt");
    const createDone = document.getElementById("createDone");
    const createReport = document.getElementById("createReport");
    const createSuggestedModel = document.getElementById("createSuggestedModel");
    const createModelReason = document.getElementById("createModelReason");
    const createAssets = document.getElementById("createAssets");
    const createPackageBtn = document.getElementById("createPackageBtn");
    const createThreadWarning = document.getElementById("createThreadWarning");
    const createModelSuggestion = document.getElementById("createModelSuggestion");
    const createOperatorInstructions = document.getElementById("createOperatorInstructions");
    const createTaskPacket = document.getElementById("createTaskPacket");
    const createCommand = document.getElementById("createCommand");
    const createCopyTaskPacketBtn = document.getElementById("createCopyTaskPacketBtn");
    const createCopyCommandBtn = document.getElementById("createCopyCommandBtn");
    const createPackagePath = document.getElementById("createPackagePath");
    const parallelRows = document.getElementById("parallelRows");
    const parallelAddRowBtn = document.getElementById("parallelAddRowBtn");
    const parallelCreateBtn = document.getElementById("parallelCreateBtn");
    const parallelCopyCommandsBtn = document.getElementById("parallelCopyCommandsBtn");
    const parallelValidationWarning = document.getElementById("parallelValidationWarning");
    const parallelDispatchCommands = document.getElementById("parallelDispatchCommands");

    const packagesReloadBtn = document.getElementById("packagesReloadBtn");
    const packageList = document.getElementById("packageList");
    const selectedPackageId = document.getElementById("selectedPackageId");
    const selectedTaskPacket = document.getElementById("selectedTaskPacket");
    const selectedCopyCommand = document.getElementById("selectedCopyCommand");
    const selectedOperatorInstructions = document.getElementById("selectedOperatorInstructions");
    const selectedPackageMeta = document.getElementById("selectedPackageMeta");
    const selectedThreadWarning = document.getElementById("selectedThreadWarning");
    const selectedMetaTitle = document.getElementById("selectedMetaTitle");
    const selectedMetaThread = document.getElementById("selectedMetaThread");
    const selectedMetaProblem = document.getElementById("selectedMetaProblem");
    const selectedMetaFullPrompt = document.getElementById("selectedMetaFullPrompt");
    const selectedMetaDone = document.getElementById("selectedMetaDone");
    const selectedMetaReport = document.getElementById("selectedMetaReport");
    const selectedMetaModel = document.getElementById("selectedMetaModel");
    const selectedMetaModelReason = document.getElementById("selectedMetaModelReason");
    const selectedPromptEditor = document.getElementById("selectedPromptEditor");
    const packageReloadBtn = document.getElementById("packageReloadBtn");
    const packageSaveBtn = document.getElementById("packageSaveBtn");
    const packageSaveMetaBtn = document.getElementById("packageSaveMetaBtn");
    const packageSaveMetaRegenBtn = document.getElementById("packageSaveMetaRegenBtn");
    const packageCopyTaskPacketBtn = document.getElementById("packageCopyTaskPacketBtn");
    const packageCopyPromptBtn = document.getElementById("packageCopyPromptBtn");
    const packageCopyCommandBtn = document.getElementById("packageCopyCommandBtn");

    let busy = false;
    let selectedId = "";
    let activeProjectRoot = "";

    function showError(msg) {
      errorText.hidden = false;
      errorText.textContent = msg;
      okText.hidden = true;
      okText.textContent = "";
    }

    function showOk(msg) {
      okText.hidden = false;
      okText.textContent = msg;
      errorText.hidden = true;
      errorText.textContent = "";
    }

    function setBusy(value) {
      busy = value;
      for (const button of document.querySelectorAll("button")) {
        button.disabled = value;
      }
    }

    function setBootstrapStatus(message, variant = "info") {
      if (!bootstrapStatus) return;
      const validVariants = new Set(["info", "ok", "warn", "error"]);
      const normalized = validVariants.has(variant) ? variant : "info";
      bootstrapStatus.textContent = message || "";
      bootstrapStatus.className = "status " + normalized;
      bootstrapStatus.hidden = !message;
    }

    function clearBootstrapStatus() {
      setBootstrapStatus("", "info");
    }

    async function copyText(text) {
      if (!text) return;
      await navigator.clipboard.writeText(text);
      showOk("Copied.");
    }

    function renderThreadSuggestionNotice(element, suggestion) {
      const message = suggestion && typeof suggestion.message === "string" ? suggestion.message.trim() : "";
      if (!message) {
        element.hidden = true;
        element.textContent = "";
        element.className = "warn";
        return;
      }
      element.hidden = false;
      element.textContent = message;
      element.className = suggestion && suggestion.shouldCreate ? "warn" : "subtle";
    }

    function applyProjectContext(data) {
      if (!data || typeof data !== "object") return;
      if (typeof data.projectRoot === "string" && data.projectRoot.trim()) {
        activeProjectRoot = data.projectRoot.trim();
        projectRootInput.value = activeProjectRoot;
      }
      if (typeof data.delegationRoot === "string") {
        projectDelegationRoot.value = data.delegationRoot;
      }
    }

    function scopedUrl(rawUrl) {
      const next = new URL(rawUrl, window.location.origin);
      if (activeProjectRoot && !next.searchParams.has("projectRoot")) {
        next.searchParams.set("projectRoot", activeProjectRoot);
      }
      return next.pathname + next.search;
    }

    async function requestJson(url, options = {}) {
      const response = await fetch(scopedUrl(url), options);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || ("Request failed (" + response.status + ")"));
      }
      applyProjectContext(payload);
      return payload;
    }

    async function loadMasterControl() {
      const data = await requestJson("/api/master-control", { cache: "no-store" });
      masterControlEditor.value = data.content || "";
      masterControlPath.textContent = data.filePath || "";
    }

    async function saveMasterControl() {
      await requestJson("/api/master-control", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: masterControlEditor.value })
      });
    }

    async function loadMasterPrompt() {
      const data = await requestJson("/api/master-prompt", { cache: "no-store" });
      masterPromptEditor.value = data.content || "";
      masterPromptPath.textContent = data.filePath || "";
    }

    async function saveMasterPrompt() {
      await requestJson("/api/master-prompt", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: masterPromptEditor.value })
      });
    }

    async function loadBootstrapCommand() {
      const targetRepoPath = bootstrapTargetRepo.value.trim();
      const suffix = targetRepoPath ? ("?targetRepoPath=" + encodeURIComponent(targetRepoPath)) : "";
      setBootstrapStatus("Loading starter packet...", "info");
      try {
        const data = await requestJson("/api/bootstrap-command" + suffix, { cache: "no-store" });
        bootstrapCommand.value = data.command || "";
        updateStarterPacketStatus(data.startPacket, targetRepoPath);
      } catch (error) {
        clearBootstrapStatus();
        throw error;
      }
    }

    function updateStarterPacketStatus(payload, targetRepoPath) {
      const trimmedPayload = typeof payload === "string" ? payload.trim() : "";
      const resolvedTarget = targetRepoPath || "$PWD";
      bootstrapStartPacket.value = trimmedPayload ? payload : "";
      if (trimmedPayload) {
        setBootstrapStatus(
          "Starter packet ready for "
            + resolvedTarget
            + ". Copy it into the new Project manager thread to continue onboarding.",
          "ok"
        );
      } else {
        setBootstrapStatus(
          "Starter packet payload is empty for "
            + resolvedTarget
            + ". Ensure "
            + resolvedTarget
            + "/docs/master-control.md exists and rerun the bootstrap command or installer.",
          "error"
        );
      }
    }

    async function copyStarterPacket() {
      const text = bootstrapStartPacket.value || "";
      if (!text.trim()) {
        setBootstrapStatus("Starter packet is empty. Refresh the command or set a target repo path.", "warn");
        return;
      }
      await copyText(text);
      setBootstrapStatus("Starter packet copied. Paste it into the Project manager thread to continue onboarding.", "ok");
    }

    async function applyProjectRoot(useServerDefault = false) {
      activeProjectRoot = useServerDefault ? "" : projectRootInput.value.trim();
      await loadMasterControl();
      await loadMasterPrompt();
      await loadPackages("");
      await loadBootstrapCommand();
    }

    async function appendSummary() {
      if (!summaryTask.value.trim() || !summaryOutcome.value.trim()) {
        throw new Error("Task and Outcome are required.");
      }
      await requestJson("/api/master-control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread: summaryThread.value,
          task: summaryTask.value,
          outcome: summaryOutcome.value,
          files: summaryFiles.value,
          openItems: summaryOpenItems.value
        })
      });
      summaryTask.value = "";
      summaryOutcome.value = "";
      summaryFiles.value = "";
      summaryOpenItems.value = "";
      await loadMasterControl();
    }

    function readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed reading asset: " + file.name));
        reader.readAsDataURL(file);
      });
    }

    async function encodeAssets(fileList) {
      const assets = [];
      for (const file of Array.from(fileList || [])) {
        const dataURL = await readFileAsDataURL(file);
        const comma = dataURL.indexOf(",");
        if (comma < 0) throw new Error("Invalid asset encoding: " + file.name);
        assets.push({
          name: file.name,
          type: file.type || "application/octet-stream",
          dataBase64: dataURL.slice(comma + 1)
        });
      }
      return assets;
    }

    async function createPackage() {
      if (!createTitle.value.trim() || !createThread.value.trim() || !createPrompt.value.trim()) {
        throw new Error("Package title, target thread, and full task prompt are required.");
      }
      const assets = await encodeAssets(createAssets.files);
      const data = await requestJson("/api/delegation-package", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: createTitle.value,
          targetThread: createThread.value,
          problem: createProblem.value,
          fullPrompt: createPrompt.value,
          doneCriteria: createDone.value,
          reportBack: createReport.value,
          suggestedModel: createSuggestedModel.value,
          modelReason: createModelReason.value,
          assets
        })
      });

      createTaskPacket.value = data.taskPacket || data.dispatchPrompt || "";
      createCommand.value = data.copyCommand || "";
      createPackagePath.value = data.packageDir || "";
      createAssets.value = "";
      if (data.modelSuggestion && data.modelSuggestion.model) {
        const modelLower = String(data.modelSuggestion.model || "").toLowerCase();
        const effort = data.modelSuggestion.effort || (modelLower.includes("nano") ? "low" : (modelLower.includes("mini") ? "medium" : "high"));
        const uiModel = data.modelSuggestion.uiModel || data.modelSuggestion.model;
        createModelSuggestion.textContent = "Suggested model: " + uiModel + " | effort: " + effort + " | " + (data.modelSuggestion.reason || "");
      } else {
        createModelSuggestion.textContent = "";
      }
      createOperatorInstructions.value = data.operatorInstructions || "";

      renderThreadSuggestionNotice(createThreadWarning, data.threadSuggestion || null);

      await loadPackages(data.packageId);
    }

    function createParallelRow(seed = {}) {
      const row = document.createElement("div");
      row.className = "parallel-row";
      row.innerHTML = ""
        + "<div class=\"grid-form\">"
        + "  <label>Package title<input data-field=\"title\" placeholder=\"Task title\" /></label>"
        + "  <label>Target thread<input data-field=\"targetThread\" placeholder=\"Focused thread\" /></label>"
        + "</div>"
        + "<label>Task prompt<textarea data-field=\"fullPrompt\" class=\"tiny\" spellcheck=\"false\" placeholder=\"Exact instructions for this thread.\"></textarea></label>"
        + "<div class=\"grid-form\">"
        + "  <label>Hard problem context<textarea data-field=\"problem\" class=\"tiny\" spellcheck=\"false\" placeholder=\"Optional context.\"></textarea></label>"
        + "  <label>Done criteria<textarea data-field=\"doneCriteria\" class=\"tiny\" spellcheck=\"false\" placeholder=\"Optional done criteria.\"></textarea></label>"
        + "</div>"
        + "<label>Required return update<textarea data-field=\"reportBack\" class=\"tiny\" spellcheck=\"false\" placeholder=\"Optional return update instructions.\"></textarea></label>"
        + "<div class=\"row\">"
        + "  <label class=\"checkbox-inline\"><input data-field=\"parallelSafe\" type=\"checkbox\" checked /> Parallel safe (independent task)</label>"
        + "  <button type=\"button\" class=\"btn\" data-action=\"remove\">Remove</button>"
        + "</div>";

      const setValue = (field, value) => {
        const node = row.querySelector("[data-field=\"" + field + "\"]");
        if (!node) return;
        if (node.type === "checkbox") {
          node.checked = Boolean(value);
        } else {
          node.value = typeof value === "string" ? value : "";
        }
      };

      setValue("title", seed.title);
      setValue("targetThread", seed.targetThread);
      setValue("fullPrompt", seed.fullPrompt);
      setValue("problem", seed.problem);
      setValue("doneCriteria", seed.doneCriteria);
      setValue("reportBack", seed.reportBack);
      setValue("parallelSafe", Object.prototype.hasOwnProperty.call(seed, "parallelSafe") ? seed.parallelSafe : true);

      const removeBtn = row.querySelector("[data-action=\"remove\"]");
      removeBtn.addEventListener("click", () => {
        if (parallelRows.children.length <= 1) {
          parallelValidationWarning.hidden = false;
          parallelValidationWarning.textContent = "At least one row is required.";
          return;
        }
        row.remove();
      });

      return row;
    }

    function addParallelRow(seed = {}) {
      parallelRows.append(createParallelRow(seed));
    }

    function collectParallelItems() {
      const items = [];
      const rows = Array.from(parallelRows.querySelectorAll(".parallel-row"));
      for (const row of rows) {
        const title = (row.querySelector("[data-field=\"title\"]") || {}).value || "";
        const targetThread = (row.querySelector("[data-field=\"targetThread\"]") || {}).value || "";
        const fullPrompt = (row.querySelector("[data-field=\"fullPrompt\"]") || {}).value || "";
        const problem = (row.querySelector("[data-field=\"problem\"]") || {}).value || "";
        const doneCriteria = (row.querySelector("[data-field=\"doneCriteria\"]") || {}).value || "";
        const reportBack = (row.querySelector("[data-field=\"reportBack\"]") || {}).value || "";
        const parallelSafeNode = row.querySelector("[data-field=\"parallelSafe\"]");
        const parallelSafe = Boolean(parallelSafeNode && parallelSafeNode.checked);

        const hasContent = [title, targetThread, fullPrompt, problem, doneCriteria, reportBack].some((text) => String(text).trim().length > 0);
        if (!hasContent) continue;

        items.push({
          title,
          targetThread,
          problem,
          fullPrompt,
          doneCriteria,
          reportBack,
          parallelSafe
        });
      }
      return items;
    }

    async function createParallelPackages() {
      const items = collectParallelItems();
      if (items.length < 2) {
        throw new Error("Provide at least 2 populated rows for parallel packet creation.");
      }

      const data = await requestJson("/api/delegation-packages/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items })
      });

      const created = Array.isArray(data.created) ? data.created : [];
      const lines = [];
      const warnings = [];
      for (const item of created) {
        lines.push("Paste into thread: " + (item.targetThread || ""));
        lines.push(String(item.taskPacket || item.dispatchPrompt || "").trim());
        lines.push("");
        if (item.threadSuggestion && item.threadSuggestion.message) {
          warnings.push(item.threadSuggestion.message);
        }
      }
      parallelDispatchCommands.value = lines.join("\n").trim();

      if (warnings.length) {
        parallelValidationWarning.hidden = false;
        parallelValidationWarning.textContent = warnings.join(" | ");
      } else {
        parallelValidationWarning.hidden = true;
        parallelValidationWarning.textContent = "";
      }

      if (created.length > 0) {
        await loadPackages(created[0].packageId);
      } else {
        await loadPackages("");
      }
    }

    function renderPackageList(items) {
      packageList.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "subtle";
        empty.style.padding = "10px";
        empty.textContent = "No packages yet.";
        packageList.append(empty);
        return;
      }

      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        if (item.packageId === selectedId) button.classList.add("active");
        const created = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
        const model = item.suggestedModel || "auto";
        button.innerHTML = "<div><strong>" + item.title + "</strong></div><div class=\\\"subtle\\\">" + (item.targetThread || "(no thread)") + " | " + model + " | " + created + "</div>";
        button.addEventListener("click", () => {
          void run(async () => {
            await loadPackageDetail(item.packageId);
          });
        });
        packageList.append(button);
      }
    }

    async function loadPackages(preferredId = "") {
      const data = await requestJson("/api/delegation-packages", { cache: "no-store" });
      const items = Array.isArray(data.items) ? data.items : [];
      if (preferredId) {
        selectedId = preferredId;
      } else if (!selectedId && items.length) {
        selectedId = items[0].packageId;
      } else if (selectedId && !items.some((x) => x.packageId === selectedId)) {
        selectedId = items.length ? items[0].packageId : "";
      }

      renderPackageList(items);

      if (selectedId) {
        await loadPackageDetail(selectedId);
      } else {
        selectedPackageId.value = "";
        selectedTaskPacket.value = "";
        selectedCopyCommand.value = "";
        selectedOperatorInstructions.value = "";
        selectedPromptEditor.value = "";
        selectedPackageMeta.textContent = "";
        selectedMetaTitle.value = "";
        selectedMetaThread.value = "";
        selectedMetaProblem.value = "";
        selectedMetaFullPrompt.value = "";
        selectedMetaDone.value = "";
        selectedMetaReport.value = "";
        selectedMetaModel.value = "";
        selectedMetaModelReason.value = "";
        selectedThreadWarning.hidden = true;
        selectedThreadWarning.textContent = "";
      }
    }

    async function loadPackageDetail(packageId) {
      const data = await requestJson("/api/delegation-packages/" + encodeURIComponent(packageId), { cache: "no-store" });
      selectedId = data.packageId || "";
      selectedPackageId.value = selectedId;
      selectedTaskPacket.value = data.taskPacket || data.dispatchPrompt || "";
      selectedCopyCommand.value = data.copyCommand || "";
      selectedOperatorInstructions.value = data.operatorInstructions || "";
      selectedPromptEditor.value = data.prompt || "";
      const metadata = data.metadata || {};
      const assetCount = Array.isArray(metadata.assets) ? metadata.assets.length : 0;
      const created = metadata.createdAt ? new Date(metadata.createdAt).toLocaleString() : "";
      const modelLabel = (data.modelSuggestion && (data.modelSuggestion.uiModel || data.modelSuggestion.model)) || metadata.suggestedModel || "";
      const effortLabel = (metadata.suggestedEffort || (data.modelSuggestion && data.modelSuggestion.effort) || "");
      selectedPackageMeta.textContent = "Thread: " + (metadata.targetThread || "") + " | Model: " + modelLabel + " | Effort: " + effortLabel + " | Created: " + created + " | Assets: " + assetCount;

      selectedMetaTitle.value = metadata.title || "";
      selectedMetaThread.value = metadata.targetThread || "";
      selectedMetaProblem.value = metadata.problem || "";
      selectedMetaFullPrompt.value = metadata.fullPrompt || "";
      selectedMetaDone.value = metadata.doneCriteria || "";
      selectedMetaReport.value = metadata.reportBack || "";
      selectedMetaModel.value = metadata.suggestedModel || ((data.modelSuggestion && data.modelSuggestion.model) || "");
      selectedMetaModelReason.value = metadata.modelReason || ((data.modelSuggestion && data.modelSuggestion.reason) || "");

      renderThreadSuggestionNotice(selectedThreadWarning, data.threadSuggestion || null);
      await loadPackagesWithoutSelectionReset();
    }

    async function loadPackagesWithoutSelectionReset() {
      const data = await requestJson("/api/delegation-packages", { cache: "no-store" });
      const items = Array.isArray(data.items) ? data.items : [];
      renderPackageList(items);
    }

    async function saveSelectedPrompt() {
      if (!selectedId) throw new Error("Select a package first.");
      await requestJson("/api/delegation-packages/" + encodeURIComponent(selectedId) + "/prompt", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: selectedPromptEditor.value })
      });
    }

    async function saveSelectedMetadata(regeneratePrompt) {
      if (!selectedId) throw new Error("Select a package first.");
      const data = await requestJson("/api/delegation-packages/" + encodeURIComponent(selectedId) + "/metadata", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: selectedMetaTitle.value,
          targetThread: selectedMetaThread.value,
          problem: selectedMetaProblem.value,
          fullPrompt: selectedMetaFullPrompt.value,
          doneCriteria: selectedMetaDone.value,
          reportBack: selectedMetaReport.value,
          suggestedModel: selectedMetaModel.value,
          modelReason: selectedMetaModelReason.value,
          regeneratePrompt
        })
      });

      renderThreadSuggestionNotice(selectedThreadWarning, data.threadSuggestion || null);
      selectedTaskPacket.value = data.taskPacket || data.dispatchPrompt || selectedTaskPacket.value;
      selectedCopyCommand.value = data.copyCommand || selectedCopyCommand.value;
      selectedOperatorInstructions.value = data.operatorInstructions || selectedOperatorInstructions.value;

      if (regeneratePrompt) {
        await loadPackageDetail(selectedId);
      } else {
        await loadPackagesWithoutSelectionReset();
      }
    }

    async function run(fn, successMessage = "") {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        if (successMessage) showOk(successMessage);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Operation failed");
      } finally {
        setBusy(false);
      }
    }

    masterControlReloadBtn.addEventListener("click", () => { void run(loadMasterControl, "Master Control loaded."); });
    masterControlSaveBtn.addEventListener("click", () => { void run(saveMasterControl, "Master Control saved."); });

    masterPromptReloadBtn.addEventListener("click", () => { void run(loadMasterPrompt, "Master prompt loaded."); });
    masterPromptSaveBtn.addEventListener("click", () => { void run(saveMasterPrompt, "Master prompt saved."); });
    masterPromptCopyBtn.addEventListener("click", () => { void run(() => copyText(masterPromptEditor.value), "Master prompt copied."); });

    projectApplyBtn.addEventListener("click", () => { void run(() => applyProjectRoot(false), "Project root applied."); });
    projectDefaultBtn.addEventListener("click", () => { void run(() => applyProjectRoot(true), "Using server default project root."); });
    bootstrapRefreshBtn.addEventListener("click", () => { void run(loadBootstrapCommand, "Bootstrap command refreshed."); });
    bootstrapCopyBtn.addEventListener("click", () => { void run(() => copyText(bootstrapCommand.value), "Bootstrap command copied."); });
    bootstrapCopyPacketBtn.addEventListener("click", () => { void run(copyStarterPacket, "Starter packet copied."); });
    bootstrapTargetRepo.addEventListener("change", () => { void run(loadBootstrapCommand, "Target repo updated."); });
    bootstrapTargetRepo.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void run(loadBootstrapCommand, "Target repo updated.");
      }
    });

    summaryAppendBtn.addEventListener("click", () => { void run(appendSummary, "Summary appended."); });

    createPackageBtn.addEventListener("click", () => { void run(createPackage, "Delegation package created."); });
    createCopyTaskPacketBtn.addEventListener("click", () => {
      void run(() => copyText(createTaskPacket.value), "Task packet copied.");
    });
    createCopyCommandBtn.addEventListener("click", () => {
      void run(() => copyText(createCommand.value), "Terminal helper command copied.");
    });
    parallelAddRowBtn.addEventListener("click", () => {
      addParallelRow({});
    });
    parallelCreateBtn.addEventListener("click", () => { void run(createParallelPackages, "Parallel task packets created."); });
    parallelCopyCommandsBtn.addEventListener("click", () => {
      void run(() => copyText(parallelDispatchCommands.value), "Parallel task packets copied.");
    });

    packagesReloadBtn.addEventListener("click", () => { void run(() => loadPackages(""), "Package list reloaded."); });
    packageReloadBtn.addEventListener("click", () => { void run(() => loadPackageDetail(selectedId), "Selected package reloaded."); });
    packageSaveBtn.addEventListener("click", () => { void run(saveSelectedPrompt, "Selected package prompt saved."); });
    packageSaveMetaBtn.addEventListener("click", () => { void run(() => saveSelectedMetadata(false), "Selected package metadata saved."); });
    packageSaveMetaRegenBtn.addEventListener("click", () => { void run(() => saveSelectedMetadata(true), "Selected package metadata saved and prompt regenerated."); });
    packageCopyTaskPacketBtn.addEventListener("click", () => { void run(() => copyText(selectedTaskPacket.value), "Selected task packet copied."); });
    packageCopyPromptBtn.addEventListener("click", () => { void run(() => copyText(selectedPromptEditor.value), "Selected prompt copied."); });
    packageCopyCommandBtn.addEventListener("click", () => { void run(() => copyText(selectedCopyCommand.value), "Selected terminal helper command copied."); });

    void run(async () => {
      if (!parallelRows.children.length) {
        addParallelRow({ parallelSafe: true });
        addParallelRow({ parallelSafe: true });
      }
      await loadMasterControl();
      await loadMasterPrompt();
      await loadPackages("");
      await loadBootstrapCommand();
    }, "Workspace loaded.");
  </script>
</body>
</html>`;
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
  let projectContext = resolveProjectContext(url);
  let masterControlPath = projectContext.masterControlPath;
  let masterPromptPath = projectContext.masterPromptPath;
  const withContext = (payload = {}) => ({
    ...payload,
    projectRoot: projectContext.projectRoot,
    delegationRoot: projectContext.delegationRoot
  });

  try {
    if (method === "GET" && url.pathname === "/") {
      return sendText(res, 200, htmlPage(), "text/html; charset=utf-8");
    }

    if (method === "GET" && url.pathname === "/api/bootstrap-command") {
      const installerPath = await resolveBootstrapInstallerPath();
      const targetRepoPath = cleanLine(url.searchParams.get("targetRepoPath"), "");
      const command = buildBootstrapCommand(installerPath, targetRepoPath);
      const startPacket = buildBootstrapStartPacket({ installerPath, targetRepoPath });
      return sendJson(res, 200, withContext({
        command,
        startPacket,
        installerPath,
        mode: "existing-project-safe",
        targetRepoPath: targetRepoPath || "$PWD"
      }));
    }

    if (method === "GET" && url.pathname === "/api/master-control") {
      const content = await readText(masterControlPath, "");
      return sendJson(res, 200, withContext({ content, filePath: masterControlPath }));
    }

    if (method === "PUT" && url.pathname === "/api/master-control") {
      const body = parseJson(await readBody(req));
      projectContext = resolveProjectContext(url, body);
      masterControlPath = projectContext.masterControlPath;
      masterPromptPath = projectContext.masterPromptPath;
      if (typeof body.content !== "string") {
        throw new HttpError(400, "Invalid content");
      }
      await writeText(masterControlPath, body.content);
      return sendJson(res, 200, withContext({ ok: true, filePath: masterControlPath }));
    }

    if (method === "POST" && url.pathname === "/api/master-control") {
      const body = parseJson(await readBody(req));
      projectContext = resolveProjectContext(url, body);
      masterControlPath = projectContext.masterControlPath;
      masterPromptPath = projectContext.masterPromptPath;
      const current = await readText(masterControlPath, "");
      const next = appendSummaryBlock(current, body || {});
      await writeText(masterControlPath, next);
      return sendJson(res, 200, withContext({ ok: true, filePath: masterControlPath }));
    }

    if (method === "GET" && url.pathname === "/api/master-prompt") {
      const content = await readText(masterPromptPath, "");
      return sendJson(res, 200, withContext({ content, filePath: masterPromptPath }));
    }

    if (method === "PUT" && url.pathname === "/api/master-prompt") {
      const body = parseJson(await readBody(req));
      projectContext = resolveProjectContext(url, body);
      masterControlPath = projectContext.masterControlPath;
      masterPromptPath = projectContext.masterPromptPath;
      if (typeof body.content !== "string") {
        throw new HttpError(400, "Invalid content");
      }
      await writeText(masterPromptPath, body.content);
      return sendJson(res, 200, withContext({ ok: true, filePath: masterPromptPath }));
    }

    if (method === "POST" && url.pathname === "/api/delegation-package") {
      const body = parseJson(await readBody(req));
      projectContext = resolveProjectContext(url, body);
      masterControlPath = projectContext.masterControlPath;
      masterPromptPath = projectContext.masterPromptPath;
      const result = await createDelegationPackage(masterControlPath, body);
      return sendJson(res, 200, withContext(result));
    }

    if (method === "POST" && url.pathname === "/api/delegation-packages/bulk") {
      const body = parseJson(await readBody(req));
      projectContext = resolveProjectContext(url, body);
      masterControlPath = projectContext.masterControlPath;
      masterPromptPath = projectContext.masterPromptPath;
      const result = await createDelegationPackageBatch(masterControlPath, body || {});
      return sendJson(res, 200, withContext(result));
    }

    if (method === "GET" && url.pathname === "/api/delegation-packages") {
      const items = await listDelegationPackages(masterControlPath);
      return sendJson(res, 200, withContext({ items, root: resolveDelegationRoot(masterControlPath) }));
    }

    const detailMatch = url.pathname.match(/^\/api\/delegation-packages\/([^/]+)$/);
    if (method === "GET" && detailMatch) {
      const packageId = decodeURIComponent(detailMatch[1]);
      const detail = await loadPackageDetail(masterControlPath, packageId);
      return sendJson(res, 200, withContext(detail));
    }

    const promptSaveMatch = url.pathname.match(/^\/api\/delegation-packages\/([^/]+)\/prompt$/);
    if (method === "PUT" && promptSaveMatch) {
      const packageId = decodeURIComponent(promptSaveMatch[1]);
      const body = parseJson(await readBody(req));
      projectContext = resolveProjectContext(url, body);
      masterControlPath = projectContext.masterControlPath;
      masterPromptPath = projectContext.masterPromptPath;
      if (typeof body.content !== "string") {
        throw new HttpError(400, "Invalid content");
      }
      const packageDir = resolvePackageDir(masterControlPath, packageId);
      const promptFile = path.join(packageDir, "TARGET_THREAD_PROMPT.md");
      await writeText(promptFile, body.content);
      return sendJson(res, 200, withContext({ ok: true, packageId, promptFile }));
    }

    const metadataSaveMatch = url.pathname.match(/^\/api\/delegation-packages\/([^/]+)\/metadata$/);
    if (method === "PUT" && metadataSaveMatch) {
      const packageId = decodeURIComponent(metadataSaveMatch[1]);
      const body = parseJson(await readBody(req));
      projectContext = resolveProjectContext(url, body);
      masterControlPath = projectContext.masterControlPath;
      masterPromptPath = projectContext.masterPromptPath;
      const result = await updateDelegationPackageMetadata(masterControlPath, packageId, body || {});
      return sendJson(res, 200, withContext(result));
    }

    return sendJson(res, 404, withContext({ error: "Not found" }));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Server error";
    return sendJson(res, status, withContext({ error: message, masterControlPath, masterPromptPath }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`Master Control Ops running on http://localhost:${PORT}\n`);
});
