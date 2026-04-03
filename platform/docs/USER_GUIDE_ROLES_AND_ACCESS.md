# User roles & access — guide for members and coordinators

This document explains **who can do what** in the Neighbourhood Watch web app. It matches how the app is built today (routes, admin tools, and database rules). Use it for onboarding and so everyone understands **why** a button or page might be missing.

---

## How roles work (big picture)

- Your **role** is stored on your **profile in the database** (`users.role`). You do not pick it yourself in the app; a **committee member or admin** assigns it when your account is set up or updated.
- The app checks your role to **show or hide** pages (for example the Admin panel) and to **block** actions you are not allowed to do (for example deleting another user’s account).
- **Database security** (Row Level Security and special “admin” functions) adds another layer: even if someone tried to bypass the website, the server can still refuse the action. This guide focuses on **what you see in the app**.

**Legacy note:** Very old accounts might have the value `patrol` instead of `patroller`. The app treats **`patrol` the same as `patroller`** for access.

---

## The role types (what they usually mean)

| Role | Typical meaning |
|------|-----------------|
| **admin** | Full operational control in the app: user deletion, hard-delete incidents, editing approved incidents, plus everything committee can do. |
| **committee** | Watch leadership: admin-style **panel** (users, moderation, patrol prints, chat logs) **except** a few **admin-only** actions (see below). |
| **patroller** | Active patrol member: incidents, patrol schedule, intelligence (where enabled), emergency chat, etc. |
| **investigator** | Often used like patroller for intelligence / incident work; same **broad** app access as patroller in most places. |
| **volunteer** | General member: can use core features; may have a lighter default depending on how your watch configures accounts. |
| **user** | Generic **logged-in member** role used for **intelligence** access in the app (search, profiles, create profile) when your watch uses this bucket for “standard” members. |

*Your watch may define day-to-day expectations differently; the table is how the **software** groups people.*

---

## What (almost) every signed-in member can do

After you **sign in** and accept the current **SOP** (standard operating procedure) in the app, you can normally reach:

- **Dashboard** — patrol status, shortcuts, refresh, sounds, theme  
- **Patrol schedule**  
- **Incidents** — list, **report new** incidents, open details, print views where provided  
- **Emergency chat**  
- **Profile** & **vehicles**  
- **Guide**, **About**, **Leaderboard** (as configured)

**Intelligence** (criminal database, search, new profile, profile detail) is available only to roles the app explicitly allows: **admin, committee, patroller, investigator, volunteer, user**. If your role is missing or not in that list, the Intelligence area will say you do not have access.

---

## Committee & admin — the “Admin panel”

Users with role **`admin`** or **`committee`** see an **Admin panel** entry on the Dashboard and can open:

| Area | Path (approx.) | Who |
|------|----------------|-----|
| Admin dashboard | `/admin` | Admin **or** committee |
| User management | `/admin/users` | Admin **or** committee |
| Print patrol logs | `/admin/print` | Admin **or** committee |
| Incident moderation | `/admin/incidents` | Admin **or** committee |
| Admin chat logs | `/admin/chat` | Admin **or** committee |

### User management — important difference

- **Committee and admin** can open **User management** and **change another person’s role** using the dropdown (volunteer, patroller, investigator, admin, committee).  
- **Only admin** sees the **Delete** action to remove another user’s account (auth + profile). Committee users do **not** get that delete column in the app.

---

## Admin-only actions (committee cannot do these in the app)

These are **restricted to `admin`** in the current app:

1. **Delete another user’s account** — the red **Delete** control on User management (committee can change roles but not use this).  
2. **Edit an already-approved incident** in the full editor — route `/incident/:id/edit` and the edit flow are **admin-only** (committee members use moderation workflows instead of this editor).  
3. **Hard-delete an incident** from incident detail — the destructive “delete incident” path is tied to an **admin-only** server function; the UI is shown only for admins.

If you need one of these and you are **committee**, ask your **admin**.

---

## Intelligence — “everyone” vs “committee only”

### All intelligence-eligible roles (admin, committee, patroller, investigator, volunteer, user)

Can use (subject to your watch’s policies):

- **Intelligence home** — search, new profile, profile detail, profile search  
- Routes such as `/intelligence`, `/intelligence/search`, `/intelligence/profiles/new`, `/intelligence/profiles/:id`

### Admin & committee only (extra intelligence tools)

These routes are **not** open to patroller / investigator / volunteer / `user` in the app:

- **Match queue** — `/intelligence/matches` (review suggested links between incidents and profiles)  
- **Mobile profile view** — `/intelligence/profiles/:id/mobile`  
- **Nearby threats** (placeholder) — `/intelligence/nearby`

On **Intelligence home**, **Match queue** and **Nearby threats** cards appear only for **admin** and **committee**. Other roles still see **Criminal database** and **New profile**.

---

## Quick reference — “Why can’t I see this?”

| Symptom | Likely reason |
|--------|----------------|
| No **Admin panel** on Dashboard | Your role is not **admin** or **committee**. |
| **Intelligence** says no access | Your role is not one of: admin, committee, patroller, investigator, volunteer, user — or role not set. |
| **Match queue** / **Nearby** missing | Only **admin** and **committee** get those entries and URLs. |
| **Delete user** missing on User management | Only **admin** sees account deletion. |
| **Edit incident** (full edit of approved incident) blocked | **Admin-only**; committee uses moderation, not this editor. |
| **Delete incident** missing | **Admin-only** destructive action. |

---

## SOP (acceptance)

Most main screens are behind **SOP acceptance**: you must complete the current SOP flow when the watch rolls out a new version. That is separate from role — it applies to **all** roles until you accept.

---

## For coordinators (how to use this doc)

- **Assign roles** in **User management** (admin/committee) to match duty: patrol vs committee vs admin.  
- **Admin** sparingly — it is the only role that can **delete users** and **hard-delete incidents** in the app.  
- If someone asks why a feature is missing, check their **role** and the tables above before assuming a bug.

---

*This guide reflects the application behaviour in the repository. Server-side policies may add further limits; if behaviour differs in production, check Supabase RLS and Edge Functions with your technical contact.*
