/**
 * The one address users are told to write to — account deletion, data
 * questions, general support.
 *
 * A single constant because it is a placeholder: signup is still playgroup-only,
 * and this has to be swapped for a real inbox in exactly one place before that
 * changes. The privacy and terms pages are the only things that render it, and
 * they show it as a `mailto:` link rather than repeating the string.
 */

// TODO: replace with the real support address before opening signup beyond the playgroup
export const SUPPORT_EMAIL = "support@example.com";
