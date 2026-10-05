# AI 参谋（/chat）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Inspirations Farm App 中新增「AI 参谋」：基于 Note（日记）与 review_status-（考研计划）两个远程 GitHub 仓库的 agentic 工具检索对话，AI 可全自动改写计划文档（单文件 `[ai-chat]` commit + 一键回滚），Note 仅追加。

**Architecture:** Next.js API 路由（Vercel Functions，`maxDuration=60`）内用 Vercel AI SDK v5 `streamText` + 服务端工具调用；语料经 git trees API + Contents API 装入 lambda 内存缓存（TTL 5min、45s 预算、热度优先），热集（本周三科计划 + 宏观规划 + 最近周总结 + 近 7 天日记）预载进 system prompt；写入走既有 Contents API + `withConflictRetry` 纪律；写权限（review 全写 / note 仅追加）在工具参数校验层强制，不依赖提示词。

**Tech Stack:** Next.js 16 App Router（既有）、`ai@^5` + `@ai-sdk/react@^2` + `@ai-sdk/openai-compatible@^1` + `zod@^4`（新增，仅此四件）、GLM OpenAI 兼容端点（env 可切）、node:test 离线测试（既有惯例）。

**Spec:** `docs/plan/ai-counselor/design.md`（本计划从 spec 论证，执行者两份都读）

## Global Constraints

- 测试全离线：不访问 GitHub / LLM 网络；框架 = node:test + `--experimental-strip-types`，测试文件为 `tests/*.test.mjs`，直接 `import "../src/....ts"`（带 .ts 扩展名，既有惯例）。
- 所有 GitHub 访问走 `githubFetchFor`（复用服务端 `GITHUB_PAT`），PAT 不得出现在客户端代码。
- 三个 chat 路由一律 `validatePin(req)` 开头（401 = `{ok:false,error:"Unauthorized"}`）；`/api/chat` 声明 `export const maxDuration = 60;`。
- AI 写入 commit 消息一律前缀 `[ai-chat] `（常量 `AI_COMMIT_PREFIX`）。
- Note 仓库**只允许追加**：`update_plan_file` 对 note 仓库必须抛 `WriteForbiddenError`；系统内不存在「全文件改写日记」的函数。
- 日期一律北京时区（复用 `src/lib/beijing-time.ts`）。
- 新依赖仅：`ai@^5`、`@ai-sdk/react@^2`、`@ai-sdk/openai-compatible@^1`、`zod@^4`。禁止引入向量/embedding 库。
- UI 文案中文；样式沿用 `@/components/ui/*` + `var(--farm-*)` 变量惯例。

## Review Focus

spec 隐含但单任务测试最容易漏掉的五类输入（每条已钉进归属任务的测试）：

1. **提示注入要求改写历史日记** — 期望：工具层根本没有全文件改写日记的函数，`update_plan_file` 拒绝 note 仓库。钉在 Task 6。
2. **AI 幻觉路径**（`..`、`sources/` 前缀、非 .md）— 期望：工具返回结构化错误文本供模型自纠，不抛断流。钉在 Task 4/6。
3. **写时外部并发修改**（obsidian-git / Hermes 周 job）— 期望：409 被 `withConflictRetry` 自动消化，重 GET 新 sha 后重放。钉在 Task 4。
4. **GitHub 故障 / 45s 预算内未载完语料** — 期望：降级不阻塞，`search_text` 返回覆盖率，session 返回 `degraded:true` + 「数据截至」时间。钉在 Task 2/9。
5. **`AI_API_KEY` 未配置** — 期望：`/api/chat` 返回 503 明确错误，而非空白流。钉在 Task 8。

---

### Task 1: 依赖、env 键位、双仓库注册表与参数化 GitHub 客户端

**Files:**
- Modify: `inspirations-farm-app/package.json`（scripts 之外只加 dependencies）
- Modify: `inspirations-farm-app/.env.example`
- Modify: `inspirations-farm-app/src/lib/github-client.ts`（githubFetch 拆出可注入凭证的内部变体）
- Create: `inspirations-farm-app/src/lib/chat/repos.ts`
- Create: `inspirations-farm-app/src/lib/chat/github-chat.ts`
- Test: `inspirations-farm-app/tests/chat-repos.test.mjs`

**Interfaces:**
- Consumes: 既有 `getConfig()`、`githubFetch`、错误类（`src/lib/github-client.ts`）。
- Produces:
  - `type ChatRepoId = "note" | "review"`；`interface ChatRepo { id: ChatRepoId; owner: string; repo: string; label: string }`
  - `getChatRepos(env?): { note: ChatRepo; review: ChatRepo }`（缺 env 抛 `ChatConfigError`）
  - `class ChatConfigError extends Error`
  - `githubFetchFor<T>(creds: { pat: string }, path: string, options?: RequestInit): Promise<T>`
  - `interface ChatGithubIo { getFile(repo, path): Promise<{sha, content}>; putFile(repo, path, content, message, sha?): Promise<{commit, url}>; getCommit(repo, sha): Promise<{parents: string[]}>; getFileAtRef(repo, path, ref): Promise<{sha, content}>; listMdPaths(repo): Promise<string[]> }`
  - `createChatGithubIo(deps?: { fetch?: typeof githubFetchFor 风格函数 }): ChatGithubIo`（deps.fetch 可注入做离线测试，签名 `(creds, path, options) => Promise<any>`）

- [ ] **Step 1: 安装依赖**

```bash
cd inspirations-farm-app && npm install ai@^5 @ai-sdk/react@^2 @ai-sdk/openai-compatible@^1 zod@^4
```

- [ ] **Step 2: 写失败测试** — `tests/chat-repos.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import { ChatConfigError, getChatRepos } from "../src/lib/chat/repos.ts";

test("getChatRepos maps note from REPO_* and review from REVIEW_REPO_*", () => {
  const repos = getChatRepos({
    REPO_OWNER: "alan",
    REPO_NAME: "Note",
    REVIEW_REPO_OWNER: "alan",
    REVIEW_REPO_NAME: "review_status-",
  });
  assert.equal(repos.note.id, "note");
  assert.equal(repos.note.repo, "Note");
  assert.equal(repos.review.id, "review");
  assert.equal(repos.review.repo, "review_status-");
});

test("getChatRepos throws ChatConfigError when REVIEW_REPO_* missing", () => {
  assert.throws(
    () => getChatRepos({ REPO_OWNER: "alan", REPO_NAME: "Note" }),
    ChatConfigError
  );
});

test("createChatGithubIo getFile decodes content and guards traversal", async () => {
  const { createChatGithubIo } = await import("../src/lib/chat/github-chat.ts");
  const calls = [];
  const io = createChatGithubIo({
    pat: "pat-test",
    fetch: async (creds, path) => {
      calls.push({ pat: creds.pat, path });
      if (path.includes("contents/a%2Fb.md")) {
        return { sha: "s1", content: btoa("hello"), encoding: "base64" };
      }
      throw new Error("unexpected " + path);
    },
  });
  const repos = getChatRepos({
    REPO_OWNER: "alan",
    REPO_NAME: "Note",
    REVIEW_REPO_OWNER: "alan",
    REVIEW_REPO_NAME: "review_status-",
  });
  const file = await io.getFile(repos.note, "a/b.md");
  assert.equal(file.sha, "s1");
  assert.equal(file.content, "hello");
  assert.equal(calls[0].pat, "pat-test");
  assert.ok(calls[0].path.startsWith("/repos/alan/Note/contents/"));
  await assert.rejects(() => io.getFile(repos.note, "../escape.md"));
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- tests/chat-repos.test.mjs`（实际命令：`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --import ./tests/register-hooks.mjs --test tests/chat-repos.test.mjs`）
Expected: FAIL（模块不存在）

- [ ] **Step 4: github-client.ts 拆出 githubFetchFor** — 把 `githubFetch` 的函数体移入新导出 `githubFetchFor(creds, path, options)`，`githubFetch` 变为薄委托：

```ts
/** Parameterised variant of githubFetch for callers targeting a repo other
 *  than the default vault. Same auth headers and error mapping. */
export async function githubFetchFor<T = unknown>(
  creds: { pat: string },
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${creds.pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const safeMessage = `GitHub API error ${res.status}`;
    console.error(`[githubFetchFor] ${path}:`, body.slice(0, 500));
    if (res.status === 409) throw new GitHubConflictError(safeMessage);
    throw new GitHubApiError(safeMessage, res.status);
  }
  return res.json() as Promise<T>;
}

export async function githubFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { pat } = getConfig();
  return githubFetchFor<T>({ pat }, path, options);
}
```

- [ ] **Step 5: 实现 repos.ts**

```ts
export type ChatRepoId = "note" | "review";

export interface ChatRepo {
  id: ChatRepoId;
  owner: string;
  repo: string;
  label: string;
}

export class ChatConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatConfigError";
  }
}

export function getChatRepos(
  env: Record<string, string | undefined> = process.env
): { note: ChatRepo; review: ChatRepo } {
  const { REPO_OWNER, REPO_NAME, REVIEW_REPO_OWNER, REVIEW_REPO_NAME } = env;
  if (!REPO_OWNER || !REPO_NAME) {
    throw new ChatConfigError("Missing REPO_OWNER/REPO_NAME (note vault)");
  }
  if (!REVIEW_REPO_OWNER || !REVIEW_REPO_NAME) {
    throw new ChatConfigError(
      "Missing REVIEW_REPO_OWNER/REVIEW_REPO_NAME (review_status)"
    );
  }
  return {
    note: { id: "note", owner: REPO_OWNER, repo: REPO_NAME, label: "日记/灵感库" },
    review: { id: "review", owner: REVIEW_REPO_OWNER, repo: REVIEW_REPO_NAME, label: "复习计划库" },
  };
}
```

- [ ] **Step 6: 实现 github-chat.ts** — `ChatGithubIo` 的五个方法，全部走 `githubFetchFor`，路径段用 `encodeURIComponent` 编码（Contents API 接受百分号编码路径）：

```ts
import {
  type GitHubContentItem,
  decodeBase64,
  encodeBase64,
  githubFetchFor,
} from "@/lib/github-client";
import type { ChatRepo } from "@/lib/chat/repos";

export interface ChatGithubIo {
  getFile(repo: ChatRepo, path: string): Promise<{ sha: string; content: string }>;
  putFile(
    repo: ChatRepo,
    path: string,
    content: string,
    message: string,
    sha?: string
  ): Promise<{ commit: string; url: string }>;
  getCommit(repo: ChatRepo, sha: string): Promise<{ parents: string[] }>;
  getFileAtRef(
    repo: ChatRepo,
    path: string,
    ref: string
  ): Promise<{ sha: string; content: string }>;
  listMdPaths(repo: ChatRepo): Promise<string[]>;
}

function assertSafePath(path: string): void {
  if (path.includes("..") || path.startsWith("/")) {
    throw new Error(`Invalid file path: ${path}`);
  }
}

function enc(repo: ChatRepo, path: string): string {
  return `/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(path)}`;
}

export function createChatGithubIo(
  overrides: {
    pat?: string;
    fetch?: (creds: { pat: string }, path: string, options?: RequestInit) => Promise<unknown>;
  } = {}
): ChatGithubIo {
  const pat = overrides.pat ?? process.env.GITHUB_PAT ?? "";
  const gh = overrides.fetch ?? githubFetchFor;

  async function getFile(repo: ChatRepo, path: string) {
    assertSafePath(path);
    const data = await gh<{ sha: string; content: string; encoding: string }>(
      { pat },
      enc(repo, path)
    );
    if (data.encoding !== "base64") throw new Error(`Unexpected encoding: ${data.encoding}`);
    return { sha: data.sha, content: decodeBase64(data.content).replace(/\r\n?/g, "\n") };
  }

  async function putFile(
    repo: ChatRepo,
    path: string,
    content: string,
    message: string,
    sha?: string
  ) {
    assertSafePath(path);
    const res = await gh<{ commit: { sha: string }; content: { html_url: string } }>(
      { pat },
      enc(repo, path),
      {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: encodeBase64(content),
          ...(sha ? { sha } : {}),
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
    return { commit: res.commit.sha, url: res.content.html_url };
  }

  async function getCommit(repo: ChatRepo, sha: string) {
    const res = await gh<{ parents: Array<{ sha: string }> }>(
      { pat },
      `/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(sha)}`
    );
    return { parents: res.parents.map((p) => p.sha) };
  }

  async function getFileAtRef(repo: ChatRepo, path: string, ref: string) {
    assertSafePath(path);
    const data = await gh<{ sha: string; content: string; encoding: string }>(
      { pat },
      `${enc(repo, path)}?ref=${encodeURIComponent(ref)}`
    );
    if (data.encoding !== "base64") throw new Error(`Unexpected encoding: ${data.encoding}`);
    return { sha: data.sha, content: decodeBase64(data.content).replace(/\r\n?/g, "\n") };
  }

  async function listMdPaths(repo: ChatRepo) {
    const res = await gh<{
      truncated?: boolean;
      tree: Array<{ path: string; type: string }>;
    }>({ pat }, `/repos/${repo.owner}/${repo.repo}/git/trees/HEAD?recursive=1`);
    if (res.truncated) console.warn(`[chat] tree truncated for ${repo.repo}`);
    return res.tree.filter((n) => n.type === "blob" && n.path.endsWith(".md")).map((n) => n.path);
  }

  return { getFile, putFile, getCommit, getFileAtRef, listMdPaths };
}
```

