// Shared route param types for the signed-in navigator — kept in their own
// module so App.tsx, DecksScreen and DeckDetailScreen all reference the same
// shape rather than each re-declaring it.

export type DecksStackParamList = {
  DeckList: undefined;
  DeckDetail: { deckId: string };
};

export type TabParamList = {
  Scan: undefined;
  Collection: undefined;
  Decks: undefined;
  Account: undefined;
};
