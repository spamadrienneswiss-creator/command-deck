# Command Deck: notes for Claude

Read this first in any new thread. It's the handoff from earlier work, so a fresh session can pick up without re-asking.

## Who and how
- Command Deck belongs to **Nick**. He builds it by talking with Claude and doesn't read or edit code himself, so explain changes in plain words, not code.
- **Mock up and recap before building.** New features and themes go on the design board first; build only after he says so.
- **One question at a time.** Keep replies short. Tone: JARVIS with some warmth: competent, a little dry, friendly.
- He decides when a session ends and how much to take on. Offer the next step; don't wrap things up for him.
- Design board comments: reply in that comment's thread (and resolve it unless a question is still open), then post one short line in chat.

## What it is
- **Command Deck**: a Windows desktop widget (Electron) with a sci-fi HUD. Clock, weather, voice "Computer", calendar, upcoming events, notepad, tasks / projects / schedule, timers, themes, iCUE lighting, and a Xeneon Edge layout.
- **Field Unit**: the iPhone web app (Firebase Hosting, project `command-deck-c3000`). It pairs with the deck and syncs both ways.
- **Deck Relay**: the shared-link pages. `/s/<token>` is the shared schedule (`field-unit/schedule.js`); project links use `manifest.js`.
- Design board (mockups): https://claude.ai/code/artifact/ddbcd5e0-9ea9-489d-8053-37ed33ea240d. Read its `project/canvas.json` before adding boards.

## Code map
- `main.js`, `preload.js`, `src/`: Electron main process (store, commands, calendar, iCUE/lighting).
- `renderer/`: the deck UI. `app.js` is the main app, `modals.js` holds the dialogs, `fieldunit.js` is the phone uplink and push.
- `shared/`: code used by both apps.
  - `sync.js` is the deck ⇄ phone sync. It **stamps and strips a top-level `by` field**, so never use `by` on synced items; schedule entries use `addedBy`.
  - `roster.js` is the shared-schedule relay. `manifest.js` handles project links.
- `field-unit/`: phone app and link pages. `npm run build:field` copies `shared/` and the fonts into it; run it after changing `shared/`.
- `firestore.rules`: who can read and write what. Guests may only add, edit or soft-delete their own entries, and only on READ + ADD links.

## Test, build, release
- `npm test` runs the unit tests. `npm run test:rules` needs the Firestore emulator; it runs in CI, since the emulator download is blocked in cloud sessions.
- Phone and link UI tests run in headless Chromium against a fake Firestore: `node tools/ui-tests/<name>.mjs`. Current ones: guest-test, sched-guest-test, phone-sched-test, phone-share-test, theme-shots. Screenshots go to `tools/ui-tests/out/`.
- Deck screenshots: `tools/deck-shots.js` (usage at the top of the file).
- **Release:**
  1. `node scripts/bump.js X.Y.Z`
  2. Commit, then `git push origin main`.
  3. The GitHub "Release" workflow tests, builds the Windows installer (published to GitHub Releases, so the deck auto-updates) and deploys Field Unit.
  4. Watch it with `tools/watch-release.sh Release <sha>`.
- Commit as `Claude <noreply@anthropic.com>`. Keep the README and FIELD-UNIT-SETUP.md in step with features.

## Where things stand (v1.15.0, Oct 2026)
Shipped recently:
- v1.14: Skydock and Vector themes, Dock Lights trim, switch panel, panel renames.
- v1.14.1: neural voice for the boot briefing. v1.14.2: sync tie fix.
- v1.15: one shared schedule with name chips, READ ONLY or READ + ADD links, a color per person, guest add / edit / delete, the owner's chip in Settings › Operator, and a look gear on the link.

Parked, mocked or discussed but **not built**. Nick will pick from these:
- **Themes:** Bay 9 (hangar), Overclock and Afterhours (Cyberpunk-inspired, with new fonts Teko + Red Hat Mono and Tilt Neon + Kode Mono). All on the board.
- **Standby screen** and **Now Playing** panel (on the board).
- **Stream Deck** integration ideas.
- **AI chat assistant** that runs deck actions as tools. Options: Gemini free tier, Ollama on the PC, or Claude API later. Make the model swappable, keep the key on the deck only, and confirm before deletes.
- **Push notifications to shared-link people** (Web Push, like the deck already does for the paired phone).
- **Royal Kludge keyboard lighting:** depends on the model; only a few RK models (wired) have community-made control.
- **Productivity ideas:**
  - Focus mode; quick-capture hotkey; morning top-3; time blocking.
  - Shutdown routine; leave-by alerts; routines with streaks.
  - Bills and renewals; shared lists; countdowns; weekly recap.
- More schedule revisions Nick is still thinking over.
- Scrapped: Discord mute.
