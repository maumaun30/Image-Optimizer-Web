"use client";

import { CircleAlert, LoaderCircle, RefreshCw, Zap } from "lucide-react";
import { useTheme } from "next-themes";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { AUTH_EXPIRED_EVENT, getMe, loginUrl, logout, User } from "@/lib/api";

/** Messages for the `auth_error` the API appends when it refuses a sign-in. */
const AUTH_ERRORS: Record<string, string> = {
  domain: "That Google account isn’t allowed. Sign in with your company Workspace account.",
  unverified: "Your Google account email isn’t verified. Verify it with Google, then sign in again.",
  expired: "Sign-in timed out. Try again.",
  cancelled: "Sign-in was cancelled.",
  failed: "Couldn’t reach Google. Check your connection and try again.",
  invalid: "Google’s response couldn’t be verified. Try again.",
};

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; error: string | null; expired?: boolean }
  | { kind: "signed-in"; user: User }
  | { kind: "unreachable" };

interface Auth {
  user: User;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/** The signed-in user and sign-out. Only valid inside <AuthGate>. */
export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside <AuthGate>");
  return auth;
}

export function useUser(): User {
  return useAuth().user;
}

/** Path + query to come back to after sign-in, minus our own `auth_error` param. */
function currentPath(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("auth_error");
  return url.pathname + url.search;
}

/**
 * Gates the whole app behind Google sign-in. The session lives in an httpOnly cookie
 * set by the API, so the only way to know whether we're signed in is to ask it.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const check = useCallback(async () => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("auth_error");
    if (code) {
      // Drop it from the address bar so a reload doesn't show the error again
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    try {
      const user = await getMe();
      setState(
        user
          ? { kind: "signed-in", user }
          : { kind: "signed-out", error: code ? (AUTH_ERRORS[code] ?? AUTH_ERRORS.failed) : null }
      );
    } catch {
      setState({ kind: "unreachable" });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // A 401 from any API call means the session ran out mid-use
  useEffect(() => {
    const onExpired = () => setState({ kind: "signed-out", error: null, expired: true });
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const signOut = useCallback(async () => {
    await logout().catch(() => {});
    setState({ kind: "signed-out", error: null });
  }, []);

  if (state.kind === "signed-in") {
    return <AuthContext.Provider value={{ user: state.user, signOut }}>{children}</AuthContext.Provider>;
  }

  return (
    <SignInScreen
      state={state}
      onRetry={() => {
        setState({ kind: "loading" });
        check();
      }}
    />
  );
}

function SignInScreen({
  state,
  onRetry,
}: {
  state: Exclude<State, { kind: "signed-in" }>;
  onRetry: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <main className="bg-background relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      {/* The one place a richer background is allowed: nothing else runs here */}
      <FlickeringGrid
        aria-hidden="true"
        squareSize={4}
        gridGap={6}
        flickerChance={0.15}
        maxOpacity={dark ? 0.18 : 0.12}
        color={dark ? "rgb(129, 140, 248)" : "rgb(79, 70, 229)"}
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_50%_55%_at_50%_50%,#000_10%,transparent_75%)]"
      />

      {state.kind === "loading" ? (
        <p role="status" className="text-muted-foreground relative m-0 flex items-center gap-2.5 text-sm">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" strokeWidth={2.25} />
          Checking sign-in…
        </p>
      ) : (
        <section
          aria-labelledby="signin-title"
          className="bg-card border-border relative flex w-full max-w-[400px] flex-col gap-6 rounded-[18px] border p-6 shadow-[0_1px_2px_rgb(24_24_27/0.05),0_12px_40px_-12px_rgb(24_24_27/0.12)] sm:p-8 dark:shadow-[0_1px_2px_rgb(0_0_0/0.6),0_12px_40px_-12px_rgb(0_0_0/0.8)]"
        >
          <div className="flex flex-col items-center gap-3.5 text-center">
            <span className="bg-primary flex size-11 items-center justify-center rounded-lg">
              <Zap aria-hidden="true" className="text-primary-foreground size-[22px]" strokeWidth={2} />
            </span>
            <h1 id="signin-title" className="m-0 text-[22px] font-semibold tracking-tight">
              Image Optimizer
            </h1>
            <p className="text-muted-foreground m-0 text-sm leading-[21px]">
              {state.kind === "signed-out" && state.expired
                ? "Your session expired. Sign in again to continue."
                : "Sign in with your company Google account to compress images, PDFs and video."}
            </p>
          </div>

          {state.kind === "unreachable" ? (
            <>
              <SignInAlert message="Can’t reach the Image Optimizer server right now." />
              <button
                type="button"
                onClick={onRetry}
                className="border-border bg-muted hover:bg-border flex h-11 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium"
              >
                <RefreshCw aria-hidden="true" className="size-4" strokeWidth={2} />
                Try again
              </button>
            </>
          ) : (
            <>
              {state.error && <SignInAlert message={state.error} />}
              <GoogleButton href={loginUrl(currentPath())} />
            </>
          )}

          <p className="text-muted-foreground m-0 text-center text-xs leading-[18px]">
            Only company Google Workspace accounts can sign in.
          </p>
        </section>
      )}
    </main>
  );
}

function SignInAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-destructive-border bg-destructive-soft text-destructive flex gap-2.5 rounded-[10px] border p-3 text-[13px] leading-[19px]"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 flex-none" strokeWidth={2} />
      <span>{message}</span>
    </div>
  );
}

/**
 * Follows Google's sign-in branding: neutral fill and outline, the full-color G
 * mark, "Sign in with Google". It's a link because sign-in is a full-page redirect
 * through the API, not the Google Identity Services popup.
 */
function GoogleButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="flex h-11 items-center justify-center gap-2.5 rounded-full border border-[#747775] bg-white px-3 text-sm font-medium text-[#1f1f1f] transition-colors hover:bg-[#f8f9fa] dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#1f1f20]"
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      Sign in with Google
    </a>
  );
}