- [ ] **Step 7: .env.example 追加键位**（注释照抄）

```bash
# ── AI counselor chat (/chat) ──
# OpenAI-compatible endpoint; GLM by default. Key lives server-side only.
AI_API_KEY=
AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_MODEL=glm-4.6

# Counselor chat write target: the review_status repo (second remote repo).
REVIEW_REPO_OWNER=your-github-username
REVIEW_REPO_NAME=review_status-
```

- [ ] **Step 8: 跑全部测试确认无回归**

Run: `npm test`
Expected: 全部 PASS（含既有 20 个测试文件与新 chat-repos）

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .env.example src/lib/github-client.ts src/lib/chat/repos.ts src/lib/chat/github-chat.ts tests/chat-repos.test.mjs
git commit -m "feat(chat): dual-repo registry and parameterized github client"
```

---

### Task 2: 语料缓存 corpus-cache（45s 预算、TTL、热度优先、覆盖率）

**Files:**
- Create: `inspirations-farm-app/src/lib/chat/corpus-cache.ts`
- Test: `inspirations-farm-app/tests/chat-corpus-cache.test.mjs`

**Interfaces:**
- Consumes: `ChatRepo`、`ChatGithubIo.listMdPaths`（Task 1）。
- Produces:
  - `interface CorpusEntry { files: Map<string, string>; treePaths: string[]; fetchedAt: number; partial: boolean }`
  - `ensureCorpus(repo, io: ChatGithubIo, opts?: { budgetMs?: number; force?: boolean; now?: () => number }): Promise<CorpusEntry>`
  - `getCorpus(id: ChatRepoId): CorpusEntry | null`
  - `corpusCoverage(id: ChatRepoId): { cached: number; total: number; fetchedAt: number | null; partial: boolean }`
  - `corpusPriority(repoId: ChatRepoId, path: string, todayBeijing: string): number`（越小越先载）
  - `readThrough(repo, path, io): Promise<string | null>`（缓存优先，未命中回源并写入缓存；404 → null）

- [ ] **Step 1: 写失败测试** — `tests/chat-corpus-cache.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  corpusCoverage,
  corpusPriority,
  ensureCorpus,
  getCorpus,
} from "../src/lib/chat/corpus-cache.ts";

// 直接构造 ChatRepo 形状，避免依赖 env
const review = { id: "review", owner: "a", repo: "r", label: "复习计划库" };
const note = { id: "note", owner: "a", repo: "n", label: "日记/灵感库" };

function fakeIo(paths, delayMs = 0) {
  return {
    getFile: async (repo, path) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (!paths.contents[path]) throw new Error("404");
      return { sha: "s", content: paths.contents[path] };
    },
    putFile: async () => {
      throw new Error("not used");
    },
    getCommit: async () => {
      throw new Error("not used");
    },
    getFileAtRef: async () => {
      throw new Error("not used");
    },
    listMdPaths: async () => paths.tree,
  };
}

test("ensureCorpus loads all md files within budget and caches", async () => {
  const io = fakeIo({
    tree: ["宏观复习规划.md", "数学/w39/旧.md", "数学/w40/本周复习计划.md"],
    contents: { "宏观复习规划.md": "M", "数学/w39/旧.md": "O", "数学/w40/本周复习计划.md": "W40" },
  });
  const entry = await ensureCorpus(review, io, { now: () => 1_000_000 });
  assert.equal(entry.files.get("数学/w40/本周复习计划.md"), "W40");
  assert.equal(entry.partial, false);
  assert.equal(getCorpus("review"), entry);
  assert.deepEqual(corpusCoverage("review"), {
    cached: 3,
    total: 3,
    fetchedAt: 1_000_000,
    partial: false,
  });
});

test("ensureCorpus respects TTL and force refresh", async () => {
  let clock = 1_000_000;
  const io = fakeIo({ tree: ["a.md"], contents: { "a.md": "A" } });
  const first = await ensureCorpus(review, io, { now: () => clock });
  const second = await ensureCorpus(review, io, { now: () => clock + 60_000 });
  assert.equal(first, second); // TTL 内命中缓存
  const third = await ensureCorpus(review, io, { now: () => clock + 600_000, force: false });
  assert.notEqual(first, third); // TTL 过期重载
});

test("ensureCorpus marks partial when budget exhausted, recent week first", async () => {
  const tree = [
    "数学/w20/本周复习计划.md",
    "数学/w40/本周复习计划.md",
    "记忆库/心理/2026-09-01_状态.md",
    "Archive/旧.md",
  ];
  const contents = Object.fromEntries(tree.map((p) => [p, "C:" + p]));
  const io = fakeIo({ tree, contents }, 30); // 每文件 30ms
  const entry = await ensureCorpus(review, io, {
    budgetMs: 100,
    now: () => Date.now(),
  });
  assert.equal(entry.partial, true);
  assert.ok(entry.files.has("数学/w40/本周复习计划.md"), "最近周优先载入");
  assert.ok(entry.files.has("记忆库/心理/2026-09-01_状态.md"), "记忆库优先级高于 Archive");
  assert.ok(!entry.files.has("Archive/旧.md") || entry.partial);
});

test("corpusPriority: review recent week < memory < archive; note recent daily first", () => {
  const today = "2026-10-05";
  const recentWeek = corpusPriority("review", "数学/w40/本周复习计划.md", today);
  const oldWeek = corpusPriority("review", "数学/w20/本周复习计划.md", today);
  const memory = corpusPriority("review", "记忆库/心理/x.md", today);
  const archive = corpusPriority("review", "Archive/旧.md", today);
  assert.ok(recentWeek < oldWeek);
  assert.ok(oldWeek < memory);
  assert.ok(memory < archive);

  const todayDaily = corpusPriority("note", "Journal/Daily/2026-10-05.md", today);
  const weekOldDaily = corpusPriority("note", "Journal/Daily/2026/09/2026-09-28.md", today);
  const inspiration = corpusPriority("note", "Inspirations/AI-20261005.md", today);
  assert.ok(todayDaily < weekOldDaily);
  assert.ok(weekOldDaily < inspiration);
});

