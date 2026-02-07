"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { type GeneratePanelState } from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

type ModelKey = "gemini-2.0-flash" | "nano-banana-pro" | "nano-banana" | "a2e";
const PROMPT_STORAGE_KEY = "aidrive:generatePrompt";

const MODEL_OPTIONS: Array<{ key: ModelKey; label: string; apiModel: string; resolutions: string[] }> = [
  { key: "gemini-2.0-flash", label: "Gemini 2.0 Flash", apiModel: "Gemini 2.0 flash", resolutions: ["1K"] },
  { key: "nano-banana-pro", label: "Nano Banana Pro", apiModel: "nano banana pro", resolutions: ["1K", "2K", "4K"] },
  { key: "nano-banana", label: "Nano Banana", apiModel: "nano banana", resolutions: ["1K"] },
  { key: "a2e", label: "A2E", apiModel: "A2E Image generator", resolutions: ["1K", "2K", "4K"] }
];

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

export function GlobalGeneratePanel() {
  const { folders, selectedProjectId, selectedProject, selectProject, setCreateModalOpen, refreshAssets, refreshJobs } = useProjects();
  const [promptLoaded, setPromptLoaded] = useState(false);
  const [modelKey, setModelKey] = useState<ModelKey>("gemini-2.0-flash");
  const [panelState, setPanelState] = useState<GeneratePanelState>({
    prompt: "",
    model: "Gemini 2.0 Flash",
    type: "IMAGE",
    aspectRatio: "1:1",
    resolution: "1K",
    targetProjectId: null,
    canSubmit: false,
    error: null
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const model = useMemo(() => MODEL_OPTIONS.find((item) => item.key === modelKey) ?? MODEL_OPTIONS[0], [modelKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(PROMPT_STORAGE_KEY);
      if (stored) {
        setPanelState((prev) => ({
          ...prev,
          prompt: stored,
          canSubmit: Boolean(stored.trim() && (selectedProjectId ?? prev.targetProjectId) && !submitting)
        }));
      }
    } catch {
      // Ignore storage read failures.
    }
    setPromptLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!promptLoaded || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PROMPT_STORAGE_KEY, panelState.prompt);
    } catch {
      // Ignore storage write failures.
    }
  }, [panelState.prompt, promptLoaded]);

  useEffect(() => {
    setPanelState((prev) => {
      const nextResolution = model.resolutions.includes(prev.resolution) ? prev.resolution : model.resolutions[0];
      const nextTarget = selectedProjectId ?? prev.targetProjectId;
      const canSubmit = Boolean(nextTarget && prev.prompt.trim() && !submitting);
      return {
        ...prev,
        model: model.apiModel,
        resolution: nextResolution,
        targetProjectId: nextTarget,
        canSubmit,
        error: null
      };
    });
  }, [modelKey, selectedProjectId, model, submitting]);

  const canSubmit = panelState.canSubmit;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || !panelState.targetProjectId) return;

    setSubmitting(true);
    setMessage(null);

    try {
      await apiRequest("/v1/generation/jobs", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: "ws_demo",
          folderId: panelState.targetProjectId,
          prompt: panelState.prompt.trim(),
          model: panelState.model,
          type: panelState.type,
          settings: {
            quality: panelState.resolution,
            resolution: panelState.resolution,
            aspectRatio: panelState.aspectRatio
          }
        })
      });

      setMessage(`Queued in ${selectedProject?.name ?? "selected project"}`);

      setTimeout(() => {
        void refreshAssets({ silent: true });
        void refreshJobs({ silent: true });
      }, 700);
    } catch (e) {
      setPanelState((prev) => ({ ...prev, error: e instanceof Error ? e.message : "Failed to submit generation" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <footer className="generate-dock-wrap">
      <form className="generate-dock" onSubmit={onSubmit}>
        <div className="dock-top">
          <input
            className="dock-prompt"
            placeholder="Describe the scene you imagine"
            value={panelState.prompt}
            onChange={(e) => {
              const prompt = e.target.value;
              setPanelState((prev) => ({
                ...prev,
                prompt,
                canSubmit: Boolean(prompt.trim() && (selectedProjectId ?? prev.targetProjectId) && !submitting)
              }));
            }}
          />
        </div>

        <div className="dock-controls">
          <select className="dock-chip" value={modelKey} onChange={(e) => setModelKey(e.target.value as ModelKey)}>
            {MODEL_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>

          <select
            className="dock-chip"
            value={panelState.aspectRatio}
            onChange={(e) => setPanelState((prev) => ({ ...prev, aspectRatio: e.target.value }))}
          >
            {ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
          </select>

          <select
            className="dock-chip"
            value={panelState.resolution}
            onChange={(e) => setPanelState((prev) => ({ ...prev, resolution: e.target.value }))}
          >
            {model.resolutions.map((res) => <option key={res} value={res}>{res}</option>)}
          </select>

          <select
            className="dock-chip"
            value={selectedProjectId ?? ""}
            onChange={(e) => {
              if (e.target.value) {
                selectProject(e.target.value);
                setPanelState((prev) => ({ ...prev, targetProjectId: e.target.value, canSubmit: Boolean(prev.prompt.trim()) }));
              }
            }}
            disabled={folders.length === 0}
          >
            <option value="">Target Project</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>

          <button className="dock-chip" type="button" onClick={() => setCreateModalOpen(true)}>+ Project</button>
        </div>

        <div className="dock-submit">
          {folders.length === 0 ? (
            <p className="dock-note">Create your first project to unlock generation.</p>
          ) : (
            <p className="dock-note">
              Target: {selectedProject?.name ?? "None"} · {panelState.aspectRatio} · {panelState.resolution}
            </p>
          )}

          <button className="generate-btn" type="submit" disabled={!canSubmit || submitting}>
            {submitting ? "Generating..." : "Generate ✨8"}
          </button>
        </div>
      </form>

      {panelState.error ? <p className="error dock-feedback">{panelState.error}</p> : null}
      {message ? <p className="success dock-feedback">{message}</p> : null}
    </footer>
  );
}
