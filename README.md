# COMMAND DECK

A sci-fi HUD desktop console for Windows 11: clock, month calendar, weather, upcoming events, a task queue, and a voice-driven ship's computer. Built with Electron.

Its iPhone companion, **Field Unit**, syncs tasks, projects, notes, events and timers with the console, and has a keyboard **Comms Terminal** that answers like a ship's mainframe. Setting it up is optional and free: see **[FIELD-UNIT-SETUP.md](FIELD-UNIT-SETUP.md)**.

---

## 1 · Install it

Download **Command-Deck-Setup-x.y.z.exe** from the latest release:
<https://github.com/spamadrienneswiss-creator/command-deck/releases/latest>
Run it. Nothing else needs installing: no Node.js, no command window.

**Updates are automatic.** Command Deck checks for a new version shortly after it starts and every few hours, and downloads it in the background. When one is ready, **UPDATE READY · RESTART** appears at the top of the console: tap it to restart into the new version, or just keep going and it installs the next time Command Deck closes. **Settings › System › Updates** shows the version you're on and has **CHECK NOW**.

> **Windows SmartScreen:** because the app isn't code-signed, Windows may say it "protected your PC" the first time the installer runs. Click **More info › Run anyway**. That's expected for homemade software, and it only happens on that first install; updates don't ask.

---

## 2 · First launch

The console boots up, then walks through a five-step setup:

| Step | What it sets |
|---|---|
| **Operator** | Their name (what the computer calls them) and the console's name |
| **Location** | City for the weather |
| **Calendars** | Any number of private calendar links (see below) |
| **Tasks & Crew** | Task categories, the "Assigned to" list, the default reminder |
| **System** | Motion level, sound level, window mode, clock style, °F/°C, computer voice, start with Windows, daily briefing |

Everything can be changed later from the **gear icon**.

### Getting a calendar link

- **Google Calendar:** open calendar.google.com on a computer › gear › **Settings** › click the calendar under "Settings for my calendars" › **Integrate calendar** › copy **Secret address in iCal format**.
- **Outlook.com:** Settings › Calendar › Shared calendars › **Publish a calendar** › copy the ICS link.
- **iCloud:** in the Calendar app, share the calendar › turn on **Public Calendar** › copy the link.

Paste as many as you like, give each a name and color, and use **Test links** to confirm they work. Linked calendars are read-only. Events added in the console go to its own **Local** calendar.

### The voice

- Tap the octagon mic button. The computer greets you, then listens. Speak, and pause when you're done (or tap again to finish).
- The **first time**, it downloads two small AI models, needing internet once: the listening model (about 80 MB) and the neural voice (about 90 MB). After that both run entirely on the computer, so audio never leaves it. Until the neural voice finishes downloading, the built-in Windows voice fills in.
- **Settings › System › Computer voice** picks the engine (Neural or Windows), the voice (Fenrir, a low American voice, is the default), and the speed, plus:
  - **Voice character:** *Robot companion* (a boxy built-in speaker with a faint metallic ring; the default), *Ship comms* (an intercom with a small room), *Radio* (a person on a two-way radio: thin, punchy, a little static, with a squelch click at each end), or *Off*.
  - **Depth:** lowers the pitch without slowing the voice down
  - **Effect strength:** from a clean voice to full effect
- **Humor setting** (Settings › System, 0–100%): 0% is strictly professional; higher settings add dry, deadpan remarks after the facts. You can also just say *"set humor to 75 percent."*
- If it can't hear anything, check **Windows Settings › Privacy & security › Microphone** and make sure **Let desktop apps access your microphone** is on.

Things it understands:

```
Call Sam Thursday at 3, high priority, work
Remind me to take out the trash every Tuesday at 7pm
Pay the electric bill by October 20th, assign to Alex
Water the plants every weekday
Put dinner with Jordan on the calendar Saturday at 7
Schedule dentist appointment next Wednesday from 2 to 3pm
What's my day look like?         (full briefing)
What's on my list?
What's next?
What's the weather?
Mark pay electric bill as done
Set humor to 75 percent
Take a note: gate code is 1357      Jot this down: oat milk, basil

New project garage cleanout         Add sweep the floor to the garage cleanout project
How's the holiday party project?    List my projects

Set a timer for 10 minutes          Start a 25 minute timer called focus
Wake me at 7                        Set an alarm for 6:30 PM tomorrow called gym
How much time is left?              Cancel the timer / Cancel all alarms
Snooze                              Remind me in 20 minutes

Move call Sam to Friday at 2     Push water the plants to tomorrow
Make electric bill high priority    Move book flights to work
Assign groceries to Alex            Delete book flights   (it asks "Confirm?" first; say yes)
```