test("readThrough hits cache then falls back to network on miss", async () => {
  const io = fakeIo({
    tree: ["a.md", "b.md"],
    contents: { "a.md": "A", "b.md": "B", "c.md": "C" },
  });
  await ensureCorpus(note, io, { now: () => Date.now() });
  const { readThrough } = await import("../src/lib/chat/corpus-cache.ts");
  assert.equal(await readThrough(note, "a.md", io), "A");
  assert.equal(await readThrough(note, "c.md", io), "C"); // 未在 tree 里 → 回源成功并入缓存
  assert.equal(await readThrough(note, "missing.md", io), null); // 404 → null
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-corpus-cache.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 corpus-cache.ts**

```ts
import pLimit from "p-limit";
import { formatBeijingDate } from "@/lib/beijing-time";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo, ChatRepoId } from "@/lib/chat/repos";

export interface CorpusEntry {
  files: Map<string, string>;
  treePaths: string[];
  fetchedAt: number;
  partial: boolean;
}

const TTL_MS = 5 * 60_000;
export const LOAD_BUDGET_MS = 45_000;

const cache = new Map<ChatRepoId, CorpusEntry>();

/** 加载优先级（小者先载）。review：宏观/顶层 > 最近周计划 > 记忆库 > 其余；
 *  note：最近日记 > Inspirations > 其余。 */
export function corpusPriority(
  repoId: ChatRepoId,
  path: string,
  todayBeijing: string
): number {
  if (repoId === "review") {
    if (!path.includes("/")) return 0; // 宏观复习规划.md、总览.md 等顶层文件
    const week = /\/w(\d{2,})\//.exec(path);
    if (week) return 100 - Number(week[1]); // 周号越大越新越优先
    if (path.startsWith("记忆库/")) return 500;
    return 10_000;
  }
  const m = /(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
  if (m) {
    const days = Math.max(
      0,
      Math.round(
        (Date.parse(todayBeijing) - Date.parse(m[1])) / 86_400_000
      )
    );
    return 100 + Math.min(days, 3650);
  }
  if (path.startsWith("Inspirations/")) return 5_000;
  return 20_000;
}

export async function ensureCorpus(
  repo: ChatRepo,
  io: ChatGithubIo,
  opts: { budgetMs?: number; force?: boolean; now?: () => number } = {}
): Promise<CorpusEntry> {
  const now = opts.now ?? Date.now();
  const existing = cache.get(repo.id);
  if (existing && !opts.force && now() - existing.fetchedAt < TTL_MS) return existing;

  const treePaths = await io.listMdPaths(repo);
  const today = formatBeijingDate(new Date(now()));
  const deadline = now() + (opts.budgetMs ?? LOAD_BUDGET_MS);
  const files = existing?.files ?? new Map<string, string>();
  const limit = pLimit(10);
  let gaveUp = false;

  const sorted = [...treePaths].sort(
    (a, b) => corpusPriority(repo.id, a, today) - corpusPriority(repo.id, b, today)
  );
  await Promise.all(
    sorted.map((path) =>
      limit(async () => {
        if (now() > deadline) {
          gaveUp = true;
          return;
        }
        try {
          files.set(path, (await io.getFile(repo, path)).content);
        } catch {
          // 单文件 404/瞬时失败：跳过，覆盖率如实反映
        }
      })
    )
  );

  const entry: CorpusEntry = {
    files,
    treePaths,
    fetchedAt: now(),
    partial: gaveUp || files.size < treePaths.length,
  };
  cache.set(repo.id, entry);
  return entry;
}

export function getCorpus(id: ChatRepoId): CorpusEntry | null {
  return cache.get(id) ?? null;
}

export function corpusCoverage(id: ChatRepoId): {
  cached: number;
  total: number;
  fetchedAt: number | null;
  partial: boolean;
} {
  const e = cache.get(id);
  if (!e) return { cached: 0, total: 0, fetchedAt: null, partial: false };
  return {
    cached: e.files.size,
    total: e.treePaths.length,
    fetchedAt: e.fetchedAt,
    partial: e.partial,
  };
}

/** 缓存优先读取；未命中回源并写回缓存；404/非法路径 → null。 */
export async function readThrough(
  repo: ChatRepo,
  path: string,
  io: ChatGithubIo
): Promise<string | null> {
  const entry = cache.get(repo.id);
  const hit = entry?.files.get(path);
  if (hit !== undefined) return hit;
  try {
    const { content } = await io.getFile(repo, path);
    entry?.files.set(path, content);
    return content;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/chat-corpus-cache.test.mjs`
Expected: PASS（5 个测试）

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/corpus-cache.ts tests/chat-corpus-cache.test.mjs
git commit -m "feat(chat): in-memory corpus cache with budget, TTL and priority"
```

---

### Task 3: 热集装配 hot-set（ISO 周、路径解析、prompt 文本）

**Files:**
- Create: `inspirations-farm-app/src/lib/chat/hot-set.ts`
- Test: `inspirations-farm-app/tests/chat-hot-set.test.mjs`

**Interfaces:**
- Consumes: `ChatRepo`（Task 1）、`getCorpus`/`readThrough`（Task 2）、`formatBeijingDate`。
- Produces:
  - `isoWeek(d: Date): { year: number; week: number }`
  - `weekLabel(w: { week: number }): string`（`"w40"`）
  - `minusDays(dateStr: string, n: number): string`（"YYYY-MM-DD" 逐日回退）
  - `resolveHotSetPaths(repoId: ChatRepoId, treePaths: string[], todayBeijing: string): string[]`（review：宏观 + 三科本周计划 + 最近周总结；note：近 7 天日记；合计 ≤ 14 条）
  - `assembleHotSet(repos, io, now: Date): Promise<{ text: string; loaded: string[]; degraded: boolean }>`（读缓存在场文件，缺失的跳过；一个都没载到 → degraded）

- [ ] **Step 1: 写失败测试** — `tests/chat-hot-set.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  isoWeek,
  minusDays,
  resolveHotSetPaths,
  weekLabel,
} from "../src/lib/chat/hot-set.ts";

test("isoWeek handles year boundaries", () => {
  assert.deepEqual(isoWeek(new Date("2026-01-01T12:00:00+08:00")), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(new Date("2026-10-05T12:00:00+08:00")), { year: 2026, week: 41 });
  assert.deepEqual(isoWeek(new Date("2027-01-01T12:00:00+08:00")), { year: 2026, week: 53 });
});

test("weekLabel zero-pads", () => {
  assert.equal(weekLabel({ week: 5 }), "w05");
  assert.equal(weekLabel({ week: 40 }), "w40");
});

test("minusDays crosses month", () => {
  assert.equal(minusDays("2026-10-05", 7), "2026-09-28");
  assert.equal(minusDays("2026-03-01", 1), "2026-02-28");
});

test("resolveHotSetPaths review: macro + current week plans + latest summary", () => {
  const tree = [
    "宏观复习规划.md",
    "总览.md",
    "408/w39/本周复习计划.md",
    "408/w40/本周复习计划.md",
    "数学/w40/本周复习计划.md",
    "数学/w40/本周总结.md",
    "英语/w40/本周复习计划.md",
    "数学/w39/本周总结.md",
    "记忆库/心理/x.md",
  ];
  const paths = resolveHotSetPaths("review", tree, "2026-09-30");
  assert.ok(paths.includes("宏观复习规划.md"));
  assert.ok(paths.includes("408/w40/本周复习计划.md"));
  assert.ok(paths.includes("数学/w40/本周复习计划.md"));
  assert.ok(paths.includes("英语/w40/本周复习计划.md"));
  assert.ok(paths.includes("数学/w40/本周总结.md"), "取最近周的总结");
  assert.ok(!paths.includes("数学/w39/本周总结.md"));
  assert.ok(!paths.includes("408/w39/本周复习计划.md"), "不要旧周计划");
});

test("resolveHotSetPaths note: last 7 days incl. nested monthly layout", () => {
  const tree = [
    "Journal/Daily/2026-10-04.md",
    "Journal/Daily/2026-10-05.md",
    "Journal/Daily/2026/09/2026-09-30.md",
    "Journal/Daily/2026/09/2026-09-28.md",
    "Inspirations/x.md",
  ];
  const paths = resolveHotSetPaths("note", tree, "2026-10-05");
  assert.ok(paths.includes("Journal/Daily/2026-10-05.md"));
  assert.ok(paths.includes("Journal/Daily/2026/09/2026-09-30.md"));
  assert.ok(!paths.includes("Inspirations/x.md"));
  assert.ok(paths.length <= 7);
});

test("assembleHotSet skips missing files and flags degraded when nothing loads", async () => {
  const { assembleHotSet } = await import("../src/lib/chat/hot-set.ts");
  const repos = {
    note: { id: "note", owner: "a", repo: "n", label: "日记/灵感库" },
    review: { id: "review", owner: "a", repo: "r", label: "复习计划库" },
  };
  const present = { "宏观复习规划.md": "# 宏观计划" };
  const io = {
    getFile: async (repo, path) => {
      if (present[path]) return { sha: "s", content: present[path] };
      throw new Error("404");
    },
  };
  // 预置缓存：直接经由 ensureCorpus 太重，这里用 readThrough 的缓存外通道——
  // assembleHotSet 依赖 getCorpus，测试里先用 ensureCorpus 造缓存
  const { ensureCorpus } = await import("../src/lib/chat/corpus-cache.ts");
  await ensureCorpus(repos.review, {
    getFile: io.getFile,
    putFile: async () => { throw new Error("-"); },
    getCommit: async () => { throw new Error("-"); },
    getFileAtRef: async () => { throw new Error("-"); },
    listMdPaths: async () => ["宏观复习规划.md", "数学/w40/本周复习计划.md"],
  }, { now: () => Date.now() });

  const result = await assembleHotSet(repos, io, new Date("2026-09-30T12:00:00+08:00"));
  assert.ok(result.text.includes("# 宏观计划"));
  assert.ok(result.loaded.includes("宏观复习规划.md"));
  assert.ok(
    result.missing.includes("数学/w40/本周复习计划.md"),
    "树里有但缓存缺失的文件进 missing 清单"
  );
  assert.equal(result.degraded, false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-hot-set.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 hot-set.ts**

```ts
import { getCorpus, readThrough } from "@/lib/chat/corpus-cache";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo, ChatRepoId } from "@/lib/chat/repos";
import { formatBeijingDate } from "@/lib/beijing-time";

/** ISO 8601 周号（周一为一周之始；含 12/29-31 可能属次年 w01 的规则）。 */
export function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // 周日 = 7
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export function weekLabel(w: { week: number }): string {
  return `w${String(w.week).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" 回退 n 天（UTC 逐日算术，避开时区坑）。 */
export function minusDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - n));
  return dt.toISOString().slice(0, 10);
}

const REVIEW_SUBJECTS = "(?:408|数学|英语)";

/** 从全树路径解析热集文件。review：宏观 + 三科本周计划 + 最近周总结；
 *  note：近 7 天日记（兼容当月顶层与按月嵌套两种布局）。 */
export function resolveHotSetPaths(
  repoId: ChatRepoId,
  treePaths: string[],
  todayBeijing: string
): string[] {
  if (repoId === "review") {
    const label = weekLabel(isoWeek(new Date(`${todayBeijing}T12:00:00+08:00`)));
    const out: string[] = [];
    const macro = treePaths.find((p) => p === "宏观复习规划.md");
    if (macro) out.push(macro);
    for (const subject of ["408", "数学", "英语"]) {
      const plan = treePaths.find(
        (p) => p === `${subject}/${label}/本周复习计划.md`
      );
      if (plan) out.push(plan);
    }
    const summaries = treePaths
      .map((p) => {
        const m = new RegExp(`^${REVIEW_SUBJECTS}/w(\\d{2,})/.*总结.*\\.md$`).exec(p);
        return m ? { path: p, week: Number(m[1]) } : null;
      })
      .filter((x): x is { path: string; week: number } => x !== null)
      .sort((a, b) => b.week - a.week);
    if (summaries[0]) out.push(summaries[0].path);
    return out;
  }
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = minusDays(todayBeijing, i);
    const hit = treePaths.find((p) => p.endsWith(`/${date}.md`) || p === `Journal/Daily/${date}.md`);
    if (hit) out.push(hit);
  }
  return out;
}

export interface HotSetResult {
  text: string;
  loaded: string[];
  missing: string[];
  degraded: boolean;
}

/** 组装热集 prompt 文本：仓库名 + 文件路径头 + 正文。只在缓存里取（不阻塞），
 *  缺失文件列入 missing；全部缺失 → degraded。 */
export async function assembleHotSet(
  repos: { note: ChatRepo; review: ChatRepo },
  io: ChatGithubIo,
  now: Date
): Promise<HotSetResult> {
  const today = formatBeijingDate(now);
  const blocks: string[] = [];
  const loaded: string[] = [];
  const missing: string[] = [];

  for (const repo of [repos.review, repos.note]) {
    const entry = getCorpus(repo.id);
    if (!entry) continue;
    const paths = resolveHotSetPaths(repo.id, entry.treePaths, today);
    for (const path of paths) {
      const content = await readThrough(repo, path, io);
      if (content === null) {
        missing.push(path);
        continue;
      }
      loaded.push(path);
      blocks.push(`### [${repo.label}] ${path}\n\n${content}`);
    }
  }

  return {
    text: blocks.join("\n\n---\n\n"),
    loaded,
    missing,
    degraded: loaded.length === 0,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/chat-hot-set.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/hot-set.ts tests/chat-hot-set.test.mjs
git commit -m "feat(chat): hot-set resolution with ISO week and 7-day journal window"
```

---

### Task 4: 计划写层 —— updatePlanFile / revertPlanFile（单文件单 commit、409 重试、回滚幂等）

**Files:**
- Create: `inspirations-farm-app/src/lib/chat/write-core.ts`
- Create: `inspirations-farm-app/src/lib/chat/plan-writes.ts`
- Test: `inspirations-farm-app/tests/chat-plan-writes.test.mjs`

**Interfaces:**
- Consumes: `ChatGithubIo`、`withConflictRetry`/`GitHubConflictError`（github-client）、`ChatRepo`。
- Produces:
  - `const AI_COMMIT_PREFIX = "[ai-chat] "`
  - `class WriteForbiddenError extends Error`、`class JournalMissingError extends Error`
  - `updatePlanFile(repo: ChatRepo, path: string, newContent: string, reason: string, io: ChatGithubIo): Promise<WriteResult>`
  - `revertPlanFile(repo: ChatRepo, path: string, commitSha: string, io: ChatGithubIo): Promise<WriteResult & { alreadyReverted: boolean }>`
  - `interface WriteResult { path: string; commit: string; url: string | null }`

- [ ] **Step 1: 写失败测试** — `tests/chat-plan-writes.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_COMMIT_PREFIX,
  WriteForbiddenError,
} from "../src/lib/chat/write-core.ts";
import { revertPlanFile, updatePlanFile } from "../src/lib/chat/plan-writes.ts";
import { GitHubConflictError } from "../src/lib/github-client.ts";

const review = { id: "review", owner: "a", repo: "review_status-", label: "复习计划库" };
const note = { id: "note", owner: "a", repo: "Note", label: "日记/灵感库" };

function fakeIo(state) {
  // state: { files: Map<path, {sha, content}>, puts: [] }
  return {
    getFile: async (repo, path) => {
      const f = state.files.get(path);
      if (!f) throw new Error("404");
      return { ...f };
    },
    putFile: async (repo, path, content, message, sha) => {
      if (state.conflictOnce && !state.conflicted) {
        state.conflicted = true;
        throw new GitHubConflictError("stale sha");
      }
      state.puts.push({ path, content, message, sha });
      const commit = "c" + state.puts.length;
      state.files.set(path, { sha: "s-" + commit, content });
      return { commit, url: `https://github.com/a/${repo.repo}/commit/${commit}` };
    },
    getCommit: async (repo, sha) => ({ parents: [state.parents[sha] ?? "root"] }),
    getFileAtRef: async (repo, path, ref) => {
      const f = state.atRef.get(`${path}@${ref}`);
      if (!f) throw new Error("404 at ref");
      return { ...f };
    },
    listMdPaths: async () => [],
  };
}

test("updatePlanFile writes with [ai-chat] prefix and returns commit", async () => {
  const state = { files: new Map([["数学/w40/本周复习计划.md", { sha: "s0", content: "旧" }]]), puts: [] };
  const res = await updatePlanFile(
    review, "数学/w40/本周复习计划.md", "新内容", "套卷提前至周三", fakeIo(state)
  );
  assert.equal(res.commit, "c1");
  assert.ok(res.url.includes("/commit/c1"));
  assert.equal(state.puts[0].message, `${AI_COMMIT_PREFIX}套卷提前至周三`);
  assert.equal(state.puts[0].sha, "s0");
});

test("updatePlanFile retries once on 409 with fresh sha", async () => {
  const state = {
    files: new Map([["数学/w40/本周复习计划.md", { sha: "s0", content: "旧" }]]),
    puts: [], conflictOnce: true,
  };
  const io = fakeIo(state);
  const res = await updatePlanFile(review, "数学/w40/本周复习计划.md", "新", "调整", io);
  assert.equal(res.commit, "c1");
  assert.equal(state.puts[0].sha, "s0", "重试时用重 GET 的新 sha");
});

test("updatePlanFile forbids note repo, non-md and traversal", async () => {
  const io = fakeIo({ files: new Map(), puts: [] });
  await assert.rejects(
    () => updatePlanFile(note, "Journal/Daily/x.md", "c", "r", io),
    WriteForbiddenError
  );
  await assert.rejects(
    () => updatePlanFile(review, "数学/w40/计划.txt", "c", "r", io),
    WriteForbiddenError
  );
  await assert.rejects(
    () => updatePlanFile(review, "../escape.md", "c", "r", io),
    WriteForbiddenError
  );
});

test("revertPlanFile restores parent content and is idempotent", async () => {
  const parent = { sha: "p0", content: "父版本" };
  const state = {
    files: new Map([["数学/w40/本周复习计划.md", { sha: "s1", content: "AI改过的" }]]),
    puts: [], parents: { "cAI": "p0" },
    atRef: new Map([["数学/w40/本周复习计划.md@p0", parent]]),
  };
  const io = fakeIo(state);
  const res = await revertPlanFile(review, "数学/w40/本周复习计划.md", "cAI", io);
  assert.equal(res.alreadyReverted, false);
  assert.equal(state.puts[0].content, "父版本");
  assert.equal(state.puts[0].message, `${AI_COMMIT_PREFIX}revert cAI 数学/w40/本周复习计划.md`);

  // 再滚一次：当前内容已等于父版本 → 幂等空操作
  const again = await revertPlanFile(review, "数学/w40/本周复习计划.md", "cAI", {
    ...io,
    getFile: async () => ({ sha: "s2", content: "父版本" }),
  });
  assert.equal(again.alreadyReverted, true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-plan-writes.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 write-core.ts**

```ts
export const AI_COMMIT_PREFIX = "[ai-chat] ";

export class WriteForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteForbiddenError";
  }
}

export class JournalMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalMissingError";
  }
}
```

- [ ] **Step 4: 实现 plan-writes.ts**

```ts
import { withConflictRetry } from "@/lib/github-client";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo } from "@/lib/chat/repos";
import { WriteForbiddenError } from "@/lib/chat/write-core";

export interface WriteResult {
  path: string;
  commit: string;
  url: string | null;
}

export function assertReviewWritable(repo: ChatRepo, path: string): void {
  if (repo.id !== "review") {
    throw new WriteForbiddenError("计划文件只允许写入 review 仓库");
  }
  if (!path.endsWith(".md")) {
    throw new WriteForbiddenError(`只允许写 .md 文件，收到：${path}`);
  }
  if (path.includes("..") || path.startsWith("/")) {
    throw new WriteForbiddenError(`非法路径：${path}`);
  }
}

export async function updatePlanFile(
  repo: ChatRepo,
  path: string,
  newContent: string,
  reason: string,
  io: ChatGithubIo
): Promise<WriteResult> {
  assertReviewWritable(repo, path);
  return withConflictRetry(async () => {
    const cur = await io.getFile(repo, path); // 404 → GitHubApiError 上抛，工具层转错误文本
    const res = await io.putFile(repo, path, newContent, `[ai-chat] ${reason}`, cur.sha);
    return { path, commit: res.commit, url: res.url };
  });
}

export async function revertPlanFile(
  repo: ChatRepo,
  path: string,
  commitSha: string,
  io: ChatGithubIo
): Promise<WriteResult & { alreadyReverted: boolean }> {
  assertReviewWritable(repo, path);
  return withConflictRetry(async () => {
    const commit = await io.getCommit(repo, commitSha);
    const parentSha = commit.parents[0];
    if (!parentSha) throw new WriteForbiddenError("该提交没有父提交，无法回滚");
    const parentFile = await io.getFileAtRef(repo, path, parentSha);
    const cur = await io.getFile(repo, path);
    if (cur.content === parentFile.content) {
      return { path, commit: commitSha, url: null, alreadyReverted: true };
    }
    const res = await io.putFile(
      repo,
      path,
      parentFile.content,
      `[ai-chat] revert ${commitSha.slice(0, 7)} ${path}`,
      cur.sha
    );
    return { path, commit: res.commit, url: res.url, alreadyReverted: false };
  });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- tests/chat-plan-writes.test.mjs`
Expected: PASS（4 个测试）

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat/write-core.ts src/lib/chat/plan-writes.ts tests/chat-plan-writes.test.mjs
git commit -m "feat(chat): plan-file write layer with 409 retry and idempotent revert"
```

---

### Task 5: Note 追加层 —— appendJournalEntry / appendInspirationCard

**Files:**
- Create: `inspirations-farm-app/src/lib/chat/journal-writes.ts`
- Test: `inspirations-farm-app/tests/chat-journal-writes.test.mjs`

**Interfaces:**
- Consumes: `insertIntoDailyNotesSection(content, time, noteText)`（`src/lib/markdown-utils.ts:787`）、`getBeijingTimestamp()`（beijing-time）、`GitHubApiError`、`AI_COMMIT_PREFIX`/errors（Task 4）。
- Produces:
  - `appendJournalEntry(repo: ChatRepo, date: string, text: string, io: ChatGithubIo, time?: string): Promise<WriteResult>`（日记缺失 → `JournalMissingError`；review 仓库 → `WriteForbiddenError`；先试当月顶层路径，未中则按 `/${date}.md` 后缀搜全树）
  - `appendInspirationCard(repo: ChatRepo, card: { title: string; body: string; tags?: string[]; priority?: string }, io: ChatGithubIo, timestamp?: string): Promise<WriteResult>`（新建 `Inspirations/AI-<北京时间戳>.md`，同名 422 → 最多重试 2 次加 `-2`/`-3` 后缀）

- [ ] **Step 1: 写失败测试** — `tests/chat-journal-writes.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  appendInspirationCard,
  appendJournalEntry,
} from "../src/lib/chat/journal-writes.ts";
import { AI_COMMIT_PREFIX, JournalMissingError, WriteForbiddenError } from "../src/lib/chat/write-core.ts";
import { GitHubApiError } from "../src/lib/github-client.ts";

const note = { id: "note", owner: "a", repo: "Note", label: "日记/灵感库" };
const review = { id: "review", owner: "a", repo: "review_status-", label: "复习计划库" };

function io404On(paths) {
  return {
    getFile: async (repo, path) => {
      if (paths[path]) return { sha: "s0", content: paths[path] };
      throw new GitHubApiError("GitHub API error 404", 404);
    },
    putFile: async (repo, path, content, message, sha) => {
      paths[path] = content;
      return { commit: "c9", url: `https://github.com/a/${repo.repo}/commit/c9` };
    },
    getCommit: async () => { throw new Error("-"); },
    getFileAtRef: async () => { throw new Error("-"); },
    listMdPaths: async () => Object.keys(paths),
  };
}

const DAILY = `---
tags:
  - diary
date: 2026-10-05
---

# 近期计划

# 当日日程

- [ ] 复习数学 #p1

# 本日总结

## 今日杂记

- 08:00 早读
`;

test("appendJournalEntry appends timestamped bullet into 今日杂记", async () => {
  const paths = { "Journal/Daily/2026-10-05.md": DAILY };
  const io = io404On(paths);
  const res = await appendJournalEntry(note, "2026-10-05", "和参谋聊了计划调整", io, "14:32:00");
  assert.equal(res.commit, "c9");
  assert.equal(paths["Journal/Daily/2026-10-05.md"].includes("- 14:32:00 和参谋聊了计划调整"), true);
  assert.ok(paths["Journal/Daily/2026-10-05.md"].startsWith("---"), "frontmatter 原样保留");
  const puts = [];
  // commit message 断言（重放一次拿 message）
  const io2 = {
    ...io,
    putFile: async (repo, path, content, message, sha) => {
      puts.push(message);
      return { commit: "c9", url: "u" };
    },
  };
  await appendJournalEntry(note, "2026-10-05", "再记一条", io2, "15:00:00");
  assert.equal(puts[0], `${AI_COMMIT_PREFIX}日记杂记 2026-10-05`);
});

test("appendJournalEntry finds archived daily by date suffix", async () => {
  const paths = { "Journal/Daily/2026/09/2026-09-28.md": DAILY };
  const io = io404On(paths);
  const res = await appendJournalEntry(note, "2026-09-28", "补记", io, "10:00:00");
  assert.equal(res.path, "Journal/Daily/2026/09/2026-09-28.md");
});

test("appendJournalEntry: missing daily → JournalMissingError; review repo → forbidden", async () => {
  const io = io404On({});
  await assert.rejects(
    () => appendJournalEntry(note, "2026-10-01", "x", io),
    JournalMissingError
  );
  await assert.rejects(
    () => appendJournalEntry(review, "2026-10-05", "x", io404On({ "Journal/Daily/2026-10-05.md": DAILY })),
    WriteForbiddenError
  );
});

test("appendInspirationCard creates timestamped card with insights frontmatter", async () => {
  const paths = {};
  const io = io404On(paths);
  const res = await appendInspirationCard(
    note,
    { title: "测试灵感", body: "先做检索再做向量", tags: ["ai-chat"], priority: "p1" },
    io,
    "2026-10-05-121500"
  );
  assert.equal(res.path, "Inspirations/AI-2026-10-05-121500.md");
  const content = paths["Inspirations/AI-2026-10-05-121500.md"];
  assert.ok(content.startsWith("---\ntype: inspiration\nstatus: active\ncreate: "));
  assert.ok(content.includes("priority: p1"));
  assert.ok(content.includes("tags: [ai-chat]"));
  assert.ok(content.includes("# 先做检索再做向量"));
});

test("appendInspirationCard retries on 422 (name exists)", async () => {
  let calls = 0;
  const io = {
    getFile: async () => { throw new GitHubApiError("404", 404); },
    putFile: async (repo, path) => {
      calls++;
      if (calls === 1) throw new GitHubApiError("GitHub API error 422", 422);
      return { commit: "c2", url: "u" };
    },
    getCommit: async () => { throw new Error("-"); },
    getFileAtRef: async () => { throw new Error("-"); },
    listMdPaths: async () => [],
  };
  const res = await appendInspirationCard(note, { title: "t", body: "b" }, io, "TS");
  assert.equal(res.path, "Inspirations/AI-TS-2.md");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-journal-writes.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 journal-writes.ts**

```ts
import { getBeijingDateTimeString, getBeijingTimestamp } from "@/lib/beijing-time";
import { insertIntoDailyNotesSection } from "@/lib/markdown-utils";
import { GitHubApiError, withConflictRetry } from "@/lib/github-client";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo } from "@/lib/chat/repos";
import { AI_COMMIT_PREFIX, JournalMissingError, WriteForbiddenError } from "@/lib/chat/write-core";
import type { WriteResult } from "@/lib/chat/plan-writes";

function beijingClock(): string {
  return getBeijingDateTimeString().slice(11); // "YYYY-MM-DD HH:mm:ss" → "HH:mm:ss"
}

export async function appendJournalEntry(
  repo: ChatRepo,
  date: string,
  text: string,
  io: ChatGithubIo,
  time?: string
): Promise<WriteResult> {
  if (repo.id !== "note") {
    throw new WriteForbiddenError("append_journal 只允许 note 仓库");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new WriteForbiddenError(`日期格式应为 YYYY-MM-DD，收到：${date}`);
  }
  return withConflictRetry(async () => {
    const flat = `Journal/Daily/${date}.md`;
    let path = flat;
    let journal: { sha: string; content: string };
    try {
      journal = await io.getFile(repo, flat);
    } catch (err: unknown) {
      if (err instanceof GitHubApiError && err.status === 404) {
        const suffix = `/${date}.md`;
        const tree = await io.listMdPaths(repo);
        const archived = tree.find((p) => p.endsWith(suffix));
        if (!archived) {
          throw new JournalMissingError(
            `当日日记不存在：${flat}（AI 不代建日记；请改记最近已有的一天，或提示用户手动创建）`
          );
        }
        path = archived;
        journal = await io.getFile(repo, archived);
      } else {
        throw err;
      }
    }
    const next = insertIntoDailyNotesSection(journal.content, time ?? beijingClock(), text);
    const res = await io.putFile(repo, path, next, `${AI_COMMIT_PREFIX}日记杂记 ${date}`, journal.sha);
    return { path, commit: res.commit, url: res.url };
  });
}

export interface InspirationCardInput {
  title: string;
  body: string;
  tags?: string[];
  priority?: string;
}

export async function appendInspirationCard(
  repo: ChatRepo,
  card: InspirationCardInput,
  io: ChatGithubIo,
  timestamp?: string
): Promise<WriteResult> {
  if (repo.id !== "note") {
    throw new WriteForbiddenError("append_inspiration 只允许 note 仓库");
  }
  const ts = timestamp ?? getBeijingTimestamp();
  const yaml = (name: string) =>
    [
      "---",
      "type: inspiration",
      "status: active",
      `create: ${getBeijingDateTimeString()}`,
      `priority: ${card.priority ?? "p2"}`,
      `tags: [${(card.tags ?? []).join(", ")}]`,
      "---",
      "",
      `# ${card.body}`,
    ].join("\n");

  let attempt = 0;
  for (;;) {
    const name = attempt === 0 ? `AI-${ts}.md` : `AI-${ts}-${attempt + 1}.md`;
    const path = `Inspirations/${name}`;
    try {
      const res = await io.putFile(repo, path, yaml(name), `${AI_COMMIT_PREFIX}灵感：${card.title}`);
      return { path, commit: res.commit, url: res.url };
    } catch (err: unknown) {
      const status = err instanceof GitHubApiError ? err.status : 0;
      if (status === 422 && attempt < 2) {
        attempt++;
        continue;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/chat-journal-writes.test.mjs`
Expected: PASS（5 个测试）

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/journal-writes.ts tests/chat-journal-writes.test.mjs
git commit -m "feat(chat): append-only journal and inspiration writes for note repo"
```

---

### Task 6: 搜索与 AI 工具集（读三件 + 写三件，边界在工具层强制）

**Files:**
- Create: `inspirations-farm-app/src/lib/chat/search.ts`
- Create: `inspirations-farm-app/src/lib/chat/tools.ts`
- Test: `inspirations-farm-app/tests/chat-tools.test.mjs`

**Interfaces:**
- Consumes: `getCorpus`/`readThrough`（Task 2）、`ensureCorpus`（Task 2）、Task 4/5 全部写函数、`tool` + `zod`（ai / zod 包）。
- Produces:
  - `searchCorpus(entry: CorpusEntry | null, query: string, opts?: { glob?: string; maxFiles?: number }): { matches: Array<{ path: string; lines: Array<{ no: number; text: string }>> }; searched: number; total: number }`
  - `createChatTools(deps: ChatToolDeps): Record<string, Tool>`，`ChatToolDeps = { repos: { note: ChatRepo; review: ChatRepo }; io: ChatGithubIo }`
  - 六个工具：`read_file` / `search_text` / `list_tree` / `update_plan_file` / `append_journal` / `append_inspiration`
  - **工具错误契约**：`execute` 永不 throw，失败返回 `{ ok: false, error: string }`（AI 可自纠，流不断）。

- [ ] **Step 1: 写失败测试** — `tests/chat-tools.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import { searchCorpus } from "../src/lib/chat/search.ts";
import { createChatTools } from "../src/lib/chat/tools.ts";
import { ensureCorpus } from "../src/lib/chat/corpus-cache.ts";
import { WriteForbiddenError } from "../src/lib/chat/write-core.ts";

function io(state) {
  return {
    getFile: async (repo, path) => {
      if (state.conflicts?.[path] && !state.conflicted) {
        state.conflicted = true;
        throw Object.assign(new Error("GitHub API error 409"), { status: 409 });
      }
      if (state.files[path] === undefined) throw new Error("404");
      return { sha: "s", content: state.files[path] };
    },
    putFile: async (repo, path, content, message, sha) => {
      state.puts.push({ repo: repo.id, path, content, message, sha });
      return { commit: "c" + state.puts.length, url: "u" + state.puts.length };
    },
    getCommit: async () => ({ parents: ["p0"] }),
    getFileAtRef: async (repo, path) => {
      const f = state.atRef?.[path];
      if (!f) throw new Error("404");
      return f;
    },
    listMdPaths: async () => state.tree,
  };
}

const REVIEW = { id: "review", owner: "a", repo: "r", label: "复习计划库" };
const NOTE = { id: "note", owner: "a", repo: "n", label: "日记/灵感库" };

test("searchCorpus matches literal query with line numbers and glob", async () => {
  const state = {
    tree: ["数学/w40/本周复习计划.md", "英语/w40/本周复习计划.md", "记忆库/心理/x.md"],
    files: {
      "数学/w40/本周复习计划.md": "周一：套卷\n周二：错题\n",
      "英语/w40/本周复习计划.md": "周一：阅读\n",
      "记忆库/心理/x.md": "状态一般\n",
    },
  };
  await ensureCorpus(REVIEW, io(state), { now: () => Date.now() });
  const { getCorpus } = await import("../src/lib/chat/corpus-cache.ts");
  const all = searchCorpus(getCorpus("review"), "周一");
  assert.equal(all.matches.length, 2);
  assert.equal(all.matches[0].lines[0].no, 1);
  const onlyMath = searchCorpus(getCorpus("review"), "周一", { glob: "数学/**" });
  assert.equal(onlyMath.matches.length, 1);
  assert.equal(onlyMath.matches[0].path, "数学/w40/本周复习计划.md");
});

test("tools: read_file returns cached content; miss returns ok:false error text", async () => {
  const state = {
    tree: ["a.md"], files: { "a.md": "AAA" },
  };
  await ensureCorpus(REVIEW, io(state), { now: () => Date.now() });
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const hit = await tools.read_file.execute({ repo: "review", path: "a.md" }, {});
  assert.equal(hit.ok, true);
  assert.equal(hit.content, "AAA");
  const miss = await tools.read_file.execute({ repo: "review", path: "nope.md" }, {});
  assert.equal(miss.ok, false);
  assert.ok(typeof miss.error === "string" && miss.error.length > 0);
});

test("tools: update_plan_file enforces review-only at tool layer and never throws", async () => {
  const state = {
    files: { "数学/w40/本周复习计划.md": "旧" },
    puts: [], tree: ["数学/w40/本周复习计划.md"],
  };
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const bad = await tools.update_plan_file.execute(
    { path: "Journal/Daily/2026-10-05.md", new_content: "x", reason: "测试注入" }, {}
  );
  assert.equal(bad.ok, false, "note 路径在 review 仓库不存在 → 文件级 404 转错误文本");
  // 直接对 note 仓库调用底层函数确认拒绝（提示注入也绕不过工具层）
  const { updatePlanFile } = await import("../src/lib/chat/plan-writes.ts");
  await assert.rejects(() => updatePlanFile(NOTE, "x.md", "c", "r", io(state)), WriteForbiddenError);

  const good = await tools.update_plan_file.execute(
    { path: "数学/w40/本周复习计划.md", new_content: "新", reason: "测试调整" }, {}
  );
  assert.equal(good.ok, true);
  assert.equal(good.commit, "c1");
  assert.equal(state.puts[0].message, "[ai-chat] 测试调整");
});

test("tools: append_journal routes to note repo with structured result", async () => {
  const daily = "# 本日总结\n\n## 今日杂记\n";
  const state = { files: { "Journal/Daily/2026-10-05.md": daily }, puts: [], tree: ["Journal/Daily/2026-10-05.md"] };
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const res = await tools.append_journal.execute(
    { date: "2026-10-05", text: "记一条", time: "09:00:00" }, {}
  );
  assert.equal(res.ok, true);
  assert.equal(res.path, "Journal/Daily/2026-10-05.md");
  assert.ok(state.puts[0].message.startsWith("[ai-chat]"));
});

test("tools: list_tree filters by dir prefix", async () => {
  const state = { files: {}, tree: ["数学/w40/本周复习计划.md", "英语/w40/本周复习计划.md"], puts: [] };
  await ensureCorpus(REVIEW, io(state), { now: () => Date.now() });
  const tools = createChatTools({ repos: { note: NOTE, review: REVIEW }, io: io(state) });
  const res = await tools.list_tree.execute({ repo: "review", dir: "数学" }, {});
  assert.deepEqual(res.paths, ["数学/w40/本周复习计划.md"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-tools.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 search.ts**

```ts
import type { CorpusEntry } from "@/lib/chat/corpus-cache";

export interface SearchMatch {
  path: string;
  lines: Array<{ no: number; text: string }>;
}

export function globToRegExp(glob: string): RegExp {
  const src = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${src}$`);
}

/** 字面匹配默认；`re:` 前缀按正则（非法正则抛错，由工具层转错误文本）。 */
export function searchCorpus(
  entry: CorpusEntry | null,
  query: string,
  opts: { glob?: string; maxFiles?: number } = {}
): { matches: SearchMatch[]; searched: number; total: number } {
  if (!entry) return { matches: [], searched: 0, total: 0 };
  const maxFiles = opts.maxFiles ?? 20;
  const re = query.startsWith("re:") ? new RegExp(query.slice(3)) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const glob = opts.glob ? globToRegExp(opts.glob) : null;
  const matches: SearchMatch[] = [];
  let searched = 0;
  for (const [path, content] of entry.files) {
    if (glob && !glob.test(path)) continue;
    if (matches.length >= maxFiles) break;
    searched++;
    const lines = content.split("\n");
    const hits: Array<{ no: number; text: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ no: i + 1, text: lines[i].slice(0, 200) });
        if (hits.length >= 5) break;
      }
    }
    if (hits.length > 0) matches.push({ path, lines: hits });
  }
  return { matches, searched, total: entry.files.size };
}
```

- [ ] **Step 4: 实现 tools.ts**

```ts
import { tool } from "ai";
import { z } from "zod";

import { getCorpus, readThrough } from "@/lib/chat/corpus-cache";
import { searchCorpus } from "@/lib/chat/search";
import { updatePlanFile } from "@/lib/chat/plan-writes";
import { appendInspirationCard, appendJournalEntry } from "@/lib/chat/journal-writes";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo } from "@/lib/chat/repos";

export interface ChatToolDeps {
  repos: { note: ChatRepo; review: ChatRepo };
  io: ChatGithubIo;
}

const repoEnum = z.enum(["note", "review"]);

export function createChatTools(deps: ChatToolDeps) {
  const repoOf = (id: "note" | "review"): ChatRepo => deps.repos[id];

  return {
    read_file: tool({
      description: "读取仓库中一个 markdown 文件的全文。先确保语料已缓存。",
      inputSchema: z.object({ repo: repoEnum, path: z.string() }),
      execute: async ({ repo, path }) => {
        try {
          const r = repoOf(repo);
          const content = await readThrough(r, path, deps.io);
          if (content === null) {
            return { ok: false as const, error: `文件不存在或不可读：${path}` };
          }
          return { ok: true as const, path, content };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    search_text: tool({
      description:
        "在语料缓存内全文搜索。默认字面匹配；'re:' 前缀为正则。glob 如 '数学/**'、'Journal/Daily/*.md'。",
      inputSchema: z.object({ repo: repoEnum, query: z.string(), glob: z.string().optional() }),
      execute: async ({ repo, query, glob }) => {
        try {
          const entry = getCorpus(repoOf(repo).id);
          const result = searchCorpus(entry, query, { glob });
          return {
            ok: true as const,
            ...result,
            partial: entry?.partial ?? false,
            note: entry?.partial ? "语料为部分装载，结果可能不全；可用 list_tree + read_file 精确读取" : undefined,
          };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    list_tree: tool({
      description: "列出仓库 .md 路径（可按目录前缀过滤）。",
      inputSchema: z.object({ repo: repoEnum, dir: z.string().optional() }),
      execute: async ({ repo, dir }) => {
        const entry = getCorpus(repoOf(repo).id);
        const paths = (entry?.treePaths ?? []).filter(
          (p) => !dir || p.startsWith(dir.endsWith("/") ? dir : `${dir}/`)
        );
        return { ok: true as const, paths };
      },
    }),

    update_plan_file: tool({
      description:
        "改写复习计划仓库的一个 .md 文件（整文件替换为新版本）。一次调用 = 一个 [ai-chat] commit，可从 UI 回滚。改计划必须保留/更新「修订依据」。",
      inputSchema: z.object({
        path: z.string(),
        new_content: z.string().min(1),
        reason: z.string().min(4).describe("一句话修订依据，会进 commit message"),
      }),
      execute: async ({ path, new_content, reason }) => {
        try {
          const res = await updatePlanFile(deps.repos.review, path, new_content, reason, deps.io);
          return { ok: true as const, ...res, note: "已提交；用户可在消息卡片一键回滚" };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    append_journal: tool({
      description:
        "向某天的 Daily 日记「## 今日杂记」追加一条时间戳记录（只能追加，不能改历史）。日记不存在会失败。",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        text: z.string().min(1),
        time: z.string().optional().describe("HH:mm:ss，缺省用当前北京时间"),
      }),
      execute: async ({ date, text, time }) => {
        try {
          const res = await appendJournalEntry(deps.repos.note, date, text, deps.io, time);
          return { ok: true as const, ...res };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    append_inspiration: tool({
      description: "在 Inspirations/ 新建一张灵感卡（新文件，frontmatter 自动生成）。",
      inputSchema: z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        tags: z.array(z.string()).default([]),
        priority: z.enum(["p0", "p1", "p2", "p3"]).default("p2"),
      }),
      execute: async ({ title, body, tags, priority }) => {
        try {
          const res = await appendInspirationCard(
            deps.repos.note, { title, body, tags, priority }, deps.io
          );
          return { ok: true as const, ...res };
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- tests/chat-tools.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat/search.ts src/lib/chat/tools.ts tests/chat-tools.test.mjs
git commit -m "feat(chat): six server-side tools with layered write enforcement"
```

---

### Task 7: 模型工厂与系统提示词

**Files:**
- Create: `inspirations-farm-app/src/lib/chat/model.ts`
- Create: `inspirations-farm-app/src/lib/chat/prompt.ts`
- Test: `inspirations-farm-app/tests/chat-prompt-model.test.mjs`

**Interfaces:**
- Consumes: `createOpenAICompatible`（@ai-sdk/openai-compatible）、`ChatConfigError`（Task 1）、`assembleHotSet`（Task 3）、`corpusCoverage`（Task 2）。
- Produces:
  - `createChatModel(env?: Record<string, string | undefined>): LanguageModel`（缺 `AI_API_KEY` → `ChatConfigError`）
  - `buildSystemPrompt(input: { hotSet: { text: string; degraded: boolean; missing: string[] }; coverage: { note: string; review: string }; nowIso: string }): string`
  - `buildSystemFromCache(repos, io, now: Date): Promise<{ system: string; hotSet: HotSetResult }>`（ensureCorpus 不在此做——由 session/chat 路由控制预算）

- [ ] **Step 1: 写失败测试** — `tests/chat-prompt-model.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import { ChatConfigError } from "../src/lib/chat/repos.ts";
import { createChatModel } from "../src/lib/chat/model.ts";
import { buildSystemPrompt } from "../src/lib/chat/prompt.ts";

test("createChatModel throws ChatConfigError without key; returns model with key", () => {
  assert.throws(() => createChatModel({}), ChatConfigError);
  const model = createChatModel({ AI_API_KEY: "k" });
  assert.ok(model); // LanguageModelV2 实例即可
});

test("createChatModel honors env overrides", () => {
  const model = createChatModel({ AI_API_KEY: "k", AI_BASE_URL: "http://x/v1", AI_MODEL: "m1" });
  assert.ok(model);
});

test("buildSystemPrompt embeds hot set, coverage, discipline and degrade note", () => {
  const system = buildSystemPrompt({
    hotSet: {
      text: "### [复习计划库] 数学/w40/本周复习计划.md\n\n- 周三 套卷",
      degraded: false,
      missing: ["英语/w40/本周复习计划.md"],
    },
    coverage: { note: "12/143 (partial)", review: "9/9" },
    nowIso: "2026-10-05T12:00:00+08:00",
  });
  assert.ok(system.includes("计划参谋"));
  assert.ok(system.includes("数学/w40/本周复习计划.md"));
  assert.ok(system.includes("12/143"));
  assert.ok(system.includes("英语/w40/本周复习计划.md"), "缺失文件要列出");
  assert.ok(system.includes("修订依据"));
  assert.ok(system.includes("只能追加"));
  assert.ok(system.includes("update_plan_file"));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-prompt-model.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 model.ts**

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatConfigError } from "@/lib/chat/repos";

export function createChatModel(
  env: Record<string, string | undefined> = process.env
) {
  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    throw new ChatConfigError("Missing AI_API_KEY（在 Vercel/.env.local 配置后重试）");
  }
  const provider = createOpenAICompatible({
    name: "counselor",
    baseURL: env.AI_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    apiKey,
  });
  return provider(env.AI_MODEL ?? "glm-4.6");
}
```

- [ ] **Step 4: 实现 prompt.ts**

```ts
import { assembleHotSet, type HotSetResult } from "@/lib/chat/hot-set";
import type { ChatGithubIo } from "@/lib/chat/github-chat";
import type { ChatRepo } from "@/lib/chat/repos";

export interface SystemPromptInput {
  hotSet: { text: string; degraded: boolean; missing: string[] };
  coverage: { note: string; review: string };
  nowIso: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const degrade = input.hotSet.degraded
    ? "⚠️ 热集未能装载（缓存为空或全部失败）。请用 list_tree/search_text/read_file 自行检索后再回答，并提示用户数据可能不是最新。"
    : "";
  const missing = input.hotSet.missing.length
    ? `以下热集文件未能载入：${input.hotSet.missing.join("、")}。需要时可用 read_file 读取。`
    : "";
  return `你是用户的「计划参谋」：一个嵌入在 Inspirations Farm App 里的 AI 对话助手。用户是备考 408 的学生，用 Note 仓库（Obsidian）记日记和灵感，用 review_status 仓库运营考研复习计划。你的职责：基于两个仓库的真实内容分析当前计划、讨论额外工作，并按用户指示直接调整计划文档。

当前时间：${input.nowIso}

## 语料覆盖
- review 仓库缓存：${input.coverage.review}
- note 仓库缓存：${input.coverage.note}
${degrade}
${missing}

## 热集（已预载的当前计划与近况）
${input.hotSet.text || "（空）"}

## 工具与写入纪律
- 事实性问题必须基于 read_file/search_text 的结果回答，并给出文件路径；不许凭空编造计划内容。
- update_plan_file 只能改 review 仓库的 .md；整文件替换；一次调用一个 commit（[ai-chat] 前缀自动加）。**改计划必须保留/更新文件里的「修订依据」内容**，对齐该仓库「不静默改目标」的纪律。
- append_journal 只能向某天 Daily 的「## 今日杂记」**追加**一条时间戳记录——历史日记与当日日程绝不可改写。
- append_inspiration 在 Inspirations/ 新建卡片。
- 多文件调整拆成多次 update_plan_file 调用，每次一个可独立回滚的 commit。
- 写入失败（ok:false）时向用户说明原因，不要静默重试超过一次。
- 回答用中文，引用文件时写明路径。`;
}

export async function buildSystemFromCache(
  repos: { note: ChatRepo; review: ChatRepo },
  io: ChatGithubIo,
  now: Date
): Promise<{ system: string; hotSet: HotSetResult }> {
  const hotSet = await assembleHotSet(repos, io, now);
  const { corpusCoverage } = await import("@/lib/chat/corpus-cache");
  const fmt = (id: "note" | "review") => {
    const c = corpusCoverage(id);
    return c.total === 0 ? "空（未装载）" : `${c.cached}/${c.total}${c.partial ? " (partial)" : ""}`;
  };
  return {
    hotSet,
    system: buildSystemPrompt({
      hotSet,
      coverage: { note: fmt("note"), review: fmt("review") },
      nowIso: now.toISOString(),
    }),
  };
}
```

注意：模板里的 `coverage.note` / `coverage.review` 是测试喂进去的两个字符串（如 `"12/143 (partial)"`），断言 `system.includes("12/143")` 钉住插值正确。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- tests/chat-prompt-model.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat/model.ts src/lib/chat/prompt.ts tests/chat-prompt-model.test.mjs
git commit -m "feat(chat): provider-agnostic model factory and counselor system prompt"
```

---

### Task 8: /api/chat 流式对话路由

**Files:**
- Create: `inspirations-farm-app/src/app/api/chat/route.ts`
- Test: `inspirations-farm-app/tests/chat-route.test.mjs`

**Interfaces:**
- Consumes: `validatePin`、`streamText`/`convertToModelMessages`/`stepCountIs`（ai）、Task 6/7 全部。
- Produces:
  - `createChatRoute(deps?: { model?: unknown; tools?: Record<string, unknown>; system?: string | Promise<string> }): { POST }`（路由工厂，测试注入）
  - `export const { POST }`；`export const maxDuration = 60`
  - POST 契约：PIN 401；`{messages}` 缺失/非数组 → 400；`ChatConfigError` → 503 `{ok:false,error}`；成功 → AI SDK UI message stream（`toUIMessageStreamResponse()`）

- [ ] **Step 1: 写失败测试** — `tests/chat-route.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createChatRoute } from "../src/app/api/chat/route.ts";

const PIN = "246810";

function req(body, headers = { "x-app-pin": PIN }) {
  return {
    headers: new Headers(headers),
    json: async () => body,
  };
}

const MESSAGES = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "这周计划怎么调？" }] },
];

test.before(() => {
  process.env.APP_PIN = PIN;
});
test.after(() => {
  delete process.env.APP_PIN;
});

test("chat route: 401 without PIN", async () => {
  const { POST } = createChatRoute({ model: {}, tools: {}, system: "s" });
  assert.equal((await POST(req({}, {}))).status, 401);
});

test("chat route: 400 on missing messages", async () => {
  const { POST } = createChatRoute({ model: {}, tools: {}, system: "s" });
  assert.equal((await POST(req({}))).status, 400);
  assert.equal((await POST(req({ messages: "no" }))).status, 400);
});

test("chat route: 503 when model factory raises ChatConfigError", async () => {
  const saved = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    const { POST } = createChatRoute({ tools: {}, system: "s" });
    const res = await POST(req({ messages: MESSAGES }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.ok(body.error.includes("AI_API_KEY"));
  } finally {
    if (saved !== undefined) process.env.AI_API_KEY = saved;
  }
});

test("chat route: streams a mocked model response", async () => {
  const { MockLanguageModelV2, simulateReadableStream } = await import("ai/test");
  const model = new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "r0", modelId: "mock", timestamp: new Date(0) },
          { type: "text-start", id: "t0" },
          { type: "text-delta", id: "t0", delta: "本周建议……" },
          { type: "text-end", id: "t0" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        ],
      }),
    }),
  });
  const { POST } = createChatRoute({
    model,
    tools: {},
    system: "测试系统提示",
  });
  const res = await POST(req({ messages: MESSAGES }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("本周建议"));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-route.test.mjs`
Expected: FAIL（route.ts 不存在）

- [ ] **Step 3: 实现 route.ts**

```ts
import type { NextRequest } from "next/server";
import { convertToModelMessages, stepCountIs, streamText } from "ai";

import { validatePin } from "@/lib/auth";
import { ChatConfigError, getChatRepos } from "@/lib/chat/repos";
import { createChatGithubIo } from "@/lib/chat/github-chat";
import { createChatTools } from "@/lib/chat/tools";
import { buildSystemFromCache } from "@/lib/chat/prompt";
import { createChatModel } from "@/lib/chat/model";

// Vercel Hobby 上限 60s：冷启动语料装载 + 多步工具链都在预算内（plan 01 §时限纪律）。
export const maxDuration = 60;

function deny() {
  return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** 路由工厂：测试注入 model/tools/system 全离线。 */
export function createChatRoute(
  deps: {
    model?: unknown;
    tools?: Record<string, unknown>;
    system?: string | Promise<string>;
  } = {}
) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) return deny();

    let body: { messages?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ ok: false, error: "messages required" }, { status: 400 });
    }

    let model: unknown;
    try {
      model = deps.model ?? createChatModel();
    } catch (err: unknown) {
      if (err instanceof ChatConfigError) {
        return Response.json({ ok: false, error: err.message }, { status: 503 });
      }
      throw err;
    }

    const io = createChatGithubIo();
    const tools = deps.tools ?? createChatTools({ repos: getChatRepos(), io });
    const system =
      deps.system ?? (await buildSystemFromCache(getChatRepos(), io, new Date())).system;

    const result = streamText({
      model: model as Parameters<typeof streamText>[0]["model"],
      system,
      messages: convertToModelMessages(body.messages),
      tools: tools as Parameters<typeof streamText>[0]["tools"],
      stopWhen: stepCountIs(12),
      temperature: 0.3,
    });
    return result.toUIMessageStreamResponse();
  }

  return { POST };
}

