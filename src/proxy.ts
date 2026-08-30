import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

/**
 * Runs before every matched request. Next 16 renamed this convention from
 * `middleware` to `proxy`; the behaviour is unchanged.
 *
 * Its whole job is to refresh the Supabase session cookie and bounce anonymous
 * visitors to /login — see src/lib/supabase/session.ts.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files — those never need a
     * session refresh and running middleware on them is wasted latency.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