The **quick-add line** at the bottom of the task queue understands the same phrasing when typed.

---

## 3 · Everyday use

- **Show / hide from anywhere:** `Ctrl` + `Alt` + `Space`
- **Minimize** (the — button) or close: it goes to the system tray. Right-click the tray icon for *Always on top*, *Start with Windows*, or **Quit**.
- **ON TOP / DESKTOP:** float above everything, or sit behind other windows like wallpaper.
- **Rearrange panels:** click the lock icon, drag panels by their header, and pull the amber corner to resize. Click the lock again to save.
- **Resize the whole console:** drag its bottom-right corner. Move it by dragging the header.
- **Tasks:** click a task to edit every field. Check it off; repeating tasks roll forward to their next date. Completed tasks clear the next day (finished tasks that belong to a live project stay with the project).
- **Calendar:** click a day to see events from that date; double-click a day to add an event.
- **Weather:** click the weather panel for the full forecast on weather.com.
- **Opacity:** Settings › System › Console opacity fades the whole console (30–100%) so the desktop shows through. It previews live as you drag.
- **Background darkness:** Settings › System darkens just the space between and behind the panels, from see-through to near-black.
- **Motion:** FULL (boot sequence, scan lines, pulses), SUBTLE (quieter), STILL (no animation). To stay light on the CPU, the looping animations run at an easy 10 frames a second (full speed while the computer is talking or listening), and they pause completely when nobody's at the PC: after 5 minutes without mouse or keyboard, when the screen is locked, or when the console is hidden. They pick up the moment you're back.
- **Sound:** FULL, KEY MOMENTS, or SILENT, in Settings › System.
- **Color themes:** Settings › System › Color theme: *Dusk* (amber, default), *Deep Space* (cyan), *Red Alert* (crimson), *Terminal* (green), *Retro* (colorful 80s terminal with scan lines), *Moonbase '79* (white plastic modules with an orange stripe), *Blueprint* (navy drafting grid with registration marks), *Cryo* (frosted white and ice blue), and *Freighter* (green phosphor, scan lines and a hazard stripe, after the ship in *Alien*).
- **Typeface:** Settings › System › Typeface. *Theme default* lets each theme use its own (Moonbase: Michroma, Blueprint: Space Mono, Cryo: Exo 2, Freighter: B612 Mono, the rest: Chakra Petch). Or pick any of Chakra, Michroma, Space Mono, Exo 2, B612 Mono, VT323, Orbitron, Oxanium, Rajdhani, Share Tech Mono or Major Mono with any theme.
- **Text color:** Settings › System › Text color: *Theme* (default), *Amber CRT*, *Phosphor*, *Ice*, *Arctic* or *Rose*. It recolors the main text only; accents, warnings and checkmarks stay with the theme. On the light themes each one switches to a deeper shade so it stays readable.
- **Frame:** Settings › System › Frame: *Dark* (the theme's own tray), *Bone* (warm off-white), *Gunmetal* (brushed dark grey), *Olive Drab* (military green) or *Midnight Navy* (deep blue with a faint grid). Works with every color theme and typeface.
- **Panel trim:** Settings › System › Panel trim adds a retro stripe across the top of every panel: *Sunset* (brick, orange, mustard), *Mission* (red-orange, cream, navy), *Arcade* (magenta, orange, yellow, teal), *Hazard* (yellow and black diagonal stripes), *Aurora* (teal, green, violet) or *Gulf* (powder blue with an orange stripe). Field Unit has the same Frame and Panel trim options in its own Settings.
- **Timers and alarms:** they appear as countdown chips in the ship computer panel; click × to cancel. When one finishes, it chimes, speaks, and shows an alert bar with **Snooze** and **Dismiss**. They survive a restart; alarms missed while the computer was off are noted in the log.
- **Reminders** show the same alert bar, with **Snooze**, **Mark done** and **Dismiss**.
- **Quiet hours** (Settings › Alerts, default 10 PM–7 AM): no speaking or sounds. Reminders still appear on screen, while timers, alarms and anything you ask for still make sound.
- **Red alert** (Settings › Alerts): if a task is overdue by more than the set time (default 1 hour), the frame glows red and pulses every few minutes until it's handled. With Motion set to STILL, it shows a steady red edge instead.

---

### Projects

Panel 06 has two views: **QUEUE** (the task list) and **PROJECTS**.
- **+ Project** starts one: a name, an optional goal, an optional finish-by date and a color.
- Each card shows progress (tasks done of total), the next open task and the finish-by date. Click a card for the whole project: open and done tasks, **+ Add task** (filed straight into it), **Edit**, and **Mark complete** once everything is done.
- Any task can join a project from the task editor's **Project** list.
- Say or type *"add buy string lights to the holiday party project"*. If that project doesn't exist yet, it's started for you. *"How's the holiday party project?"* reads out the progress; *"list my projects"* runs through them all.
- Deleting a project keeps its tasks in the queue.

### Project Manifest (sharing a project)

Send someone a link to one project so they can work through its checklist. It opens in any phone or computer browser, with no app or account. Their changes come straight back to Command Deck and Field Unit. Sharing runs through the Field Unit link, so set that up first ([FIELD-UNIT-SETUP.md](FIELD-UNIT-SETUP.md)).

- Open a project and press **SHARE** (on the phone: the **SHARE** pill at the top of the project).
- Type their name and choose what they can do:
  - **Check off only:** tick tasks done, and untick a mistake.
  - **Check off + notes:** also leave notes on tasks and post to the project log.
  - **Project administrator:** also add, rename, re-date and delete tasks.
- Choose when the link stops working: **when the project is done**, **in 7 days**, or **never**.
- **CREATE LINK** copies the link and shows a QR code. On the phone, **SEND…** opens iPhone's share menu (Messages, Mail, AirDrop).
- They see the project name, goal, progress and checklist (a page titled **PROJECT MANIFEST**). They never see other projects, your private task notes, reminders or anything else on the deck.
- **Crew on your side:**
  - Shared projects show the crew's initials on their cards.
  - Tasks show **DONE BY** or **ADDED BY** with their name, and their notes appear under the task.
  - Each change shows up as a toast and a line in the activity log.
- **Project log:** a running board inside the project for notes that aren't about a single task (*"dumpster arrives Friday"*). You and the crew can both post.
- **People with access** (the CREW chip, or SHARE again) lists everyone you've shared with and when they were last active. From there you can change someone's access, copy their link again, or **STOP** it (press twice). Stopping a link removes their copy of the project at once.
- **If the computer is off:** guests keep working. Field Unit relays their changes whenever it's open, and Command Deck catches up when it starts. With both off, guest changes wait on the link and are applied the moment either one comes online. Until then, other guests already see each other's check-offs.

### Schedule (shifts & appointments, shared by link)

Panel 06's third tab, **SCHEDULE**, holds your work shifts and appointments, one week at a time. Send it to someone by a link, and they can confirm each entry or ask for a change.

- **+ Add** makes an entry: a **type** (Appointment, LDC, Metro, Other, or **+ New Type** to make your own), a title, a date, an optional **start** and **end** time, and an optional note they'll see. Click any entry to edit or delete it.
- **‹ ›** step through the weeks; **THIS WEEK** jumps back.
- **SHARE** opens the share window: type their name, pick when the link stops working (in 7 days, in 30 days, never) and press **CREATE LINK**. It's copied, with a QR code to scan. Everyone you've shared with is listed with **COPY LINK** and **STOP** (press twice).
- **On their side** the link opens a page called **SCHEDULE**, one week at a time with your type chips and notes. Each entry has **GOT IT** and **CHANGE REQUEST**; a change request can carry a note, like *"Could you move it to Thursday?"*, or none at all (it shows as **NO NOTE** here, your cue to give them a call). The link opens with a short **DECK RELAY** load-up while it connects. On an iPhone they can tap **Share › Add to Home Screen** and it opens full screen, like an app.
- **Their replies** show on each entry here and on Field Unit (✓ GOT IT or ⚠ CHANGE REQUEST with their note), with a toast and a line in the log. **CHANGE DATE** under a request opens the entry with the date ready to change.
- **Changing an entry's date, time, title or type clears its replies**, so everyone confirms the new version.
- Types are managed in **Settings › Tasks & Crew › SCHEDULE TYPES** (rename, recolor, remove; a removed type's entries become Other).
- Like Project Manifest, replies come home through whichever of Command Deck or Field Unit is open.

### Notepad

Panel 07 holds notes, shared with Field Unit on the phone.
- **+ Note** writes one; click any note to edit it, **Pin** it to the top, turn it into a task with **→ Task**, or delete it (click twice).
- The magnifier searches every note.
- Say or type **"take a note: …"** (also "note that…", "jot this down…") to the computer or the quick-add line.
- Each note is tagged with where it came from: *Typed*, *Voice*, *Comms* (the phone's terminal), or *Scanned* (from Field Scan, while it was on).

---

### Rig lighting (Corsair iCUE)

Command Deck can light up your Corsair gear (fans, RAM, keyboard, mouse, strips) for a few moments, then hand it straight back to your iCUE profile. Everything else about your lighting stays exactly as iCUE has it.

1. In iCUE: ⚙ **Settings › SDK** (older versions: **Software and Games**) › turn on **iCUE SDK**.
2. In Command Deck: **Settings › LIGHTING** › switch on **Command Deck lights up for these moments**. The first time, it downloads Corsair's free iCUE SDK (about 350 KB) directly from Corsair. The panel then shows **ICUE LINK · CONNECTED** and your devices.
3. Pick the moments, set the brightness, and use **TRY THEM** to see each one, then **SAVE**.

The moments:
- **Boot sweep:** amber travels across the rig while Command Deck loads (inside the case first, then the desk) and turns green when it's ready.
- **Red Alert:** a red pulse when a timer or alarm goes off, a task reaches its due time without being done, or a calendar event starts. It stops when you dismiss or snooze the alert on the deck, or after 2 minutes.
- **Computer speaking:** a blue pulse while Command Deck talks.
- **Crew signals:** a green blip when someone taps GOT IT or checks off a shared task, coral for a change request.

During quiet hours only timers and alarms light the rig. If the panel says it's waiting for iCUE, check that iCUE is running and the SDK switch is on; **RESCAN** looks again. If Armoury Crate (or another lighting app) also controls a device, give that device to one app only, or they'll flicker as they take turns.

## 4 · Field Unit (iPhone)

Once set up (see [FIELD-UNIT-SETUP.md](FIELD-UNIT-SETUP.md)), **Settings › Field Unit** shows the uplink status, a **Show pairing code** button (QR code plus a 6-character code, valid 10 minutes), the list of paired phones with **Unpair**, and **Unlink this console**.

- Tasks, projects, notes, the schedule, local events and timers sync both ways. Changes made without signal on either side are sent when the connection returns, and the newest edit wins.
- The console relays its calendars, categories, crew list and weather location to the phone.
- While the console is running, it sends the phone notifications for task reminders, alarms, and timers set on the phone.
- The footer shows **UPLINK ONLINE · 1 FIELD UNIT** when everything is connected.
- **Notes tab:** the same notes as the desktop Notepad, synced within seconds. To copy text from paper, open a note, tap in the text and choose iPhone's own **Scan Text**; it reads printed pages and handwriting. (Field Scan, the in-app page reader, is switched off for now.)
- **Projects** on the phone: Tasks › **PROJECTS** shows the same project cards; tap one for its tasks, + Add task, Edit and Mark complete. **SHARE** sends a Project Manifest link (see *Project Manifest* above), the crew strip shows who has access, and **PROJECT LOG** opens the project's shared board.
- **Schedule** on the phone: Tasks › **SCHEDULE** has the same week-by-week list, **+** to add an entry, **SHARE** to send the link (SEND opens iPhone's share menu), and their replies under each entry. New types are added on Command Deck.
- **Comms Terminal:** the `>_` button in the middle of the tab bar opens a keyboard terminal. Type anything you'd have said to the computer (*"call sam thursday at 3, high priority"*, *"take a note: gate code 1357"*, *"new project garage cleanout"*). Field Unit prints its replies like a mainframe readout ("Copy." · "Transmitting data to Command…" · "Command acknowledges."), with a readout card for each change and an **UNDO** button. Deletes wait for **CONFIRM**, or type **y** / **n**. The chips above the keyboard are *Status report*, *Take a note*, *New project* and *Add to calendar* (the last three fill in the start of the command so you just finish the sentence, e.g. *schedule* → *dentist friday at 2*). Type **help** for examples. **CLEAR** (top right) or typing **clear** wipes the screen; **CLOSE TERMINAL** next to it puts the terminal away. The transcript stays while you switch between apps, and is wiped when Field Unit is closed completely (swiped away), so each launch starts fresh. Tap the readout to skip ahead.
- **Terminal sound:** Settings › Comms terminal sound: *Mainframe* (readout chirps, relay clicks and the low computer-room hum), *Soft* (gentle beeps only) or *Off*. Field Unit no longer listens or speaks; the voice stays on the desktop.
- Field Unit's **Settings** (theme, typeface, frame, trim, sound, phrases) live behind the gear next to the weather on the Today screen. It has all nine color themes and the same Typeface, Text color, Frame and Panel trim choices.

### A second Command Deck (another computer, like a Surface)

Run Command Deck on two computers with the same tasks, projects, notes and events on both.

1. On the second computer, run the same installer (from the [latest release](https://github.com/spamadrienneswiss-creator/command-deck/releases/latest)). Nothing else needs installing there, and it updates itself the same way.
2. On the **main console** (the one your phones are paired with): **Settings › Field Unit › SHOW PAIRING CODE**.
3. On the second computer: **Settings › Field Unit**. Paste the same Field Unit web address, enter the code under **OR JOIN ANOTHER COMMAND DECK**, and press **JOIN DECK**. Don't press LINK there, because that would start a separate deck.

What to expect:
- Tasks, projects, notes, the schedule, local events and timers sync both ways, with each phone too. Anything already on the second computer is added to the shared deck.
- Categories, crew, location, units and calendar feeds follow the main console, so change them there. Theme, typeface, frame, layout and window settings stay separate on each computer.
- Phones pair with the main console only. Phone notifications come from the main console; when it's off, the phone rings reminders itself whenever Field Unit is open, as before.
- The main console lists the second computer under **PAIRED DEVICES**, where **REMOVE** takes it off the deck. On the second computer, **LEAVE THIS DECK** does the same; its own copy of everything stays.

---

## 5 · Data & backup

- Everything is stored in one file: `%APPDATA%\Command Deck\command-deck.json`
- **Settings › Data › Export backup** saves a copy anywhere; **Restore from file** brings it back.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Weather says **NO SIGNAL** | Check the internet connection; it retries every 15 minutes. |
| Footer says **CAL FEED OFFLINE** | Hover over it to see which calendar and why. Re-copy that calendar's secret link. |
| Footer says **MIC CORE OFFLINE** | The listening model couldn't download. Connect to the internet and tap the mic again. |
| Footer says **VOICE SYNTH OFFLINE** | The neural voice couldn't download; the Windows voice is used meanwhile. It retries the next time the computer speaks. |
| The computer doesn't speak | Settings › System › Computer voice: make sure it's on, then press **Test voice**. Try the other engine if needed. |
| Footer says **UPLINK ERROR** | Settings › Field Unit shows the reason. It retries every minute on its own. |
| It doesn't start with Windows | Settings › System › Start with Windows (only applies to the installed app, not `npm start`). |

---

## For developers

```
npm start     # run in development
npm test      # command-parser, calendar and sync checks
npm run test:rules   # Firestore security rules against the emulator (needs Java)
npm run dist  # build the Windows installer locally
npm run build:core   # rebuild shared/core.js (Firebase + parser bundle)
npm run deploy -- --project ID   # publish Field Unit + security rules by hand
```

**Releasing an update** (GitHub Actions does the building and publishing):

```
npm run bump -- 1.11.1        # sets the version in package.json and both apps
git commit -am "v1.11.1" && git push
```

A push to main with a version that isn't released yet starts the full `.github/workflows/release.yml` (other pushes just run the checks): tests and the rules check, then the Windows installer is published as a GitHub Release (installed copies pick it up through electron-updater), then Field Unit, the shared-link pages and the rules are deployed to Firebase. Deploying needs the repository secret `FIREBASE_SERVICE_ACCOUNT` (a service-account key with the Firebase Admin role); see FIELD-UNIT-SETUP.md.

- `main.js`: window, tray, storage, IPC, private `deck://` file protocol
- `src/commands.js`: natural-language parsing (chrono-node)
- `src/calendar.js`: iCal feed download and recurring-event expansion (node-ical)
- `src/lighting.js` + `src/icue.js`: rig lighting moments through Corsair's iCUE SDK (koffi); `test/fixtures/fake-icue.c` stands in for the SDK in tests
- `shared/`: the sync engine (`sync.js`) and the bundled Firebase + parser (`core.js`), used by both apps
- `renderer/fieldunit.js`: the uplink (linking, pairing, sync, phone notifications via Web Push)
- `field-unit/`: the iPhone web app; `firestore.rules`: who can read what
- `renderer/`: the HUD (`app.js`), editors and settings (`modals.js`), synthesized sounds (`sound.js`), voice capture (`voice.js`) with the Whisper worker (`asr-worker.js`), and neural speech (`tts.js`) with the Kokoro worker (`tts-worker.js`)

Weather by [Open-Meteo](https://open-meteo.com). Speech recognition by Whisper via Transformers.js. Neural voice by Kokoro-82M via kokoro-js (Apache 2.0). Sync by Firebase (free Spark plan). Fonts: Chakra Petch, IBM Plex Mono, Share Tech Mono, Michroma, Space Mono, Exo 2, B612 Mono, VT323, Orbitron, Oxanium, Rajdhani and Major Mono Display (SIL Open Font License).
