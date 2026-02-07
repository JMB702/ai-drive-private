import type { ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import "./globals.css";

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
