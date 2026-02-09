function findLineValue(packet, prefix) {
  const lines = String(packet || "").split(/\r?\n/);
  for (const rawLine of lines) {
    if (rawLine.startsWith(prefix)) {
      return rawLine.slice(prefix.length).trim();
    }
  }
  return "";
}

function hasRegex(packet, pattern) {
  return pattern.test(String(packet || ""));
}

export function evaluateTaskPacketCompliance(packet, context = {}) {
  const text = String(packet || "");
  const packageId = String(context.packageId || "").trim();
  const masterControlPath = String(context.masterControlPath || "").trim();
  const violations = [];

  if (!hasRegex(text, /^# Task Packet$/m)) {
    violations.push({ id: "missing-header", message: "Missing '# Task Packet' header." });
  }

  if (!hasRegex(text, /^Start now\. Do not stop at analysis\.$/m)) {
    violations.push({ id: "missing-start-now", message: "Missing required start-immediately instruction." });
  }

  if (!hasRegex(text, /^Fetch the latest prompt from Master Control Ops and execute immediately\.$/m)) {
    violations.push({ id: "missing-fetch-latest", message: "Missing packet-first fetch instruction." });
  }

  if (!hasRegex(text, /^Package:\s+\S+/m)) {
    violations.push({ id: "missing-package-line", message: "Missing package identifier line." });
  }

  if (packageId && !hasRegex(text, new RegExp(`^Package:\\s+${packageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"))) {
    violations.push({ id: "package-id-mismatch", message: "Package line does not match expected package ID." });
  }

  const packageApi = findLineValue(text, "Package API:");
  if (!packageApi) {
    violations.push({ id: "missing-package-api", message: "Missing Package API line." });
  } else {
    if (!hasRegex(packageApi, /^https?:\/\//)) {
      violations.push({ id: "invalid-package-api-url", message: "Package API must be an absolute URL." });
    }
    if (packageId && !packageApi.includes(`/api/delegation-packages/${encodeURIComponent(packageId)}`)) {
      violations.push({ id: "package-api-id-mismatch", message: "Package API does not reference expected package ID." });
    }
    if (!/[?&]projectRoot=/.test(packageApi)) {
      violations.push({ id: "missing-project-root-scope", message: "Package API must include projectRoot scoping." });
    }
  }

  if (!hasRegex(text, /^1\.\s+Fetch `prompt` from .+$/m)) {
    violations.push({ id: "missing-action-fetch-step", message: "Missing action step to fetch prompt." });
  }

  if (!hasRegex(text, /^2\.\s+Execute immediately\.$/m)) {
    violations.push({ id: "missing-action-execute-step", message: "Missing action step to execute immediately." });
  }

  if (masterControlPath) {
    const escapedPath = masterControlPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!hasRegex(text, new RegExp(`^3\\.\\s+Append completion summary to ${escapedPath} \\(standard fields\\)\\.$`, "m"))) {
      violations.push({
        id: "summary-path-mismatch",
        message: "Summary append step does not target expected Master Control path."
      });
    }
  } else if (!hasRegex(text, /^3\.\s+Append completion summary to .+ \(standard fields\)\.$/m)) {
    violations.push({ id: "missing-summary-step", message: "Missing summary append step." });
  }

  if (hasRegex(text, /^Target thread:/m)) {
    violations.push({
      id: "target-thread-leak",
      message: "Task Packet must not include destination thread in the packet body."
    });
  }

  if (!hasRegex(text, /^Begin implementation now\.$/m)) {
    violations.push({ id: "missing-begin-line", message: "Missing final begin-implementation line." });
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

