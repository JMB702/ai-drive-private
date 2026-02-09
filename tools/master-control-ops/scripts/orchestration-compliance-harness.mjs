import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { evaluateTaskPacketCompliance } from "../harness/packet-policy.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPS_DIR = path.resolve(__dirname, "..");
const REPLAY_CASES_FILE = path.join(OPS_DIR, "harness", "replay-cases.json");

function logResult(ok, label, detail = "") {
  if (ok) {
    process.stdout.write(`[PASS] ${label}\n`);
    return;
  }
  const suffix = detail ? ` :: ${detail}` : "";
  process.stdout.write(`[FAIL] ${label}${suffix}\n`);
}

function fail(message) {
  throw new Error(message);
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve dynamic port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function ensureReady(baseUrl, projectRoot, attempts = 40) {
  const encodedProjectRoot = encodeURIComponent(projectRoot);
  const url = `${baseUrl}/api/master-control?projectRoot=${encodedProjectRoot}`;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  fail("Master Control Ops server did not become ready in time.");
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    fail(`Invalid JSON response from ${url}`);
  }
  if (!response.ok) {
    const message = payload && payload.error ? payload.error : `Request failed (${response.status})`;
    fail(`${message} [${response.status}]`);
  }
  return payload;
}

function violationIds(result) {
  return (result.violations || []).map((item) => item.id).sort();
}

function assertExactViolationSet(result, expectedIds, label) {
  const actual = violationIds(result);
  const expected = [...expectedIds].sort();
  const matches = actual.length === expected.length && actual.every((id, index) => id === expected[index]);
  logResult(matches, label, `expected=${expected.join(",")} actual=${actual.join(",")}`);
  if (!matches) {
    fail(`Replay mismatch for ${label}`);
  }
}

async function loadReplayCases() {
  const raw = await readFile(REPLAY_CASES_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    fail("Replay cases file must be an array.");
  }
  return parsed;
}

