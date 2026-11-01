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
- Design board (mockups), "Dusk Console Widget": https://claude.ai/artifact/1156ujhTHeoA1qiJz377wU. Read its `project/canvas.json` before adding boards.
  - Since Nov 1, 2026 the board and the Claude work live on Nick's own Claude account; he is the person you're working with. The board was rebuilt there from the v1.16.0 backup.
  - Moving Claude accounts again? The board belongs to the account that made it. Back it up (`project/canvas.json` + every `*.dc.html`) and rebuild it on the new account from the Design type, then update the link here.

## Code map
- `main.js`, `preload.js`, `src/`: Electron main process (store, commands, calendar, iCUE/lighting).
- `renderer/`: the deck UI. `app.js` is the main app, `modals.js` holds the dialogs, `fieldunit.js` is the phone uplink and push.
- `shared/`: code used by both apps.
  - `sync.js` is the deck ⇄ phone sync. It **stamps and strips a top-level `by` field**, so never use `by` on synced items; schedule entries use `addedBy`.
  - `roster.js` is the shared-schedule relay. `manifest.js` handles project links.
- Data Recap: `renderer/recap.js` (the deck's pipeline: collect → save → decode → Whisper → Gemini), `renderer/audio.js` (m4a → 16 kHz), `renderer/recap-worker.js` (long-form Whisper), `src/gemini.js` (summary call, main process; the key never leaves the deck). The phone sends recordings as base64 pieces in `decks/{id}/recapChunks` plus a `recapUploads` doc (free plan has no Storage); the main console deletes them once saved. Audio lives in the app's `recaps` folder. A recap is a note with `src: 'recap'` and a `recap` object.
- Load-ups ("Signal"): deck in `renderer/index.html` + `bootSequence()` in app.js (`sg-` classes); phone and links share `field-unit/boot.js` + `boot.css` (`sb-` classes, since schedule CSS already uses `sg-`). Each page names its rows and wording in `data-` attributes on `#boot`. iPhone launch images are plain black (`scripts/make-launch-images.mjs`).
- Pages: page 2's panels and names in `settings.pages`; layouts in `layoutP2` / `layoutEdgeP2`; `setPage()` in app.js.
- `field-unit/`: phone app and link pages. `npm run build:field` copies `shared/` and the fonts into it; run it after changing `shared/`.
- `firestore.rules`: who can read and write what. Guests may only add, edit or soft-delete their own entries, and only on READ + ADD links.

## Test, build, release
- `npm test` runs the unit tests. `npm run test:rules` needs the Firestore emulator; it runs in CI, since the emulator download is blocked in cloud sessions.
- Phone and link UI tests run in headless Chromium against a fake Firestore: `node tools/ui-tests/<name>.mjs`. Current ones: guest-test, sched-guest-test, phone-sched-test, phone-share-test, signal-test (load-ups + Data Recap send), theme-shots. Screenshots go to `tools/ui-tests/out/`.
- Deck screenshots: `tools/deck-shots.js` (usage at the top of the file).
- **Release:**
  1. `node scripts/bump.js X.Y.Z`
  2. Commit, then `git push origin main`.
  3. The GitHub "Release" workflow tests, builds the Windows installer (published to GitHub Releases, so the deck auto-updates) and deploys Field Unit.
  4. Watch it with `tools/watch-release.sh Release <sha>`.
- Commit as `Claude <noreply@anthropic.com>`. Keep the README and FIELD-UNIT-SETUP.md in step with features.

## Where things stand (v1.16.0, Oct 2026)
Shipped recently:
- v1.14: Skydock and Vector themes, Dock Lights trim, switch panel, panel renames.
- v1.14.1: neural voice for the boot briefing. v1.14.2: sync tie fix.
- v1.15: one shared schedule with name chips, READ ONLY or READ + ADD links, a color per person, guest add / edit / delete, the owner's chip in Settings › Operator, and a look gear on the link.
- v1.16: Data Recap (Voice Memos → Field Unit → transcribed on the PC → Gemini summary; RECAPS tab on both; per-recording audio keep / 30 days / delete now); deck pages (page 2 with picked panels); the "Signal" load-up on the deck, Field Unit and both shared links. The Signal *theme* was mocked and turned down.

**No parked list.** The old backlog (Oct 31, 2026) was scrapped on purpose. Don't suggest or revive past ideas; wait for Nick to bring new revisions. Older mockups may still sit on the design board; treat them as archive, not a to-do list.
