"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onLogin() {
    setLoading(true);
    setError("");
    try {
      await signIn("github", { callbackUrl: "/admin" });
    } catch {
      setError("Could not reach GitHub. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="container flex min-h-[70vh] items-center justify-center py-16">
      <div className="card w-full max-w-sm p-8 text-center">
        <p className="text-2xl font-extrabold tracking-tight">
          OUT<span className="text-gold">TAKE</span>
        </p>
        <p className="mt-2 text-sm text-mut">Admin — sign in to manage the vault.</p>

        <button
          onClick={onLogin}
          disabled={loading}
          className="btn mt-6 w-full border border-line hover:bg-panel-2"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          )}
          {loading ? "Redirecting…" : "Continue with GitHub"}
        </button>

        {error ? <p className="mt-4 text-sm text-rose">{error}</p> : null}
      </div>
    </div>
  );
}