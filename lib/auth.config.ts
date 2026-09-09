import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

/** Allowed GitHub logins (comma-separated) for admin access. */
export function adminLogins(): string[] {
  return (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fail closed in production: no dev fallback secret, no open allowlist. */
function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production");
  }
  return "outtake-local-dev-secret-change-me";
}

export const authConfig = {
  providers: [GitHub],
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  trustHost: true,
  secret: authSecret(),
  callbacks: {
    // Middleware gate: /admin/* requires an authenticated session (see middleware.ts).
    // The sign-in page itself must stay public, or logins redirect-loop forever.
    async authorized({ auth, request }) {
      const { pathname } = new URL(request.url);
      if (pathname === "/admin/login") return true;
      if (pathname.startsWith("/admin")) return !!auth?.user;
      return true;
    },
    // Restrict to the allowlist. Returning a URL redirects; returning false blocks sign-in.
    // Empty allowlist = open door in dev, locked door in production.
    async signIn({ profile }) {
      const allowed = adminLogins();
      if (allowed.length === 0) return process.env.NODE_ENV !== "production";
      const login = (profile as { login?: string } | undefined)?.login;
      if (!login) return false;
      return allowed.includes(login);
    },
    async jwt({ token, user, profile }) {
      if (user) token.sub = (profile as { login?: string } | undefined)?.login ?? token.sub;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.name = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;