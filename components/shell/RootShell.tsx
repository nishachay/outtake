/** Vault root shell switch — admin renders plain, everything else inside the vault canvas. */
"use client";

import { usePathname } from "next/navigation";
import AppShell from "./AppShell";

export default function RootShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname && pathname.startsWith("/admin")) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
