"use client";

import { useState } from "react";
import { readDraggedAssetIds } from "../lib/projects";
import { useProjects } from "./ProjectsProvider";

export function ProjectGrid() {
  const { projectCards, selectProject, setCreateModalOpen, moveItemsToFolder } = useProjects();
  const [dropProjectId, setDropProjectId] = useState<string | null>(null);

  return (
    <div className="project-grid-wrap">
      <button className="project-card new" onClick={() => setCreateModalOpen(true)}>
        <span className="plus">+</span>
        <strong>New Project</strong>
        <small>Create folder/project</small>
      </button>

      {projectCards.map((project) => (
        <button
          key={project.id}
          className={`project-card ${project.isSelected ? "selected" : ""} ${dropProjectId === project.id ? "drop-target" : ""}`}
          onClick={() => selectProject(project.id)}
          onDragOver={(event) => {
            event.preventDefault();
            setDropProjectId(project.id);
          }}
          onDragLeave={() => setDropProjectId((current) => (current === project.id ? null : current))}
          onDrop={(event) => {
            const ids = readDraggedAssetIds(event);
            if (ids.length === 0) return;
            event.preventDefault();
            setDropProjectId(null);
            void moveItemsToFolder(ids, project.id);
          }}
        >
          <strong>{project.name}</strong>
          <small>Project</small>
        </button>
      ))}
    </div>
  );
}
