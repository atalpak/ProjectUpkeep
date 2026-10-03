import type { ReactNode } from "react";

import { AVATAR_PALETTE, FAVORITE_COLOR_NAMES, avatarStyle, favoriteColors, favoriteFormats, type AvatarStyle } from "@/lib/social/profile";
import { ManaSymbol } from "@/components/ManaCost";
import type { ProfileDetails } from "@/lib/social/types";
import { Card as Panel } from "@/components/ui";

export function ProfileAvatar({
  username,
  style,
  size = "lg",
}: {
  username: string;
  style: AvatarStyle;
  size?: "sm" | "lg";
}) {
  const colors = AVATAR_PALETTE[avatarStyle(style)];
  return (
    <span
      aria-hidden="true"
      className={`retro-avatar inline-flex shrink-0 items-center justify-center rounded-xl border-2 border-border-strong font-brand font-bold shadow-[var(--shadow-card)] ${size === "lg" ? "size-20 text-3xl" : "size-9 text-sm"}`}
      style={{ backgroundColor: colors.background, color: colors.ink }}
    >
      {username.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Only member-chosen identity goes here. Trading data stays in friend-gated sections. */
export function ProfileIdentity({
  profile,
  context,
  actions,
}: {
  profile: ProfileDetails;
  context?: ReactNode;
  actions?: ReactNode;
}) {
  const formats = favoriteFormats(profile.favorite_formats);
  const colors = favoriteColors(profile.favorite_colors);

  return (
    <Panel className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <ProfileAvatar username={profile.username} style={profile.avatar_style} />
        <div className="min-w-0 space-y-2">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{profile.username}</h1>
            {context ? <p className="text-xs text-ink-muted">{context}</p> : null}
          </div>
          {profile.bio ? <p className="max-w-prose whitespace-pre-wrap text-sm">{profile.bio}</p> : null}
          {formats.length > 0 || colors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {formats.map((format) => (
                <span key={format} className="rounded border border-border-strong bg-surface-muted px-2 py-0.5">
                  {format}
                </span>
              ))}
              {colors.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded border border-border-strong bg-surface-muted px-2 py-0.5" role="img" aria-label={`Favorite colors: ${colors.map((color) => FAVORITE_COLOR_NAMES[color]).join(", ")}`}>
                  {colors.map((color) => <ManaSymbol key={color} code={color} />)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </Panel>
  );
}
