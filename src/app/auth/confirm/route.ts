import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for the email-confirmation link Supabase sends on signup.
 *
 * Exchanges the one-time token for a session, then redirects into the app. If
 * the link is stale or already used, bounce to /login with a message rather
 * than showing a raw error.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL("/collection", request.url));
    }
  }

  const failed = new URL("/login", request.url);
  failed.searchParams.set("error", "That confirmation link is invalid or has expired.");
  return NextResponse.redirect(failed);
}
