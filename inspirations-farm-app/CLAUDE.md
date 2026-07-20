# Inspirations Farm � Architecture

Personal inspiration management system. GitHub repo (`Evergarden-Alan/Note`) = flat-file database (Obsidian vault). Next.js 16 App Router + React 19 + Tailwind v4 + shadcn/ui (base-nova).

## Rendering Architecture (Server-Side Streaming)

```
Browser requests /
  � page.tsx (Server Component, force-dynamic, no cache)
    � <Home> (Client Component � PIN gate + sticky header)
      � <Suspense fallback={<DashboardSkeleton />}>
        � <DashboardContent> (Async Server Component)
          � Promise.all([getTodos(), getInspirations()])
          � Reconciliation (cross-reference completed tasks � active ideas)
          � In-memory filter � pass to client components
```

- **Shell renders instantly** � header + skeleton streamed immediately
- **Skeleton pulses** � `DashboardSkeleton` with `animate-pulse`, matches two-column grid
- **Data fetched server-side** � bypasses API routes, calls GitHub direct via `GITHUB_PAT`
- **Lock screen overlay** � `fixed inset-0 z-50` covers everything until PIN verified; data loads underneath regardless

## Key Files

| File | Role |
|------|------|
| `src/app/page.tsx` | Server Component shell � `dynamic = 'force-dynamic'`, composes Home + Suspense + DashboardContent |
| `src/app/home.tsx` | Client Component � PIN lock overlay + sticky header |
| `src/app/dashboard-content.tsx` | Async Server Component � `Promise.all` fetch + reconciliation + child rendering |
| `src/app/dashboard-skeleton.tsx` | Client Component � `animate-pulse` skeleton for Suspense fallback |
| `src/app/daily-dashboard.tsx` | Client Component � daily journal tasks (accepts `initialDaily` prop) |
| `src/app/inspiration-feed.tsx` | Client Component � inspiration pool (accepts `initialItems` prop) |
| `src/app/jottings-card.tsx` | Client Component � daily notes (accepts `initialNotes` prop) |
| `src/app/lock-screen.tsx` | Client Component � PIN entry form |
| `src/lib/github.ts` | GitHub REST API client � all `fetch()` calls use `cache: 'no-store'` |
| `src/lib/data.ts` | Server-side data layer � `getTodos()`, `getInspirations()`, `syncCompletedIdeas()` |
| `src/lib/api.ts` | Client-side `apiFetch()` wrapper � attaches `x-app-pin` header |
| `src/lib/beijing-time.ts` | Beijing timezone (UTC+8) date utilities |
| `src/lib/cascade.ts` | Task toggle with parent-child cascade |
| `src/app/api/github/route.ts` | Inspiration CRUD API (POST/PUT/DELETE/PATCH) |
| `src/app/api/daily/route.ts` | Daily journal CRUD API |

## Data Flow

### Initial Page Load (Server-Side)
1. `page.tsx` renders `<Home><Suspense><DashboardContent/></Suspense></Home>`
2. `DashboardContent` calls `Promise.all([getTodos(), getInspirations()])` � direct GitHub API
3. Reconciliation: finds completed tasks with `sourceIdeaId` � `syncCompletedIdeas()` if needed
4. In-memory filter: removes synced ideas from array
5. Streams resolved data as props to `DailyDashboard` / `InspirationFeed` / `JottingsCard`
6. `Home` overlays `LockScreen` (z-50) until PIN verified

### Mutations (Client-Side)
All writes go through API routes: `apiFetch()` � `/api/github` or `/api/daily` � PIN validation � GitHub API.
Client components manage own state after initial SSR seed.
Events (`daily:updated`, `inspiration:updated`, `auth:expired`) trigger re-fetches across components.

## Caching
- `src/lib/github.ts`: `githubFetch()` uses `cache: 'no-store'` � every call hits GitHub fresh
- `src/app/page.tsx`: `dynamic = 'force-dynamic'` + `revalidate = 0`
- No ISR, no static generation, no client-side cache

## Environment Variables
- `GITHUB_PAT` � GitHub personal access token (repo scope)
- `REPO_OWNER` � GitHub username/org
- `REPO_NAME` � repository name
- `APP_PIN` � lock screen PIN

## Styling
- Tailwind v4 (CSS-based config in `globals.css`)
- `tw-animate-css` for animations
- shadcn/ui base-nova (Base UI React primitives)
- `@tailwindcss/typography` for markdown prose
- Markdown render: `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` (KaTeX) — inline `$...$`, block `$$...$$`; KaTeX CSS `@import`ed globally in `globals.css`; `rehypeKatex` uses `output: "html"` to avoid exposed MathML/source text
- Geist Sans + Geist Mono fonts