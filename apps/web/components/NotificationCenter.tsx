"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProjects } from "./ProjectsProvider";
import { toDisplayPreviewUrl } from "../lib/projects";
import { apiRequest } from "../lib/api";
import { postClientDiagnostic } from "../lib/diagnostics-client";
import {
  copyGenerationFailureReport,
  generationFailureCategoryLabel,
  generationFailureForJob
} from "../lib/generation-failure";

const NOTIFICATIONS_STORAGE_KEY = "aidrive:notifications";

type IncidentPromptKind = "triage" | "fix" | "verify";
type IncidentDiagnosticTool = "incident_packet" | "triage_prompt" | "fix_prompt" | "verify_prompt";

type IncidentPromptsPayload = {
  triage: string;
  fix: string;
  verify: string;
};

function formatRelativeTime(iso: string): string {
  const deltaMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(deltaMs)) return "now";
  const minutes = Math.max(0, Math.floor(deltaMs / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatCompletedTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function stringifySettings(settings: Record<string, string | number | boolean>): string {
  try {
    return JSON.stringify(settings, null, 2);
  } catch {
    return "{}";
  }
}

function stringifyUnknown(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function normalizeIncidentPrompts(input: unknown): IncidentPromptsPayload | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<IncidentPromptsPayload>;
  const triage = typeof raw.triage === "string" ? raw.triage.trim() : "";
  const fix = typeof raw.fix === "string" ? raw.fix.trim() : "";
  const verify = typeof raw.verify === "string" ? raw.verify.trim() : "";
  if (!triage || !fix || !verify) return null;
  return { triage, fix, verify };
}

function incidentPromptLabel(kind: IncidentPromptKind): string {
  if (kind === "triage") return "Triage";
  if (kind === "fix") return "Fix";
  return "Verify";
}

function incidentPromptTool(kind: IncidentPromptKind): IncidentDiagnosticTool {
  if (kind === "triage") return "triage_prompt";
  if (kind === "fix") return "fix_prompt";
  return "verify_prompt";
}

function incidentToolLabel(tool: IncidentDiagnosticTool): string {
  if (tool === "incident_packet") return "Incident packet";
  if (tool === "triage_prompt") return "Triage prompt";
  if (tool === "fix_prompt") return "Fix prompt";
  return "Verify prompt";
}

export function NotificationCenter() {
  const {
    notifications,
    unreadNotificationCount,
    folders,
    assets,
    jobs,
    selectProject,
    setSidebarFocusFolder,
    openAsset,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    clearAllNotifications,
    dismissNotification
  } = useProjects();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expandedNotificationId, setExpandedNotificationId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [markAllFeedback, setMarkAllFeedback] = useState<string | null>(null);
  const [pushToasts, setPushToasts] = useState<Array<{ id: string; notificationId: string; kind: "GENERATION_SUCCEEDED" | "GENERATION_FAILED" | "SUBMIT_FAILED" }>>([]);
  const [bellRinging, setBellRinging] = useState(false);
  const [animatingNotificationIds, setAnimatingNotificationIds] = useState<Set<string>>(new Set());
  const [removingNotificationIds, setRemovingNotificationIds] = useState<Set<string>>(new Set());
  const incidentPromptsCacheRef = useRef<Map<string, IncidentPromptsPayload>>(new Map());
  const [lastCopiedToolByIncident, setLastCopiedToolByIncident] = useState<Record<string, IncidentDiagnosticTool>>({});
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const hasPrimedNotificationsRef = useRef(false);

  useEffect(() => {
    const seen = seenNotificationIdsRef.current;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (!item || typeof item !== "object") continue;
              const id = (item as { id?: unknown }).id;
              if (typeof id === "string" && id.length > 0) {
                seen.add(id);
              }
            }
          }
        }
      } catch {
        // Ignore parse failures.
      }
    }
    hasPrimedNotificationsRef.current = true;
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      const node = wrapRef.current;
      const target = event.target as Node | null;
      if (!node || (target && node.contains(target))) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );
  const jobById = useMemo(
    () => new Map(jobs.map((job) => [job.id, job])),
    [jobs]
  );
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets]
  );

  useEffect(() => {
    const seen = seenNotificationIdsRef.current;
    if (!hasPrimedNotificationsRef.current) {
      return;
    }
    for (const notification of notifications) {
      if (seen.has(notification.id)) continue;
      seen.add(notification.id);
      const toastKind = notification.kind;
      if (toastKind !== "GENERATION_SUCCEEDED" && toastKind !== "GENERATION_FAILED" && toastKind !== "SUBMIT_FAILED") {
        continue;
      }
      if (notification.read) {
        continue;
      }
      const toastId = `${notification.id}:${Date.now()}`;
      if (open) {
        setAnimatingNotificationIds((prev) => {
          const next = new Set(prev);
          next.add(notification.id);
          return next;
        });
        window.setTimeout(() => {
          setAnimatingNotificationIds((prev) => {
            const next = new Set(prev);
            next.delete(notification.id);
            return next;
          });
        }, 760);
      }
      if (toastKind === "GENERATION_SUCCEEDED") {
        setBellRinging(true);
        window.setTimeout(() => setBellRinging(false), 850);
      }
      if (open) {
        continue;
      }
      setPushToasts((prev) => [...prev, { id: toastId, notificationId: notification.id, kind: toastKind }].slice(-4));
      window.setTimeout(() => {
        setPushToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, 5000);
    }
  }, [notifications, open]);

  function onOpenNotification(notificationId: string): void {
    const notification = notifications.find((item) => item.id === notificationId);
    if (!notification) return;
    markNotificationRead(notification.id);
    if (notification.folderId) {
      selectProject(notification.folderId);
      setSidebarFocusFolder();
    }
    if (notification.imageAssetId) {
      const asset = assetById.get(notification.imageAssetId);
      if (asset) {
        if (pathname !== "/") {
          router.push("/");
        }
        void openAsset(asset);
      }
    }
    setOpen(false);
  }

  function onOpenToastNotification(toastId: string, notificationId: string): void {
    setPushToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    onOpenNotification(notificationId);
  }

  function showCopyFeedback(message: string): void {
    setCopyFeedback(message);
    window.setTimeout(() => setCopyFeedback(null), 2200);
  }

  function rememberCopiedTool(incidentId: string, tool: IncidentDiagnosticTool): void {
    setLastCopiedToolByIncident((prev) => {
      if (prev[incidentId] === tool) return prev;
      return { ...prev, [incidentId]: tool };
    });
  }

  function emitIncidentToolUsage(
    incidentId: string,
    tool: IncidentDiagnosticTool,
    outcome: "success" | "error"
  ): void {
    void postClientDiagnostic({
      severity: outcome === "success" ? "INFO" : "WARN",
      category: "CLIENT",
      component: "web.notification_center",
      eventName: "diagnostics.tool.used",
      message: outcome === "success"
        ? `Operator used ${incidentToolLabel(tool)}`
        : `Operator attempted ${incidentToolLabel(tool)} but copy failed`,
      workspaceId: "ws_demo",
      context: {
        incidentId,
        tool,
        outcome,
        source: "notification_center"
      }
    });
  }

  function emitIncidentToolFeedback(
    incidentId: string,
    tool: IncidentDiagnosticTool,
    helpful: boolean,
    improvementSuggestion: string | null
  ): void {
    void postClientDiagnostic({
      severity: helpful ? "INFO" : "WARN",
      category: "CLIENT",
      component: "web.notification_center",
      eventName: "diagnostics.tool.feedback",
      message: helpful
        ? `Operator marked ${incidentToolLabel(tool)} as helpful`
        : `Operator marked ${incidentToolLabel(tool)} as needing improvement`,
      workspaceId: "ws_demo",
      context: {
        incidentId,
        tool,
        helpful,
        improvementSuggestion: improvementSuggestion ?? null,
        source: "notification_center"
      }
    });
  }

  async function loadIncidentPrompts(incidentId: string): Promise<IncidentPromptsPayload | null> {
    const cached = incidentPromptsCacheRef.current.get(incidentId);
    if (cached) return cached;
    const response = await apiRequest<{ prompts?: unknown }>(
      `/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}/prompts`
    );
    const prompts = normalizeIncidentPrompts(response.prompts);
    if (!prompts) return null;
    incidentPromptsCacheRef.current.set(incidentId, prompts);
    return prompts;
  }

  async function copyIncidentPacket(notificationId: string, incidentId: string): Promise<void> {
    try {
      const response = await apiRequest<{ packet?: string }>(
        `/v1/diagnostics/incidents/${encodeURIComponent(incidentId)}/packet`
      );
      const packet = typeof response.packet === "string" ? response.packet : "";
      if (!packet) {
        showCopyFeedback("Incident packet was empty.");
        return;
      }
      await navigator.clipboard.writeText(packet);
      markNotificationRead(notificationId);
      rememberCopiedTool(incidentId, "incident_packet");
      emitIncidentToolUsage(incidentId, "incident_packet", "success");
      showCopyFeedback("Incident packet copied for Codex.");
    } catch {
      emitIncidentToolUsage(incidentId, "incident_packet", "error");
      showCopyFeedback("Could not copy incident packet.");
    }
  }

  async function copyIncidentPrompt(
    notificationId: string,
    incidentId: string,
    kind: IncidentPromptKind
  ): Promise<void> {
    const tool = incidentPromptTool(kind);
    try {
      const prompts = await loadIncidentPrompts(incidentId);
      if (!prompts) {
        emitIncidentToolUsage(incidentId, tool, "error");
        showCopyFeedback("Incident prompts were unavailable.");
        return;
      }
      const prompt = prompts[kind];
      if (!prompt) {
        emitIncidentToolUsage(incidentId, tool, "error");
        showCopyFeedback(`${incidentPromptLabel(kind)} prompt was empty.`);
        return;
      }
      await navigator.clipboard.writeText(prompt);
      markNotificationRead(notificationId);
      rememberCopiedTool(incidentId, tool);
      emitIncidentToolUsage(incidentId, tool, "success");
      showCopyFeedback(`${incidentPromptLabel(kind)} prompt copied for Codex.`);
    } catch {
      emitIncidentToolUsage(incidentId, tool, "error");
      showCopyFeedback(`Could not copy ${incidentPromptLabel(kind).toLowerCase()} prompt.`);
    }
  }

  function submitIncidentToolFeedback(notificationId: string, incidentId: string, helpful: boolean): void {
    const tool = lastCopiedToolByIncident[incidentId];
    if (!tool) {
      showCopyFeedback("Copy a packet or prompt first so feedback can be tied to a tool.");
      return;
    }
    let improvementSuggestion: string | null = null;
    if (!helpful) {
      const response = window.prompt("How could this tool be improved? (Optional)");
      if (response === null) return;
      const normalized = response.trim();
      improvementSuggestion = normalized.length > 0 ? normalized.slice(0, 280) : null;
    }
    markNotificationRead(notificationId);
    emitIncidentToolFeedback(incidentId, tool, helpful, improvementSuggestion);
    if (helpful) {
      showCopyFeedback(`${incidentToolLabel(tool)} marked helpful.`);
      return;
    }
    showCopyFeedback("Improvement feedback saved.");
  }

  function iconForNotification(kind: string, previewUrl?: string | null): ReactNode {
    const normalized = previewUrl ? toDisplayPreviewUrl(previewUrl) : null;
    if (normalized) {
      return <img src={normalized} alt="Generated image icon" className="notification-item-icon-image" />;
    }
    if (kind === "GENERATION_SUCCEEDED") return <span aria-hidden="true">🖼️</span>;
    if (kind === "GENERATION_FAILED") return <span aria-hidden="true">⚠️</span>;
    if (kind === "SYSTEM_INCIDENT") return <span aria-hidden="true">🛠️</span>;
    return <span aria-hidden="true">🔔</span>;
  }

  function dismissNotificationAnimated(notificationId: string): void {
    setRemovingNotificationIds((prev) => {
      if (prev.has(notificationId)) return prev;
      const next = new Set(prev);
      next.add(notificationId);
      return next;
    });
    window.setTimeout(() => {
      dismissNotification(notificationId);
      setRemovingNotificationIds((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    }, 420);
  }

  return (
    <div className="notification-wrap" ref={wrapRef}>
      <button
        className={`notification-bell ${open ? "open" : ""}`}
        data-ring={bellRinging ? "1" : "0"}
        type="button"
        aria-label="Notifications"
        onClick={() => {
          setPushToasts([]);
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true">🔔</span>
        {unreadNotificationCount > 0 ? (
          <span className="notification-badge">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span>
        ) : null}
      </button>

      {open ? (
        <section className="notification-panel" aria-label="Notification list">
          <header className="notification-head">
            <button
              className="btn notification-action-btn notification-clear-all"
              type="button"
              aria-label="Clear all notifications"
              onClick={() => {
                if (notifications.length > 0) {
                  clearAllNotifications();
                  setMarkAllFeedback("All notifications cleared.");
                } else {
                  setMarkAllFeedback("No notifications to clear.");
                }
                window.setTimeout(() => setMarkAllFeedback(null), 2200);
              }}
            >
              <span className="notification-action-glyph" aria-hidden="true">🗑</span>
              <span className="notification-action-text">Clear all</span>
            </button>
            <strong>Notifications</strong>
            <button
              className="btn notification-action-btn notification-mark-all"
              type="button"
              aria-label="Mark all notifications as read"
              onClick={() => {
                if (unreadNotificationCount > 0) {
                  markAllNotificationsRead();
                  setMarkAllFeedback("All notifications marked as read.");
                } else {
                  setMarkAllFeedback("All notifications already read.");
                }
                window.setTimeout(() => setMarkAllFeedback(null), 2200);
              }}
            >
              <span className="notification-action-glyph" aria-hidden="true">✓</span>
              <span className="notification-action-text">Mark all as read</span>
            </button>
          </header>
          {copyFeedback ? <p className="muted">{copyFeedback}</p> : null}
          {markAllFeedback ? <p className="muted">{markAllFeedback}</p> : null}

          {notifications.length === 0 ? (
            <p className="muted">No notifications yet.</p>
          ) : (
            <div className="notification-list">
              {notifications.map((notification) => {
                const folderName = notification.folderId ? folderNameById.get(notification.folderId) : null;
                const job = notification.jobId ? jobById.get(notification.jobId) : undefined;
                const assetPreviewUrl = notification.imageAssetId
                  ? assetById.get(notification.imageAssetId)?.previewUrl
                  : null;
                const effectivePreviewUrl = notification.imagePreviewUrl ?? assetPreviewUrl ?? null;
                const hasDiagnostics = Boolean(job && (job.status === "FAILED" || job.status === "CANCELED"));
                const failure = hasDiagnostics && job ? generationFailureForJob(job) : null;
                const isGenerationSuccess = notification.kind === "GENERATION_SUCCEEDED";
                const isUnread = !notification.read;
                const isFailureNotification = notification.kind === "GENERATION_FAILED" || notification.kind === "SUBMIT_FAILED";
                const isSystemIncident = notification.kind === "SYSTEM_INCIDENT";
                const model = job?.request.model ?? null;
                const aspectRatio = typeof job?.request.settings.aspectRatio === "string" ? job.request.settings.aspectRatio : null;
                const resolution = typeof job?.request.settings.resolution === "string" ? job.request.settings.resolution : null;
                const expanded = expandedNotificationId === notification.id;
                return (
                  <article
                    key={notification.id}
                    className={`notification-item ${isUnread ? "unread" : "read"} ${isGenerationSuccess && isUnread ? "notification-item-success" : ""} ${animatingNotificationIds.has(notification.id) ? "notification-item-enter" : ""} ${removingNotificationIds.has(notification.id) ? "notification-item-removing" : ""}`}
                    onClick={() => onOpenNotification(notification.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onOpenNotification(notification.id);
                    }}
                  >
                    <div className="notification-item-main">
                      <div className="notification-item-icon">
                        {iconForNotification(notification.kind, effectivePreviewUrl)}
                      </div>
                      <div className="notification-item-content">
                        <div className="notification-item-head">
                          <strong className={isGenerationSuccess ? "notification-title-success" : ""}>
                            {isGenerationSuccess ? <span className="notification-success-check" aria-hidden="true">✓</span> : null}
                            {notification.title}
                          </strong>
                          <small className="muted">{formatRelativeTime(notification.createdAt)}</small>
                        </div>
                        {notification.imageName ? <p className="notification-image-name">{notification.imageName}</p> : null}
                        {folderName ? <small className="muted">Folder: {folderName}</small> : null}
                        {model ? (
                          <small className="muted">
                            {model}
                            {aspectRatio ? ` · ${aspectRatio}` : ""}
                            {resolution ? ` · ${resolution}` : ""}
                          </small>
                        ) : (
                          <p>{notification.message}</p>
                        )}
                        {isSystemIncident ? (
                          <small className="muted">
                            Severity: {notification.severity ?? "WARN"} · Cause: {notification.causeStatus ?? "UNKNOWN"}
                          </small>
                        ) : null}
                        {isSystemIncident && notification.incidentId ? (
                          <div className="notification-diagnostics-actions">
                            <button
                              className="btn"
                              type="button"
                              onClick={async (event) => {
                                event.stopPropagation();
                                await copyIncidentPacket(notification.id, notification.incidentId ?? "");
                              }}
                            >
                              Copy incident packet
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={async (event) => {
                                event.stopPropagation();
                                await copyIncidentPrompt(notification.id, notification.incidentId ?? "", "triage");
                              }}
                            >
                              Copy triage prompt
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={async (event) => {
                                event.stopPropagation();
                                await copyIncidentPrompt(notification.id, notification.incidentId ?? "", "fix");
                              }}
                            >
                              Copy fix prompt
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={async (event) => {
                                event.stopPropagation();
                                await copyIncidentPrompt(notification.id, notification.incidentId ?? "", "verify");
                              }}
                            >
                              Copy verify prompt
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                submitIncidentToolFeedback(notification.id, notification.incidentId ?? "", true);
                              }}
                            >
                              Helpful
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                submitIncidentToolFeedback(notification.id, notification.incidentId ?? "", false);
                              }}
                            >
                              Needs improvement
                            </button>
                          </div>
                        ) : null}
                        {isGenerationSuccess ? (
                          <small className="muted">Completed: {formatCompletedTime(notification.createdAt)}</small>
                        ) : null}
                      </div>
                    </div>
                    {hasDiagnostics && job && failure ? (
                      <div className="notification-diagnostics-actions">
                        <button
                          className="btn"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedNotificationId((current) => current === notification.id ? null : notification.id);
                          }}
                        >
                          {expanded ? "Hide details" : "Why this failed"}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={async (event) => {
                            event.stopPropagation();
                            try {
                              await copyGenerationFailureReport(job, { folderName });
                              markNotificationRead(notification.id);
                              setCopyFeedback("Diagnostics copied. Paste it into chat.");
                              window.setTimeout(() => setCopyFeedback(null), 2200);
                            } catch {
                              setCopyFeedback("Could not copy diagnostics.");
                              window.setTimeout(() => setCopyFeedback(null), 2200);
                            }
                          }}
                        >
                          Copy for Codex
                        </button>
                      </div>
                    ) : null}
                    {expanded && hasDiagnostics && job && failure ? (
                      <div className="notification-diagnostics">
                        <small>Category: {generationFailureCategoryLabel(failure.category)}</small>
                        <small>Fix: {failure.suggestedFix}</small>
                        <small>Provider: {failure.provider}{failure.statusCode ? ` · HTTP ${failure.statusCode}` : ""}{failure.errorCode ? ` · ${failure.errorCode}` : ""}</small>
                      </div>
                    ) : null}
                    <div className="notification-item-actions">
                      {isFailureNotification ? (
                        <button
                          className="btn notification-action-btn notification-copy-one"
                          type="button"
                          aria-label="Copy failure details"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const lines: string[] = [
                              "AI Drive Failure Report",
                              `Notification ID: ${notification.id}`,
                              `Kind: ${notification.kind}`,
                              `Title: ${notification.title}`,
                              `Message: ${notification.message}`,
                              `Created At: ${notification.createdAt}`,
                              `Read: ${notification.read ? "yes" : "no"}`,
                              `Folder Name: ${folderName ?? "(none)"}`,
                              `Folder ID: ${notification.folderId ?? "(none)"}`,
                              `Image Name: ${notification.imageName ?? "(none)"}`,
                              `Image Asset ID: ${notification.imageAssetId ?? "(none)"}`,
                              `Job ID: ${notification.jobId ?? "(none)"}`
                            ];
                            if (job) {
                              lines.push(
                                "",
                                "Job",
                                `Status: ${job.status}`,
                                `Created At: ${job.createdAt}`,
                                `Error: ${job.error ?? "(none)"}`,
                                "",
                                "Request",
                                `Type: ${job.request.type}`,
                                `Model: ${job.request.model}`,
                                `Prompt: ${job.request.prompt}`,
                                `Negative Prompt: ${job.request.negativePrompt ?? "(none)"}`,
                                `Settings: ${stringifySettings(job.request.settings)}`
                              );
                            }
                            if (failure) {
                              lines.push(
                                "",
                                "Failure Analysis",
                                `Category: ${generationFailureCategoryLabel(failure.category)} (${failure.category})`,
                                `Provider: ${failure.provider}`,
                                `Status Code: ${failure.statusCode ?? "(none)"}`,
                                `Error Code: ${failure.errorCode ?? "(none)"}`,
                                `User Message: ${failure.userMessage}`,
                                `Suggested Fix: ${failure.suggestedFix}`,
                                `Retryable: ${failure.retryable ? "yes" : "no"}`,
                                `Raw Message: ${failure.rawMessage || "(none)"}`,
                                `Debug Context: ${stringifyUnknown(failure.debugContext)}`
                              );
                            }
                            try {
                              await navigator.clipboard.writeText(lines.join("\n"));
                              markNotificationRead(notification.id);
                              setCopyFeedback("Failure details copied.");
                              window.setTimeout(() => setCopyFeedback(null), 2200);
                            } catch {
                              setCopyFeedback("Could not copy failure details.");
                              window.setTimeout(() => setCopyFeedback(null), 2200);
                            }
                          }}
                        >
                          <span className="notification-action-glyph" aria-hidden="true">⧉</span>
                          <span className="notification-action-text">Copy error</span>
                        </button>
                      ) : null}
                      <button
                        className="btn notification-action-btn notification-clear-one"
                        type="button"
                        aria-label="Clear notification"
                        onClick={(event) => {
                          event.stopPropagation();
                          dismissNotificationAnimated(notification.id);
                        }}
                      >
                        <span className="notification-action-glyph" aria-hidden="true">🗑</span>
                        <span className="notification-action-text">Clear</span>
                      </button>
                      <button
                        className="btn notification-action-btn notification-mark-one"
                        type="button"
                        aria-label={notification.read ? "Mark notification as unread" : "Mark notification as read"}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (notification.read) {
                            markNotificationUnread(notification.id);
                          } else {
                            markNotificationRead(notification.id);
                          }
                        }}
                      >
                        <span className="notification-action-glyph" aria-hidden="true">{notification.read ? "↺" : "✓"}</span>
                        <span className="notification-action-text">{notification.read ? "Mark unread" : "Mark read"}</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {pushToasts.length > 0 ? (
        <div className="push-toast-stack" aria-live="polite" aria-atomic="false">
          {pushToasts.map((toast) => {
            const notification = notifications.find((item) => item.id === toast.notificationId);
            if (!notification) return null;
            const previewSource = notification.imagePreviewUrl ??
              (notification.imageAssetId ? assetById.get(notification.imageAssetId)?.previewUrl ?? null : null);
            const preview = previewSource ? toDisplayPreviewUrl(previewSource) : null;
            return (
              <article
                key={toast.id}
                className={`push-toast push-toast-${toast.kind === "GENERATION_SUCCEEDED" ? "ok" : "error"}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpenToastNotification(toast.id, notification.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpenToastNotification(toast.id, notification.id);
                }}
              >
                <div className="push-toast-icon-wrap">
                  {preview ? (
                    <img src={preview} alt={notification.imageName ?? "Generated image"} className="push-toast-icon" />
                  ) : (
                    <span className="push-toast-fallback" aria-hidden="true">
                      {toast.kind === "GENERATION_SUCCEEDED" ? "🖼️" : "⚠️"}
                    </span>
                  )}
                </div>
                <div className="push-toast-copy">
                  <strong className={toast.kind === "GENERATION_SUCCEEDED" ? "notification-title-success" : ""}>
                    {toast.kind === "GENERATION_SUCCEEDED" ? <span className="notification-success-check" aria-hidden="true">✓</span> : null}
                    {notification.title}
                  </strong>
                  <span>{notification.imageName ?? "Image unavailable"}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
