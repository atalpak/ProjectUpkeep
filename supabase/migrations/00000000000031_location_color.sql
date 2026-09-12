-- ---------------------------------------------------------------------------
-- locations.color: a user-chosen label colour, purely cosmetic.
--
-- The tile layout (grid view, added alongside the existing list) has no room
-- for the detail a list row carries, so telling two boxes apart at a glance
-- falls to something like a folder colour instead. Deliberately its own small
-- vocabulary rather than reusing WUBRG (globals.css): those five colours
-- already mean "Magic colour identity" everywhere else in this app, and a
-- green-bordered box would read as saying something about the cards inside
-- it rather than just being the colour its owner picked. A closed list, not a
-- free colour picker, so the UI can render a fixed swatch row instead of
-- trusting arbitrary CSS values.
--
-- Nullable: no colour is the default and the common case, not a colour of its
-- own called "none".
-- ---------------------------------------------------------------------------

alter table public.locations
  add column color text
    check (color in ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'));
