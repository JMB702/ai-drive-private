import type { ReactNode } from "react";
import type { Viewport } from "next";
import { AppShell } from "../components/AppShell";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "'Avenir Next', 'Trebuchet MS', 'Segoe UI', sans-serif",
          margin: 0,
          minHeight: "100vh",
          background: "#05080f",
          color: "#ecf2fb"
        }}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
