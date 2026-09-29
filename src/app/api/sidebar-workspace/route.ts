import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { getLocations } from "@/lib/collection/queries";
import { getWantList } from "@/lib/social/queries";

export const dynamic = "force-dynamic";

/** Small, owner-scoped lists for the persistent explorer. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const locations = await getLocations();
    const deckId = request.nextUrl.searchParams.get("deck") ?? "";
    const locationId = request.nextUrl.searchParams.get("location") ?? "";
    const selectedDeck = locations.find((l) => l.id === deckId && l.type === "deck")
      ?? locations.find((l) => l.type === "deck");
    const selectedLocation = locations.find((l) => l.id === locationId && l.type !== "deck");
    const supabase = await createClient();

    const [deckResult, locationResult, wants] = await Promise.all([
      selectedDeck
        ? supabase.from("deck_cards")
            .select("id, card_id, quantity, cards ( name, type_line, cmc, rarity, colors, mana_cost )")
            .eq("deck_id", selectedDeck.id).order("id").limit(300)
        : Promise.resolve({ data: [], error: null }),
      selectedLocation || locationId === "unsorted"
        ? (() => {
            const q = supabase.from("card_instances")
              .select("id, card_id, quantity, condition, finish, language, notes, cards ( name, image_uri_small )")
              .eq("owner_user_id", user.id).limit(300);
            return locationId === "unsorted" ? q.is("location_id", null) : q.eq("location_id", selectedLocation!.id);
          })()
        : Promise.resolve({ data: [], error: null }),
      getWantList(),
    ]);

    if (deckResult.error) throw deckResult.error;
    if (locationResult.error) throw locationResult.error;

    return NextResponse.json({
      decks: locations.filter((l) => l.type === "deck").map((l) => ({ id: l.id, name: l.name })),
      locations: locations.filter((l) => l.type !== "deck").map((l) => ({ id: l.id, name: l.name })),
      deckCards: deckResult.data ?? [],
      commanderEntryId: (deckResult.data ?? []).find((entry) => entry.card_id === selectedDeck?.commander_card_id)?.id ?? null,
      locationId,
      locationCards: locationResult.data ?? [],
      wants: wants.map((w) => ({ id: w.id, name: w.displayName, quantity: w.quantity })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the explorer." }, { status: 500 });
  }
}