export const { POST } = createChatRoute();
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/chat-route.test.mjs`
Expected: PASS（4 个测试）

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts tests/chat-route.test.mjs
git commit -m "feat(chat): streaming /api/chat route with tool-calling"
```

---

### Task 9: /api/chat/session 引导与 /api/chat/revert 回滚路由

**Files:**
- Create: `inspirations-farm-app/src/app/api/chat/session/route.ts`
- Create: `inspirations-farm-app/src/app/api/chat/revert/route.ts`
- Test: `inspirations-farm-app/tests/chat-session-revert-routes.test.mjs`

**Interfaces:**
- Consumes: `ensureCorpus`/`corpusCoverage`（Task 2）、`revertPlanFile`（Task 4）、`validatePin`。
- Produces:
  - `createChatSessionRoute(deps?: { ensure?: (repo, io, opts) => Promise<unknown> }): { POST }`；POST → `{ ok: true, fetchedAt: string, coverage: { note, review }, degraded, hotSetChars }`（单仓库失败不整体失败，`degraded:true`）
  - `createChatRevertRoute(deps?: { revert?: typeof revertPlanFile }): { POST }`；POST `{repoId:"review", path, commit}` → `{ ok: true, commit, url, alreadyReverted }`；非 review 的 repoId → 400

