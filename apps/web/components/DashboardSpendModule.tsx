"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { useProjects } from "./ProjectsProvider";

type MediaSpendSummaryResponse = {
  workspaceId: string;
  currency?: string;
  estimated?: boolean;
  pricing?: {
    usdCentsPerCredit?: number;
  };
  totals?: {
    imageCredits?: number;
    videoCredits?: number;
    totalCredits?: number;
    imageUsdCents?: number;
    videoUsdCents?: number;
    totalUsdCents?: number;
    image?: number;
    video?: number;
    total?: number;
  };
  counts?: {
    imageTransactions?: number;
    videoTransactions?: number;
  };
  updatedAt?: string;
};
type MediaSpendSummary = {
  workspaceId: string;
  currency: "USD";
  estimated: boolean;
  pricing: {
    usdCentsPerCredit: number;
  };
  totals: {
    imageCredits: number;
    videoCredits: number;
    totalCredits: number;
    imageUsdCents: number;
    videoUsdCents: number;
    totalUsdCents: number;
  };
  counts: {
    imageTransactions: number;
    videoTransactions: number;
  };
  updatedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function toWholeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function toWholeNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function normalizeSummary(workspaceId: string, payload: unknown): MediaSpendSummary {
  const source = asRecord(payload) ?? {};
  const pricing = asRecord(source.pricing) ?? {};
  const totals = asRecord(source.totals) ?? {};
  const counts = asRecord(source.counts) ?? {};
  const usdCentsPerCredit = Math.max(1, toWholeNumber(pricing.usdCentsPerCredit) || 1);
  const imageCredits = toWholeNumber(totals.imageCredits ?? totals.image);
  const videoCredits = toWholeNumber(totals.videoCredits ?? totals.video);
  const totalCredits = toWholeNumber(totals.totalCredits ?? totals.total);
  const imageUsdCents = toWholeNumberOrNull(totals.imageUsdCents) ?? (imageCredits * usdCentsPerCredit);
  const videoUsdCents = toWholeNumberOrNull(totals.videoUsdCents) ?? (videoCredits * usdCentsPerCredit);
  const totalUsdCents = toWholeNumberOrNull(totals.totalUsdCents) ?? ((imageCredits + videoCredits) * usdCentsPerCredit);
  const resolvedWorkspaceId =
    typeof source.workspaceId === "string" && source.workspaceId.length > 0
      ? source.workspaceId
      : workspaceId;
  const resolvedUpdatedAt =
    typeof source.updatedAt === "string" && source.updatedAt.length > 0
      ? source.updatedAt
      : null;
  return {
    workspaceId: resolvedWorkspaceId,
    currency: "USD",
    estimated: source.estimated !== false,
    pricing: {
      usdCentsPerCredit
    },
    totals: {
      imageCredits,
      videoCredits,
      totalCredits: totalCredits >= imageCredits + videoCredits ? totalCredits : imageCredits + videoCredits,
      imageUsdCents,
      videoUsdCents,
      totalUsdCents: totalUsdCents >= imageUsdCents + videoUsdCents ? totalUsdCents : imageUsdCents + videoUsdCents
    },
    counts: {
      imageTransactions: toWholeNumber(counts.imageTransactions),
      videoTransactions: toWholeNumber(counts.videoTransactions)
    },
    updatedAt: resolvedUpdatedAt
  };
}

function formatCredits(amount: number): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US").format(safeAmount);
}

function formatUsdCents(amount: number): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(safeAmount / 100);
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "just now";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "just now";
  return new Date(timestamp).toLocaleString();
}

export function DashboardSpendModule() {
  const { workspaceId, jobs } = useProjects();
  const [summary, setSummary] = useState<MediaSpendSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const safeWorkspaceId = typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : "ws_demo";

  const jobsRefreshToken = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    let newest = 0;
    for (const job of list) {
      if (!job || typeof job !== "object") continue;
      const updatedAt = typeof job.updatedAt === "string" ? job.updatedAt : undefined;
      const createdAt = typeof job.createdAt === "string" ? job.createdAt : undefined;
      const stamp = Date.parse(updatedAt ?? createdAt ?? "");
      if (Number.isFinite(stamp) && stamp > newest) newest = stamp;
    }
    return `${list.length}:${newest}`;
  }, [jobs]);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary(): Promise<void> {
      if (!hasLoadedRef.current) {
        setLoading(true);
      }

      try {
        const payload = await apiRequest<unknown>(`/v1/billing/${safeWorkspaceId}/media-spend`);
        if (cancelled) return;
        setSummary(normalizeSummary(safeWorkspaceId, payload));
        setLoadError(null);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load spend totals");
      } finally {
        if (cancelled) return;
        hasLoadedRef.current = true;
        setLoading(false);
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [safeWorkspaceId, jobsRefreshToken]);

  const totals = summary?.totals ?? {
    imageCredits: 0,
    videoCredits: 0,
    totalCredits: 0,
    imageUsdCents: 0,
    videoUsdCents: 0,
    totalUsdCents: 0
  };
  const counts = summary?.counts ?? { imageTransactions: 0, videoTransactions: 0 };
  const usdCentsPerCredit = summary?.pricing.usdCentsPerCredit ?? 1;
  const estimated = summary?.estimated ?? true;

  return (
    <div className="dashboard-spend-module">
      <div className="dashboard-spend-head">
        <h3>Media Spend</h3>
        <p>Estimated dollar spend for generated images and videos.</p>
      </div>

      {loading ? <p className="muted">Calculating spend...</p> : null}
      {!loading && loadError ? <p className="muted">Unable to load spend summary right now.</p> : null}

      <div className="dashboard-spend-total" aria-live="polite">
        <span>Total spent</span>
        <strong>{formatUsdCents(totals.totalUsdCents)}</strong>
        <small>{estimated ? "estimated USD" : "USD"}</small>
      </div>

      <div className="dashboard-spend-breakdown">
        <article className="dashboard-spend-item">
          <span>Images</span>
          <strong>{formatUsdCents(totals.imageUsdCents)}</strong>
          <small>{formatCredits(totals.imageCredits)} credits · {counts.imageTransactions} billed job{counts.imageTransactions === 1 ? "" : "s"}</small>
        </article>
        <article className="dashboard-spend-item">
          <span>Videos</span>
          <strong>{formatUsdCents(totals.videoUsdCents)}</strong>
          <small>{formatCredits(totals.videoCredits)} credits · {counts.videoTransactions} billed job{counts.videoTransactions === 1 ? "" : "s"}</small>
        </article>
      </div>

      <p className="dashboard-spend-footnote">Estimated from finalized billing transactions at {formatUsdCents(usdCentsPerCredit)} per credit.</p>
      <p className="dashboard-spend-updated">Updated {formatUpdatedAt(summary?.updatedAt ?? null)}</p>
    </div>
  );
}
