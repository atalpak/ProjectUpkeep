import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/lib/social/queries";
import { AccountMenu } from "@/components/AccountMenu";
import { AppNavDrawer, AppNavLinks } from "@/components/AppNav";
import { CardPanelProvider, CardPanelOutlet } from "@/components/CardPanel";
import { CardPreviewToggle } from "@/components/CardPreviewMode";
import { FeedbackButton } from "@/components/FeedbackButton";
import { HeaderSearch } from "@/components/HeaderSearch";
import { PageTransition } from "@/components/PageTransition";
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
      <div className="min-h-screen [--app-header-height:4.125rem]">
        {/* Sticky so the nav stays reachable down a long collection list.
            Fully opaque, not translucent: a page can now scroll a full-bleed
            background image under it (the deck page's commander-art banner),
            and a blurred/translucent nav let that art show through enough to
            blend into the bar rather than read as a header the content
            scrolls behind. */}
        <header className="sticky top-0 z-20 h-[var(--app-header-height)] border-b border-border bg-surface">
          <nav className="flex h-full w-full items-center gap-4 px-4 sm:px-6 lg:px-8">
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
              <CardPreviewToggle />
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

        {/* The explorer is a sibling of the content rather than an overlay, so
            card details and drop destinations never cover the list being read.
            It keeps its place while scrolling and animates its width when the
            reader opens or closes it. Because `main` is `flex-1`, the page
            grows into that space as the explorer closes. */}
        {/* Padding belongs to the page, while the explorer occupies a separate
            edge-to-edge column with its own scroll area. */}
        <div className="flex w-full">
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <PageTransition>{children}</PageTransition>
          </main>
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
