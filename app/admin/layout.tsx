import Link from "next/link";
import { redirect } from "next/navigation";
import { Disc3, LayoutDashboard, PlusCircle, Users, Inbox } from "lucide-react";

import { auth } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/artists", label: "Artists", icon: Users },
  { href: "/admin/songs", label: "Add Song", icon: PlusCircle },
  { href: "/admin/pending", label: "Pending", icon: Inbox },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/admin/login");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col gap-1 border-r border-line p-4 md:flex">
        <Link href="/admin" className="mb-4 flex items-center gap-2 font-bold">
          <Disc3 size={18} className="text-gold" />
          Admin
        </Link>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-mut transition hover:bg-panel-2 hover:text-fg"
          >
            <Icon size={16} /> {label}
          </Link>
        ))}
        <div className="mt-auto border-t border-line pt-4">
          <form
            action={async () => {
              "use server";
              const { signOut } = await import("@/lib/auth");
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="w-full text-left text-sm text-mut transition hover:text-rose">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-6 md:p-10">
        <nav className="mb-6 flex flex-wrap gap-2 md:hidden">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-mut transition hover:text-fg"
            >
              {label}
            </Link>
          ))}
        </nav>
        {children}
      </main>
    </div>
  );
}