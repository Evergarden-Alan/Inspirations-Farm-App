# Inspirations Farm 🌱

> 🌐 语言：[English](README.md) | **简体中文**  
> 🏷️ 版本：**v1.0.0**

一个移动优先的 PWA 个人灵感管理系统。以 GitHub 为后端的 Headless CMS，可安装到手机主屏。

**线上地址**：[todo.alanevergarden.xyz](https://todo.alanevergarden.xyz)

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript |
| UI | React 19 + Tailwind CSS v4 |
| 组件 | shadcn/ui (base-nova) + Base UI React 基础组件 |
| 图标 | lucide-react |
| Markdown | gray-matter (frontmatter) + `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` (KaTeX) |
| Markdown AST | `mdast-util-from-markdown` + `micromark-extension-frontmatter` + `mdast-util-frontmatter`（代码块安全的章节定位） |
| 后端 / CMS | GitHub REST API（Markdown 文件） |
| 鉴权 | PIN 锁屏 + Cron 密钥 |
| PWA | manifest + service worker（仅生产环境） |
| 定时任务 | Vercel Cron Jobs |
| 部署 | Vercel |

## 特性

- **🔐 PIN 锁屏** — 4-6 位访问密钥，401 自动锁回
- **📝 灵感池** — 以时间戳命名文件捕获灵感，带 YAML frontmatter
- **🏷️ 优先级与标签** — p0–p3 优先级边框 + 标签药丸 + 筛选栏
- **📅 每日看板** — 日程含嵌套任务复选框，父子级联逻辑
- **🔗 灵感 → 任务联动** — 把灵感作为 `[[timestamp|title]]` wiki 链接推送到今日日程；后端去重防止重复录入；推送按钮带 spinner + 成功/重复反馈
- **✅ 级联归档** — 完成联动任务时自动归档灵感（Web 端 toggle 与 Obsidian 端下次加载时的对账都支持）
- **⏳ 相对时间** — 北京时区感知的"X小时前"标签
- **🌳 嵌套任务** — 按 Markdown 缩进解析树状结构，父子级联切换（基于行，避免 `String.replace` 误匹配）；支持 `-`、`*`、`+` 三种任务列表标记
- **🔄 每日 Rollover** — 基于树的拆分保留父子关系；`🔄` 标记 rollover 任务，前端以琥珀色"延期"徽章高亮
- **🏷️ Rollover 徽章** — 从昨天顺延的任务渲染 `延期` 徽章（`bg-amber-100 text-amber-700`），与今日新任务视觉区分
- **📝 灵感追加记录** — 通过 `## 追加记录` 章节给灵感追加带时间戳的后续笔记；多行 patch 内容完整保留（续行不再丢失）
- **🛡️ 代码块安全编辑** — 章节插入（追加记录、每日任务、杂记）与解析使用 mdast AST 定位标题，代码块内的 `# 标题` 或 `---` 永远不会误定位章节或损坏文件。YAML frontmatter 作为单一节点解析（YAML `#` 注释不会被误判为标题）。文件其余部分逐字节保留（Tab、`*`/`+` 标记、空行）—— 不做全量重序列化。
- **📐 CRLF 安全解析** — 日记读取时归一化为 LF，CRLF 文件（如 Windows 版 Obsidian）能正确解析任务/杂记，不再被静默漏掉。
- **📄 富 Markdown 渲染** — `react-markdown` + `remark-gfm` + `@tailwindcss/typography`；灵感卡片与杂记用 prose 样式；todo 任务用内联安全渲染（无 prose，`<p>`→`<span>`，保持 flex 布局）
- **🧮 数学公式渲染** — 行内 `$...$` 与块级 `$$...$$`，经 `remark-math` + `rehype-katex`；KaTeX CSS 全局引入（`globals.css`）；`output: "html"` 防止暴露 MathML/源码文本如 `{\displaystyle ...}`
- **🗒️ 每日杂记** — 带时间戳的笔记追加到 `# 本日总结` 下的 `## 今日杂记`；在看板上以时间线渲染
- **📋 模板支持** — rollover 时从 GitHub 拉取 `Templates/Diary_Template.md`；支持 `{{date}}` / `{{DATE:YYYY-MM-DD}}` 与 `%%TODO_PLACEHOLDER%%` 占位符；路径可由 `DIARY_TEMPLATE_PATH` 环境变量配置；拉取失败回退内置模板
- **📱 PWA** — 可安装到主屏，离线缓存，standalone 模式
- **📂 Headless CMS** — 所有数据以纯 Markdown 存于你的私有 GitHub 仓库

## 架构

为避免曾经的"上帝对象" `github.ts` 臃肿，代码按单一职责拆分：

| 模块 | 职责 |
|---|---|
| `src/lib/github-client.ts` | 底层 GitHub REST 客户端 —— 鉴权/配置、`githubFetch`、`withConflictRetry`（409 重试）、base64 编解码、原始 API 响应类型。无业务逻辑，无 Markdown。 |
| `src/lib/markdown-utils.ts` | 纯 Markdown 解析与操作 —— 日期安全的 frontmatter、`parseTasks`/`computeParents`、`parseInspirationPatches`/`parseDailyNotes`，以及基于 AST 的插入辅助。无网络，无 GitHub。 |
| `src/lib/github.ts` | 高层数据服务 —— 编排 client + markdown-utils 完成业务操作（list/create/archive 灵感、日记 CRUD、`syncIdeasState`）。重新导出拆分前的公开 API，调用方（API 路由、服务端数据层、客户端组件）零改动。 |

**Markdown 操作基于 AST。** 插入与解析辅助把文档解析为 mdast 树来稳健定位标题/章节 —— 围栏代码块与 YAML frontmatter 是独立节点类型，所以代码块内的 `# 标题` 或 `---` 永远不会误定位章节或损坏文件。新行随后按 AST 推导的行号 splice 进原文；文件其余部分逐字节保留（不做全量重序列化，Tab、`*`/`+` 标记、空行原样不动）。

**写入一致性。** 日记写路径（加任务、加杂记）经 `modifyDailyJournal`，把整个读-改-写包进 `withConflictRetry`（409 时重新 GET 新鲜 SHA + 内容），并加一段短暂的读前暂停，让 GitHub 最终一致的读副本追上 —— 既防 409 失败，也防"新 SHA + 旧内容"读取导致的静默数据丢失。

## 项目结构

```
Inspirations_Farm/
├── README.md
├── README.zh-CN.md
├── docs/DEVLOG.md
└── inspirations-farm-app/
    ├── vercel.json                       # Cron 调度
    ├── public/
    │   ├── icon.svg                      # PWA 图标
    │   └── sw.js                         # Service Worker
    ├── src/
    │   ├── app/
    │   │   ├── api/
    │   │   │   ├── github/route.ts       # 灵感 CRUD + 归档 + 追加记录 + syncIdeas
    │   │   │   ├── daily/route.ts        # 日记 + 推送灵感到日程 + 杂记
    │   │   │   └── cron/rollover/route.ts # Rollover 端点
    │   │   ├── layout.tsx                # PWA meta + SW 注册（仅生产）
    │   │   ├── page.tsx                  # 服务端组件外壳 (force-dynamic) + Suspense
    │   │   ├── home.tsx                  # 客户端外壳：PIN 锁屏覆盖层 + 吸顶 header
    │   │   ├── dashboard-content.tsx     # 异步服务端组件：取数 + 对账
    │   │   ├── dashboard-skeleton.tsx    # Suspense 骨架 (animate-pulse)
    │   │   ├── lock-screen.tsx           # PIN 解锁
    │   │   ├── inspiration-feed.tsx      # 捕获 + 时间线 + 推送按钮
    │   │   ├── daily-dashboard.tsx       # 嵌套任务 + 级联 + 归档
    │   │   ├── jottings-card.tsx         # 每日杂记时间线 + 加 note
    │   │   └── manifest.ts               # → /manifest.webmanifest
    │   ├── components/ui/                # shadcn/ui (base-nova)
    │   ├── types/
    │   │   └── js-yaml.d.ts              # js-yaml 最小 ambient 类型
    │   └── lib/
    │       ├── github-client.ts          # 底层 GitHub REST 客户端 (fetch, retry, base64, 类型)
    │       ├── markdown-utils.ts         # 纯 Markdown 解析/操作 (AST 章节定位)
    │       ├── github.ts                 # 高层数据服务 (编排 client + markdown-utils)
    │       ├── data.ts                   # 服务端数据层: getTodos/getInspirations/syncCompletedIdeas
    │       ├── beijing-time.ts           # Asia/Shanghai 日期工具
    │       ├── time.ts                   # 存活时长 + 北京时间解析
    │       ├── cascade.ts               # 嵌套任务 toggle 级联
    │       ├── rollover.ts              # 每日未完成任务迁移 (树拆分 + 合并)
    │       ├── auth.ts                   # 服务端 PIN 校验
    │       ├── api.ts                    # 客户端 fetch 封装 (PIN + 401 处理)
    │       └── utils.ts                  # cn() 工具
    ├── .env.example
    └── package.json
```

## 快速开始

### 1. 安装

```bash
cd inspirations-farm-app
npm install
```

### 2. 环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
GITHUB_PAT=ghp_your_personal_access_token   # 需 repo 权限
REPO_OWNER=your-github-username
REPO_NAME=your-private-repo
APP_PIN=1234                                 # 锁屏 PIN（留空则跳过鉴权）
CRON_SECRET=your-random-secret               # Vercel Cron Job 鉴权
DIARY_TEMPLATE_PATH=Templates/Diary_Template.md  # 可选，默认即此值
```

### 3. 仓库结构

你的 GitHub 仓库应包含这些目录：

```
Inspirations/            # 灵感 .md 文件
Journal/Daily/           # 每日日记 .md 文件
Templates/               # （可选）Diary_Template.md
```

### 4. 运行

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，输入 APP_PIN 解锁。

## API 参考

所有端点都需 `x-app-pin` 头（除非未设置 `APP_PIN`）。

### /api/github

| 方法 | Body | 说明 |
|---|---|---|
| GET | — | 列出活跃灵感（含 `id`、`title`、`content`、`patches`） |
| POST | `{ content, priority?, tags? }` | 创建灵感（`Inspirations/YYYY-MM-DD-HHmmss.md`） |
| POST | `{ action: "syncIdeas", ideaIds: string[] }` | 批量归档灵感（Obsidian 端对账；幂等 —— 跳过已完成） |
| PATCH | `{ path, content }` | 给 `## 追加记录` 章节追加带时间戳的记录 |
| PUT | `{ path, sha, status }` 或 `{ ideaId, status }` | 更新状态，或按 ideaId 归档 |
| DELETE | `{ path, sha }` | 删除灵感 |

### /api/daily

| 方法 | Body | 说明 |
|---|---|---|
| GET | `?date=YYYY-MM-DD` | 获取日记（含解析后的任务 + 杂记） |
| POST | `{ date }` | 创建日记 |
| POST | `{ ideaId, ideaTitle, date }` | 把灵感推入今日任务（去重：`ideaId` 已存在返回 `409`） |
| POST | `{ action: "addNote", date, content }` | 给 `## 今日杂记` 追加带时间戳的笔记 |
| PUT | `{ path, sha, content }` | 更新日记内容 |

### /api/cron/rollover

| 方法 | 鉴权 | 说明 |
|---|---|---|
| GET | `Authorization: Bearer <CRON_SECRET>` 或 `?secret=<CRON_SECRET>` | 把昨天未完成任务迁移到今天 |

**查询参数：**

| 参数 | 值 | 说明 |
|---|---|---|
| `secret` | `<CRON_SECRET>` | URL 鉴权（Bearer 头的替代） |
| `dryRun` | `true` | 解析 + 构建内容，跳过 GitHub 写入，返回预览 |
| `targetDate` | `YYYY-MM-DD` | 时光机：显式设定源日期（目标 = 源 + 1 天） |

**鉴权优先级**：`NODE_ENV=development` → 跳过所有鉴权。否则：`?secret=` → `Authorization` 头。

**示例：**
```
# 本地安全测试（dev 模式 —— 无需鉴权）
/api/cron/rollover?dryRun=true

# 生产 dry run（URL 鉴权）
/api/cron/rollover?secret=<SECRET>&dryRun=true

# 时光机：6-30 → 7-1 的 rollover（源 = 06-30，目标 = 07-01）
/api/cron/rollover?secret=<SECRET>&dryRun=true&targetDate=2026-06-30

# 真实历史 rollover（会写入 GitHub！）
/api/cron/rollover?secret=<SECRET>&targetDate=2026-06-15
```

**Dry-run 响应**含 `sourcePreview`、`targetPreview`、`extractedTasks`、`sourceDate`、`targetDate`。

## Markdown 文件格式

所有 Markdown 内容用 `react-markdown` + `remark-gfm`（GFM）+ `@tailwindcss/typography` prose 样式渲染。支持 **粗体**、*斜体*、`代码`、[链接](url)、表格、任务列表、删除线。

**灵感**（`Inspirations/2026-06-19-113215.md`）：
```markdown
---
type: inspiration
status: active
create: 2026-06-19 11:32:15
priority: p2
tags: [rust, learning]
---

# 用户的笔记内容

一些正文...

## 追加记录

- **2026-06-20 14:30** 关于这个话题的后续想法
- **2026-06-21 09:15** 睡了一觉后的更新
```

**每日日记**（`Journal/Daily/2026-06-19.md`）：
```markdown
---
tags:
  - diary
date: 2026-06-19
---
# 近期计划



---
# 当日日程

- [ ] 买菜
- [ ] [[2026-06-19-113215|学 Rust]]    ← 联动的灵感
    - [ ] 4 空格缩进的子任务

---
# 本日总结

## 今日杂记

- **14:30** 白天随手记的想法
```

**数学公式语法** —— 灵感内容、追加记录、杂记、任务文本都支持：
```markdown
行内: $E = mc^2$

块级:
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

**Rollover 行为**：每天北京时间 00:01，cron 读取**昨天**的日记，从 `# 当日日程` 章节构建**任务树**（处理 `[x]`、`[ ]`、`[>]` 标记，任意嵌套深度）。树随后递归拆分：
- **全部完成**的子树（父 `[x]` + 所有后代 `[x]`）原样留在昨天。
- **部分完成**的子树拆分：完成部分留在昨天（父 `[>]`，子 `[x]`），未完成部分迁移到今天（父 `[ ]`，子 `[ ]`），保留嵌套。
- 迁移任务加 `🔄` 后缀，前端渲染琥珀色"延期"徽章 —— 用户看不到原始 emoji。防止重复叠加。

**目标已存在时合并**：如果今天的日记已存在，迁移任务会合并进其 `# 当日日程` 章节，而非整体追加。当迁移的顶层任务规范化文本（去掉 `🔄`）匹配已有顶层任务时，其后代追加到该已有根下 —— 例如 rollover 的 `数学 🔄` 会把子任务合并到已存在的 `数学` 下，而非创建重复。未匹配的顶层任务（以及会自嵌套的叶根）作为新根追加到章节末尾。缩进原样保留。

当今日日记尚不存在时，rollover 会从 GitHub 拉取 **Obsidian 模板** `Templates/Diary_Template.md`（路径可由 `DIARY_TEMPLATE_PATH` 配置）。替换 `{{date}}` / `{{DATE:YYYY-MM-DD}}` 为目标日期，并在 `%%TODO_PLACEHOLDER%%` 注入未完成任务。未找到占位符则追加到 `## 当日日程` 之后。模板拉取失败时用内置回退模板 —— 脚本绝不会因模板文件缺失而崩溃。

这种基于树的方式消除了"孤儿子任务"bug（旧行级过滤可能把子任务与父任务拆开，在目标日留下孤立的缩进项）。

**实时 UI 更新**：所有写操作用乐观更新 —— UI 立即按服务端响应（或本地计算的内容）应用变更，避开 GitHub API 的最终一致性延迟。追加记录、任务 toggle、加任务/子任务、加杂记都即时更新，无需重新拉取。

## 部署到 Vercel

1. 把本仓库推到 GitHub
2. 在 Vercel 导入 → 根目录设为 `inspirations-farm-app`
3. 添加环境变量：`GITHUB_PAT`、`REPO_OWNER`、`REPO_NAME`、`APP_PIN`、`CRON_SECRET`
4. 部署 → 你的自定义域名以 HTTPS 提供 PWA
5. 在 Vercel Dashboard → Cron Jobs 确认定时任务已激活

## 更新日志

完整开发日志见 [docs/DEVLOG.md](docs/DEVLOG.md)。

### v1.0.0 (2026-07-05)

**审计与健壮性**
- YAML `status` 更新从正则改为结构化 `gray-matter`（用 `JSON_SCHEMA` 让 `create` 等日期类字段保持字符串 —— 不再有时区损坏）。
- `parseInspirationPatches` 保留多行 patch 内容（此前续行被丢弃）。
- `calcIndent` 改用 `Math.floor`（单个空格缩进不再被算作一级）；`parseTasks` 接受 `-`/`*`/`+` 任务标记。
- `syncIdeasState` 改为 `Promise.allSettled` 并发（此前串行 —— 易触发 Vercel 超时）。
- `[-+*]` 任务标记支持在 `cascade.ts`、`rollover.ts`、`insertSubtaskLine` 间一致化（toggle/rebuild 时保留 bullet）。
- 日记读取时归一化为 LF —— CRLF 文件（Windows 版 Obsidian）不再静默丢失任务/杂记。

**架构**
- `github.ts` 按单一职责拆分为 `github-client.ts`（网络）+ `markdown-utils.ts`（Markdown）+ `github.ts`（业务服务）。公开 API 不变。
- 章节插入/解析重写为 mdast AST —— 代码块与 frontmatter 安全；逐字节保留（无全量重序列化）。

**一致性**
- `modifyDailyJournal` 把日记读-改-写包进 409 重试 + 读前暂停，修复快速连续写入的 409，以及 GitHub 最终一致性导致的静默数据丢失。
