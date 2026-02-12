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

function runtimeTabTitle(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  const isPrivateIpv4 = (() => {
    if (!ipv4Match) return false;
    const octets = ipv4Match.slice(1).map((value) => Number(value));
    if (octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) return false;
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  })();
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  ) {
    return "Working";
  }
  if (isPrivateIpv4) {
    return "Working Mobile";
  }
  return "Deployed";
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname?.startsWith("/sign-in") ?? false;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [viewportReady, setViewportReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.title = runtimeTabTitle(window.location.hostname);
  }, []);

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

  const shellCollapsed = !viewportReady || !sidebarOpen;

  return (
    <ProjectsProvider>
      <ClientErrorBoundary>
        <div className={`rebuild-shell ${shellCollapsed ? "sidebar-collapsed" : ""}`}>
          {viewportReady ? (
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
