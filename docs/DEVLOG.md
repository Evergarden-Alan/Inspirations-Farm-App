# Dev Log — Inspirations Farm

## 2026-06-19 — Phases 1–3 Complete

### Scaffold & Config
- Next.js 16.2.9, React 19.2.4, TypeScript 5, Tailwind CSS v4
- shadcn/ui (new-york, neutral) — components: `button`, `input`, `card`, `textarea`
- lucide-react for icons

### GitHub API Module (`src/lib/github.ts`)
| Function | Description |
|---|---|
| `listInspirations()` | List files in `Inspirations/` |
| `createInspiration(filename, content)` | Create `.md` with YAML frontmatter |
| `getFileContent(path)` | Fetch & decode single file |
| `parseMarkdown(text)` | Parse YAML frontmatter + extract body |
| `listInspirationsWithContent()` | Full list with content + metadata, sorted newest-first |
| `deleteFile(path, sha)` | Delete a file by path and sha |
| `updateFileStatus(path, sha, status)` | Update `status` field in YAML frontmatter |
| `getDailyJournal(date)` | Get or check daily journal existence |
| `createDailyJournal(date)` | Create journal at `Journal/Daily/YYYY-MM-DD.md` |
| `updateDailyJournal(path, sha, content)` | Full content update for journal |

### Markdown Templates
**Inspiration:**
```yaml
---
type: inspiration
status: active
create: 2026-06-19 11:32:15
---
# <user input>
```

**Daily Journal:**
```yaml
---
type: daily
date: 2026-06-19
created: 2026-06-19 14:30:00
---
- [ ] Task item
```

### API Routes (all PIN-protected)
| Route | Method | Body | Auth |
|---|---|---|---|
| `/api/github` | GET | — | `x-app-pin` header |
| `/api/github` | POST | `{ content }` | ↑ |
| `/api/github` | PUT | `{ path, sha, status }` | ↑ |
| `/api/github` | DELETE | `{ path, sha }` | ↑ |
| `/api/daily` | GET | `?date=YYYY-MM-DD` | ↑ |
| `/api/daily` | POST | `{ date }` | ↑ |
| `/api/daily` | PUT | `{ path, sha, content }` | ↑ |

### Phase 3 — PIN Auth System
- **Backend**: `src/lib/auth.ts` — `validatePin(req)` checks `x-app-pin` header vs `APP_PIN` env var. If `APP_PIN` is unset, auth is skipped (dev mode).
- **Client**: `src/lib/api.ts` — `apiFetch()` wrapper auto-attaches PIN from localStorage. On 401, clears localStorage and dispatches `auth:expired` custom event.
- **Lock Screen**: `src/app/lock-screen.tsx` — centered Lock icon + password input + "进入农场" button. Wrong PIN shows "密钥错误".
- **Page**: `src/app/page.tsx` listens for `auth:expired` and flips back to lock screen on credential loss.

### UI — Responsive Two-Column Layout
```
grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto p-4 pb-24
```
- **Left**: Daily Dashboard — task checkboxes, add task input
- **Right**: Inspiration Pool — capture zone + timeline with action cards
- Mobile: single column, `pb-24` bottom padding for safe area

### Daily Dashboard Features
- Auto-fetches today's journal (`Journal/Daily/YYYY-MM-DD.md`)
- Full-row touch targets (`min-h-[3.5rem]`, `py-3 px-3`) with `touch-manipulation`
- `Circle` (unchecked) / `CheckCircle2` (checked) icons at `w-6 h-6`
- Checked items: `text-slate-300 line-through` with `transition-all duration-200`
- Add-task input with dedicated emerald `+` button (`min-w-[44px] min-h-[44px]`)
- Progress counter: `done/total`

### Inspiration Cards — Touch-Friendly
- Compact footer: survival time + action buttons in single row
- Mobile: buttons always visible (`text-slate-400`), PC: `md:opacity-0 md:group-hover:opacity-100`
- Action bar: `flex justify-end gap-3`, each button `min-w-[44px] min-h-[44px]` with `touch-manipulation`
- Textarea: `rows={3}` + auto-resize on input

