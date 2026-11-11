import type { Metadata } from "next";
import AuthGate from "./auth-gate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Image Optimizer",
  description: "Convert and compress images to WebP or AVIF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
