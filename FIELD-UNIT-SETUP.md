# FIELD UNIT · One-time setup

Field Unit is Command Deck's iPhone companion. It runs as a web app installed to the Home Screen, so there's no App Store and no fee. The two sync through **Firebase**, Google's free app backend. You create a free Firebase project once, publish Field Unit to it with one command, and then pair phones by scanning a QR code.

**Time:** about 20–30 minutes. **Cost:** free (Firebase's Spark plan; no credit card). **You need:** the computer where you built Command Deck (Node.js already installed), a Google account, and the iPhone (iOS 16.4 or newer for notifications).

> **Whose account?** The Firebase project belongs to the Google account you create it with. The security rules let only paired devices read the data, but the project owner can view it in the Firebase console. If that matters, create the project with the recipient's Google account instead.

---

## Part 1 · Create the Firebase project (in a web browser)

1. Go to **<https://console.firebase.google.com>** and sign in.
2. **Create a project.** Name it something like `command-deck-home`. Turn **Google Analytics off** (not needed), then finish.
   - Write down the **Project ID** shown under the name (for example `command-deck-home` or `command-deck-home-3f2a1`). You'll need it in Part 2.
3. **Turn on anonymous sign-in.** In the left menu: **Build › Authentication › Get started › Sign-in method › Anonymous › Enable › Save.**
   This lets each device get a private ID without anyone creating a login.
4. **Create the database.** **Build › Firestore Database › Create database.**
   - If it asks for an edition, choose **Standard**.
   - **Location:** pick the region nearest you (for example `nam5 (United States)`). This can't be changed later.
   - Choose **Start in production mode**. Command Deck's own security rules replace the defaults in Part 2.
5. Leave the Firebase tab open. You don't need to set up Hosting in the console; Part 2 does it.

---

## Part 2 · Publish Field Unit (in the command window)

1. Open the `command-deck` folder in File Explorer, click the address bar, type `cmd`, press **Enter**.
2. If you haven't since unzipping this version, run:
   ```
   npm install
   ```
3. Sign the Firebase tools into your Google account (a browser window opens; approve it, then come back):
   ```
   npm run firebase-login
   ```
4. Publish, replacing `YOUR-PROJECT-ID` with the Project ID from Part 1:
   ```
   npm run deploy -- --project YOUR-PROJECT-ID
   ```
   Keep the `--` (two dashes, then a space) before `--project`. When it finishes, it prints:
   ```
   Hosting URL: https://YOUR-PROJECT-ID.web.app
   ```
   That address is Field Unit's home. Copy it.

> Got `Error: ... Cloud Firestore API has not been used` or similar? Part 1 step 4 isn't finished yet. Create the database, wait a minute, and run the deploy command again.

---

## Part 3 · Link Command Deck

On the computer running Command Deck (the recipient's PC):

1. **Gear icon › Settings › Field Unit.**
2. Paste the Hosting URL (`https://YOUR-PROJECT-ID.web.app`) and press **LINK**.
3. The status turns to **ONLINE** and the footer shows **UPLINK ONLINE**. Command Deck uploads its existing tasks and events now.

---

## Part 4 · Pair the iPhone

1. In **Settings › Field Unit**, press **SHOW PAIRING CODE**. A QR code and a 6-character code appear, valid for 10 minutes.
2. On the iPhone, open the **Camera** and point it at the QR code. Tap the link that appears. Safari opens Field Unit, showing **Almost there**.
3. Install it: tap **Share** (the square with an arrow) › **Add to Home Screen** › **Add**.
4. Open **Field Unit** from the Home Screen (not Safari), type the 6-character code from the computer screen, and tap **ESTABLISH UPLINK**.
   The phone says "Uplink established", and Command Deck shows it under **Paired field units**.
5. **Turn on alerts:** in Field Unit, tap **Settings › ENABLE ALERTS › Allow**.
   Command Deck now sends reminders, alarms and phone timers to the iPhone as notifications whenever it's running.
6. **Try the Comms Terminal:** tap the `>_` button in the middle of the tab bar and type *call sam thursday at 3, high priority*. Field Unit prints "Copy…", transmits to Command, shows a readout card with **UNDO**, and reports "Command acknowledges."

> Why pair inside the Home Screen app? iPhone keeps a Home Screen app's storage separate from Safari's. Pairing in Safari would leave the installed app unpaired.

### About the Comms Terminal

Field Unit is keyboard-only: it doesn't listen or speak (the desktop console keeps its voice). Everything you'd have said works typed:
- Deletes ask first: tap **CONFIRM** / **CANCEL** or type **y** / **n**.
- The chips: *Status report* runs straight away; *Take a note*, *New project* and *Add to calendar* fill in the start of the command ("take a note: ", "new project ", "schedule ") so you just finish typing.
- **help** lists examples. **CLEAR** (top right) or typing **clear** wipes the screen; **CLOSE TERMINAL** next to it puts the terminal away. The transcript stays while you switch apps and is wiped when you close Field Unit completely (swipe it away in the app switcher). If iPhone closes it in the background to save memory, that counts too.
- Sound: **Settings › Comms terminal sound**: *Mainframe* (readout chirps, relay clicks, low computer-room hum), *Soft*, or *Off*. The iPhone's silent switch mutes it.

### Make it yours

- **Callsign:** what the phone calls itself ("Field Unit online. Go ahead.").
- **Phrases:** *Settings › Edit what Field Unit says* lets you rewrite every line, one option per line (it picks one at random). Use `{name}`, `{callsign}` and `{title}` as placeholders.
- **Humor setting**, **color theme** (Dusk, Deep Space, Red Alert, Terminal, Retro, Moonbase '79, Blueprint, Cryo, Freighter, Skydock, Vector) **typeface** (theme default, or Chakra, Michroma, Space Mono, Exo 2, B612 Mono, VT323, Orbitron, Oxanium, Rajdhani, Share Tech Mono, Major Mono, Quantico, Tektur), **text color** (Theme, Amber CRT, Phosphor, Ice, Arctic, Rose), **frame** (Dark, Bone, Gunmetal, Olive Drab, Midnight Navy) and **panel trim** (Sunset, Mission, Arcade, Hazard, Aurora, Gulf, Dock Lights).

---

## Everyday notes

- **Swipe a task left** for Snooze, Done and Delete. Tap a task to edit everything.
- **Projects:** Tasks › **PROJECTS**. Tap **+** to start one, tap a card to see its tasks and add more.
- **No signal?** Field Unit says "Data stored locally" and transmits automatically when signal returns. The same goes for Command Deck.
- **COMMAND OFFLINE** on the phone means the computer is off, asleep or Command Deck isn't running. The phone keeps working. While Command is offline, timers and reminders ring on the phone whenever Field Unit is open.
- **Calendars** on the phone are the ones Command Deck reads, relayed when the console is running. Events added on the phone go to the console's Local calendar.
- **Another phone?** Show a new pairing code and repeat Part 4.
- **Another computer?** Install Command Deck there, then in its Settings › Field Unit enter the same web address and a pairing code from the main console under **JOIN DECK** (README › *A second Command Deck*). No extra deploy is needed.
- **Remove a phone:** in Command Deck › Settings › Field Unit, press **UNPAIR** next to it (the phone returns to its pairing screen), or on the phone, *Settings › Unpair this device*.

## Updating Field Unit later

From version 1.11 on, updates publish themselves: each new release on GitHub also deploys Field Unit, the shared-link pages and the security rules to your Firebase project, and phones pick up the new version the next time Field Unit opens. This needs a one-time key, so GitHub is allowed to publish to your Firebase project:

1. **Make the key.** In the [Firebase console](https://console.firebase.google.com), open your project › ⚙ **Project settings** › **Service accounts** tab › **Generate new private key** › **Generate key**. A small `.json` file downloads.
2. **Let it publish.** Open [Google Cloud › IAM](https://console.cloud.google.com/iam-admin/iam) (pick the same project at the top). Find the row whose principal starts with **firebase-adminsdk-**, click its pencil (**Edit principal**) › **Add another role** › search **Firebase Admin** › pick it › **Save**.
3. **Give it to GitHub.** On GitHub, open the command-deck repository › **Settings** › **Secrets and variables** › **Actions** › **New repository secret**. Name: `FIREBASE_SERVICE_ACCOUNT`. Secret: open the `.json` file in Notepad, select all, copy, paste. **Add secret**.
4. **Delete the `.json` file** from your Downloads (and empty the Recycle Bin). GitHub keeps it encrypted; nobody, including you, can read it back from there.

If you ever want to publish by hand instead, Part 2's `npm run deploy -- --project YOUR-PROJECT-ID` still works.

## Troubleshooting

| Symptom | Fix |
|---|---|
| LINK says **No Firebase project found** | Check the address is exactly the Hosting URL from Part 2, starting with `https://`. |
| **Firebase refused access** | The deploy didn't finish (rules missing) or Anonymous sign-in is off. Recheck Part 1 step 3, then rerun the Part 2 deploy. |
| **Code not recognized / expired** | Codes last 10 minutes. Press SHOW PAIRING CODE again. |
| No notifications | Field Unit must be opened from the Home Screen, iOS 16.4+, alerts enabled in Field Unit Settings, and Command Deck running on the computer. Check iPhone Settings › Notifications › Field Unit and any Focus mode. |
| No terminal sounds | Check the iPhone's silent switch and volume, and **Settings › Comms terminal sound**. |
| Old mic screen still shows | Close Field Unit fully (swipe it away) and reopen it to load the new version. |
| Share link says **Link not found** or **This link has ended** | The link was stopped, the project was finished (for "when done" links) or its 7 days passed. Share again to make a new one. If no share link opens at all, rerun the Part 2 deploy. |
| Guest's check-offs don't show up | Command Deck or Field Unit must be open somewhere to relay them. They arrive as soon as either one comes online. |
| Schedule link says **Link not found** or **This link has ended** | It was stopped, or its 7 or 30 days passed. Share again for a new one. If no schedule link opens at all, rerun the Part 2 deploy (v1.10 adds the schedule page). |
| Their GOT IT / CHANGE REQUEST doesn't show up | Command Deck or Field Unit must be open somewhere to bring replies in. They arrive as soon as either one comes online. |
| Phone shows old data | Pull it to the front and wait a few seconds; if Command shows **UPLINK ERROR**, see Settings › Field Unit on the computer. |

**Free-tier limits** (reads, writes, storage and bandwidth) are far above what one console and a few phones use.
