import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui";

/**
 * Shell for every signed-in page. Middleware already redirects anonymous
 * visitors; the check here is belt-and-braces so a misconfigured matcher can
 * never leak a page.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[--color-border]">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <Link href="/collection" className="font-semibold">
            MTGManager
          </Link>

          <div className="flex gap-4 text-sm">
            <Link href="/collection" className="hover:underline">
              Collection
            </Link>
            <Link href="/locations" className="hover:underline">
              Locations
            </Link>
          </div>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-[--color-ink-muted]">
              {profile?.username ?? user.email}
            </span>
            <form action={signOut}>
              <Button variant="ghost" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