- [ ] **Step 1: 写失败测试** — `tests/chat-session-revert-routes.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createChatSessionRoute } from "../src/app/api/chat/session/route.ts";
import { createChatRevertRoute } from "../src/app/api/chat/revert/route.ts";

const PIN = "135791";

function req(body, headers = { "x-app-pin": PIN }) {
  return { headers: new Headers(headers), json: async () => body };
}

test.before(() => {
  process.env.APP_PIN = PIN;
  process.env.REPO_OWNER = "a";
  process.env.REPO_NAME = "Note";
  process.env.REVIEW_REPO_OWNER = "a";
  process.env.REVIEW_REPO_NAME = "review_status-";
});
test.after(() => {
  for (const k of ["APP_PIN", "REPO_OWNER", "REPO_NAME", "REVIEW_REPO_OWNER", "REVIEW_REPO_NAME"]) {
    delete process.env[k];
  }
});

test("session route: 401 without PIN", async () => {
  const { POST } = createChatSessionRoute({ ensure: async () => ({}) });
  assert.equal((await POST(req({}, {}))).status, 401);
});

test("session route: reports coverage and degraded on partial failure", async () => {
  let calls = 0;
  const { POST } = createChatSessionRoute({
    ensure: async (repo) => {
      calls++;
      if (repo.id === "review") throw new Error("github down");
      return { files: new Map(), treePaths: ["a.md"], fetchedAt: 1, partial: false };
    },
  });
  const res = await POST(req({}));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.degraded, true, "review 失败 → degraded");
  assert.equal(calls, 2);
  assert.ok(typeof body.hotSetChars === "number");
});

test("revert route: 401 / 400 / happy path with injected revert", async () => {
  const calls = [];
  const { POST } = createChatRevertRoute({
    revert: async (repo, path, commit) => {
      calls.push({ repo: repo.id, path, commit });
      return { path, commit: "cNew", url: "u", alreadyReverted: false };
    },
  });
  assert.equal((await POST(req({}, {}))).status, 401);
  assert.equal((await POST(req({ repoId: "review" }))).status, 400);
  assert.equal((await POST(req({ repoId: "note", path: "x.md", commit: "c" }))).status, 400);

  const res = await POST(req({ repoId: "review", path: "数学/w40/本周复习计划.md", commit: "cAI" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.commit, "cNew");
  assert.equal(calls[0].repo, "review");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/chat-session-revert-routes.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 session/route.ts**

```ts
import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import { corpusCoverage } from "@/lib/chat/corpus-cache";
import { createChatGithubIo } from "@/lib/chat/github-chat";
import { buildSystemFromCache } from "@/lib/chat/prompt";
import { getChatRepos } from "@/lib/chat/repos";

