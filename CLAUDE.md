# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm dev:invitational     # Start invitational dev server
pnpm dev:admin            # Start admin dev server
pnpm build                # Build all apps
```

No linting, type-checking, or tests are configured yet.

## Architecture

**pnpm monorepo** with three apps and three shared packages.

### Apps

- `apps/invitational` — `invitational.skymga.org` — Member-facing lottery registration + public results (Vite + React)
- `apps/admin` — `admin.skymga.org` — Roster management, tournament config, draw console (Vite + React)
- `apps/calcutta` — `calcutta.skymga.org` — Future phase, not yet built

### Shared Packages

- `packages/ui` — Shared React components, brand tokens, Tailwind preset, logo assets
- `packages/supabase` — Supabase client, helpers (shared across all apps)
- `packages/utils` — GHIN validation, tenure calculation, tier band validation

### Database

- `supabase/migrations/` — SQL migration files for all tables
- Single shared Supabase project backing all apps
- Tables: `members`, `tournaments`, `tiers`, `registrations`, `lottery_results`, `prior_year_winners`, `flight_winner_registrations`

## Styling

Tailwind CSS v4 with brand tokens defined in each app's `src/index.css` via `@theme` directive. Key colors: sky-400 (`#4B8DCC` primary blue), sky-700 (`#1E3851` dark navy).

## Deployment

Each app is a separate Vercel project, auto-deploys on push to `main`. SPA routing handled by `vercel.json` rewrites. DNS via Cloudflare.

## Environment Variables

Each Vercel project needs:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Admin app additionally needs `SUPABASE_SERVICE_ROLE_KEY` (never exposed to browser).