### Environment Variables (`.env.local`)
```
GITHUB_PAT=ghp_xxx        # GitHub personal access token (repo scope)
REPO_OWNER=your-username   # GitHub username or org
REPO_NAME=your-repo        # Repository name
APP_PIN=1234               # Lock screen PIN (omit to skip auth in dev)
```

### Phase 4 — PWA
- **Manifest**: `src/app/manifest.ts` → `/manifest.webmanifest` (static)
  - `display: standalone`, `theme_color: #059669`, portrait orientation
  - SVG icon with `purpose: any`
- **Service Worker**: `public/sw.js`
  - Pre-caches `/` and `/manifest.webmanifest` on install
  - Network-first strategy with cache fallback for non-API requests
  - Skips `/api/*` entirely (always live)
  - Auto-cleans old cache versions on activate
- **Meta tags**: `layout.tsx` — viewport (`viewportFit: cover`, no user-scalable), `apple-mobile-web-app-capable`, theme-color
- **Icon**: `public/icon.svg` — emerald rounded-rect with plant motif
- **Domain**: [todo.alanevergarden.xyz](https://todo.alanevergarden.xyz)

### Build Status
- TypeScript: ✅ zero errors
- `next build`: ✅ compiled successfully
- Routes: `○ /`, `ƒ /api/github`, `ƒ /api/daily`, `○ /manifest.webmanifest`

### Next Up
- [ ] Deploy to Vercel
- [ ] Replace SVG icon with proper PNG for iOS apple-touch-icon
- [ ] Add push notifications

---

## 2026-06-19 — Inspiration Capture Polish
- **Priority + tags** in capture form: `p0`–`p3` priority selector, tag pills input. Stored in YAML frontmatter (`priority`, `tags`).
- **Filter bar**: filter inspirations by priority + tag client-side.
- **Create-date extraction**: `create:` field parsed from raw string (bypasses gray-matter date coercion into local Date). Survival label uses Beijing-time parser (`parseBeijingTime`).
- README updated with full feature set + Beijing-time survival label.

## 2026-06-20 → 06-21 — Real-Time UI + Rollover Cron
- **Optimistic updates** for all mutations: patch append, task toggle, task/subtask add, daily note. UI applies server response (or locally-computed content) immediately — no re-fetch, no GitHub eventual-consistency wait.
- **Rollover cron hardened** (`src/lib/rollover.ts` + `src/app/api/cron/rollover/route.ts`):
  - `dryRun=true` — parse + build, skip GitHub writes, return `sourcePreview` / `targetPreview` / `extractedTasks`.
  - `targetDate=YYYY-MM-DD` time-machine — source = given date, target = source + 1 day.
  - Auth: `NODE_ENV=development` bypasses; else `?secret=` → `Authorization: Bearer`. Robust logging.
- **Rollover date inversion fix**: source = yesterday, target = today (was inverted).

## 2026-06-22 — Inspiration Patches (追加记录)
- Append timestamped follow-up notes to inspirations via `## 追加记录` section.
- `PATCH /api/github` → `appendInspirationPatch()` — fetches SHA internally, inserts before trailing blank lines (or creates section at file end).
- `parseInspirationPatches()` splits body at `## 追加记录`; `HH:mm`-only timestamps get the createdAt date prepended.

## 2026-06-23 — Rich Markdown Rendering
- `react-markdown` + `remark-gfm` + `@tailwindcss/typography`. GFM: tables, task lists, strikethrough, autolinks.
- Prose styles for inspiration cards + jottings.
- **Inline-safe rendering** for todo task text: no prose wrapper, `<p>` → `<span>`, preserves flex layout.

## 2026-06-24 — Tree-Based Cascade + Rollover
- **Cascade toggle** rewritten (`src/lib/cascade.ts`): tree-based parent-child completion. Checking parent marks all descendants `[x]`; unchecking child unchecks ancestors. Line-based parsing avoids false `String.replace` matches.
- **Tree-based rollover**: builds task tree from `# 当日日程` (handles `[x]`, `[ ]`, `[>]` at arbitrary depth), splits recursively:
  - Fully-done subtrees stay in yesterday as-is.
  - Partially-done subtrees split: done parts remain (parent `[>]`, children `[x]`), undone parts migrate to today (parent `[ ]`, children `[ ]`) with nesting preserved.
  - Migrated tasks get `🔄` suffix → frontend renders amber `延期` badge. Double-stacking prevented.
- **Mixed tab/space indent normalisation**: tab → 2 spaces in depth calc (`indentDepth`), consistent hierarchy parsing.
- Eliminates orphan-subtask bug from old line-by-line filtering.

## 2026-06-28 — Push-to-Daily, Templates, Auto-Reconciliation
- **Push-to-daily UX**: spinner + success/duplicate feedback on push button. Backend dedup: `409` if `ideaId` already in today's tasks.
- **Dynamic Obsidian template loading**: when target journal missing, rollover fetches `Templates/Diary_Template.md` from GitHub (path via `DIARY_TEMPLATE_PATH` env, default `Templates/Diary_Template.md`). Replaces `{{date}}` / `{{DATE:YYYY-MM-DD}}`, injects undone tasks at `%%TODO_PLACEHOLDER%%` (falls back to `## 当日日程` append). Built-in fallback template on fetch failure — never crashes.
- **Auto-reconciliation (Obsidian-side)**: completing a linked task in Obsidian is caught on next page load. `syncCompletedIdeas()` batch-archives matching inspirations via `syncIdeasState` (idempotent — skips already-completed, tolerates 404).

## 2026-06-28 — Server-Side Streaming Architecture
Major refactor: data fetching moved server-side, streamed via Suspense.
```
Browser → /
  → page.tsx (Server Component, force-dynamic, no cache)
    → <Home> (Client: PIN gate + sticky header)
      → <Suspense fallback={<DashboardSkeleton />}>
        → <DashboardContent> (Async Server Component)
          → Promise.all([getTodos(), getInspirations()])
          → Reconciliation (completed tasks ↔ active ideas)
          → In-memory filter → props to client components
```
- Shell renders instantly (header + skeleton). Data fetched server-side direct via `GITHUB_PAT` — bypasses API routes.
- `src/lib/data.ts`: `getTodos()`, `getInspirations()`, `syncCompletedIdeas()`.
- New files: `home.tsx`, `dashboard-content.tsx`, `dashboard-skeleton.tsx`, `jottings-card.tsx`.
- Daily jottings (`## 今日杂记` under `# 本日总结`): `POST /api/daily { action: "addNote", date, content }` → `insertIntoDailyNotesSection()`.
- Caching: `githubFetch()` uses `cache: 'no-store'`; `page.tsx` `dynamic = 'force-dynamic'` + `revalidate = 0`. No ISR, no client cache.
- shadcn/ui style: **base-nova** (Base UI React primitives), not new-york.

## 2026-06-29 — Markdown Math Rendering
- `remark-math` + `rehype-katex` + `katex` added to all `ReactMarkdown` renderers.
- Inline `$...$`, block `$$...$$`.
- KaTeX CSS imported globally (`src/app/globals.css` → `@import "katex/dist/katex.min.css"`).
- `rehypeKatex` configured `{ strict: false, throwOnError: false, output: "html" }` — `output: "html"` prevents exposed MathML/source text (e.g. `{\displaystyle ...}`) in compact prose.

## 2026-06-29 → 07-01 — Rollover Merge (target-exists path)
- New `mergeIntoSection()` in `rollover.ts`: when target journal already exists, incoming migrated tasks merge into `# 当日日程` instead of bulk-append.
- Same-named top-level task match (normalized, `🔄` stripped) → descendants appended under existing root (e.g. rolled-over `数学 🔄` merges under existing `数学`). Unmatched top-level tasks + self-nesting leaf roots append at section end as new roots. Indent preserved.
- Replaces `insertIntoSection` on the target-exists path. Append-only path (target missing → template + inject) unchanged.