type Ensure = typeof import("@/lib/chat/corpus-cache").ensureCorpus;

export function createChatSessionRoute(
  deps: { ensure?: Ensure } = {}
) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const repos = getChatRepos();
    const io = createChatGithubIo();
    const ensure = deps.ensure ?? (await import("@/lib/chat/corpus-cache")).ensureCorpus;

    let degraded = false;
    const deadline = Date.now() + 45_000;
    for (const repo of [repos.review, repos.note]) {
      try {
        await ensure(repo, io, { budgetMs: Math.max(5_000, deadline - Date.now()) });
      } catch (err: unknown) {
        console.error(`[chat/session] corpus ${repo.id} failed:`, err);
        degraded = true;
      }
    }

    const { system, hotSet } = await buildSystemFromCache(repos, io, new Date());
    return Response.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      coverage: { note: corpusCoverage("note"), review: corpusCoverage("review") },
      degraded: degraded || hotSet.degraded,
      hotSetChars: system.length,
    });
  }

  return { POST };
}

export const { POST } = createChatSessionRoute();
```

- [ ] **Step 4: 实现 revert/route.ts**

```ts
import type { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import { createChatGithubIo } from "@/lib/chat/github-chat";
import { revertPlanFile } from "@/lib/chat/plan-writes";
import { getChatRepos } from "@/lib/chat/repos";

export function createChatRevertRoute(
  deps: { revert?: typeof revertPlanFile } = {}
) {
  async function POST(req: NextRequest) {
    if (!validatePin(req)) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { repoId, path, commit } = body as {
      repoId?: string;
      path?: string;
      commit?: string;
    };
    if (repoId !== "review" || typeof path !== "string" || typeof commit !== "string") {
      return Response.json(
        { ok: false, error: "repoId must be 'review', path and commit required" },
        { status: 400 }
      );
    }
    const io = createChatGithubIo();
    const revert = deps.revert ?? revertPlanFile;
    try {
      const result = await revert(getChatRepos().review, path, commit, io);
      return Response.json({ ok: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Revert failed";
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
  }

  return { POST };
}

export const { POST } = createChatRevertRoute();
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- tests/chat-session-revert-routes.test.mjs`
Expected: PASS（3 个测试）

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat/session/route.ts src/app/api/chat/revert/route.ts tests/chat-session-revert-routes.test.mjs
git commit -m "feat(chat): session bootstrap and revert endpoints"
```

---

### Task 10: 导航 + /chat 页面 + 聊天 UI（流式、工具卡、回滚按钮、本地历史）

**Files:**
- Modify: `inspirations-farm-app/src/components/app-shell/navigation-config.ts`
- Modify: `inspirations-farm-app/src/components/app-shell/app-nav.tsx:16-20`（ICONS 映射）
- Modify: `inspirations-farm-app/tests/workspace-navigation.test.mjs`
- Create: `inspirations-farm-app/src/app/(workspace)/chat/page.tsx`
- Create: `inspirations-farm-app/src/features/chat/chat-workspace.tsx`
- Test: `tests/workspace-navigation.test.mjs`（更新既有）

**Interfaces:**
- Consumes: `useChat`（@ai-sdk/react）、`DefaultChatTransport`（ai）、`apiFetch`（`src/lib/api.ts`）、`MarkdownRenderer`（`src/components/markdown-renderer`）、`toast`（`src/components/app-shell/toast`）。
- Produces: `/chat` 路由 + `ChatWorkspace` 组件（无导出契约，页面级）。
- UI 事实约定：AI SDK v5 UI message 的工具分片 `part.type` 形如 `"tool-update_plan_file"`，`part.state` ∈ `input-streaming | input-available | output-available | output-error`，输出在 `part.output`。写工具 = `update_plan_file / append_journal / append_inspiration`。

- [ ] **Step 1: 更新导航测试（先改断言让它失败）** — `tests/workspace-navigation.test.mjs` 两处：

```js
test("workspace navigation exposes five deep-linkable destinations", () => {
  assert.deepEqual(
    WORKSPACE_NAV.map((item) => item.href),
    ["/", "/inspirations", "/jottings", "/bench", "/chat"],
  );
  // ……其余不变
});

test("workspace navigation uses renderable icon ids", () => {
  const allowedIcons = new Set(["calendar", "lightbulb", "notebook", "flask", "message"]);
  // ……其余不变
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/workspace-navigation.test.mjs`
Expected: FAIL（导航还没有 /chat）

- [ ] **Step 3: 改 navigation-config.ts**（三处各加一项）

```ts
export type WorkspaceIconId =
  | "calendar"
  | "lightbulb"
  | "notebook"
  | "flask"
  | "message";

export interface WorkspaceNavItem {
  href: "/" | "/inspirations" | "/jottings" | "/bench" | "/chat";
  label: string;
  icon: WorkspaceIconId;
}

export const WORKSPACE_NAV: readonly WorkspaceNavItem[] = [
  { href: "/", label: "今日", icon: "calendar" },
  { href: "/inspirations", label: "灵感池", icon: "lightbulb" },
  { href: "/jottings", label: "杂记", icon: "notebook" },
  { href: "/bench", label: "验证台", icon: "flask" },
  { href: "/chat", label: "参谋", icon: "message" },
] as const;
```

- [ ] **Step 4: 改 app-nav.tsx 的 ICONS 映射**

```tsx
import {
  CalendarDays,
  FlaskConical,
  Lightbulb,
  MessageCircle,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<WorkspaceIconId, LucideIcon> = {
  calendar: CalendarDays,
  lightbulb: Lightbulb,
  notebook: NotebookPen,
  flask: FlaskConical,
  message: MessageCircle,
};
```

- [ ] **Step 5: 跑导航测试确认通过**

Run: `npm test -- tests/workspace-navigation.test.mjs`
Expected: PASS

- [ ] **Step 6: 创建页面** `src/app/(workspace)/chat/page.tsx`

```tsx
import { ChatWorkspace } from "@/features/chat/chat-workspace";

export default function ChatPage() {
  return <ChatWorkspace />;
}
```

- [ ] **Step 7: 创建聊天工作区组件** `src/features/chat/chat-workspace.tsx`

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, AuthError } from "@/lib/api";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { toast } from "@/components/app-shell/toast";

const STORAGE_KEY = "chat-history-v1";

const WRITE_TOOLS = new Set(["update_plan_file", "append_journal", "append_inspiration"]);

interface WriteToolOutput {
  ok?: boolean;
  path?: string;
  commit?: string;
  url?: string | null;
  alreadyReverted?: boolean;
  error?: string;
}

interface SessionInfo {
  fetchedAt: string;
  degraded: boolean;
  coverage: { note: { cached: number; total: number }; review: { cached: number; total: number } };
}

export function ChatWorkspace() {
  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);

  // 恢复上次会话 + 拉取 session 引导（暖缓存 + 热集）
  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setMessages(parsed);
      } catch {
        /* 坏数据直接忽略 */
      }
    }
    apiFetch<SessionInfo>("/api/chat/session", { method: "POST" })
      .then(setSession)
      .catch(() => setSession(null));
  }, [setMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    setInput("");
    sendMessage({ text });
  }, [input, sendMessage, status]);

  const revert = useCallback(
    async (path: string, commit: string) => {
      setReverting(commit);
      try {
        await apiFetch("/api/chat/revert", {
          method: "POST",
          body: JSON.stringify({ repoId: "review", path, commit }),
        });
        toast("已回滚");
      } catch (err) {
        toast(err instanceof AuthError ? "请重新解锁" : "回滚失败");
      } finally {
        setReverting(null);
      }
    },
    []
  );

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-68px)] max-w-[1280px] flex-col gap-3 px-4 py-4">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">计划参谋</h1>
        {session && (
          <span className="text-xs text-[var(--farm-muted)]">
            数据截至 {new Date(session.fetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            {session.degraded ? "（部分降级）" : ""}
          </span>
        )}
      </header>

      {error && (
        <Card className="border-red-400/40">
          <CardContent className="py-3 text-sm text-red-600 dark:text-red-400">
            对话出错：{error.message}
            <Button variant="ghost" size="sm" className="ml-2" onClick={() => sendMessage()}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-[var(--farm-muted)]">
            试试问：「这周计划合理吗？」「把下周三的套卷挪到周二」「我最近一周状态如何」
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            <div className="text-xs text-[var(--farm-muted)]">
              {message.role === "user" ? "你" : "参谋"}
            </div>
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return <MarkdownRenderer key={i} content={part.text} />;
              }
              if (part.type?.startsWith("tool-")) {
                const name = part.type.slice(5);
                const isWrite = WRITE_TOOLS.has(name);
                const output = ("output" in part ? part.output : undefined) as WriteToolOutput | undefined;
                return (
                  <Card key={i} className="border-dashed">
                    <CardHeader className="py-2">
                      <CardTitle className="text-sm font-medium">
                        🔧 {name}
                        {output?.path ? ` · ${output.path}` : ""}
                        {output?.ok === false ? " · 失败" : ""}
                      </CardTitle>
                    </CardHeader>
                    {isWrite && output && (
                      <CardContent className="flex items-center gap-2 py-2 text-xs">
                        {output.url && (
                          <a href={output.url} target="_blank" rel="noreferrer" className="underline">
                            查看 commit
                          </a>
                        )}
                        {name === "update_plan_file" && output.commit && !output.alreadyReverted && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={reverting !== null}
                            onClick={() => revert(output.path!, output.commit!)}
                          >
                            {reverting === output.commit ? "回滚中…" : "回滚"}
                          </Button>
                        )}
                        {output.error && <span className="text-red-600">{output.error}</span>}
                      </CardContent>
                    )}
                  </Card>
                );
              }
              return null;
            })}
          </div>
        ))}
        {status === "streaming" && <p className="text-sm text-[var(--farm-muted)]">参谋正在思考……</p>}
      </div>

      <div className="sticky bottom-0 flex gap-2 bg-[var(--farm-paper)]/90 pb-2 pt-2 backdrop-blur">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="和参谋聊聊计划……"
          className="min-h-11"
        />
        <Button onClick={submit} disabled={!input.trim() || status === "streaming" || status === "submitted"}>
          发送
        </Button>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setMessages([]);
              window.localStorage.removeItem(STORAGE_KEY);
            }}
          >
            清空
          </Button>
        )}
      </div>
    </div>
  );
}
```

注意两处实现细节，执行时按实际类型微调（机械修正，不改结构）：① `MarkdownRenderer` 的 props 名以 `src/components/markdown-renderer.tsx` 实际签名为准（`content` 或 `children`）；② `part.output` 在 AI SDK v5 的 TS 类型是判别联合，若 typecheck 报窄化错误，用 `as` 收敛到上面的 `WriteToolOutput`。`apiFetch<T>` 若无泛型签名，去掉 `<T>` 用 `as SessionInfo`。

- [ ] **Step 8: 全量验证**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: 全绿

- [ ] **Step 9: Commit**

```bash
git add src/components/app-shell/navigation-config.ts src/components/app-shell/app-nav.tsx tests/workspace-navigation.test.mjs "src/app/(workspace)/chat/page.tsx" src/features/chat/chat-workspace.tsx
git commit -m "feat(chat): /chat workspace with streaming UI, tool cards and revert"
```

---

### Task 11: verify:chat 端到端离线场景 + 全套验证

**Files:**
- Create: `inspirations-farm-app/scripts/verify-chat.mjs`
- Modify: `inspirations-farm-app/package.json`（scripts 加 `verify:chat`）

**Interfaces:**
- Consumes: 前十个任务的全部公共函数；`tests/register-hooks.mjs`（既有 strip-types 引导）。
- Produces: `npm run verify:chat` —— 离线验证：语料装载 → 热集 → 检索 → 改计划 → 回滚 全链路（fixture 驱动），断言 commit 消息与内容。

- [ ] **Step 1: 实现 scripts/verify-chat.mjs**

```js
import assert from "node:assert/strict";

