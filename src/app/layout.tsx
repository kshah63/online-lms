import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MathVision Global — 1-1 Online Tutoring",
  description:
    "MathVision Global: live one-to-one online tutoring — scheduling, video, a collaborative notebook, AI coaching, and parent reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
