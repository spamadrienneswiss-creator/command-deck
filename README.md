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

- Since v1.27 the computer **doesn't listen**: you type to it in the terminal (below), and it can still answer out loud. Listening may come back once it's more reliable.
- The **first time**, it downloads the neural voice (about 90 MB), needing internet once. After that it runs entirely on the computer. Until it finishes downloading, the built-in Windows voice fills in.
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

### Discord mute and deafen (beside Hail)

Two small icons at the right end of the Ship Computer's Hail row show your Discord **mic** and **sound**, live: grey when you're live, coral with a slash when you're muted (MIC MUTED) or deafened (DEAFENED), faint outlines when Discord isn't running. They follow Discord however you change it (Discord itself, your Stream Deck, or here). Click the mic to mute or unmute, the headset to deafen or undeafen, or say *"mute me"*, *"unmute"*, *"deafen me"*, *"undeafen"* (to the Computer or Comm Tower 1).

**One-time setup** (Settings › System › DISCORD): Discord only lets apps you own use this, so make your own free one:
1. Open the [Discord Developer Portal](https://discord.com/developers/applications) › **New Application** (any name).
2. In **OAuth2**, copy the **Client ID**, then **Reset Secret** and copy the **Client Secret**.
3. Still in OAuth2, under **Redirects**, add `http://localhost` and save.
4. Paste both into Settings, press **CONNECT**, then click **Authorize** in the box Discord shows. The deck remembers it from then on. **FORGET** removes it.

The icons stay hidden until Discord is set up.

### The terminal (type to the ship computer)

Listening is switched off for now (v1.27): you type, and the deck answers, out loud too if you like.

- The Ship Computer's big button now reads **> _ OPEN TERMINAL**. Click it, or just **start typing anywhere on the deck**, and the terminal opens over the panels with what you typed already in it. It's the same as Field Unit's terminal: your lines in amber, replies below, a **✓ TASK LOGGED** card (or event, note, timer) when something's filed, and chips for Status report, What's next, Take a note, Add to calendar, Timer 10 min and Mute me (when Discord is connected).
- **Enter** sends, **Esc** closes, **↑ / ↓** bring back earlier commands. **VOICE REPLIES** in the terminal's header turns the spoken replies on or off (the text always shows).
- Everything the Computer understood by voice works typed: tasks, events, notes, timers and alarms, "what's next", "status report", "mute me".
- With a Gemini key, replies are worded conversationally and questions about your day get answered. When it offers to add something, type **yes** or **no**.

### Comm Tower 1 (the dial)

A small glowing core sits in the bottom-right corner of your main monitor, above everything else.

- **Click it** (or press **Ctrl + Alt + T** from any app) and it opens into a fan of keys over turning rings: **Record** (a meeting, into Data Recap), **Terminal** (the typing terminal), **Browser**, **Note** (the terminal, started with *take a note:*), **Files** (File Explorer) and **+** (your own shortcut). Hover a key and its name shows in the corner of the fan; click it, or press **1** to **6**. **Esc**, a click on the core, or a click anywhere else folds it away.
- **Your own shortcuts:** **+** asks for a website address, or lets you pick a program or a folder, and a name. Up to five; they sit on the inner arc with their initials. The same box lists them with **REMOVE**.
- **The terminal** pops up beside the core. Type, press Enter, and the reply shows there (and is spoken, if voice replies are on). It closes itself after a minute untouched.
- **Move it:** drag the closed core. Let go near any corner of any screen and it **locks to that corner** (the rings run off the screen's edge there), and stays on that monitor even if Windows reorders the displays. The fan opens toward wherever there's room.
- **Settings › System › COMM TOWER 1:** show or hide it, rename it, **BACK TO CORNER**, the **DIAL COLOR** (Eclipse, Sentinel, Prism, Halo, or Match theme; the dial keeps its own colors unless you pick Match theme), and the page the **Browser** key opens. The tray menu can show or hide it too.
- The deck does the work, so it needs to be running (it can be hidden in the tray).
- **Gemini** (with a key in **Settings › Field Unit › DATA RECAP**) words replies and answers questions from your tasks, calendar and schedule, which are sent to Gemini for that. No key, no signal, or too slow: the deck's own replies.
- **Record a meeting:** the dial's **Record** key (or the red **● REC** in the terminal's header, or type *record meeting*, optionally *called …*). Name it if you like and pick the sources: **computer audio** (everyone else on Zoom, Teams, a browser call) and **my microphone** (you); both are on. While it records, the terminal shows the time and two level meters with **STOP + RECAP**, **PAUSE** and **DISCARD**, and the core burns in the accent color with the running time under it, so you can close the terminal and keep working. Typing works too: *stop recording*, *pause recording*, *resume recording*, *discard recording*.
- When you stop, it goes through **Data Recap** like a phone recording: transcribed on this PC, then summarized by Gemini, and Comm Tower 1 tells you when the recap is ready in Notepad › RECAPS. The audio is saved every 10 seconds while it records, so if the deck closes mid-call, what was recorded is recapped the next time it starts.
- **Heads-up:** in California (and some other places) everyone on a call has to agree to being recorded. This doesn't announce itself the way Zoom's recorder does, so mention it when you start.

### Projects

Panel 06 has two views: **QUEUE** (the task list) and **PROJECTS**.
- The **QUEUE** keeps tasks that aren't in a project. Tasks in a live project live under **PROJECTS** instead, except ones due today or overdue, which stay in the queue tagged with their project. A line at the bottom ("+ 3 project tasks live under Projects") jumps there.
- **+ Project** starts one: a name, an optional goal, an optional finish-by date and a color.
- Each project is a group you can fold: its header shows progress, open and done counts and the finish-by date; click it to show or hide its tasks (check them off right there), **+ Add task**, and **Open project** for the whole project: **Edit**, the log, sharing, and **Mark complete** once everything is done. Each project remembers whether you left it open.
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

Panel 06's third tab, **SCHEDULE**, holds your work shifts and appointments, one week at a time. It's one **shared schedule**: everyone you send a link to sees the same entries, and every entry carries a **name chip** in that person's color (before the type chip), so you can tell at a glance who added what.

- **+ Add** makes an entry: a **type** (Appointment, LDC, Metro, Other, or **+ New Type** to make your own), a title, a date, an optional **start** and **end** time, and an optional note everyone sees. Click any entry to edit or delete it, including ones other people added.
- **Your chip:** set the name and color on your own entries in **Settings › Operator › YOUR CHIP ON SHARED SCHEDULES**. The entry editor shows **Shows as [chip]**.
- **‹ ›** step through the weeks; **THIS WEEK** jumps back.
- **SHARE** opens the share window: type their name, pick their **color** (colors already in use are dimmed), their access (**READ ONLY**, or **READ + ADD NEW ITEMS**) and when the link stops working (in 7 days, in 30 days, never), then press **CREATE LINK**. It's copied, with a QR code to scan. Everyone you've shared with is listed with their color, access, **COPY LINK** and **STOP** (press twice). Tap their color to recolor them, or their access to switch it, without sending a new link.
- **On their side** the link opens a page called **SCHEDULE**, one week at a time with everyone's name chips, type chips and notes (a note reads *"JORDAN: Can someone drive?"*). On a **READ + ADD** link they get **+ ADD TO SCHEDULE** (type, title, date, optional times, optional note, with a *Shows as* preview of their chip), plus **EDIT** and **DELETE** on the entries they added, and only those. The link opens with a short **DECK RELAY** load-up in the Signal style while it connects (its log shows the real steps, like their access and this week's entries) and ends on *"Welcome, Jordan."* with their name. Project links open the same way. On an iPhone they can tap **Share › Add to Home Screen** and it opens full screen, like an app.
- **Their look:** the gear next to their name opens **YOUR VIEW · ONLY ON THIS PHONE**: a theme (Dusk, Moonbase '79, Blueprint, Skydock, Vector, Horizon, Hi-Vis, Lumen, Meridian), a typeface (theme default, Michroma, Space Mono, VT323, Orbitron) and a frame (Dark, Bone, Midnight Navy). It only changes their phone; **USE [YOUR NAME]'S LOOK** puts yours back.
- **When someone adds, edits or deletes**, you get a toast and a line in the log, and the change goes out to everyone else's link.
- Types are managed in **Settings › Tasks & Crew › SCHEDULE TYPES** (rename, recolor, remove; a removed type's entries become Other).
- Like Project Manifest, guest changes come home through whichever of Command Deck or Field Unit is open. Until one of them is, a new entry shows on the phone that added it (marked **SENDING…**) and reaches everyone else once your app picks it up.

### Notepad

Panel 07 holds notes, shared with Field Unit on the phone.
- **+ Note** writes one; click any note to edit it, **Pin** it to the top, turn it into a task with **→ Task**, or delete it (click twice).
- The magnifier searches every note.
- Say or type **"take a note: …"** (also "note that…", "jot this down…") to the computer or the quick-add line.
- Each note is tagged with where it came from: *Typed*, *Voice*, *Comms* (the phone's terminal), or *Scanned* (from Field Scan, while it was on).
- Two tabs: **NOTES** and **RECAPS** (meeting recaps, below). When the panel is wide enough (on page 2, or dragged bigger) it splits into a list and a reading pane; click a note to read it there, double-click or **EDIT** to change it.

### Data Recap (meetings recorded on the phone)

Record a meeting or a long conversation on the iPhone, and Command Deck turns it into a transcript, a summary, the main points and a list of action items. Made for 30-minute to one-hour recordings.

1. **Record in Voice Memos** on the iPhone. It keeps recording with the screen locked or other apps open.
2. In Voice Memos, tap the recording's **···** › **Save to Files**.
3. In Field Unit: **Notes › DATA RECAP**, pick the recording, give it a title, choose what the recap includes and what happens to the audio afterwards, then **TRANSMIT TO COMMAND**. Keep Field Unit open until the upload finishes (a minute or two for an hour of audio on Wi-Fi); after that it's safe to close.
4. The main console picks it up, **transcribes it on this PC** with the same Whisper engine the voice uses (a few minutes for an hour with a decent graphics card, longer without), then asks Google's **Gemini** for the summary, main points and action items. The phone gets a notification when it's ready.

- Recaps live in **Notepad › RECAPS** on the deck and in **Notes › RECAPS** on the phone: **SUMMARY** (summary, main points, action items) and **TRANSCRIPT** (every line with its time, searchable on the phone). **→ TASK** turns an action item into a task, **→ ALL TO TASKS** does them all; on the phone, **ADD TO PROJECT** files them into a project and **COPY RECAP** copies the lot.
- **The audio** stays on the main console only (never in the cloud). Choose per recording when you send it: **KEEP**, **30 DAYS** (the default) or **DELETE NOW**, and change it later on the recap. **DELETE NOW** on the deck waits a few seconds with **UNDO**. The transcript always stays. The default is in **Settings › Field Unit › DATA RECAP**.
- **Summaries need a free Gemini key:** [aistudio.google.com](https://aistudio.google.com) › *Get API key* › *Create API key*, then paste it in **Settings › Field Unit › DATA RECAP**, press **TEST KEY**, then **SAVE**. It stays on this computer and never goes to the phone. Without a key you still get the full transcript, and **SUMMARIZE** on the recap fills in the rest once a key is added. On Google's free tier, what's sent to Gemini (the transcript, not the audio) may be used to improve Google's models.
- **How the recording travels:** through the deck's own Firebase database in small pieces, which the deck deletes as soon as it has the file. That keeps it on the free plan, which has no file storage. Recordings up to 150 MB work (well over an hour in Voice Memos' usual quality).
- If Command Deck is off when you send one, it waits and starts the next time the deck opens. If the PC goes off mid-transcription, it carries on from the saved audio. **TRY AGAIN** on a recap that needs attention starts it over.
- No speaker labels: the transcript is one continuous conversation.

---

### Layouts: standard and Xeneon Edge

Command Deck has two arrangements of the same panels. The **standard** layout suits a normal monitor. The **Xeneon Edge** layout re-stacks all seven panels across a wide, short touch strip like Corsair's 14.5" Xeneon Edge (2560 × 720), with slightly larger text and buttons for fingertips. Themes, fonts, ink, frames and trims work the same in both.

- **Settings › System › LAYOUT:** **AUTO** (the default) uses the Edge layout whenever the window is much wider than it is tall and the standard layout otherwise, switching as you move the window between screens. **STANDARD** or **XENEON EDGE** keeps one layout everywhere.
- **The LAYOUT chip** at the top of the deck flips between the two on the spot.
- Each layout remembers its own panel arrangement (unlock the layout to drag and resize), and **Reset layout** restores the one you're looking at.
- On the Xeneon Edge, Windows display scale of 100% or 125% gives the panels the most room; 150% works, but lists show fewer rows.

### Pages

The deck has two pages. **Page 1 (MAIN)** is always the whole deck, in your own arrangement. **Page 2 (WORK)** holds just the panels you pick, so they can be much bigger: by default a slim clock strip across the top with **Tasks** and **Notepad** filling the rest. Every tab still works on page 2 (QUEUE, PROJECTS and SCHEDULE on Tasks; NOTES and RECAPS on Notepad).

- **Flip pages** with the **PAGE · 1 / 2** chip at the top, `Ctrl` + `1` / `Ctrl` + `2`, a quick sideways swipe on a touchscreen like the Xeneon Edge, or say *"page two"*, *"go to the work page"*, *"main page"*, *"next page"*.
- **Settings › System › PAGES:** rename the pages and tap panels on or off for page 2 (at least one), with a small preview of how page 2 is laid out.
- Page 2 has its own arrangement, in both the standard and the Edge layout: unlock the layout there to drag and resize without touching page 1. The clock can shrink to a one-line strip on page 2.
- The deck remembers which page you were on.

### Rig lighting (Corsair iCUE)

Command Deck can light up your Corsair gear (fans, RAM, keyboard, mouse, strips) for a few moments, then hand it straight back to your iCUE profile. Everything else about your lighting stays exactly as iCUE has it.

1. In iCUE: ⚙ **Settings › SDK** (older versions: **Software and Games**) › turn on **iCUE SDK**.
2. In Command Deck: **Settings › LIGHTING** › switch on **Command Deck lights up for these moments**. The first time, it downloads Corsair's free iCUE SDK (about 350 KB) directly from Corsair. The panel then shows **ICUE LINK · CONNECTED** and your devices.
3. Pick the moments, set the brightness, and use **TRY THEM** to see each one, then **SAVE**.

The moments:
- **Boot sweep:** amber travels across the rig while Command Deck loads (inside the case first, then the desk) and turns green when it's ready.
- **Red Alert:** a red pulse when a timer or alarm goes off, a task reaches its due time without being done, or a calendar event starts. It stops when you dismiss or snooze the alert on the deck, or after 2 minutes.
- **Computer speaking:** a blue pulse while Command Deck talks.
- **Crew signals:** a green blip when someone adds to the shared schedule or checks off a shared task.

During quiet hours only timers and alarms light the rig. If the panel says it's waiting for iCUE, check that iCUE is running and the SDK switch is on; **RESCAN** looks again. If Armoury Crate (or another lighting app) also controls a device, give that device to one app only, or they'll flicker as they take turns.

## 4 · Field Unit (iPhone)

Once set up (see [FIELD-UNIT-SETUP.md](FIELD-UNIT-SETUP.md)), **Settings › Field Unit** shows the uplink status, a **Show pairing code** button (QR code plus a 6-character code, valid 10 minutes), the list of paired phones with **Unpair**, and **Unlink this console**.

- Tasks, projects, notes, the schedule, local events and timers sync both ways. Changes made without signal on either side are sent when the connection returns, and the newest edit wins.
- The console relays its calendars, categories, crew list and weather location to the phone.
- While the console is running, it sends the phone notifications for task reminders, alarms, and timers set on the phone.
- **Interface (Settings › Interface):** three looks for the same Field Unit. Switching is instant; tasks, schedule, notes, recaps and sync are shared.
  - **Cockpit** (after Starfield's cockpit): slate plates with clipped corners, a glowing dot-matrix clock on an inset screen with a ring for how much of the day has passed, an orange striped **▲ PRIORITY** plate for the first overdue task, **Next** and **Queue** plates, and a **Flight Plan** of the next five days. Hardware keys along the bottom (**BRIEF**, **AGENDA**, **QUEUE**, **NOTES**) and a command bar: type and send to open Comms with it. The gear at the top opens Settings.
  - **Hairline** (black and white, thin lines): a big light clock and your week drawn as an orbit, with today in the middle and the coming events as points around it (nearer days on the inner ring). One red dot and a vertical **OVERDUE** label for anything late. The same keys and command bar, drawn as outlines.
  - **Classic:** the original Field Unit in your color theme (the theme, typeface, frame and trim settings apply here).
  - In Cockpit and Hairline, **QUEUE** opens the look's own task screen (Queue / Projects / Done, tap the box to finish one, a tally or a week line at the top). Calendar, Notes and Settings open the classic screens in the look's colors, with **‹ Back to Field Unit** at the top; the tab bar's Today and Tasks also go back. Comms is restyled to match.
  - **Gemini in Comms (Cockpit / Hairline):** questions and chat (*"can I fit the dentist in before my shift?"*) go to Gemini, which sees your tasks, calendar and projects, and can offer to add something (*Add reminder · Not now*; nothing changes without your tap). Commands stay on Field Unit (instant, offline). Key: Settings › **Gemini** (free from aistudio.google.com; kept with your deck so every phone shares it; Wine Log's key is used until you add one). Without a key, questions get an honest "can't answer" instead of becoming tasks.
- The footer shows **UPLINK ONLINE · 1 FIELD UNIT** when everything is connected.
- **Notes tab:** the same notes as the desktop Notepad, synced within seconds. To copy text from paper, open a note, tap in the text and choose iPhone's own **Scan Text**; it reads printed pages and handwriting. (Field Scan, the in-app page reader, is switched off for now.) **DATA RECAP** at the top sends a Voice Memos recording to the deck for a meeting recap (see *Data Recap* above); recaps are listed under **RECAPS**.
- **Load-up:** Field Unit opens with the same *Signal* load-up as the deck, its log ticking through the real steps (local data, sync relay, Command Deck), then **SIGNAL LOCKED · Welcome back**.
- **Projects** on the phone: Tasks › **PROJECTS** shows the same foldable project groups (the queue leaves project tasks there too, except ones due today or overdue); tap a header to show its tasks, or **Open project** for + Add task, Edit and Mark complete. **SHARE** sends a Project Manifest link (see *Project Manifest* above), the crew strip shows who has access, and **PROJECT LOG** opens the project's shared board.
- **Schedule** on the phone: Tasks › **SCHEDULE** has the same week-by-week list, **+** to add an entry, **SHARE** to send the link (SEND opens iPhone's share menu) with the same color and access choices, and everyone's name chips on each entry. New types are added on Command Deck.
- **Comms Terminal:** the `>_` button in the middle of the tab bar opens a keyboard terminal. Type anything you'd have said to the computer (*"call sam thursday at 3, high priority"*, *"take a note: gate code 1357"*, *"new project garage cleanout"*). Field Unit prints its replies like a mainframe readout ("Copy." · "Transmitting data to Command…" · "Command acknowledges."), with a readout card for each change and an **UNDO** button. Deletes wait for **CONFIRM**, or type **y** / **n**. The chips above the keyboard are *Status report*, *Take a note*, *New project* and *Add to calendar* (the last three fill in the start of the command so you just finish the sentence, e.g. *schedule* → *dentist friday at 2*). Type **help** for examples. **CLEAR** (top right) or typing **clear** wipes the screen; **CLOSE TERMINAL** next to it puts the terminal away. The transcript stays while you switch between apps, and is wiped when Field Unit is closed completely (swiped away), so each launch starts fresh. Tap the readout to skip ahead.
- **Terminal sound:** Settings › Comms terminal sound: *Mainframe* (readout chirps, relay clicks and the low computer-room hum), *Soft* (gentle beeps only) or *Off*. Comms is keyboard-only; Cockpit and Hairline are silent.
- Field Unit's **Settings** (theme, typeface, frame, trim, sound, phrases) live behind the gear next to the weather on the Today screen. It has every color theme (only your starred ones show; **+ MORE** opens the full list with stars, shared with the deck) and the same Typeface, Text color, Frame and Panel trim choices.

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

### Wine Log (tasting journal on the phone)

A separate home-screen app for wine tastings, published with Field Unit at **your Field Unit address + `/wine/`** (for example `https://YOUR-PROJECT-ID.web.app/wine/`). Open it in Safari, **Share › Add to Home Screen**, then pair it like a phone: on the main console, **Settings › Field Unit › SHOW PAIRING CODE**, and enter the code in Wine Log. It shows in **PAIRED DEVICES** as *Wine Log · iPhone*.

- **Entries** follow the paper tasting sheet: date, where (Winery / Restaurant / Shop / Home), producer, wine name, vintage, classification, variety, region, label photo; **The Look** (red, white, rosé or sparkling, intensity, hue); **The Nose** (the aroma finder plus notes: seven families, Fruit, Floral, Herbal & Green, Spice, Oak & Toast, Earth & Mineral and Yeast & Cream, each opening into groups of aromas to tap; Fruit follows the style picked under The Look, and *Your aromas* lists the picks); **The Palate** (the same finder for flavors, with *Same as nose*, and tap-to-fill body, tannin, acidity, alcohol and sweetness, each with a note); **Final Thoughts** and a five-star rating.
- **Scan the label** takes a photo, keeps it as the label photo, and has Gemini read the producer, name, vintage, grape, region, classification and style into the form ("Not on label" when it isn't printed). It needs a free Gemini key pasted once in Wine Log's **Settings** (gear on the log screen); it's kept with the deck, so a re-paired phone keeps it. Without a key, scanning still saves the photo.
- **Where:** type a name and tap the magnifier to look it up (OpenStreetMap, no key). Pick a match to save its address with buttons that open it in **Maps** and on its **website** (or a web search when it has none). No match is fine; what you typed is kept.
- **My log:** newest first, with search (producer, grape, region, aroma, place, notes) and **All / Red / White / Rosé / Sparkling** filters. Tap a bottle for its page: the label photo, details, Edit and Delete.
- **Day and night:** the *Estate Terrace* look by day, the *Private Cellar* look after sunset, switching at real sunset (Los Angeles until you tap **Settings › Use my current location**). The sun / moon button flips it until the next sunrise or sunset.
- **No signal?** Entries save on the phone and sync when the connection returns. Photos are kept small (about 1,200 px) and stored in Firestore, so no paid Storage plan is needed.
- Unpairing Wine Log on the deck sends it back to its pairing screen; the tastings stay with the deck.

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
