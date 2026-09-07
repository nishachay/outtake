/** Unguarded admin shell — the auth gate lives in (vault)/layout.tsx so that
 *  /admin/login stays reachable (guarding it here would redirect-loop). */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
