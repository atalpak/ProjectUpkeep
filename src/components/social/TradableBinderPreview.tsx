import { BinderCards } from "@/components/social/ProfileTradables";
import type { CardInstanceWithCard } from "@/lib/types";

/** The owner sees the same searchable list and image grid, without trade actions. */
export function TradableBinderPreview({ cards }: { cards: CardInstanceWithCard[] }) {
  return <BinderCards cards={cards} searchLabel="Filter your binder" />;
}
