"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useProjects } from "./ProjectsProvider";

export function CreateProjectModal() {
  const { folders, createModalOpen, setCreateModalOpen, createProject } = useProjects();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const forceCreate = folders.length === 0;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (createModalOpen && !name) {
      setName("Project 01");
    }
  }, [createModalOpen, name]);

  useEffect(() => {
    if (!createModalOpen) return;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [createModalOpen]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const createdId = await createProject(name);
    setBusy(false);
    if (createdId) {
      setName("");
      setCreateModalOpen(false);
    }
  }

  if (!createModalOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setCreateModalOpen(false)}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3>{forceCreate ? "Create your first project" : "Create new project"}</h3>
        <p className="muted">A project is a target folder for generated outputs.</p>

        <form onSubmit={onSubmit} className="modal-form">
          <input
            ref={inputRef}
            className="input"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />

          <div className="modal-actions">
            <button className="btn" type="button" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
