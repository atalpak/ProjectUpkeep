import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/lib/social/queries";
import { AccountMenu } from "@/components/AccountMenu";
import { AppNavDrawer, AppNavLinks } from "@/components/AppNav";
import { CardPanelProvider, CardPanelOutlet } from "@/components/CardPanel";
import { FeedbackButton } from "@/components/FeedbackButton";
import { HeaderSearch } from "@/components/HeaderSearch";
import { AlertsMenu } from "@/components/social/AlertsMenu";
import { Wordmark } from "@/components/Wordmark";

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
        {/* Sticky so the nav stays reachable down a long collection list.
            Fully opaque, not translucent: a page can now scroll a full-bleed
            background image under it (the deck page's commander-art banner),
            and a blurred/translucent nav let that art show through enough to
            blend into the bar rather than read as a header the content
            scrolls behind. */}
        <header className="sticky top-0 z-20 border-b border-border bg-surface">
          <nav className="flex w-full items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/dashboard">
              <Wordmark />
            </Link>

            {/* The destination list lives in one place; AppNav renders it inline
                from lg up and behind a drawer below that. */}
            <AppNavLinks />

            {/* A flex-growing spacer as much as a search field — see its own
                header comment for why that also retires the `ml-auto` this
                row used to lean on to push the cluster below to the right. */}
            <HeaderSearch />

            <div className="flex items-center gap-2">
              {/* Alerts sits in the right cluster rather than the nav so the
                  unread count reads as a status, not another destination. It stays
                  visible at every width — being told about a trade is the point. */}
              <AlertsMenu unread={unread} />

              {/* The username, and behind it the card-sidebar and theme
                  switches, Settings and Log out. Below lg these live in the
                  drawer instead, so the bar keeps to the logo, search, alerts
                  and the hamburger. */}
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

        {/* Below the content div rather than inside its flex row, so it spans
            the full width under the card sidebar too instead of sitting
            beside it. The drawer has no feedback entry, so this is the only
            route to it at every width — a hairline, not a card, because it
            belongs on every page without asking for attention. */}
        <footer className="border-t border-border px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">
              Spot something wrong or missing? It goes into a table the owner reads.
            </p>
            <FeedbackButton />
          </div>
        </footer>
      </div>
    </CardPanelProvider>
  );
}
