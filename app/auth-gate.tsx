"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AUTH_EXPIRED_EVENT, getMe, loginUrl, logout, User } from "@/lib/api";

/** Messages for the `auth_error` the API appends when it refuses a sign-in. */
const AUTH_ERRORS: Record<string, string> = {
  domain: "That Google account isn't allowed. Sign in with your company Workspace account.",
  unverified: "That Google account's email isn't verified.",
  expired: "Sign-in took too long or was interrupted. Please try again.",
  cancelled: "Sign-in was cancelled.",
  failed: "Couldn't reach Google to finish signing in. Please try again.",
  invalid: "Google's response couldn't be verified. Please try again.",
};

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; error: string | null }
  | { kind: "signed-in"; user: User }
  | { kind: "unreachable"; error: string };

const UserContext = createContext<User | null>(null);

/** The signed-in user. Only valid inside <AuthGate>, which renders children only then. */
export function useUser(): User {
  const user = useContext(UserContext);
  if (!user) throw new Error("useUser must be used inside <AuthGate>");
  return user;
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
          : { kind: "signed-out", error: code ? AUTH_ERRORS[code] ?? AUTH_ERRORS.failed : null }
      );
    } catch (e) {
      setState({
        kind: "unreachable",
        error: e instanceof Error ? e.message : "Couldn't reach the server",
      });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  // A 401 from any API call means the session ran out mid-use
  useEffect(() => {
    const onExpired = () =>
      setState({ kind: "signed-out", error: "Your session expired. Sign in again to continue." });
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const handleLogout = async () => {
    await logout().catch(() => {});
    setState({ kind: "signed-out", error: null });
  };

  if (state.kind === "loading") {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400" role="status">
          Checking sign-in…
        </p>
      </main>
    );
  }

  if (state.kind !== "signed-in") {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">Image Optimizer</h1>
          <p className="mt-2 text-sm text-gray-500">
            Sign in with your company Google account to compress images, PDFs and video.
          </p>
          {state.kind === "unreachable" ? (
            <>
              <p className="mt-4 text-sm text-red-600" role="alert">
                {state.error}
              </p>
              <button
                onClick={() => {
                  setState({ kind: "loading" });
                  check();
                }}
                className="mt-6 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700"
              >
                Try again
              </button>
            </>
          ) : (
            <>
              {state.error && (
                <p className="mt-4 text-sm text-red-600" role="alert">
                  {state.error}
                </p>
              )}
              <a
                href={loginUrl(currentPath())}
                className="mt-6 block w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700"
              >
                Sign in with Google
              </a>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <UserContext.Provider value={state.user}>
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-2 flex items-center justify-end gap-3 text-xs text-gray-500">
          <span className="truncate" title={state.user.email}>
            {state.user.email}
          </span>
          <button onClick={handleLogout} className="font-medium text-gray-700 hover:text-gray-900 underline">
            Sign out
          </button>
        </div>
      </div>
      {children}
    </UserContext.Provider>
  );
}
