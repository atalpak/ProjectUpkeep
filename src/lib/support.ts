/**
 * The one address users are told to write to — account deletion, data
 * questions, general support.
 *
 * A single constant so a change of inbox is made in exactly one place. The
 * privacy page is the only thing that renders it, and it shows it as a
 * `mailto:` link rather than repeating the string.
 */

export const SUPPORT_EMAIL = "atalpak@gmail.com";
