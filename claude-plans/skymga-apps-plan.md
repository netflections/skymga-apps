# skymga-apps Build Plan

## Overview

This document is a comprehensive build plan for the `skymga-apps` monorepo — a shared codebase powering the Sky Meadow Country Club Men's Golf Association (MGA) digital infrastructure. It is intended as a handoff document for Claude Code or any developer picking up this project.

The immediate deliverable is the **MGA Invitational Lottery app** (`invitational.skymga.org`), supported by a **shared Admin portal** (`admin.skymga.org`). A third app, **Calcutta** (`calcutta.skymga.org`), is planned but out of scope for this phase.

---

## Monorepo Structure

```
skymga-apps/
├── apps/
│   ├── invitational/     # invitational.skymga.org — Vite + React
│   ├── calcutta/         # calcutta.skymga.org — Vite + React (future)
│   └── admin/            # admin.skymga.org — Vite + React
├── packages/
│   ├── ui/               # Shared components, colors, logo, typography
│   ├── supabase/         # Shared Supabase client, TypeScript types, helpers
│   └── utils/            # Shared validation, date helpers, GHIN format check, etc.
└── supabase/             # Database schema, migrations, edge functions
```

**Package manager**: pnpm workspaces  
**GitHub repo**: `netflections/skymga-apps` (new repo, public)  
**Deployment**: Vercel Hobby — one Vercel project per app in `apps/`, each pointed at its subdirectory. All three auto-deploy on push to `main`.

---

## Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | Vite + React 18 + React Router v6 | Consistent with existing skymga-website |
| Styling | Tailwind CSS | Utility-first, works well in monorepo |
| Backend / DB | Supabase (free tier) | Postgres, Auth, RLS, Edge Functions, Realtime |
| Auth | Supabase Magic Link | Email-based, no passwords for members |
| Email | Resend (via Supabase Edge Function) | Transactional notifications |
| SMS | Twilio via toll-free number (via Supabase Edge Function) | Draw result notifications and configurable deadline reminders; toll-free verification chosen over 10DLC for simpler setup at low volume |
| Payments | PayPal Business (Individual) | Non-refundable deposit collection at acceptance; funds held in PayPal balance |
| Hosting | Vercel Hobby | Same as skymga.org |
| DNS | Cloudflare | Same as skymga.org — add A/CNAME records for new subdomains |

---

## Brand / Visual Identity

Match `skymeadow.com` and the existing `skymga.org` color scheme:

| Token | Value |
|-------|-------|
| Primary Blue | `#4B8DCC` |
| Dark Navy | `#1E3851` |
| White | `#FFFFFF` |
| Font | Sans-serif (match existing site) |

Logo assets are in the existing `skymga-website` repo:
- `mga_logo_v4.png` — standard logo
- `mga_logo_white_transparent.png` — white variant for dark backgrounds

Copy these into `packages/ui/assets/` so they're shared across all apps.

---

## DNS Configuration (Cloudflare)

Add the following records (gray cloud / DNS-only for all new subdomains, let Vercel handle SSL):

| Subdomain | Type | Target |
|-----------|------|--------|
| `invitational.skymga.org` | CNAME | `cname.vercel-dns.com` |
| `admin.skymga.org` | CNAME | `cname.vercel-dns.com` |
| `calcutta.skymga.org` | CNAME | `cname.vercel-dns.com` (future) |

---

## Supabase Setup

Create a single Supabase project shared by all apps. All apps in `packages/supabase/` share the same client instance and TypeScript types.

---

## Row Level Security (RLS)

RLS is enabled on all tables. The admin app uses the **service role key** (bypasses RLS entirely). The invitational app uses the **anon key** and is governed by the policies below.

`members.auth_uid` links Supabase Auth sessions to roster rows. On a member's first magic link login, the Edge Function `link-auth-uid` is invoked (triggered client-side immediately after the magic link session is established). It uses the service role key to look up the `members` row by email — if `auth_uid` is null, it writes `auth.uid()` from the session. All subsequent RLS checks use `auth.uid() = members.auth_uid`.

**`link-auth-uid` implementation notes:**
- Triggered client-side in the invitational app's auth callback handler (the page Supabase redirects to after magic link click)
- Reads `session.user.id` (the Supabase Auth UUID) and `session.user.email` from the active session
- Calls `UPDATE members SET auth_uid = $uid WHERE email = $email AND auth_uid IS NULL` using the service role key
- If no row matches (email not in roster), returns a flag — the app then shows "You are not currently an active MGA member."
- Idempotent: the `auth_uid IS NULL` guard means re-running on subsequent logins is safe

| Table | Anon Read | Anon Write | Notes |
|-------|-----------|------------|-------|
| `members` | Own row only (`auth.uid() = auth_uid`) | None — all writes via admin or Edge Functions with service role | |
| `registrations` | Own row only | Insert own row; no update | Updates (status changes, tokens) go through Edge Functions with service role |
| `tournaments` | All rows (public) | None | Members need to see tournament details |
| `tiers` | All rows (public) | None | Members need to see tier deadlines and info |
| `lottery_results` | Published results only (`tournaments.status = 'complete'`) | None | |
| `prior_year_winners` | All rows (public) | None | Displayed on public results page |
| `flight_winner_registrations` | Own row only | None | |

All Edge Functions run with the **service role key** and are not subject to RLS — this covers all post-draw status changes, token generation, payment capture, and notifications.

---

## Database Schema

