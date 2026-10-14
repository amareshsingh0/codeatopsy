import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import Image from "next/image";
import "./globals.css";

export const metadata: Metadata = {
  icons: { icon: "/visuals/logo.webp" },
  title: "CodeAutopsy — see the logic, find the difference",
  description:
    "Run code, explore recorded state, replay execution and investigate the first difference with a reference solution.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="shell header-inner">
            <Link href="/" className="brand" aria-label="CodeAutopsy home">
              <span className="brand-logo">
                <Image src="/visuals/logo.webp" alt="" width={38} height={38} />
              </span>
              <span>
                Code<span style={{ color: "var(--accent)" }}>Autopsy</span>
              </span>
            </Link>
            <nav aria-label="Main navigation">
              <Link href="/atlas">Visual atlas</Link>
              <Link href="/#problems">Problems</Link>
              <Link href="/playground" className="nav-playground">
                Playground <Icon name="arrow" size={16} />
              </Link>
            </nav>
          </div>
        </header>
        <div id="main-content">{children}</div>
        <footer className="shell site-footer">
          <span className="brand">
            CodeAutopsy<span className="muted"> / </span>Follow the evidence.
          </span>
          <span>Source → execution → state → understanding</span>
        </footer>
      </body>
    </html>
  );
}
