"use client";

import { ChevronDown, FileText, Image as ImageIcon, LogOut, Video, Zap, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useAuth } from "@/app/auth-gate";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TOOLS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Images", icon: ImageIcon },
  { href: "/pdf", label: "PDF", icon: FileText },
  { href: "/video", label: "Video", icon: Video },
];

function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] ?? email[0] ?? "?").toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Static, low-contrast dots that fade out behind content. Drawn in CSS rather
          than Magic UI's DotPattern, which renders one SVG node per dot (~3k on a
          desktop screen) — too heavy next to in-browser encoding. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(var(--pattern)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,#000_30%,transparent_80%)]"
      />
      <TopBar />
      {/* Bottom tab bar on phones: leave room so the last row isn't hidden behind it */}
      <div className="flex-1 pb-[calc(84px+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>
      <BottomTabs />
    </div>
  );
}

function TopBar() {
  return (
    <header className="bg-bar border-border sticky top-0 z-40 flex h-14 items-center gap-1 border-b pr-3 pl-4 backdrop-blur-md sm:h-[60px] sm:gap-3 sm:px-6 lg:h-16 lg:gap-4 lg:px-8">
      <Link href="/" className="flex flex-1 items-center gap-2.5 rounded-lg" aria-label="Image Optimizer home">
        <span className="bg-primary flex size-7 items-center justify-center rounded-sm">
          <Zap aria-hidden="true" className="text-primary-foreground size-4" strokeWidth={2} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Image Optimizer</span>
      </Link>
      <nav aria-label="Tool" className="hidden sm:block">
        <ToolSwitcher variant="top" />
      </nav>
      <div className="flex flex-1 items-center justify-end gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

function BottomTabs() {
  return (
    <nav
      aria-label="Tool"
      className="bg-bar border-border fixed inset-x-0 bottom-0 z-40 border-t px-3 pt-1.5 pb-[calc(22px+env(safe-area-inset-bottom)*0.5)] backdrop-blur-md sm:hidden"
    >
      <ToolSwitcher variant="bottom" />
    </nav>
  );
}

function ToolSwitcher({ variant }: { variant: "top" | "bottom" }) {
  const pathname = usePathname();
  const top = variant === "top";
  return (
    <ul
      className={cn(
        "m-0 list-none p-0",
        top
          ? "bg-muted border-border flex gap-0.5 rounded-[10px] border p-1"
          : "grid grid-cols-3 gap-1"
      )}
    >
      {TOOLS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <li key={href} className="relative">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center justify-center transition-colors duration-150",
                top
                  ? "h-9 gap-2 rounded-[7px] px-3.5 text-sm font-medium lg:h-8 lg:px-4"
                  : "min-h-14 flex-col gap-0.5 rounded-lg text-xs",
                active
                  ? top
                    ? "text-foreground"
                    : "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              )}
            >
              {active && (
                <motion.span
                  layoutId={`tool-indicator-${variant}`}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className={cn(
                    "absolute inset-0",
                    top ? "bg-card shadow-segment rounded-[7px]" : "bg-accent rounded-lg"
                  )}
                />
              )}
              <Icon
                aria-hidden="true"
                strokeWidth={1.75}
                className={cn("relative", top ? "hidden size-4 lg:block" : "size-[22px]")}
              />
              <span className="relative">{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cls =
    "border-border bg-card text-foreground hover:bg-muted flex size-11 items-center justify-center rounded-[10px] border-0 sm:border lg:size-10 [&_svg]:size-[18px]";
  // Theme is unknown until hydration; keep the slot so the bar doesn't shift
  if (!mounted) return <span className={cls} aria-hidden="true" />;

  const dark = resolvedTheme === "dark";
  return (
    <AnimatedThemeToggler
      theme={dark ? "dark" : "light"}
      onThemeChange={setTheme}
      aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
      className={cls}
    />
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const mark = initials(user.name, user.email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${user.email}`}
        className="border-border bg-card hover:bg-muted flex h-11 items-center gap-2 rounded-[10px] border-0 p-1.5 text-[13px] font-medium sm:border lg:h-10 lg:py-1 lg:pr-2.5 lg:pl-1"
      >
        <span className="bg-accent text-primary flex size-8 items-center justify-center rounded-sm text-xs font-semibold lg:size-[30px] lg:rounded-[7px]">
          {mark}
        </span>
        <span className="hidden max-w-56 truncate lg:inline">{user.email}</span>
        <ChevronDown aria-hidden="true" className="text-muted-foreground hidden size-3.5 lg:block" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{user.name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="min-h-10 cursor-pointer">
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
