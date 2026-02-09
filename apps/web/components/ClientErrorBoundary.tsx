"use client";

import type { ReactNode } from "react";
import { Component } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ClientErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: ""
  };

  static getDerivedStateFromError(error: unknown): State {
    if (error instanceof Error) {
      return { hasError: true, message: error.message || "Unexpected application error." };
    }
    return { hasError: true, message: "Unexpected application error." };
  }

  componentDidMount(): void {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem("aidrive:autoReloadedAfterChunkError");
  }

  componentDidCatch(error: unknown): void {
    console.error("Client render crash:", error);
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (typeof window === "undefined") return;
    const chunkLikeError =
      /loading chunk/i.test(message) ||
      /chunkloaderror/i.test(message) ||
      /failed to fetch dynamically imported module/i.test(message);
    if (!chunkLikeError) return;

    // Dev restarts can briefly invalidate chunk URLs; auto-reload once.
    const key = "aidrive:autoReloadedAfterChunkError";
    const alreadyReloaded = window.sessionStorage.getItem(key) === "1";
    if (alreadyReloaded) return;
    window.sessionStorage.setItem(key, "1");
    window.location.reload();
  }

  onReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="page">
        <header className="page-head">
          <h2>App recovered from a crash</h2>
          <p>A runtime error occurred. You can reload safely.</p>
        </header>

        <section className="panel">
          <p className="muted mono">{this.state.message || "Unexpected application error."}</p>
          <div className="action-row">
            <button className="btn" type="button" onClick={this.onReload}>Reload</button>
          </div>
        </section>
      </main>
    );
  }
}
