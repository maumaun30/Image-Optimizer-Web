"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import AuthGate from "./auth-gate";
import { AppShell } from "@/components/shell/app-shell";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {/* reducedMotion="user": under prefers-reduced-motion, motion drops transforms
          and keeps opacity fades, which is what the motion spec asks for */}
      <MotionConfig reducedMotion="user">
        <AuthGate>
          <AppShell>{children}</AppShell>
        </AuthGate>
      </MotionConfig>
    </ThemeProvider>
  );
}