### `members`
```sql
create table members (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text check (phone ~ '^\+1\d{10}$'),  -- E.164 format required for Twilio SMS (e.g. +16175551234); enforced on import and admin entry
  ghin text check (ghin ~ '^\d{7}$'),  -- 7-digit GHIN validation
  member_since date not null,
  is_active boolean not null default true,
  auth_uid uuid unique,  -- Supabase Auth UUID; set on first magic link login; used for RLS policies
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### `tournaments`
```sql
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year int not null unique,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'complete')),
  deposit_amount numeric(10,2) not null default 0,  -- non-refundable deposit in USD, set by admin
  last_confirmation_seq int not null default 0,      -- atomically incremented to generate confirmation numbers

  -- configurable timing windows
  seniority_acceptance_days int not null default 7,   -- acceptance window for flight winner + seniority tiers
  general_acceptance_days int not null default 7,     -- acceptance window for general tier
  waitlist_acceptance_hours int not null default 24,  -- acceptance window per individual waitlist promotion

  registration_opens_at timestamptz not null,           -- when general + seniority registration opens
  registration_deadline timestamptz not null,           -- when registration closes for all members
  flight_winner_registration_deadline timestamptz,      -- optional: when the flight winner exclusive window closes; must be <= registration_opens_at; general/seniority members see "Registration opens [registration_opens_at]" until this passes

  confirmation_cc_email text,  -- optional CC address on all "Registration Confirmed" emails
  timezone text not null default 'America/New_York',  -- IANA timezone for displaying all dates/times to members and admin (e.g. America/New_York handles EDT/EST automatically)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### `tiers`
```sql
create table tiers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  type text not null
    check (type in ('flight_winners', 'seniority', 'general', 'waitlist')),
  min_years int,          -- seniority tiers only: cumulative threshold (e.g. 15 = "15+ years")
  allocated_spots int not null,  -- use 0 to indicate unlimited (waitlist tier only)
  draw_date timestamptz,  -- nullable for waitlist tier (draw runs automatically after General draw)
  acceptance_deadline timestamptz,  -- pre-calculated at tier creation as draw_date + tournament acceptance window; displayed and editable by admin before draw runs; null for waitlist tier (each promotion calculates its own deadline as now() + waitlist_acceptance_hours)
  draw_order int not null,  -- sequence in which tiers are drawn (1 = first)
  reminder_hours_before_deadline int not null default 48,  -- how many hours before acceptance_deadline to send the reminder; default 48 for flight winner/seniority/general tiers, 12 recommended for waitlist tier
  created_at timestamptz not null default now()
);
```

### `registrations`
```sql
create table registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  member_id uuid not null references members(id),  -- no tier_id: tier association is recorded in lottery_results after the draw runs
  guest_name text not null,
  guest_email text not null,
  guest_phone text not null,
  guest_ghin text not null check (guest_ghin ~ '^\d{7}$'),
  registered_at timestamptz not null default now(),
  status text not null default 'pending'
    -- pending:      created, not yet drawn
    -- selected:     won a spot in the draw; awaiting acceptance/payment
    -- waitlisted:   in the waitlist queue, not yet promoted (acceptance_token IS NULL); status changes to 'selected' when promoted
    -- not_selected: transient status set by the General draw before the automatic waitlist draw runs; all not_selected members become 'waitlisted' moments later when the waitlist draw completes in the same operation
    -- expired:      was selected but acceptance deadline passed without payment or decline; still eligible for General tier draw
    -- declined:     member explicitly opted out; excluded from all subsequent tiers and waitlist
    -- withdrawn:    confirmed member removed by admin after payment; deposit handling tracked outside the system
    check (status in ('pending', 'selected', 'waitlisted', 'not_selected', 'expired', 'declined', 'withdrawn')),

  -- post-draw acceptance & payment
  acceptance_token text unique,                -- secure random hex token for the acceptance link
  acceptance_deadline timestamptz,             -- for tiers 1–5: denormalized from tiers.acceptance_deadline at draw time; for waitlist promotions: set to now() + tournaments.waitlist_acceptance_hours at promotion time
  accepted_at timestamptz,                     -- when member completed acceptance (payment confirmed)
  declined_at timestamptz,                     -- when member explicitly declined
  deposit_paid boolean not null default false,
  paypal_order_id text,
  confirmation_number text unique,             -- e.g. MGA-2026-XXXX; generated on payment completion
  confirmed_at timestamptz,
  reminder_sent_at timestamptz,     -- set when reminder is sent; prevents duplicate sends (window is configurable per tier via tiers.reminder_hours_before_deadline)

  unique(tournament_id, member_id)  -- one registration per member per tournament
);
```

### `lottery_results`
```sql
create table lottery_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  tier_id uuid not null references tiers(id),
  member_id uuid not null references members(id),
  draw_position int,      -- position drawn within tier (1 = first out); null for Tier 1 (flight winners, no random draw)
  result text not null
    check (result in ('selected', 'waitlisted', 'not_selected')),  -- draw outcome only; post-draw status changes (expired, declined) are tracked in registrations, not here
  drawn_at timestamptz not null default now()
);
```

### `prior_year_winners`
```sql
create table prior_year_winners (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  flight_name text not null,
  member_id uuid not null references members(id),
  guest_name text not null,
  created_at timestamptz not null default now()
);
```

### `flight_winner_registrations`
Tracks Tier 1 (flight winner) responses separately for status visibility.
```sql
create table flight_winner_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  member_id uuid not null references members(id),
  status text not null default 'no_response'
    check (status in ('accepted', 'declined', 'no_response')),
  responded_at timestamptz,  -- set on accepted (payment confirmed) or declined (decline button clicked); null for no_response
  unique(tournament_id, member_id)
);
```

**Row creation**: A `flight_winner_registrations` row is created (with `status = 'no_response'`) when the admin enters a member into `prior_year_winners` for a tournament. This gives the admin full visibility from day one — including flight winners who never register during the exclusive window. Status transitions:
- Stays `no_response` if the member never registers or lets the deadline pass without acting
- Set to `accepted` when deposit is paid (payment confirmed)
- Set to `declined` when member clicks Decline on the acceptance page

---

## Tier Configuration — Default Setup

For each tournament year the admin creates the following tiers (all values adjustable):

