import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";
import { PlayFixture } from "@/components/playtester/PlayFixture";
import styles from "./landing.module.css";

export const metadata = {
  title: "Project Upkeep · Know what you own. Know where to find it.",
  description: "Track your Magic cards by binder, box, and deck. Find available copies, check decklists, and see what friends have to trade.",
};

const benefits = [
  {
    "label": "01 / Collection",
    "title": "Track the exact copy",
    "body": "Record printing, finish, language, quantity, and physical location. A foil and a nonfoil don’t get mixed together."
  },
  {
    "label": "02 / Locations",
    "title": "Find it in your binder or box",
    "body": "Search for a card and see where every copy lives, including the ones sleeved in a deck."
  },
  {
    "label": "03 / Availability",
    "title": "Know which copies are free",
    "body": "See the copies available to use separately from cards already committed to decks."
  },
  {
    "label": "04 / Decklists",
    "title": "Check a list before building it",
    "body": "Paste a decklist to see what you own, what’s in another deck, and what you still need. Save it only if you want to."
  },
  {
    "label": "05 / Decks",
    "title": "Keep track of what’s sleeved",
    "body": "Compare your decklist with the physical copies in its location. See what’s ready and what still needs a card."
  },
  {
    "label": "06 / Wish list",
    "title": "Remember what you’re looking for",
    "body": "Keep the cards you want in one list and connect them to the decks you need them for."
  },
  {
    "label": "07 / Friends",
    "title": "Find cards in your playgroup",
    "body": "See which friends have tradable copies of cards on your wish list. Search your collection and your circle."
  },
  {
    "label": "08 / Trading",
    "title": "Keep both sides of a trade recorded",
    "body": "Propose a trade with a friend. When they accept, ownership updates in both collections and the trade stays in your history."
  },
  {
    "label": "09 / Import",
    "title": "Bring an existing list with you",
    "body": "Import a CSV collection export or a card list instead of entering every card individually."
  },
  {
    "label": "10 / iPhone scanning",
    "title": "Add cards from your phone",
    "body": "Scan a physical card with the iPhone app, confirm its printing, and choose where the copy belongs."
  },
  {
    "label": "11 / Playtesting",
    "title": "Try your deck before game night",
    "body": "Explore opening hands and mulligans, or use the tabletop playtester to try out your deck."
  },
  {
    "label": "12 / Prices & export",
    "title": "See estimates. Keep your data.",
    "body": "View Scryfall price estimates by finish. Export your collection as a CSV or card list whenever you need it."
  }
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ "playtest-fixture"?: string }> }) {
  if (process.env.NODE_ENV === "development" && (await searchParams)["playtest-fixture"] === "1") return <PlayFixture />;
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="Project Upkeep home"><Wordmark /></Link>
        <nav aria-label="Account" className={styles.nav}>
          <ThemeToggle />
          <Link href="/login" className={styles.signIn}>Sign in</Link>
          <Link href="/signup" className={`${styles.button} ${styles.headerSignup}`}>Create an account</Link>
        </nav>
      </header>
      <main className={styles.main}>
        <div className={styles.holes} aria-hidden="true"><i /><i /><i /><i /></div>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Your cards, accounted for</p>
          <h1>Know what you own.<br />Know where to find it.</h1>
          <p className={styles.lead}>Track your Magic cards by binder, box, and deck. Find available copies, check what a decklist needs, and see what friends have to trade.</p>
          <div className={styles.actions}>
            <Link href="/signup" className={styles.button}>Create an account</Link>
            <a href="#example">See an example</a>
          </div>
        </section>
        <section className={styles.example} id="example" aria-labelledby="example-heading">
          <div className={styles.exampleHeader}>
            <h2 id="example-heading">Lightning Bolt · 6 copies owned</h2>
            <span>Example collection</span>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <caption className="sr-only">Example: six copies of Lightning Bolt across three physical locations.</caption>
              <thead><tr><th scope="col">Location</th><th scope="col">Copies</th><th scope="col">Availability</th></tr></thead>
              <tbody>
                <tr><th scope="row">Trade Binder</th><td>2</td><td>Available</td></tr>
                <tr><th scope="row">Red Commons Box</th><td>3</td><td>Available</td></tr>
                <tr><th scope="row">Modern Burn</th><td>1</td><td>In a deck</td></tr>
              </tbody>
            </table>
          </div>
          <p className={styles.exampleNote}>You have 5 copies available. The sixth is sleeved in Modern Burn.</p>
        </section>
        <section className={styles.explain} aria-label="Decks and your playgroup">
          <div><h2>Check a decklist against your collection.</h2><p>Paste a list to see what you own, what’s sleeved in another deck, and what you still need. Nothing is saved unless you ask.</p></div>
          <div><h2>Find missing cards in your playgroup.</h2><p>Your wish list shows which friends have tradable copies. Propose a trade, and your collections update when it’s accepted.</p></div>
        </section>
        <section aria-labelledby="benefits-heading">
          <div className={styles.benefitsHeader}><h2 id="benefits-heading">What you can do with Upkeep</h2><p>Collection · Decks · Your playgroup</p></div>
          <div className={styles.benefits}>
            {benefits.map(benefit => <article key={benefit.label} className={styles.benefit}>
              <span className={styles.index}>{benefit.label}</span>
              <h3>{benefit.title}</h3><p>{benefit.body}</p>
            </article>)}
          </div>
        </section>
        <section className={styles.end}>
          <div><h2>Start with one binder or your whole collection.</h2><p>Add cards individually or import a list. Track each printing, finish, and location.</p></div>
          <Link href="/signup" className={styles.button}>Create an account</Link>
        </section>
      </main>
      <footer className={styles.footer}>
        <p>Card data and price estimates from Scryfall.</p>
        <div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      </footer>
    </div>
  );
}
