import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/lib/social/queries";
import { AccountMenu } from "@/components/AccountMenu";
import { AppNavDrawer, AppNavLinks } from "@/components/AppNav";
import { CardPanelProvider, CardPanelOutlet } from "@/components/CardPanel";
import { CardPreviewToggle } from "@/components/CardPreviewMode";
import { HeaderSearch } from "@/components/HeaderSearch";
import { AlertsMenu } from "@/components/social/AlertsMenu";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  const [{ data: profile }, unread] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    getUnreadNotificationCount(),
  ]);

  return (
    <CardPanelProvider>
      <div className="min-h-screen">
        {/* Sticky so the nav stays reachable down a long collection list. */}
        <header className="sticky top-0 z-10 border-b border-border bg-surface/85 backdrop-blur">
          <nav className="flex w-full items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <Link
              href="/dashboard"
              className="text-sm font-semibold tracking-tight whitespace-nowrap"
            >
              Project<span className="text-accent">Upkeep</span>
            </Link>

            {/* The destination list lives in one place; AppNav renders it inline
                from lg up and behind a drawer below that. */}
            <AppNavLinks />

            <div className="ml-auto flex items-center gap-2">
              <HeaderSearch />

              {/* Alerts sits in the right cluster rather than the nav so the
                  unread count reads as a status, not another destination. It stays
                  visible at every width — being told about a trade is the point. */}
              <AlertsMenu unread={unread} />

              {/* Hides itself below xl, where there is no sidebar to switch off. */}
              <CardPreviewToggle />
              <ThemeToggle className="hidden lg:inline-flex" />

              {/* The username, and behind it Settings and Log out. Below lg these
                  live in the drawer instead, so the bar keeps to the logo,
                  search, alerts and the hamburger. */}
              <AccountMenu label={profile?.username ?? user.email ?? "Account"} />

              <AppNavDrawer username={profile?.username ?? user.email ?? null} />
            </div>
          </nav>
        </header>

        {/* When the card sidebar is showing it is a sibling of the content rather
            than an overlay, so hovering a card never covers the list being read.
            It renders nothing at all on routes with no cards, on narrow windows,
            on touch, and when the reader has switched to the hover tooltip — and
            because `main` is `flex-1`, the width comes straight back in each of
            those cases. The provider wraps the header too, so the search box can
            open the card popup. */}
        {/* Same padding as the nav above, so page content and the nav share
            left and right edges at every width. Full-bleed rather than a
            centred column — wide pages (the collection table especially) use
            the whole window; individual narrow pages cap their own width. */}
        <div className="flex w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <main className="min-w-0 flex-1">{children}</main>
          <CardPanelOutlet />
        </div>
      </div>
    </CardPanelProvider>
  );
}
