# Pom Day

A frontend-only morning planner. Pick a few tasks, mark recurring items, drop in fixed events, generate a Pomodoro timeline, and run the day with a live timer. Everything is stored in your browser's `localStorage` — there is no backend and no network call.

## Stack

- React 19 + TypeScript + Vite
- ESLint + typescript-eslint
- Vitest for the planner unit tests

## Getting started

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). On first load the app seeds 4 default recurring templates (Inbox zero, Read technical post, Exercise, Lunch) and default day boundaries of `07:00`–`19:00`.

## Scripts

- `npm run dev` — Vite dev server with HMR.
- `npm run build` — type-check and produce a static `dist/` bundle.
- `npm run preview` — preview the production build.
- `npm run lint` — ESLint over `src/`.
- `npm run test` — Vitest run of the planner unit tests.

## Where the data lives

All state is in `window.localStorage` under these keys:

- `pomDay.schemaVersion`
- `pomDay.dayBoundaryDefaults`
- `pomDay.recurringTemplates`
- `pomDay.day.<YYYY-MM-DD>` (one bundle per day: tasks, fixed events, recurring instances, generated timeline, timer session)

Clearing browser storage resets the app to first-run defaults.

## Project docs

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) — product scope and rules
- [docs/product-requirements.md](docs/product-requirements.md) — v1 behavior and acceptance
- [docs/architecture.md](docs/architecture.md) — storage layout and module boundaries
- [docs/planner-engine.md](docs/planner-engine.md) — scheduling algorithm
- [docs/milestones.md](docs/milestones.md) — delivery history
- [docs/test-plan.md](docs/test-plan.md) — testing strategy