| Draw Order | Tier Name | Type | Spots | Reminder Window | Eligibility |
|-----------|-----------|------|-------|-----------------|-------------|
| 1 | Flight Winners | `flight_winners` | 6 | 48 hours | Prior year flight winners (same member; guest can differ) |
| 2 | 15+ Years | `seniority` | 4 | 48 hours | Members with 15+ years tenure |
| 3 | 10+ Years | `seniority` | 6 | 48 hours | Members with 10+ years tenure (includes 15+ members not yet selected) |
| 4 | 5+ Years | `seniority` | 8 | 48 hours | Members with 5+ years tenure (includes 10+/15+ members not yet selected) |
| 5 | General | `general` | 36 | 48 hours | All active members not yet selected in tiers 1–4 |
| 6 | Waitlist | `waitlist` | unlimited | 12 hours | All remaining registrants, drawn in order |

**Cumulative seniority model**: Seniority tiers use overlapping, cumulative eligibility — a member with 16 years of tenure is eligible for the 15+, 10+, and 5+ draws sequentially. Members already selected in an earlier tier are excluded from later tier pools. This rewards loyalty while the small spot allocations per tier keep the advantage bounded.

**Spillover rule**: After each acceptance window closes, any unallocated spots (insufficient registrants), explicitly declined spots, or expired spots (acceptance deadline passed without payment) from tiers 1–4 are added to the General tier allocation before that draw runs. Declined or expired spots from the General tier are added to the Waitlist pool.

---

## Tier Validation Rules

These rules are enforced both in the Admin UI (real-time) and on save (hard check):

1. Seniority tiers use cumulative (overlapping) eligibility — each tier has only a `min_years` threshold (e.g. 15+, 10+, 5+); `max_years` is not used
2. `min_years` values must be unique across seniority tiers (no two tiers with the same threshold)
3. `min_years` cannot be negative
4. Seniority tiers must be drawn in descending `min_years` order (most senior first)
5. A final gate check runs when the admin attempts to open the tournament for registration

**UX**: Display seniority tiers as a descending threshold list in the admin tier editor, showing how many roster members are eligible at each level.

---

## Flight Winner Logic

- Prior year flight winners are entered by the admin into `prior_year_winners` at the start of each tournament cycle.
- Flight winners receive an exclusive registration window (Tier 1 deadline) before general registration opens.
- Protection is tied to the **member**, not the member-guest pairing. A winner may bring a different guest.
- Flight winners register through the normal registration portal (authenticated, magic link). Submitting the form places them in a `pending` state — no token is generated and no notification is sent at registration time.
- When the admin triggers the lottery start, all Tier 1 flight winners who have registered are marked `selected`, acceptance tokens are generated, and email + SMS notifications go out in the same batch as the seniority tier draws. This keeps the entire acceptance window consolidated rather than spread over weeks.
- The acceptance link takes them to `/accept/<token>` where they pay the non-refundable deposit via PayPal. Payment completion generates their `MGA-{YEAR}-{XXXX}` confirmation number.
- `flight_winner_registrations.status` is updated on each outcome:
  - `accepted` — deposit paid; confirmation number issued
  - `declined` — member clicks "Decline" on the acceptance page
  - `no_response` — `acceptance_deadline` passes without payment or decline action
- All three statuses result in the same mechanical outcome: the spot rolls into the General tier allocation.
- Flight winners who do not claim their Tier 1 spot are still eligible to register in the General tier — non-response does not penalize them.
- Admin can see all three statuses in the draw console for visibility.

---

## Lottery Draw Logic

### Tournament Timeline

| Phase | Duration | Action |
|-------|----------|--------|
| Registration open | `registration_opens_at` → `registration_deadline` (set per tournament) | Flight winners register first during exclusive window; general + seniority members register once `registration_opens_at` is reached |
| Flight winner + seniority draws | Admin-triggered | Draws run sequentially; selected members receive acceptance links |
| Flight winner + seniority acceptance window | `seniority_acceptance_days` (default 7) | Members confirm (pay) or decline; expired/declined spots collected |
| General tier draw | Admin-triggered (after seniority window closes) | Spillover from tiers 1–4 added; draw runs; selected members receive acceptance links |
| General acceptance window | `general_acceptance_days` (default 7) | Members confirm or decline |
| Waitlist | Sequential; draw runs automatically after General draw completes, promotions automatic | One member at a time; `waitlist_acceptance_hours` (default 24) per member; next member promoted immediately on confirm/decline, or by daily cron on expiry |

All timing windows are configurable per tournament in `tournaments`. Tier `acceptance_deadline` is auto-calculated as `draw_date + acceptance_window` when the admin enters the draw date on a tier — pre-populated in the UI and editable before the draw runs.

### Draw Sequence

**Tier 1 — Flight Winners** (no lottery draw)
- All members who appear in `prior_year_winners` for this tournament and have submitted a registration are immediately marked `selected`
- No random draw — all registered flight winners are selected (up to `allocated_spots`). In the unlikely event more flight winners register than spots available, spots are awarded in registration order (`registered_at` ascending); overflow members are treated as General registrants. In practice `allocated_spots` should always equal the number of prior year flight winners.
- Record each selection in `lottery_results` with `result = 'selected'` and `draw_position = null` (no random draw order). This keeps the per-tier results history complete in one table.
- **Notification timing**: flight winner acceptance links are sent in the same batch as seniority tier notifications — i.e. when the admin triggers the lottery start. There is no separate "invitation" step; flight winners are pre-selected and notified at the same time seniority draws run. The admin triggers draws for Tiers 1–4 (flight winners + all seniority tiers) in one session; all notifications go out together.
- After `seniority_acceptance_days` window: declined + expired spots roll to General tier spillover

**Tiers 2–4 — Seniority** (lottery draw)
1. Collect eligible pool: registered members whose tenure meets `min_years` threshold, excluding anyone already selected in a prior tier or who has `status = 'declined'`
2. Fisher-Yates shuffle using `crypto.getRandomValues()` in a Supabase Edge Function
3. Assign `draw_position` 1..N to every entrant in shuffle order
4. Positions 1..`allocated_spots` → `selected`; remainder → `not_selected`
5. Record all results in `lottery_results`; update `registrations.status`
6. Send email + SMS acceptance links to selected members
7. After `seniority_acceptance_days` window: declined + expired spots roll to General tier spillover

