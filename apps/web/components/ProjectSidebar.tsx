"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useProjects } from "./ProjectsProvider";

export function ProjectSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { folders, selectedProjectId, selectProject, setCreateModalOpen } = useProjects();

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
              className={`project-link ${folder.id === selectedProjectId ? "selected" : ""}`}
              onClick={() => openProject(folder.id)}
            >
              <span>{folder.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