import { ensureCorpus } from "../src/lib/chat/corpus-cache.ts";
import { assembleHotSet } from "../src/lib/chat/hot-set.ts";
import { searchCorpus } from "../src/lib/chat/search.ts";
import { updatePlanFile, revertPlanFile } from "../src/lib/chat/plan-writes.ts";
import { appendJournalEntry } from "../src/lib/chat/journal-writes.ts";

const REVIEW = { id: "review", owner: "a", repo: "review_status-", label: "复习计划库" };
const NOTE = { id: "note", owner: "a", repo: "Note", label: "日记/灵感库" };

// ── fixture：两个远程仓库的最小镜像 ─────────────────────
const files = {
  "宏观复习规划.md": "# 宏观三阶段\nW29-W51",
  "408/w40/本周复习计划.md": "# 408 W40\n- 周三 套卷",
  "数学/w40/本周复习计划.md": "# 数学 W40\n- 周一 错题\n- 周四 套卷",
  "英语/w40/本周复习计划.md": "# 英语 W40\n- 每天 阅读",
  "Journal/Daily/2026-10-05.md": "# 本日总结\n\n## 今日杂记\n",
};
const puts = [];
const io = {
  getFile: async (repo, path) => {
    if (files[path] === undefined) throw new Error("404");
    return { sha: "s-" + path, content: files[path] };
  },
  putFile: async (repo, path, content, message, sha) => {
    puts.push({ repo: repo.id, path, content, message, sha });
    files[path] = content;
    return { commit: "c" + puts.length, url: `https://example/c${puts.length}` };
  },
  getCommit: async () => ({ parents: ["parent"] }),
  getFileAtRef: async (repo, path) => {
    // fixture：父版本内容固定
    return { sha: "s-parent", content: files[path] + "\n<!-- parent -->" };
  },
  listMdPaths: async () => Object.keys(files),
};

