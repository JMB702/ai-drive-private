"use client";

import { useProjects } from "./ProjectsProvider";

export function ProjectGrid() {
  const { projectCards, selectProject, setCreateModalOpen } = useProjects();

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
          className={`project-card ${project.isSelected ? "selected" : ""}`}
          onClick={() => selectProject(project.id)}
        >
          <strong>{project.name}</strong>
          <small>Project</small>
        </button>
      ))}
    </div>
  );
}
