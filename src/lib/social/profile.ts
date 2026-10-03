/** Choices for the small identity section of a member profile. */
export const AVATAR_STYLES = ["amber", "sage", "slate", "plum", "rust"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export const FAVORITE_FORMATS = [
  "Commander", "Standard", "Modern", "Pioneer", "Pauper", "Limited", "Legacy", "Vintage",
] as const;
export type FavoriteFormat = (typeof FAVORITE_FORMATS)[number];

export const FAVORITE_COLORS = ["W", "U", "B", "R", "G"] as const;
export type FavoriteColor = (typeof FAVORITE_COLORS)[number];
export const FAVORITE_COLOR_NAMES: Record<FavoriteColor, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green",
};

export const AVATAR_PALETTE: Record<AvatarStyle, { background: string; ink: string }> = {
  amber: { background: "#c9a34a", ink: "#292722" },
  sage: { background: "#788b68", ink: "#fffdf5" },
  slate: { background: "#667b86", ink: "#fffdf5" },
  plum: { background: "#806782", ink: "#fffdf5" },
  rust: { background: "#a9634a", ink: "#fffdf5" },
};

export function avatarStyle(value: string | null | undefined): AvatarStyle {
  return AVATAR_STYLES.find((style) => style === value) ?? "slate";
}

export function favoriteFormats(values: string[] | null | undefined): FavoriteFormat[] {
  return (values ?? []).filter((value): value is FavoriteFormat =>
    FAVORITE_FORMATS.some((format) => format === value),
  );
}

export function favoriteColors(values: string[] | null | undefined): FavoriteColor[] {
  return (values ?? []).filter((value): value is FavoriteColor =>
    FAVORITE_COLORS.some((color) => color === value),
  );
}

/** Before migration 53 lands, the previous single featured deck remains readable. */
export function profileFeaturedDeckIds(values: string[] | null | undefined, pinned: string | null): string[] {
  return [...new Set(Array.isArray(values) ? values : pinned ? [pinned] : [])].slice(0, 5);
}
