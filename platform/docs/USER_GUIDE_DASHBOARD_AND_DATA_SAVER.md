# Dashboard & data settings — quick guide

This note is for **patrollers and coordinators** using the web app. It explains the buttons on the **Dashboard** header and the **Use less mobile data** option on **Profile**.

---

## Dashboard header buttons (top strip)

These controls sit on the green welcome bar, next to your avatar.

### Refresh (circular arrows)

- **What it does:** Pulls the **latest data right now** — who is on patrol and your **chat unread** count.
- **When to use it:** Any time you want an immediate update without waiting for the automatic background refresh (for example after someone starts a patrol or you return to the tab).
- **Note:** The app also refreshes patrol information on a timer in the background; Refresh simply does it **on demand**.

### Sound (speaker icon)

- **What it does:** Turns **in-app alert sounds** on or off (for example patrol sign-in tones and other notifications the app plays in the browser).
- **Where it’s saved:** Your choice is remembered **on this browser / device** only.
- **Muted:** You’ll still see on-screen updates; only the **audio** is silenced.

### Light / dark mode (sun or moon)

- **What it does:** Switches between **light theme** and **dark theme** for the whole app (easier reading at night or in bright sunlight).
- **Where it’s saved:** Your preference is stored **on this browser / device** so it stays the next time you open the app.

---

## Profile — “Use less mobile data”

You’ll find this under your profile details, with a switch labelled **Use less mobile data**.

### What it does

When **on**, the app **reduces how often it calls the server in the background** for routine updates (for example automatic patrol list refreshes and similar polling). That **uses less data** on mobile networks.

### Where your choice is saved

- The setting is stored **locally in your browser** (like other site preferences).
- It applies to **this device and browser only** — it does not change your account on the server.
- If you use another phone, tablet, or browser, set it there separately if needed.

### What stays the same (not “throttled” by this toggle)

The goal is to save data on **background checks**, not to block urgent tools. In particular:

- **Emergency chat** — sending messages and live delivery still work; the app does not turn off chat to save data.
- **Important actions you take** (reporting, uploads you trigger, etc.) are not disabled by this switch.

Background **automatic** refresh intervals are what run **less often** when the toggle is on.

### What feels slower or less “live” when the toggle is on

Because automatic polling runs **less frequently**:

- Lists that update on a timer (such as **who is currently on patrol** on the Dashboard) may refresh **less often** until you use **Refresh** or open the screen again.
- Any feature that relies on **periodic background checks** may feel slightly less “real-time” than with the toggle off.

If you need the freshest view, use the Dashboard **Refresh** button.

### Summary

| Toggle        | Typical effect                                      |
| ------------- | --------------------------------------------------- |
| **Off**       | More frequent automatic background updates (more data use). |
| **On**        | Fewer automatic background updates (less data use); use **Refresh** when you need the latest immediately. |

---

*If something behaves differently after a browser update, try toggling “Use less mobile data” off and on once, or use Refresh on the Dashboard.*
