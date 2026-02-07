"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { readDraggedAssetIds } from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

export function ProjectSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { folders, selectedProjectId, selectProject, setCreateModalOpen, moveItemsToFolder } = useProjects();
  const [dropProjectId, setDropProjectId] = useState<string | null>(null);

  function openProject(projectId: string) {
    selectProject(projectId);
    if (pathname !== "/") {
      router.push("/");
    }
  }

  return (
    <div className="sidebar-card">
      <div className="sidebar-brand">
        <span className="brand-dot" aria-hidden="true" />
        <div>
          <h1>AI Drive</h1>
          <p>Project Dashboard</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link className={pathname === "/" ? "active" : ""} href="/">Dashboard</Link>
        <Link className={pathname === "/drive" ? "active" : ""} href="/drive">Drive</Link>
      </nav>

      <div className="sidebar-projects">
        <div className="sidebar-projects-head">
          <strong>Projects</strong>
          <button className="chip-btn" onClick={() => setCreateModalOpen(true)}>+ New</button>
        </div>

        {folders.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          folders.map((folder) => (
            <button
              key={folder.id}
              className={`project-link ${folder.id === selectedProjectId ? "selected" : ""} ${dropProjectId === folder.id ? "drop-target" : ""}`}
              onClick={() => openProject(folder.id)}
              onDragOver={(event) => {
                event.preventDefault();
                setDropProjectId(folder.id);
              }}
              onDragLeave={() => setDropProjectId((current) => (current === folder.id ? null : current))}
              onDrop={(event) => {
                const ids = readDraggedAssetIds(event);
                if (ids.length === 0) return;
                event.preventDefault();
                setDropProjectId(null);
                void moveItemsToFolder(ids, folder.id);
              }}
            >
              <span>{folder.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
