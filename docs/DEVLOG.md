# Dev Log — Inspirations Farm

## 2026-06-19 — Phase 1 & 2 Complete

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

### API Routes
| Route | Method | Body | Action |
|---|---|---|---|
| `/api/github` | GET | — | List inspirations with content + status |
| `/api/github` | POST | `{ content }` | Create inspiration |
| `/api/github` | PUT | `{ path, sha, status }` | Update status |
| `/api/github` | DELETE | `{ path, sha }` | Delete inspiration |
| `/api/daily` | GET | `?date=YYYY-MM-DD` | Get daily journal |
| `/api/daily` | POST | `{ date }` | Create daily journal |
| `/api/daily` | PUT | `{ path, sha, content }` | Update journal (tasks) |

### UI — Responsive Two-Column Layout
```
grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto
```
- **Left**: Daily Dashboard — task checkboxes, add task input
- **Right**: Inspiration Pool — capture zone + timeline with action buttons
- Mobile: single column stack

### Daily Dashboard Features
- Auto-fetches today's journal (`Journal/Daily/YYYY-MM-DD.md`)
- If missing → "创建今日日程" button
- Renders `- [ ]` / `- [x]` as clickable checkboxes
- Toggle → replaces line in raw markdown → PUT to GitHub
- Add task input (Enter to submit)
- Progress counter: `done/total`

### Build Status
- TypeScript: ✅ zero errors
- `next build`: ✅ compiled successfully
- Routes: `ƒ /api/github`, `ƒ /api/daily`

### Next Up
- [ ] PWA configuration (manifest, service worker)
- [ ] Token / auth management refinement
- [ ] Offline support