**Tier 5 — General** (lottery draw)
1. Collect eligible pool: all registered members where `status IN ('pending', 'not_selected', 'expired')` — `expired` includes flight winners and seniority members who did not respond by their deadline; `declined` members are excluded
2. Automatically calculate spillover: count all declined + expired registrations from tiers 1–4, add to this tier's `allocated_spots`. The final `allocated_spots` value is saved to the `tiers` row and displayed on the public results page before and after the draw.
3. Same Fisher-Yates draw → `selected` / `not_selected`
4. Send email + SMS acceptance links to selected members
5. After `general_acceptance_days` window: declined + expired spots roll to Waitlist pool (increase available waitlist spots)

**Tier 6 — Waitlist** (sequential, runs automatically after General draw)
1. Triggered automatically as the final step when the admin completes the General draw. Fisher-Yates shuffle of all members with `status = 'not_selected'` — these are members who registered and went through the General draw but did not receive a spot. `expired` General tier members (selected but didn't respond) are excluded — their spots open up additional waitlist promotions but they do not join the waitlist queue themselves.
2. Assign permanent `draw_position` (1..N) to every member in shuffle order. Update all of their `registrations.status` to `waitlisted`. Record results in `lottery_results` with `result = 'waitlisted'`. Send "you're on the waitlist" email to all members with their draw position.
3. Position 1 is immediately promoted: status set to `selected`, acceptance token generated, `acceptance_deadline` set to `now() + waitlist_acceptance_hours`, email + SMS sent. All other positions remain `waitlisted` with no token.
4. When position 1 confirms or declines → position 2 receives their link immediately. When position 1's window expires → position 2 is promoted by the daily cron (up to ~24 hour delay).
5. Continues sequentially until all available spots are filled or the waitlist is exhausted
6. Daily cron detects expired waitlist windows and promotes the next member
7. Note: with a once-daily cron, there may be up to a ~24-hour gap between a waitlist expiry and the next promotion — this is expected behavior

Draws for Tiers 1–5 are **manually triggered** by the admin per tier (button in the draw console) with a confirmation step. The Tier 6 waitlist draw runs automatically as the final step of the General draw — no separate admin action required. Results are not published to the public results page until the admin explicitly publishes them.

---

## Scheduled Jobs

Runs via **Vercel cron jobs** (available on Hobby plan) — hosted in the `apps/invitational` Vercel project since that's where registrations are managed. Triggered once daily.

Configured in `apps/invitational/vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/reminders", "schedule": "0 10 * * *" },
    { "path": "/api/cron/expire-acceptances", "schedule": "0 10 * * *" }
  ]
}
```

Both run at 10:00 AM UTC daily. Endpoints are protected — Vercel sets an `Authorization: Bearer <CRON_SECRET>` header; endpoint rejects requests without it.

| Job | Endpoint | Logic |
|-----|----------|-------|
| Reminder | `GET /api/cron/reminders` | Find all `registrations` where `status = 'selected'`, `deposit_paid = false`, `declined_at IS NULL`, `reminder_sent_at IS NULL`, and `acceptance_deadline <= now() + tiers.reminder_hours_before_deadline hours` (join registrations → tiers to get the per-tier window). Send email + SMS, set `reminder_sent_at = now()`. Covers both regular draw winners and promoted waitlist members (promoted members have `status = 'selected'`). `reminder_sent_at` guard prevents duplicate sends. Per-tier reminder window is configured in `tiers.reminder_hours_before_deadline` — default 48 hours for flight winner/seniority/general tiers, recommended 12 hours for the waitlist tier. |
| Expiry + waitlist promotion | `GET /api/cron/expire-acceptances` | Find all `registrations` where `status = 'selected'`, `deposit_paid = false`, `declined_at IS NULL`, `acceptance_deadline < now()`. Set `status = 'expired'`. Expired flight winner/seniority members remain eligible for the General tier draw; expired General tier members are added to the Waitlist pool. For expired members who were promoted from the waitlist (identifiable via `lottery_results.result = 'waitlisted'`): promote the next waitlist member — find the lowest `draw_position` where `status = 'waitlisted'` and `acceptance_token IS NULL`, set their status to `selected`, generate acceptance token, set `acceptance_deadline = now() + waitlist_acceptance_hours`, send email + SMS. |

Add `CRON_SECRET` to Vercel environment variables (a long random string); set it in both the Vercel dashboard and locally in `.env`.

---

## Application Modules

### Admin Portal (`admin.skymga.org`)

**Authentication**: Supabase Auth — email/password for admin accounts (not magic link; admins need reliable access)

**Admin account setup**: The admin account is `admin@skymga.org`. To create it, go to the Supabase dashboard → Authentication → Users → "Invite user" (or use the Supabase CLI: `supabase auth admin createuser --email admin@skymga.org --password <password>`). The app should have no public signup route — only pre-created accounts can log in to the admin portal. Add a guard in the admin app that redirects unauthenticated users to the login page and rejects any email that is not on an allowlist (or simply relies on the fact that no signup UI exists).

**Member Roster**
- View, search, add, edit, deactivate members
- Fields: first name, last name, email, phone, GHIN (7-digit validated), member_since, is_active
- Bulk import from `.xlsx` — map columns from the existing `MGA_Members_Email_2026.xlsx` format
- Export current roster to `.xlsx`
- Member tenure is calculated dynamically from `member_since` — not stored

**Tournament Management**
- Create tournament (name, year, description, deposit amount, confirmation CC email, timezone)
- Set tournament-level registration window: `registration_opens_at`, `registration_deadline`, and optionally `flight_winner_registration_deadline` (must be ≤ `registration_opens_at`)
- Set tournament timing windows: seniority acceptance window, general acceptance window, waitlist acceptance window (all pre-populated with defaults, editable)
- All date/time fields require both date and time — displayed and stored in the tournament's configured timezone; stored as `timestamptz` (UTC) in the database
- Configure tiers: add/remove tiers, set type, name, allocated spots, draw date, draw order; acceptance deadline auto-calculated as `draw_date + acceptance_window` when draw date is entered, displayed and editable before the draw runs; waitlist tier has no draw date or acceptance deadline
- For seniority tiers: set min_years with real-time validation (uniqueness across tiers, descending draw order enforcement)
- Set prior year flight winners (select from member roster, enter flight name and guest name)
- Tournament status lifecycle: `draft` → `open` → `closed` → `complete`
- Gate check before opening: validates tier configuration is complete and valid

**Draw Console**
- Shows current tier status: registration count, deadline, draw date, allocated spots, acceptance deadline
- Run draw button per tier (disabled until prior tier is complete and deadline has passed)
- Confirmation modal before running draw
- Preview results before publishing
- Publish results button (makes results publicly visible)
- Per-tier results table: member name, draw position, acceptance status (`pending` / `accepted` / `declined` / `expired`), deposit paid, confirmation number
- Withdrawal management: mark a confirmed member as `withdrawn` (admin-only; no member-facing UI); sets `registrations.status = 'withdrawn'`; auto-promotes next waitlist member (new acceptance link sent immediately). Deposit handling and any refund decisions are tracked outside the system.
- Expired acceptance tracking: daily cron handles auto-expiry; admin dashboard shows current state per member
- Waitlist queue view: shows full waitlist in draw order, current active member, their window expiry, and status of each position
- Flight winner status dashboard: shows `accepted` / `declined` / `no_response` per flight winner

**Historical Data**
- Browse past tournament results by year
- View full results per tournament including all tiers

---

### Invitational App (`invitational.skymga.org`)

**Authentication**: Supabase Magic Link — member enters email, receives a login link, no password required

**Registration Portal** (authenticated)
- System checks on login:
  - If `members.auth_uid` is null for this email, write the Supabase Auth UUID (first login only)
  - Is member active in the roster? If not → "You are not currently an active MGA member."
  - Have they already registered for the current tournament? If yes → show registration status
  - Determine eligible tier: check `prior_year_winners` first (flight winner), then tenure (seniority), then general
  - Check registration eligibility against tournament-level fields:
    - Flight winners: eligible to register from now until `tournaments.flight_winner_registration_deadline`
    - General/seniority members: eligible from `tournaments.registration_opens_at` to `tournaments.registration_deadline`
    - Before opens → "Registration opens [date/time in tournament timezone]"
    - After deadline → "Registration is closed"
    - General/seniority members who access during the flight winner exclusive window (before `registration_opens_at`) see "Registration opens [registration_opens_at]"
    - Otherwise → show registration form
- Registration form: guest name, guest email, guest phone, guest GHIN (all required)
- Confirmation shown after submission
- Transactional email sent on registration (via Supabase Edge Function + Resend)

**Acceptance & Payment** (secure token link — no login required)
- When a tier draw completes, selected members immediately receive a secure link via both email and SMS
- Link format: `invitational.skymga.org/accept/<token>` — token is a cryptographically random hex string stored in `registrations.acceptance_token`; expires at `acceptance_deadline`
- The acceptance page (no auth required — token is the credential) shows:
  - Member name, guest name, tier selected in, draw position
  - Tournament details
  - Deposit amount and PayPal payment button
  - Acceptance deadline countdown
- On successful payment:
  - `registrations.deposit_paid` set to `true`
  - `registrations.confirmed_at` and `accepted_at` set
  - `registrations.paypal_order_id` stored for reference
  - `registrations.confirmation_number` generated in format `MGA-{YEAR}-{XXXX}` (zero-padded sequential per tournament)
  - Confirmation email sent to member with printable confirmation number and tournament details
  - Confirmation page displayed with the number, also printable
- Member presents printed confirmation number to the Pro Shop to finalize registration
- The acceptance page shows a **Decline** button available to all selected members (flight winners, seniority, general, and waitlist). To activate it, the member must first check an acknowledgment checkbox:
  > *"I understand that by declining, I am opting out of the [YEAR] MGA Invitational. My spot will be released and offered to the next member on the waitlist."*
- On confirmed decline: `registrations.status = 'declined'`, `registrations.declined_at = now()`; if flight winner: `flight_winner_registrations.status = 'declined'`, `responded_at = now()`. Spot is immediately released to spillover — no need to wait for deadline expiry. If the declining member is a waitlist member (their spot was promoted from the waitlist), the next waitlist member is promoted immediately — token generated and email + SMS sent right away. The daily cron handles expiry-based promotion; explicit decline triggers promotion immediately.
- If the token is expired (past `acceptance_deadline`): page shows an expired message; their spot has been released

**Member History** (authenticated)
- Table of past registrations: year, tier registered in, result (selected / waitlisted / not selected), guest name
- Read-only

**Public Results Pages** (no authentication required)
- Current tournament: results per tier, draw date, selected teams, waitlist order
- Historical results browsable by year
- No auth gate — anyone can view
- Sky Meadow branded, consistent with skymga.org color scheme
- Link from main skymga.org site navigation to invitational.skymga.org

---

### Shared Packages

**`packages/ui`**
- Brand tokens (colors, typography)
- Logo assets (mga_logo_v4.png, mga_logo_white_transparent.png)
- Shared React components: Button, Input, Table, Badge, Modal, Card, Navbar
- Tailwind config (shared)

**`packages/supabase`**
- Supabase client initialization
- TypeScript types generated from schema (`supabase gen types typescript`)
- Helper functions: `getMemberTenure()`, `getEligibleTier()`, `isRegistrationOpen(tournament, memberType, now)` — checks tournament-level registration window; uses `flight_winner_registration_deadline` for flight winner members, `registration_opens_at`/`registration_deadline` for all others

**`packages/utils`**
- GHIN validation: must be exactly 7 digits (`/^\d{7}$/`)
- Date helpers: deadline checking, tenure calculation
- Tier band validation: gap/overlap detection logic (shared between admin UI and server-side checks)

---

## Email Notifications

Triggered via Supabase Edge Functions + Resend:

| Trigger | Channel | Recipient | Content |
|---------|---------|-----------|---------|
| Registration submitted | Email | Member | Confirmation with guest details and tier info |
| Selected in draw | Email + SMS | Member | Secure acceptance link, deposit amount, acceptance deadline |
| Waitlisted (General draw complete) | Email | Member | Waitlist draw position, total waitlist size, what to expect next — sent when the waitlist draw runs, not at the time of the General draw result |
| Deadline reminder (unconfirmed) | Email + SMS | Member | Reminder with acceptance link, deadline, deposit amount; sent once per selection when `acceptance_deadline` is within `tiers.reminder_hours_before_deadline` hours (default 48h; 12h recommended for waitlist tier); guarded by `reminder_sent_at`; declined members excluded |
| Promoted from waitlist | Email + SMS | Member | Spot opened, new secure acceptance link, deadline |
| Flight winner invitation | Email + SMS | Member | Sent when admin triggers the lottery start (same batch as seniority tier selections) — exclusive window open, acceptance link, deposit amount, acceptance deadline |
| Member declines spot | Email | Member | Confirmation of decline; reminder they are excluded from subsequent tiers and waitlist |
| Deposit paid / accepted | Email (+ CC to `confirmation_cc_email` if set) | Member | Printable confirmation number (`MGA-{YEAR}-{XXXX}`), tournament details, Pro Shop instructions |
| Acceptance deadline expired (no payment) | Email | Member | Spot released notification |

---

## PayPal Integration — Implementation Detail

### Edge Functions

Three Edge Functions handle the payment lifecycle:

**`paypal-create-order`** — called when the acceptance page loads
```
POST /functions/v1/paypal-create-order
Body: { token: string }

1. Validate token: look up registrations where acceptance_token = token
   - If not found → 404
   - If deposit_paid = true → 409 (already paid)
   - If status = 'withdrawn' → 410 (registration cancelled by admin)
   - If declined_at IS NOT NULL → 410 (declined — spot already released)
   - If acceptance_deadline < now() → 410 (expired)
2. Fetch tournaments.deposit_amount for the tournament
3. Call PayPal POST /v2/checkout/orders with:
   - intent: "CAPTURE"
   - amount: { currency_code: "USD", value: deposit_amount }
   - description: "MGA Invitational Deposit"
   - custom_id: registration.id  ← used by webhook to look up the registration
4. Overwrite paypal_order_id on the registration (member may revisit page; always use latest order)
5. Return { orderID } to the browser
```

**`paypal-capture-order`** — called after member approves payment in PayPal UI
```
POST /functions/v1/paypal-capture-order
Body: { token: string, orderID: string }

1. Validate token (same checks as above)
2. Verify orderID matches registrations.paypal_order_id
3. Call PayPal POST /v2/checkout/orders/{orderID}/capture
4. On successful capture (status = "COMPLETED"):
   a. Atomically increment tournaments.last_confirmation_seq:
      UPDATE tournaments SET last_confirmation_seq = last_confirmation_seq + 1
      WHERE id = $tournament_id
      RETURNING last_confirmation_seq, year
   b. Format confirmation number: MGA-{year}-{seq zero-padded to 4 digits}
      e.g. MGA-2026-0001
   c. Update registration in one statement:
      SET deposit_paid = true,
          accepted_at = now(),
          confirmed_at = now(),
          confirmation_number = 'MGA-2026-0001'
   d. Trigger confirmation email via Resend (async — do not block response)
5. Return { confirmationNumber } to browser
6. Browser renders confirmation page with number and print instructions
```

**`paypal-webhook`** — safety net for missed captures (e.g. browser closed mid-flow)
```
POST /functions/v1/paypal-webhook

1. Verify PayPal webhook signature using headers:
   PAYPAL-AUTH-ALGO, PAYPAL-CERT-URL, PAYPAL-TRANSMISSION-ID,
   PAYPAL-TRANSMISSION-SIG, PAYPAL-TRANSMISSION-TIME
   Call PayPal POST /v1/notifications/verify-webhook-signature
   Reject if invalid.
2. Handle event type PAYMENT.CAPTURE.COMPLETED:
   - Look up registration using resource.custom_id (the registration ID set at order creation)
   - If deposit_paid = true → already handled by capture endpoint, skip
   - If deposit_paid = false → run steps 4a–4d from capture flow above
3. Return 200 immediately (PayPal retries on non-200)
```

### Confirmation Number Generation

Atomic increment pattern — no duplicate numbers possible even under concurrent payments:

```sql
-- Postgres function called inside the capture transaction
create or replace function generate_confirmation_number(p_tournament_id uuid)
returns text
language plpgsql
as $$
declare
  v_year int;
  v_seq  int;
begin
  update tournaments
     set last_confirmation_seq = last_confirmation_seq + 1
   where id = p_tournament_id
  returning last_confirmation_seq, year
    into v_seq, v_year;

  return 'MGA-' || v_year || '-' || lpad(v_seq::text, 4, '0');
end;
$$;
```

Called from the Edge Function inside the same transaction as the `deposit_paid` update so the number is only assigned on a successful, committed payment.

### Confirmation Email Content

Sent via Resend immediately after a successful capture:

| Field | Content |
|-------|---------|
| Subject | `Your MGA Invitational Registration is Confirmed — MGA-2026-XXXX` |
| To | Member email |
| CC | `tournaments.confirmation_cc_email` if set (e.g. tournament coordinator or treasurer) |
| Body | Member name, guest name, confirmation number (large/bold), tournament year, deposit amount paid, instruction: *"Print this email or save your confirmation number and present it to the Pro Shop to finalize your registration."* |

The confirmation page shown in the browser after payment mirrors the email content and includes a **Print** button.

### Acceptance Page Token Validation

Every request to `/accept/<token>` runs the following checks in order:

| Check | Response |
|-------|----------|
| Token not found | "This link is invalid." |
| `deposit_paid = true` | "You're already confirmed — [show confirmation number]" |
| `status = 'withdrawn'` | "Your registration has been cancelled. Please contact the tournament coordinator." |
| `declined_at IS NOT NULL` | "You have already declined your spot. You are no longer eligible for this tournament." |
| `acceptance_deadline < now()` | "This link has expired. Your spot has been released." |
| All clear | Show acceptance + payment page |

### Environment Variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `VITE_PAYPAL_CLIENT_ID` | Browser (acceptance page) | Public — safe to expose |
| `PAYPAL_CLIENT_SECRET` | Edge Functions only | Never sent to browser |
| `PAYPAL_WEBHOOK_ID` | `paypal-webhook` Edge Function | Required for signature verification |
| `PAYPAL_MODE` | Edge Functions | `sandbox` in dev, `live` in production |
| `TWILIO_ACCOUNT_SID` | Edge Functions only | — |
| `TWILIO_AUTH_TOKEN` | Edge Functions only | — |
| `TWILIO_FROM_NUMBER` | Edge Functions only | Toll-free number e.g. `+18005550123` |
| `RESEND_API_KEY` | Edge Functions only | — |
| `RESEND_FROM_EMAIL` | Edge Functions only | `admin@skymga.org` — domain already verified in Resend (configured for the voting app) |
| `CRON_SECRET` | Vercel cron endpoints | Long random string; Vercel sends as `Authorization: Bearer <secret>`; endpoint rejects requests without it |

---

## Build Phases

### Phase 1 — Foundation ✅ Complete
- ✅ Initialize monorepo with pnpm workspaces
- ✅ Scaffold `apps/invitational`, `apps/admin`, `packages/ui`, `packages/supabase`, `packages/utils`
- ✅ Database migration files written (all 7 tables in `supabase/migrations/`)
- ✅ Shared UI components: Button, Input, Card, Badge, Modal, Navbar (`packages/ui/src/`)
- ✅ Supabase client initialized (`packages/supabase/src/index.js`)
- ✅ Utils: GHIN validation, tenure calc, seniority tier validation (`packages/utils/src/index.js`)
- ⏳ Supabase project creation + schema migration push — not yet run (needs credentials)
- ⏳ Vercel projects + Cloudflare DNS — not yet configured
- ⏳ Logo assets copy to `packages/ui/assets/` — not yet done

### Pre-build Setup (External Services)
- ✅ Twilio toll-free number purchased (`(888) 603-9799`)
- ✅ Twilio toll-free verification submitted (2026-04-12) — approval pending, allow 1–3 weeks
- ⏳ PayPal Business account + credentials — not yet configured
- ⏳ Resend API key + `admin@skymga.org` sender domain — not yet configured

### Phase 2 — Admin Core ✅ Complete
- ✅ Admin auth (email/password via Supabase)
- ✅ Member roster UI: view, search, add, edit, deactivate
- ✅ XLSX import mapped to member schema; phone auto-normalized to E.164; bad rows flagged
- ✅ Tournament builder: all fields, timezone, timing windows, confirmation CC email
- ✅ Tier configuration: draw date auto-calculates acceptance deadline; timezone-aware datetime fields
- ✅ Seniority tier validation UI (uniqueness and descending draw order enforcement)
- ✅ Prior year flight winner entry (FlightWinnerEditor tab)

### Phase 3 — Registration ✅ Complete
- ✅ Magic link auth flow for members
- ✅ Registration portal with eligibility checking (all 8 states)
- ✅ Guest information form with validation (GHIN, phone)
- ✅ Registration deadline enforcement
- ✅ Confirmation email via Edge Function + Resend
- ✅ Twilio toll-free number purchased and verification submitted 2026-04-12 — SMS blocked until approved
- ⏳ PayPal Business account + credentials — not yet configured

### Phase 4 — Lottery Engine + Acceptance ✅ Complete
- ✅ Spillover calculation logic
- ✅ Fisher-Yates random draw algorithm per tier (Supabase Edge Function `run-draw`)
- ✅ Flight winner status tracking and spot reversion
- ✅ Admin draw console UI with per-tier acceptance status tracking
- ✅ Secure acceptance token generation on draw completion
- ✅ Email + SMS notification to selected members (Resend + Twilio)
- ✅ `/accept/:token` page: PayPal deposit, decline flow, confirmation number, printable confirmation
- ✅ PayPal webhook handler
- ✅ Vercel cron jobs: reminder (email + SMS) and expiry + sequential waitlist promotion
- ✅ Waitlist promotion on admin-triggered withdrawal

### Phase 5 — Public Results + Polish ✅ Complete
- ✅ Public results pages (`/results`, `/results/:year`) — no auth required
- ✅ Member history view (`/history`) — authenticated
- ✅ FlightWinnerEditor tab wired up in admin TournamentDetail
- ✅ "Publish Results" button in DrawConsole (+ Unpublish)
- ✅ Expiry notification email in `expire-acceptances.js` cron
- ✅ Link from skymga.org navbar to invitational.skymga.org
- ✅ Results + History nav links in invitational Layout
- ✅ Migration `008_results_published.sql` + `009_rls_results_published.sql`
- ⏳ Mobile-responsive styling review — basic TW responsive classes used throughout; deep audit pending
- ⏳ End-to-end testing with dummy data — needs live Supabase project

---

## Design Decisions Log

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Seniority tier model | Cumulative (overlapping) eligibility — each seniority tier has a `min_years` threshold only (e.g. 15+, 10+, 5+). A member qualifies for every tier at or below their tenure. Members already selected in an earlier tier are excluded from later pools. Small spot allocations per tier keep the cumulative advantage bounded. |
| 2 | Flight winner no-show handling | Spot rolls to General tier; status tracked as `accepted` / `declined` / `no_response`; winner still eligible for General tier regardless of status |
| 3 | Rollover credits | **Backlog** — not in v1; tier system alone is the fairness mechanism |
| 4 | Guest information | Name, email, phone, GHIN — all required at registration time; GHIN validated as 7 digits; GHIN also added to member roster |
| 5 | Member self-service | Registration + personal history view only; withdrawals and profile updates are admin-handled in v1 (backlog for self-service) |
| 6 | Subdomain structure | Separate subdomain per app (`invitational`, `admin`, `calcutta`); single shared Supabase backend |
| 7 | Repo structure | Monorepo (`netflections/skymga-apps`); can be split into separate repos later if needed |
| 8 | Acceptance flow auth | Secure token in URL (no login required) — token is a cryptographically random hex string with expiry stored in `registrations.acceptance_token`. Simple for members; token is the credential. Expired tokens show a clear expired message. |
| 9 | Deposit / confirmation | Non-refundable deposit collected via PayPal Business (Individual) at acceptance time. PayPal JS SDK renders the payment button; no card data touches the server. On payment capture, a unique `MGA-{YEAR}-{XXXX}` confirmation number is generated and emailed. Member prints and presents to Pro Shop. Deposit amount is set by the admin per tournament in `tournaments.deposit_amount` and displayed on the acceptance page. Funds are held in the MGA treasurer's PayPal balance. |
| 10 | Spot release on non-payment | When `acceptance_deadline` passes without payment, spot is automatically released by the daily Vercel cron job. Admin can also trigger manually from the draw console. |
| 11 | Explicit decline flow | All selected members (any tier) can decline via the acceptance page. Must check an acknowledgment checkbox: *"I understand that by declining, I am opting out of the [YEAR] MGA Invitational. My spot will be released and offered to the next member on the waitlist."* Declined spots are immediately released — no need to wait for deadline expiry. Declining from a waitlist promotion triggers immediate next-member promotion. |
| 12 | Configurable timing windows | Registration window is defined by explicit `registration_opens_at` and `registration_deadline` timestamps on the tournament. Acceptance windows (seniority, general, waitlist) are stored as durations per tournament with sensible defaults (7 days / 7 days / 24 hours). Tier acceptance deadlines are auto-calculated from these at draw time but can be overridden. Per-tier reminder window (`reminder_hours_before_deadline`) defaults to 48 hours; 12 hours recommended for the waitlist tier. |
| 13 | Waitlist sequential promotion | Waitlist members are promoted one at a time in draw order. Only the current active member receives an acceptance link. The daily cron detects expired windows and promotes the next member. There is an expected ~0–24 hour delay between a waitlist expiry and the next promotion — this is acceptable given the once-daily cron. |
| 14 | Confirmation email CC | `tournaments.confirmation_cc_email` (optional) is CC'd on all "Registration Confirmed" emails, giving the tournament coordinator or treasurer real-time visibility into confirmed registrations. |
| 15 | `expired` / `declined` / `withdrawn` status | `expired` = acceptance deadline passed without action; member remains eligible for General tier draw. `declined` = member explicitly opted out; excluded from all subsequent tiers, waitlist, and reminder notifications. `withdrawn` = confirmed, paid member removed by admin after the fact; deposit handling tracked outside the system; triggers immediate next-waitlist-member promotion. `lottery_results.result` records the draw outcome only — post-draw status changes are tracked in `registrations.status`. |
| 16 | Timezone handling | All date/time fields use `timestamptz` (stored as UTC). Tournament has a configurable `timezone` field (IANA name, default `America/New_York`) used to display and accept times in the admin UI and member-facing pages. `America/New_York` handles EDT (GMT-4) and EST (GMT-5) automatically via DST rules. |
| 17 | RLS / Auth UID | `members.auth_uid` links Supabase Auth sessions to roster rows. Written on first magic link login by an Edge Function using the service role key. RLS policies key off `auth.uid() = auth_uid` — faster than email matching and resilient to email changes. All post-draw writes use the service role key and bypass RLS. |

---

## Backlog (Post-v1)

- **Rollover credits**: Members accumulate weighted lottery entries for each year shut out, applied within their seniority tier
- **Member self-service withdrawals**: Members can withdraw their own registration up to a deadline
- **Member profile editing**: Members can update their own contact info and GHIN
- **Calcutta app**: Separate app at `calcutta.skymga.org` sharing the same admin portal and member roster
- **MailerLite integration**: Bulk email to full ~200-member list (separate from transactional notifications)
- **Guest self-service**: Guest receives their own confirmation email and can view tournament info
- **WhatsApp notifications**: Send draw results and reminders via WhatsApp in addition to SMS, using the existing Twilio integration (same API, different sender format). Requires WhatsApp Business Account and Meta template approval. The MGA already has an active WhatsApp group, so member adoption is likely high.

---

## Existing Assets & Resources

| Asset | Location | Notes |
|-------|----------|-------|
| MGA logo (standard) | `mga_logo_v4.png` | Copy to `packages/ui/assets/` |
| MGA logo (white) | `mga_logo_white_transparent.png` | Copy to `packages/ui/assets/` |
| Member data | `MGA_Members_Email_2026.xlsx` | ~182 members; seed data for Phase 2 XLSX import |
| Main website repo | `netflections/skymga-website` (GitHub, public) | Vite + React 18, React Router v6 |
| Main site | `skymga.org` | Live; Vercel Hobby + Cloudflare |
| Admin email | `admin@skymga.org` | Google Workspace org admin |

---

## Notes for Claude Code

- Run `pnpm install` from the monorepo root to install all workspace dependencies
- Each app in `apps/` has its own `vite.config.ts` and `package.json`
- Supabase types should be regenerated after any schema change: `supabase gen types typescript --project-id <id> > packages/supabase/src/types.ts`
- The `supabase/` directory at monorepo root contains migrations — run `supabase db push` to apply
- Vercel environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) must be set per Vercel project
- Admin app should use a separate Supabase service role key (set as `SUPABASE_SERVICE_ROLE_KEY` in Vercel, never exposed to the browser)
- All credentials and environment variables are documented in the **PayPal Integration → Environment Variables** table above
- **Important**: Twilio toll-free verification is already in progress — SMS sending is blocked until approved (1–3 week window). Build SMS integration against sandbox; switch to live number once approved.
- Use `PAYPAL_MODE=sandbox` locally and in preview environments; `PAYPAL_MODE=live` in production only
- All GHIN fields (member and guest) validate against `/^\d{7}$/`
- Tier band validation logic lives in `packages/utils` and is imported by both the admin UI (real-time feedback) and any server-side checks
