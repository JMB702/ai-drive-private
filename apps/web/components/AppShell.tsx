"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ProjectsProvider } from "./ProjectsProvider";
import { ProjectSidebar } from "./ProjectSidebar";
import { GlobalGeneratePanel } from "./GlobalGeneratePanel";
import { CreateProjectModal } from "./CreateProjectModal";
import { NotificationCenter } from "./NotificationCenter";
import { ClientErrorBoundary } from "./ClientErrorBoundary";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith("/sign-in") ?? false;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [viewportReady, setViewportReady] = useState(false);

  useEffect(() => {
    if (isAuthRoute) return;
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const applyViewportState = (mobile: boolean) => {
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
        return;
      }
      setSidebarOpen(true);
    };

    applyViewportState(mediaQuery.matches);
    setViewportReady(true);
    const onChange = (event: MediaQueryListEvent) => {
      applyViewportState(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, [isAuthRoute]);

  if (isAuthRoute) {
    return (
      <ClientErrorBoundary>
        <div className="auth-stage">{children}</div>
      </ClientErrorBoundary>
    );
  }

  const closeSidebarOnMobileNavigation = () => {
    if (!isMobile) return;
    setSidebarOpen(false);
  };

  const shellCollapsed = !viewportReady || (isMobile && !sidebarOpen);

  return (
    <ProjectsProvider>
      <ClientErrorBoundary>
        <div className={`rebuild-shell ${shellCollapsed ? "sidebar-collapsed" : ""}`}>
          {viewportReady && isMobile ? (
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setSidebarOpen((value) => !value)}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-expanded={sidebarOpen}
              aria-controls="rebuild-sidebar"
            >
              ☰
            </button>
          ) : null}
          <NotificationCenter />
          {viewportReady && isMobile && sidebarOpen ? (
            <button
              className="mobile-sidebar-scrim"
              type="button"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}

          <aside className="rebuild-sidebar" id="rebuild-sidebar">
            {viewportReady && (!isMobile || sidebarOpen) ? <ProjectSidebar onNavigate={closeSidebarOnMobileNavigation} /> : null}
          </aside>

          <section className="rebuild-main">{children}</section>
        </div>
        <GlobalGeneratePanel />
        <CreateProjectModal />
      </ClientErrorBoundary>
    </ProjectsProvider>
  );
}
