"use client";

import { useActionState, useState } from "react";

import { updateProfileDetails } from "@/app/(app)/settings/actions";
import { EMPTY_SETTINGS_STATE } from "@/app/(app)/settings/action-state";
import { ProfileAvatar } from "@/components/social/ProfileIdentity";
import { ManaSymbol } from "@/components/ManaCost";
import { Banner, Button, Field, Textarea } from "@/components/ui";
import { AVATAR_STYLES, FAVORITE_COLORS, FAVORITE_COLOR_NAMES, FAVORITE_FORMATS, avatarStyle, favoriteColors, favoriteFormats } from "@/lib/social/profile";
import type { ProfileDetails } from "@/lib/social/types";

export function ProfileDetailsForm({
  profile,
  decks,
}: {
  profile: ProfileDetails;
  decks: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(updateProfileDetails, EMPTY_SETTINGS_STATE);
  const [selectedFormats, setSelectedFormats] = useState<string[]>(favoriteFormats(profile.favorite_formats));
  const [selectedColors, setSelectedColors] = useState<string[]>(favoriteColors(profile.favorite_colors));
  const [selectedAvatar, setSelectedAvatar] = useState(avatarStyle(profile.avatar_style));
  const [selectedDecks, setSelectedDecks] = useState<string[]>(
    profile.featured_deck_ids.filter((id) => decks.some((deck) => deck.id === id)),
  );

  return (
    <form action={action} className="space-y-5">
      <Field label="About you" hint="Up to 160 characters. Visible to signed-in members.">
        <Textarea name="bio" defaultValue={profile.bio} maxLength={160} rows={3} placeholder="What do you enjoy collecting or playing?" />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink-muted">Avatar color</legend>
        <div className="flex flex-wrap gap-3">
          {AVATAR_STYLES.map((style) => (
            <label key={style} className="cursor-pointer text-center text-xs capitalize">
              <input
                type="radio"
                name="avatar_style"
                value={style}
                checked={selectedAvatar === style}
                onChange={() => setSelectedAvatar(style)}
                className="sr-only peer"
              />
              <span className="block rounded-xl p-1 peer-checked:outline-2 peer-checked:outline-focus-ring peer-focus-visible:outline-2 peer-focus-visible:outline-focus-ring">
                <ProfileAvatar username={profile.username} style={style} size="sm" />
              </span>
              {style}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink-muted">Favorite formats <span className="font-normal">(up to 3)</span></legend>
        <div className="flex flex-wrap gap-2">
          {FAVORITE_FORMATS.map((format) => (
            <label key={format} className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-sm">
              <input
                type="checkbox"
                name="favorite_formats"
                value={format}
                checked={selectedFormats.includes(format)}
                disabled={selectedFormats.length >= 3 && !selectedFormats.includes(format)}
                onChange={(event) => setSelectedFormats((current) => event.target.checked ? [...current, format] : current.filter((item) => item !== format))}
              />
              {format}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink-muted">Favorite mana colors</legend>
        <div className="flex flex-wrap gap-2">
          {FAVORITE_COLORS.map((color) => (
            <label key={color} className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 text-sm">
              <input
                type="checkbox"
                name="favorite_colors"
                value={color}
                checked={selectedColors.includes(color)}
                onChange={(event) => setSelectedColors((current) => event.target.checked ? [...current, color] : current.filter((item) => item !== color))}
              />
              <ManaSymbol code={color} />
              {FAVORITE_COLOR_NAMES[color]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink-muted">Featured decks</legend>
        <p className="text-xs text-ink-muted">Choose up to five decks shared with friends. They appear in the order selected. {selectedDecks.length}/5 selected.</p>
        {selectedDecks.map((id) => <input key={id} type="hidden" name="featured_deck_ids" value={id} />)}
        {decks.length === 0 ? (
          <p className="text-sm text-ink-muted">Share a deck with friends to feature it here.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {decks.map((deck) => (
              <label key={deck.id} className="flex cursor-pointer items-start gap-2 rounded border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  value={deck.id}
                  checked={selectedDecks.includes(deck.id)}
                  disabled={selectedDecks.length >= 5 && !selectedDecks.includes(deck.id)}
                  onChange={(event) => setSelectedDecks((current) => event.target.checked ? [...current, deck.id] : current.filter((id) => id !== deck.id))}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">{deck.name}</span>
                {selectedDecks.includes(deck.id) ? <span className="text-xs tabular-nums text-ink-muted">{selectedDecks.indexOf(deck.id) + 1}</span> : null}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <Banner kind="error">{state.error}</Banner>
      <Banner kind="success">{state.notice}</Banner>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
    </form>
  );
}
