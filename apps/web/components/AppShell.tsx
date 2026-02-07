"use client";

import type { ReactNode } from "react";
import { ProjectsProvider } from "./ProjectsProvider";
import { ProjectSidebar } from "./ProjectSidebar";
import { GlobalGeneratePanel } from "./GlobalGeneratePanel";
import { CreateProjectModal } from "./CreateProjectModal";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ProjectsProvider>
      <div className="rebuild-shell">
        <aside className="rebuild-sidebar">
          <ProjectSidebar />
        </aside>

        <section className="rebuild-main">{children}</section>
      </div>

      <GlobalGeneratePanel />
      <CreateProjectModal />
    </ProjectsProvider>
  );
}
