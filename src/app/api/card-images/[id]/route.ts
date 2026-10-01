import { NextResponse } from "next/server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Cacheable image URL lookup for card-name hover previews. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "No card id." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("image_uri, image_uri_small")
    .eq("scryfall_id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No such printing." }, { status: 404 });

  return NextResponse.json(
    { imageUrl: data.image_uri ?? data.image_uri_small },
    { headers: { "Cache-Control": "private, max-age=86400" } },
  );
}
