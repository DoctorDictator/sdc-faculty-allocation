import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "FacultyFlow | Smart Allocation",
  description: "Faculty allocation and low-disruption schedule repair.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="facultyflow-theme-init" strategy="beforeInteractive">
          {`try { document.documentElement.dataset.theme = localStorage.getItem('facultyflow-theme') === 'dark' ? 'dark' : 'light'; } catch { document.documentElement.dataset.theme = 'light'; }`}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
