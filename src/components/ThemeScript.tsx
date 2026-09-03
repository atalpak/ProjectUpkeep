import Script from "next/script";

/**
 * Applies the stored theme before first paint.
 *
 * This has to run as a blocking inline script in the initial HTML. Doing it in
 * a React effect would mean the browser paints the default theme first and then
 * swaps — the white flash every dark-mode implementation is judged by.
 *
 * Delivered through next/script with `beforeInteractive` rather than as a raw
 * <script> element. A bare script tag works when the server renders it, but
 * React re-renders this layout on client-side navigation and warns loudly that
 * scripts rendered on the client never execute. `beforeInteractive` is the
 * supported way to say "put this in the HTML, run it before any of your own
 * code", and it does not re-run on navigation, which is what we want anyway.
 *
 * The visitor's explicit choice wins; with no stored choice we seed from the OS
 * so a first visit still looks right. The toggle itself is a plain two-state
 * switch, so once a choice is made it sticks until they change it.
 */
export const THEME_STORAGE_KEY = "mtgmanager-theme";

const SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var dark = stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    /* Private mode or blocked storage: fall through to the light default. */
  }
})();
`;

export function ThemeScript() {
  return (
    // The rule disabled here is a Pages Router rule: it wants beforeInteractive
    // confined to pages/_document.js. This app is App Router, where the docs say
    // the opposite — such scripts *must* live in the root layout. Verified in
    // the delivered HTML: the script lands inside <head>, ahead of <body>, which
    // is what keeps the theme from flashing.
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script
      id="mtgmanager-theme"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}
