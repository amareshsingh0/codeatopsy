import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeAutopsy — why is your algorithm wrong?",
  description:
    "Evidence-driven execution debugger: instrument your C++, trace every step, and see exactly where your logic diverges from the correct solution.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b bg-white" style={{ borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg">🩺</span>
              <span className="text-[15px] font-bold tracking-tight">
                Code<span style={{ color: "var(--accent)" }}>Autopsy</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-[13px]" style={{ color: "var(--muted)" }}>
              <Link href="/" className="hover:opacity-80">Problems</Link>
              <Link href="/playground" className="hover:opacity-80">Playground</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-7xl px-6 py-8 text-xs" style={{ color: "var(--muted)" }}>
          CodeAutopsy · evidence-driven debugging · traces, divergence &amp; autopsy reports
        </footer>
      </body>
    </html>
  );
}
