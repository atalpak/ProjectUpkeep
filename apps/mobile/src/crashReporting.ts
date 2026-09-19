// Crash reporting (Sentry), wired in through exactly two doors: `initCrashReporting`
// (called once at the top of App.tsx) and `reportError` in errors.ts, which calls
// `captureError` below. No screen imports this file or @sentry/react-native.
//
// It is a complete no-op unless EXPO_PUBLIC_SENTRY_DSN is set, so a build made
// without a key behaves exactly as before: nothing initialised, nothing sent.
// The DSN is read as a literal member expression -- the same rule as every other
// EXPO_PUBLIC_* value (CLAUDE.md hard constraint 2); Metro only inlines that form.
//
// Privacy is the reason this file is longer than an init call. A crash report must
// say where and what, never who: no user is attached, `sendDefaultPii` is off,
// breadcrumbs (taps, navigation, network calls and their bodies) are dropped
// entirely, request data is stripped, and anything in an error message that looks
// like an email address is masked, because Supabase and auth errors sometimes echo
// the address that was typed. Usernames and user ids are never handed to Sentry in
// the first place; `scrubEvent` deletes the fields they would travel in as a
// second line of defence. Native iOS crashes are reported by the native SDK and
// bypass `scrubEvent`; they carry device and OS info but no account data.
import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
let enabled = false;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const maskEmails = (s: string) => s.replace(EMAIL, "[email]");

/** Exported for reasoning about it in one place; takes and returns the event shape Sentry hands beforeSend. */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  delete event.user;
  delete event.request;
  delete event.breadcrumbs;
  delete event.extra;
  if (event.message) event.message = maskEmails(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskEmails(ex.value);
  }
  return event;
}

export function initCrashReporting(): void {
  if (!dsn || enabled) return;
  try {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      // Breadcrumbs carry navigation targets, touch labels and request URLs/bodies.
      beforeBreadcrumb: () => null,
      beforeSend: scrubEvent,
      // Crashes and reported errors only: no performance traces, no session replay.
      tracesSampleRate: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      // Sentry's own console logging would echo the DSN into device logs in release builds.
      debug: false,
    });
    enabled = true;
  } catch {
    // Crash reporting must never be the thing that crashes the app.
    enabled = false;
  }
}

/** Send a caught error, tagged with its short stable context. No-op when uninitialised. */
export function captureError(error: unknown, context: string): void {
  if (!enabled) return;
  Sentry.captureException(
    error instanceof Error ? error : new Error(String(error)),
    { tags: { context } },
  );
}
