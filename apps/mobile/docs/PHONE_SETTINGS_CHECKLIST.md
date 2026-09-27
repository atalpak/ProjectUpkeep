# iPhone Settings acceptance checklist

Installed 2026-09-26 on iPhone 13 mini: signed Release build, ProjectUpkeep 0.1.0
(1), bundle `dev.projectupkeep.scanner`. Installation replaced the existing app
without uninstalling. CoreDevice confirmed installation, launch and a running
process. No Metro connection is required. Migration 49 was applied to production;
the migration verifier confirms local and production are in sync.

133 mobile tests, 61 domain tests, mobile/domain typechecks and the complete local
PostgreSQL schema suite passed. The web suite previously passed 1,040 tests after
the shared password helper change. The owner reported “all work fine” after phone
testing on 2026-09-26. Settings acceptance is recorded as passed by the owner;
individual test steps were not separately reported. The checklist remains as a
repeatable regression guide. This report does not resolve the separate search
signed-in search acceptance below.

## Current priority-4 release pass

This is the short, single-session pass used to close backlog item 4. It is not
a request to repeat every historical regression below. On the installed release,
perform these in one ordinary session and record only a failure or an unchecked
step, with a screenshot and scan-log entry where applicable:

- [ ] Launch after a force-close without Metro; Collection and Settings remain
      usable while the catalog is becoming ready.
- [ ] Quick scan Book #116, Mouth #216 and borderless Oliphaunt #426. Each
      automatic capture must identify the expected printing in ordinary light.
- [ ] Cover the collector line of a multi-printing card. It must require a
      deliberate choice/confirmation before Add or Wish; add exactly one copy
      after confirming.
- [ ] Enable Scan diagnostics, save one known card, and confirm the exact
      printing appears in Collection after relaunch.
- [ ] Search `t:legendary t:elf`, use next/previous pages, open a result, and
      verify that an unavailable printing does not substitute another printing.
- [ ] Move one non-deck copy to a binder/box from its details sheet; confirm the
      destination persists after relaunch.
- [ ] Check light and dark mode plus larger iOS text on Scan, Collection and
      Settings: no clipped essential text, inaccessible action, or unreadable
      control.

If all seven pass, mark item 4 complete in `BACKLOG.md`. Follow-up work should
be based on a specific observed failure rather than the old blanket device-QA
blocker.

## Installation and startup

- [ ] Open ProjectUpkeep. Check the previous account, saved catalog, collection
      and locations remain available.
- [ ] Force-close and reopen. Check it runs without the computer or Metro.
- [ ] Open Settings and Collection while the database prepares. Scanning should
      wait for readiness; the other screens should remain usable.
- [ ] Relaunch in airplane mode with a saved catalog. Check offline catalog
      availability, then reconnect before testing account settings.

## Password: Settings → Account → Password

- [ ] Open Change password. All three fields conceal their contents and remain
      reachable above the keyboard.
- [ ] Try an empty current password, a new password shorter than eight characters,
      and mismatched confirmation. Each should show an actionable error.
- [ ] Try an incorrect current password with a valid new password. Expect
      “That current password isn't right”; the existing password should still work.
- [ ] Enter values and Cancel. Reopen: fields should be empty. Repeat by leaving
      Settings and by backgrounding the app.
- [ ] On a spare account, save a valid change. Expect “Password changed.” Sign
      out and back in using the new password; the old password should fail.
- [ ] Optionally tap Send password reset email once. Verify email delivery, the
      web reset flow, and login afterward. This sends a real email.
- [ ] Turn the network off and attempt a change. Expect a connection error and
      a usable screen; reconnect and retry.

## In-app alerts

These switches govern future inbox alerts on the account, not iOS push
notifications. Existing inbox entries stay visible.

- [ ] On an account with no saved preferences, Trade offers, Trade updates and
      Friend activity all start enabled.
- [ ] Toggle one category, wait for Saving to finish, and force-close/reopen.
      The selection should persist; other categories should keep their values.
- [ ] Disable networking after preferences load, then toggle a category. Expect
      rollback to the previous value and an error. Reconnect, tap Retry loading
      preferences, and save again.
- [ ] Sign into a second account. It should load its own preferences.
- [ ] From another account, send a proposal/counteroffer with Trade offers off.
      The trade should exist without a new inbox alert. Re-enable and repeat:
      a new alert should appear.
- [ ] Repeat with accepted/declined/cancelled trades while Trade updates is off,
      and friend requests/acceptances while Friend activity is off.
- [ ] Confirm the other categories still deliver alerts, old inbox entries
      remain, and re-enabling restores future alerts. Restore your preferences.

## Layout and accessibility

- [ ] Check light/dark themes: labels, errors and disabled switches are readable.
- [ ] Increase iOS text size: descriptions and feedback wrap without clipping;
      the whole Settings screen remains scrollable.
- [ ] Check VoiceOver names for password fields and each category switch.

## Earlier changes included in this build

Startup and mobile Scryfall search changes are also bundled. The matching web
endpoint was deployed and promoted to `https://project-upkeep.vercel.app` on
2026-09-26. No further phone installation is needed. Live probes confirmed JSON
401 responses for missing, malformed and invalid sessions. The owner subsequently
reported all search checks working on the phone (2026-09-26). Individual steps
were not separately reported; the checklist remains for regression testing.

- [ ] Search `t:legendary t:elf` and `otag:ramp`; check next/previous pages and
      an owned-only page with no matches.
- [ ] Open a result and confirm the exact printing. An unavailable printing
      should link to Scryfall without adding a different card.
- [ ] Try invalid syntax and network interruption; check errors and retry.
- [ ] Enable scan diagnostics, scan a known card, verify its exact printing,
      save once and confirm it appears in the collection.

For failures, record the checklist item, account (no passwords), network state,
expected/actual result and a screenshot. Include the scan-log entry for scanning.

## Scanner follow-up build: ambiguous printing and borderless capture

- [ ] Quick scan Mouth #216 and Book #116 with visible footers. Exact reads
      should open the correct printing without a confirmation requirement.
- [ ] Scan a card with multiple printings while covering only its collector
      line. If the footer and artwork cannot identify it, the details sheet
      should say the printing is unknown and disable Add/Wish until you select
      a printing or explicitly confirm the displayed version.
- [ ] Repeat in full Scan → continuous mode. An ambiguous card should not
      increase the session count. Tap Choose, select the correct version, then
      Add. Verify exactly one copy appears in the session.
- [ ] After confirming one ambiguous scan, scan the same card again. It must
      require a fresh confirmation rather than reuse the previous choice.
- [ ] Hold-and-slide quick Scan over Oliphaunt #426, with the whole card visible
      and a little space around it. Check it captures automatically and reads
      the footer. Also test automatic capture in the full Scan tab.
- [ ] Test a partial card, a distant card, an empty table and an unrelated
      rectangular object. They should not trigger a card capture.
- [ ] Confirm the manual Scan card button still captures Oliphaunt and selects
      #426. If automatic capture fails, record background/lighting and the hint.

Book #116 focus follow-up (2026-09-27):
- Quick scan the entire Book #116 card in steady light; hold still until capture.
  Repeat three times. Expect LTR #116 when collector text is readable.
- Start slightly blurred, then let the camera focus. Expect capture to wait for a
  sharper frame rather than immediately opening a blurry result.
- If collector text remains unreadable, expect a printing choice and blocked Add
  until you explicitly choose/confirm. A misread `0118` must not become #116 automatically.
- Recheck Mouth #216 and borderless Oliphaunt #426 for capture speed and printing.
