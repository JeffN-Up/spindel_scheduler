# Spindel Scheduler

Spindel Scheduler is a Vite + React technician scheduling app for mirroring clinic schedules from Google Sheets, validating doctor/technician constraints, and using Gemini for scheduling analysis and admin commands.

The interface follows the public Spindel Eye Associates brand system: navy `#243078`, green `#258c3b`, cool gray `#f0f2f7`, Poppins headings, and Roboto body typography. The responsive workspace uses a high-contrast top navigation, bright clinical surfaces, rounded cards, clear focus states, and plain-language controls. Desktop screens use the full six-day scheduling matrix; mobile screens use a day-focused view with swipeable day navigation, large tap targets, location coverage summaries, and reviewable move suggestions.

## Current Status

Recent fixes on `main` include:

- role-aware Google Sheet parsing, so `Doctor` / `Tech` sections determine whether ambiguous initials are parsed as doctors or technicians
- parser regression coverage via `npm exec --yes --package=pnpm@10.25.0 -- pnpm run test:parser`
- safer Gemini command validation before schedule changes are applied
- Gemini panel error handling so the UI does not get stuck while analyzing or chatting
- production build polish for app metadata, font loading, and expected bundle size
- project metadata and type packages needed for local TypeScript checks
- GitHub Actions CI for parser tests, type-checking, and production builds on pushes and pull requests
- GitHub Pages preview publishing for `main`
- static host configs for Firebase Hosting, Netlify, and Vercel

## Requirements

- Node.js 20 or newer
- pnpm 10.25.0, or use the `npm exec` commands shown below
- Firebase project access for the configured app
- Gemini API key
- Google Sheet published to the web as CSV, or a shareable Sheet URL that can be exported as CSV

## Local Setup

```bash
git clone https://github.com/Down2pound/spindel_scheduler.git
cd spindel_scheduler
npm exec --yes --package=pnpm@10.25.0 -- pnpm install --frozen-lockfile
cp .env.example .env.local
```

Edit `.env.local`:

```bash
GEMINI_API_KEY="your_gemini_api_key"
APP_URL="http://localhost:3000"
```

Start the app:

```bash
npm exec --yes --package=pnpm@10.25.0 -- pnpm run dev
```

Open the local URL printed by Vite, usually `http://localhost:3000`.

## Verification

Run these before deployment:

```bash
npm exec --yes --package=pnpm@10.25.0 -- pnpm run test:parser
npm exec --yes --package=pnpm@10.25.0 -- pnpm run lint
npm exec --yes --package=pnpm@10.25.0 -- pnpm run build
```

The repository includes `pnpm-workspace.yaml` so trusted dependency build scripts can run noninteractively during install.

GitHub Actions also runs these checks automatically for pushes to `main` and for pull requests.

## Google Sheet Setup

1. Open the scheduler source Google Sheet.
2. Use `File > Share > Publish to web` when CSV export is needed.
3. In the app, open settings and paste the Sheet URL.
4. Add tab GIDs for each week if the week tabs are separate sheets.
5. Use `SYNC_MIRROR` and verify each day has expected doctors, technicians, floating staff, off staff, and notes.

The parser expects each day to use three adjacent columns: location/status, start time, and end time. It also understands `Doctor`, `Doctors`, `Tech`, `Techs`, `Technician`, and `Technicians` section rows.

## Firebase Setup

The app reads `firebase-applet-config.json` and uses Google authentication plus Firestore collections for users, locations, doctors, technicians, assignments, schedules, and audit logs.

Before production deployment, confirm:

- the Firebase web app config points at the intended project
- Firestore rules match your intended admin and technician access model
- the production host has the same required environment variables as `.env.local`
- Google sign-in is enabled for the deployment domain

## Deployment Checklist

1. Pull latest `main` on the deployment machine.
2. Check GitHub Actions for a passing CI run, or run the verification commands locally.
3. Install dependencies with `npm exec --yes --package=pnpm@10.25.0 -- pnpm install --frozen-lockfile`.
4. Create `.env.local` with the Gemini key.
5. Run `npm exec --yes --package=pnpm@10.25.0 -- pnpm run test:parser`.
6. Run `npm exec --yes --package=pnpm@10.25.0 -- pnpm run lint`.
7. Run `npm exec --yes --package=pnpm@10.25.0 -- pnpm run build`.
8. Smoke test `npm exec --yes --package=pnpm@10.25.0 -- pnpm run dev` with Google sign-in and Sheet sync.
9. Confirm Firestore reads/writes work for admin schedule edits.
10. Deploy through the chosen host.
11. Set production environment variables in the host dashboard.
12. Add the production domain to Firebase Authentication authorized domains.

## Deployment Options

This is a static Vite app after the production build, so any static host that serves `dist` works.

GitHub Pages:

The repository includes a GitHub Pages workflow that builds `main` with `BASE_PATH=/spindel_scheduler/` and publishes `dist`. After the first successful Pages deployment, the preview URL should be:

```text
https://jeffn-up.github.io/spindel_scheduler/
```

Add `jeffn-up.github.io` to Firebase Authentication authorized domains before testing Google sign-in from this preview.

Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
npm exec --yes --package=pnpm@10.25.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@10.25.0 -- pnpm run build
firebase deploy --only hosting,firestore:rules
```

Netlify CLI:

```bash
npm install -g netlify-cli
netlify login
npm exec --yes --package=pnpm@10.25.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@10.25.0 -- pnpm run build
netlify deploy --prod --dir=dist
```

Vercel CLI:

```bash
npm install -g vercel
vercel login
vercel --prod
```

For dashboard-based deploys, use the repository host config when possible. The checked-in Netlify and Vercel configs install with `pnpm@10.25.0`, run the production build, and publish `dist`.

## Admin Scheduling Tools

The admin scheduler includes:

- `ADD` commands
- `REMOVE` commands
- day-aware AI commands
- safer immutable updates for drag/drop and edit modal changes
- audit logs for manual add/edit/delete changes

## Technician Commute & Office Preferences

Technicians can open **My Profile** from the personal weekly schedule to:

- rank Derry, Londonderry, Windham, Bedford, and Raymond from favorite to least favorite
- save their usual one-way mileage to each office
- open driving directions in Google Maps or Apple Maps, optionally starting from a saved address or town
- see estimated weekly round-trip mileage and a preference-fit score

Admins receive a soft scheduling warning when a technician is placed at their fourth- or fifth-ranked office. Profile data is stored in the `technicianProfiles` Firestore collection. Deploy the updated `firestore.rules` before enabling profile saves in production.

When an office is understaffed, the admin matrix ranks eligible technicians from floating or overstaffed offices. The move score considers the destination's preference rank, one-way mileage, and added commute versus the technician's current office. The best candidate appears as a suggestion that fills the command bar for review; it never moves someone automatically. Gemini schedule analysis and staffing questions receive the same profile data and decision priorities.

### Token-efficient decision flow

- Routine staffing recommendations run locally and use no AI tokens.
- Strict `move`, `add`, and `remove` commands are parsed locally; unfamiliar or ambiguous phrasing falls back to Gemini.
- Gemini receives compact field names and scheduling metrics rather than raw Firestore profiles. Home addresses are never included in AI context.
- Identical commands, chats, and weekly analyses are cached for the current browser session. The cache is keyed to the exact schedule and preference context, limited to 50 entries, and naturally invalidates when relevant data changes.
- Opening the Gemini panel does not automatically call the model; weekly narrative analysis starts only when the user selects **Analyze**.

Office map destinations use the clinic street addresses published by Spindel Eye Associates.
