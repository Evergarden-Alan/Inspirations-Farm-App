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

### Build Status
- TypeScript: ✅ zero errors
- `next build`: ✅ compiled successfully
- Routes: `ƒ /api/github`, `ƒ /api/daily`

### Next Up
- [ ] PWA configuration (manifest, service worker)
- [ ] Offline support
- [ ] Deploy to Vercel