// ── 场景 1：装载 → 热集 → 检索 ──────────────────────────
await ensureCorpus(REVIEW, io, { now: () => Date.now() });
await ensureCorpus(NOTE, io, { now: () => Date.now() });
const hot = await assembleHotSet({ note: NOTE, review: REVIEW }, io, new Date("2026-09-30T12:00:00+08:00"));
assert.ok(hot.text.includes("数学 W40"), "热集含本周数学计划");
assert.ok(hot.text.includes("宏观三阶段"), "热集含宏观规划");

const hits = searchCorpus((await import("../src/lib/chat/corpus-cache.ts")).getCorpus("review"), "套卷");
assert.ok(hits.matches.length >= 2, "检索命中 408 与数学的套卷");

// ── 场景 2：改计划 → [ai-chat] commit → 回滚 ─────────────
const planPath = "数学/w40/本周复习计划.md";
const original = files[planPath];
const write = await updatePlanFile(REVIEW, planPath, "# 数学 W40\n- 周二 套卷", "套卷挪至周二", io);
assert.equal(write.commit, "c1");
assert.equal(puts[0].message, "[ai-chat] 套卷挪至周二");

// 回滚父版本内容 ≠ 当前内容 → 实际写回
const rolled = await revertPlanFile(REVIEW, planPath, write.commit, {
  ...io,
  getFileAtRef: async () => ({ sha: "s-parent", content: original }),
});
assert.equal(rolled.alreadyReverted, false);
assert.equal(files[planPath], original, "回滚后内容恢复原样");
assert.ok(puts[1].message.startsWith("[ai-chat] revert"));

// ── 场景 3：日记追加（frontmatter 不动、时间戳 bullet）────
await appendJournalEntry(NOTE, "2026-10-05", "参谋记录：计划已调", io, "21:10:00");
const daily = files["Journal/Daily/2026-10-05.md"];
assert.ok(daily.startsWith("---"), "frontmatter 保留");
assert.ok(daily.includes("- 21:10:00 参谋记录：计划已调"));
assert.ok(puts[2].message === "[ai-chat] 日记杂记 2026-10-05");

console.log("verify:chat ✓ 语料/热集/检索/写入/回滚/追加 全链路离线通过");
```

- [ ] **Step 2: package.json scripts 加一条**

```json
"verify:chat": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --import ./tests/register-hooks.mjs scripts/verify-chat.mjs"
```

- [ ] **Step 3: 跑 verify**

Run: `npm run verify:chat`
Expected: 输出 `verify:chat ✓ …`，exit 0

- [ ] **Step 4: 全套验证（spec 验收标准 6）**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run verify:chat`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-chat.mjs package.json
git commit -m "feat(chat): offline end-to-end verify:chat scenario"
```

---

## 收尾（人工）

1. **Vercel 环境变量**：`AI_API_KEY`（必填）、`AI_BASE_URL`/`AI_MODEL`（可选）、`REVIEW_REPO_OWNER`/`REVIEW_REPO_NAME`（必填）。PAT 需同时能访问两个私有仓库。
2. **真机验收**：按 spec 附录 A 清单执行（spec `docs/plan/ai-counselor/design.md`）。
3. **验收标准对照**：spec 第 13 节 1-7 逐条勾选；7 号依赖真机。