async function writeSeedProject(projectRoot) {
  const masterControlPath = path.join(projectRoot, "docs", "master-control.md");
  const masterPromptPath = path.join(projectRoot, "MASTER_CONTROL_HANDOFF.md");
  await writeFile(
    masterControlPath,
    [
      "# Master Control",
      "",
      "## Thread Map",
      "- `Project manager`",
      "- `Orchestration Compliance Harness`",
      "",
      "## Thread Summaries (Optional Read)",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(masterPromptPath, "# Canonical Main Thread Handoff\n", "utf8");
  return { masterControlPath, masterPromptPath };
}

async function run() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "mc-ops-harness-"));
  const projectRoot = path.join(tempRoot, "project");
  const docsRoot = path.join(projectRoot, "docs");
  await mkdir(docsRoot, { recursive: true });

  const { masterControlPath } = await writeSeedProject(projectRoot);

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const encodedProjectRoot = encodeURIComponent(projectRoot);

  const serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: OPS_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      MASTER_CONTROL_PATH: masterControlPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stderrChunks = [];
  serverProcess.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  try {
    await ensureReady(baseUrl, projectRoot);
    logResult(true, "server-ready", `${baseUrl}`);

    const createPayload = {
      title: "Packet-first orchestration compliance harness smoke",
      targetThread: "Orchestration Compliance Harness",
      problem: "Validate packet-first orchestration handoff behavior.",
      fullPrompt: "Build deterministic checks for packet-first handoff output.",
      doneCriteria: "Harness emits explicit pass/fail output.",
      reportBack: "Append a concise completion summary entry."
    };

    const createResponse = await requestJson(`${baseUrl}/api/delegation-package?projectRoot=${encodedProjectRoot}`, {
      method: "POST",
      body: JSON.stringify(createPayload)
    });

    const createThreadSuggestionOk =
      createResponse.threadSuggestion &&
      createResponse.threadSuggestion.recommendationType === "exact" &&
      createResponse.threadSuggestion.shouldCreate === false;
    logResult(createThreadSuggestionOk, "create-thread-suggestion-exact");
    if (!createThreadSuggestionOk) {
      fail("Focused request did not resolve to exact thread suggestion.");
    }

    const createCompliance = evaluateTaskPacketCompliance(createResponse.taskPacket, {
      packageId: createResponse.packageId,
      masterControlPath
    });
    logResult(createCompliance.ok, "create-task-packet-policy", violationIds(createCompliance).join(","));
    if (!createCompliance.ok) {
      fail("Created task packet failed policy checks.");
    }

    const dispatchMatchesCreate = createResponse.dispatchPrompt === createResponse.taskPacket;
    logResult(dispatchMatchesCreate, "create-dispatch-matches-task-packet");
    if (!dispatchMatchesCreate) {
      fail("Create response dispatchPrompt does not match taskPacket.");
    }

    const packageId = createResponse.packageId;
    const detailResponse = await requestJson(
      `${baseUrl}/api/delegation-packages/${encodeURIComponent(packageId)}?projectRoot=${encodedProjectRoot}`
    );

    const detailCompliance = evaluateTaskPacketCompliance(detailResponse.taskPacket, {
      packageId,
      masterControlPath
    });
    logResult(detailCompliance.ok, "detail-task-packet-policy", violationIds(detailCompliance).join(","));
    if (!detailCompliance.ok) {
      fail("Loaded task packet failed policy checks.");
    }

    const detailDispatchMatches = detailResponse.dispatchPrompt === detailResponse.taskPacket;
    logResult(detailDispatchMatches, "detail-dispatch-matches-task-packet");
    if (!detailDispatchMatches) {
      fail("Detail response dispatchPrompt does not match taskPacket.");
    }

    const updateResponse = await requestJson(
      `${baseUrl}/api/delegation-packages/${encodeURIComponent(packageId)}/metadata?projectRoot=${encodedProjectRoot}`,
      {
        method: "PUT",
        body: JSON.stringify({
          title: "Packet-first orchestration compliance harness updated",
          targetThread: "Orchestration Compliance Harness",
          problem: "Deterministic replay check coverage.",
          fullPrompt: "Keep packet-first orchestration output stable.",
          doneCriteria: "Reproducible pass/fail checks.",
          reportBack: "Append summary.",
          regeneratePrompt: true
        })
      }
    );

    const updateCompliance = evaluateTaskPacketCompliance(updateResponse.taskPacket, {
      packageId,
      masterControlPath
    });
    logResult(updateCompliance.ok, "update-task-packet-policy", violationIds(updateCompliance).join(","));
    if (!updateCompliance.ok) {
      fail("Updated task packet failed policy checks.");
    }

    const updateDispatchMatches = updateResponse.dispatchPrompt === updateResponse.taskPacket;
    logResult(updateDispatchMatches, "update-dispatch-matches-task-packet");
    if (!updateDispatchMatches) {
      fail("Update response dispatchPrompt does not match taskPacket.");
    }

    const cases = await loadReplayCases();
    let replayCount = 0;
    for (const replayCase of cases) {
      const name = String(replayCase && replayCase.name ? replayCase.name : "").trim();
      const packet = String(replayCase && replayCase.packet ? replayCase.packet : "");
      const context = replayCase && replayCase.context ? replayCase.context : {};
      const expectedViolationIds = Array.isArray(replayCase && replayCase.expectedViolationIds)
        ? replayCase.expectedViolationIds
        : [];
      const compliance = evaluateTaskPacketCompliance(packet, context);
      assertExactViolationSet(compliance, expectedViolationIds, `replay-${name || "unnamed"}`);
      replayCount += 1;
    }

    process.stdout.write(`\nCompliance harness complete: ${replayCount} replay case(s), live API checks passed.\n`);
  } finally {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      serverProcess.once("exit", () => resolve());
      setTimeout(() => resolve(), 500);
    });
    await rm(tempRoot, { recursive: true, force: true });
    if (stderrChunks.length > 0) {
      const merged = stderrChunks.join("").trim();
      if (merged) {
        process.stdout.write(`\n[server-stderr]\n${merged}\n`);
      }
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
