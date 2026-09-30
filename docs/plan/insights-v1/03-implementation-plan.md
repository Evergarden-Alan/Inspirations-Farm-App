# 03 · 实施计划（断点续跑版）

> 创建时间：2026-10-01
> 规模估计：v0 约 0.5 天；v1 约 1800-2200 行，5-7 个专注工作日或 3 个周末。
> **断点续跑规则**：新会话先读本文件夹 README.md + 本文档，对照 git log 找到最后一个已完成的 commit，从下一个任务继续。每个任务完成即 commit（conventional commits），commit message 已在任务卡给出。

## 分支与纪律

- 分支顺序（审查修正）：T0.3/T0.4 在 `fix/hygiene` 分支，验收后合并回 `main`；**从合并后的 main 切出 `feat/insights`**，T0.5 起全程在 `feat/insights`（T0.7 与 T0.5 同分支）。T3.2 依赖 T0.4 的类型化基建，因此 `feat/insights` 必须切自已含 hygiene 修复的 main。
- 本档所有命令默认在 `inspirations-farm-app/` 下执行（工作目录为仓库根时先 `cd inspirations-farm-app`）。
- 每任务一个可验证小阶段，完成即 commit；验收命令全绿才进下一任务。
- 四件套验收：`npm test && npm run typecheck && npm run lint && npm run build`（`typecheck` script 由 T0.7 补上；补上之前用 `npx tsc --noEmit`）。
- 工作目录：仓库根 `/mnt/data/Projects/Inspirations-Farm-App/`，应用在 `inspirations-farm-app/` 子目录（src/、tests/、package.json 均在此）。

---

## M0 · 环境与卫生（v0，约 0.5 天）

完成标志：`APP_PIN` 就位（本地+Vercel）、vault 模板带「## 行为记录」节、卫生 commit 落库、insights 域骨架测试跑绿。

### T0.1 补 APP_PIN（⚠️ 功能性阻断，最高优先）

- 背景（核实新发现）：`auth.ts:23-33` 在 APP_PIN 未设置时**生产环境 deny-all**——当前生产所有 API 写操作被拒，不是卫生项是阻断项。
- 做法：
  ```bash
  cd inspirations-farm-app
  printf '\nAPP_PIN=<4-6位PIN>\n' >> .env.local
  vercel env add APP_PIN   # 同步生产
  ```
- 验收：本地 `curl -X POST /api/daily` 无 PIN 返回 401、带 PIN 返回正常业务错误（非 401）。
- 注意：secret 只进 .env.local 与 Vercel，绝不入库、绝不写入本文档。

### T0.2 换 fine-grained PAT

- GitHub 网页 Settings → Developer settings → Fine-grained tokens → 限定 `Evergarden-Alan/Note` 仓库、仅 Contents Read/Write → 替换 `.env.local` 与 Vercel 的 `GITHUB_PAT`。PAT 即整个 vault 的读写权，半小时内做完。

### T0.3 卫生 commit A：appendInspirationPatch 加重试

- 范围（核实修正）：`src/lib/github.ts:486-526` `appendInspirationPatch`（读-改-写、裸 GET+PUT、无重试）包上 `withConflictRetry`。
- **边界**：不动 `updateDailyJournal`（:696-720）——它**有意**不加（409 须透传客户端重放，docstring :690-695）。
- 分支 `fix/hygiene`；验收：四件套绿。
- `git commit -m "fix: wrap appendInspirationPatch with withConflictRetry"`

### T0.4 卫生 commit B：github 路由错误映射改类型判断

- 范围（核实修正）：**仅 `src/app/api/github/route.ts`** 五处 `message.includes("404")`（:31/:105/:133/:173/:209）改 `instanceof GitHubApiError` 看 `.status`。
- `api/daily/route.ts` 已全面 instanceof（核实确认），无需动。
- v1 的 409/404 分流依赖此改造。验收：四件套绿 + 手测「不存在的灵感」仍返回 404。
- `git commit -m "fix: type-based GitHub error mapping in github api route"`

### T0.5 insights 域骨架 + 节边界回归尖刺

- 新建 `src/lib/insights.ts`：常量（目录/前缀/commit 前缀）、类型（含 crown 事件与 source 对象）、`createInsightId`、`sourceToString()`/`parseSourceString()`（唯一转换点）、JSON_SCHEMA（日期字符串化）。
- 新建 `src/lib/insights-config.ts`：`parseVerifications` 三态（valid/damaged/duplicate）、`replay`（含 crown）、`computeScore`、`canCrown`、`nextStatus`、`LEARNING_TOPICS` 硬编码常量。
- 新建 `tests/insights-config.test.mjs`（照 focus-playlist-config.test.mjs 风格）。
- **分支（审查修正）**：本任务起在 `feat/insights` 分支（T0.3/T0.4 的 `fix/hygiene` 合回 main 后切出，见「分支与纪律」）。
- **前置小改动（审查发现）**：`SectionEndOptions`（:605-610）、`findSectionEndLine`（:614-627）、`findHeadingLine`（:596）目前全是 `markdown-utils.ts` 模块私有（未 export）——先给三者加 `export`（纯签名改动，四件套回归）。不做这步，单测与 T2.1 的 `insights-daily.ts` 都够不着机制，只能复制 30 行私有 mdast 逻辑，违背「复用而非新建」初衷。
- **尖刺单测（二段式，审查修正）**：新建 `tests/markdown-utils-section.test.mjs`，写**现状 characterization 断言**——钉住「`d===1` 谓词下 H2 节不被下一个 H2 终结」的真实现状（05 新发现 2）；fixture 必须覆盖真暴露面「杂记节后紧邻另一 H2 节」与「行为节在杂记后（EOF 追加形态）」。**不在本任务写「互不串」断言**——那是 T2.1 新路径（`headingEnds: () => true`）的行为，随建节三条单测在 T2.1 落地（有节追加 / 无节紧贴杂记前建节 / 异构日记文件尾建节，见 01 §2 建节规则）。
- 决策点落地：4 处 `d===1` 调用点的顺修**不做在本任务**，由 M1 新增的 T1.3 承接（含全量日记解析回归测试），恢复会话无需重新决策。
- 验收：
  ```bash
  cd inspirations-farm-app
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types \
    --import ./tests/register-hooks.mjs --test tests/insights-config.test.mjs tests/markdown-utils-section.test.mjs
  npx tsc --noEmit
  ```
- `git commit -m "feat: add insights domain skeleton and section-boundary regression tests"`

### T0.6 改 vault 模板（在 Note vault 仓库，不在本仓库）

- `Templates/Diary_Template.md`（= `DIARY_TEMPLATE_PATH`）在「## 今日杂记」标题**之前**插入空节 `## 行为记录`。
- **插入位置必须在杂记之前**——插到杂记之后 = 把双向串节 bug 固化进模板源头。代码内 `ensureBehaviorSection` 兜底仍保留（覆盖存量旧日记与模板遗漏）。
- 验收：次日 07:31 cron 新建的日记自带该节且节序正确。

### T0.7 顺手文档债（同一分支随 T0.5 提交或单独 chore commit）

- `package.json` scripts 加 `"typecheck": "tsc --noEmit"`（核实：现缺，四件套才有统一入口）。
- 修 `modifyDailyJournal` 退避注释矛盾（github.ts:744-746 宣称 0/500/1000ms 三档，实际 `withConflictRetry` 最多 2 次、1000ms 档不可达）：改注释为实际行为，或放宽重试上限——**选改注释**（改上限影响全局写路径语义）。
- `git commit -m "chore: add typecheck script and fix backoff comment drift"`

---

## M1 · 基础层（insights 域类型与判据）

> 大部分在 T0.5 已铺，本里程碑补齐到可支撑写路径的程度。

### T1.1 `insights.ts` 补全事件流 schema 与序列化

- verify/crown 两类事件完整类型（`id/type/ts/insight/verdict|from+to/source/note`）；`source` 恒对象、`sources[]` 恒字符串、唯一转换函数（T0.5 已建则此任务为查漏）。
- 验收：类型单测覆盖两格式互转 + 非法输入。
- `git commit -m "feat: insights event schema and source serialization"`

### T1.2 `insights-config.ts` 判据补全 + 单测

- `replay`：vc=confirm 数、fc=refute 数、last_verified=最大 ts、status 只降不升 + crown 重建；unobserved 只落流不改计数。
- 边界单测：crown 后 refute（knowledge→hypothesis）、重复事件、damaged 行不计数、falsified 收 confirm 停留（登记在案的行为）。
- 验收：`npm test` 全绿（现有 68 例零回归 + 新增用例）。
- `git commit -m "feat: insights replay and scoring rules"`

### T1.3 顺修 4 处 d===1 调用点（决策点落地，审查新增）

- 背景：行为节落地后（异构日记 EOF 追加形态），串节 bug 会在杂记渲染中**每日可见**（05 新发现 2）——登记「不修」不可接受，故 v1 即修。
- 做法：`parseDailyNotes`（:443-446）、`insertImageAfterDailyNote`（:541-544）、`insertIntoDailySection`（:762-765）、`insertIntoDailyNotesSection`（:815-818）的节终结规则从 `d===1` 改为「任意深度标题终结」（与「追加记录」先例 :673-676 对齐；各调用点 `thematicBreakEnds` 保持原值）；把 T0.5 的 characterization 断言翻转为修正断言；补全量日记解析回归测试（现网日记 fixture）。
- 验收：四件套绿；手测「杂记节后紧跟另一 H2 节」的日记渲染不再串。
- `git commit -m "fix: section end detection for H2 siblings in daily notes"`

---

## M2 · 写路径核心（三写链）

### T2.1 `src/lib/insights-daily.ts` —— 行为行写入与解析

- `parseBehaviorRecords`（全文件扫描 📌/✅❌👀，正则锚前缀）、`buildTraceLine`、`insertBehaviorTrace`（按 01 §2 建节规则，`headingEnds: () => true`）、`ensureBehaviorSection`。
- 单测（`tests/insights-daily.test.mjs`）：建节三条（有节追加 / 无节紧贴杂记前建节 / 异构日记文件尾建节，见 01 §2——本任务落地，T0.5 只钉现状）+ 「互不串」新路径断言（`headingEnds: () => true`）+ 全文件扫描（行为节外的 📌 行可读、杂记节内手写行为行计入）+ 节序不变量断言。
- `git commit -m "feat: behavior record parsing and section writing"`

### T2.2 `src/lib/insights-github.ts` —— 三写原语

- `readVerifications` / `appendVerification`（`withConflictRetry` 包裹，对照 appendInspirationPatch 但带重试）/ `readVerificationsUntilVisible`（ev.id 可见性守卫，0/500/1000ms 退避）/ `readInsightFile` / `updateInsightFrontmatter`（`setFrontmatterField`，markdown-utils.ts:106-114）/ `createInsightFile` / `readRecentJournals(3)`。
- 依赖注入风格（**审查修正：照 `focus-playlist-service.ts:41-51` 的 `FocusPlaylistServiceDependencies` 注入接口**——`focus-playlist-github.ts` 本身无 DI，直连网络，不可作参照），注入网络原语（githubFetch/withConflictRetry/getFileContent 等 fake），全部可离线单测。
- 单测：可见性守卫（陈旧副本不重放）、append 重试、create 跳过再 GET。
- `git commit -m "feat: insights github primitives with visibility guard"`

### T2.3 `src/lib/insights-service.ts` —— applyVerification + crown 服务层

- 按 01 §2 伪代码实现：单点读齐 → 幂等查重 → 写① → 写②（重放计数 + sources 回写）→ 写③（INSIGHTS_TRACE_MODE 三态，默认 per-event）。
- `crownInsight`：服务端提交前重读 frontmatter，已 knowledge → `already_crowned`。
- `createInsightFromText` 同在本文件实现（T3.1 POST 的依赖，审查补明归属）：生成 `createInsightId` → 写 INS 文件（`Add insight INS-{id}`，commit message 含命题前 40 字）→ **归纳期来源指针写 INS 正文**（如 `- 来源：Journal/2026-09-30.md@1432` 行），**不写 frontmatter `sources[]`**（审查设计裁决：frontmatter sources 唯一写入者是写②，来源仅 verify/crown 事件可重放——归纳期指针若进 frontmatter，replay 为空，verify:insights 从第一天就报 drift）。
- **服务层 DI 测试（照 focus-playlist-service.test.mjs）覆盖失败矩阵全 7 格**（01 §2 表）——报告风险 6 明确：现有 68 例全为纯函数，三写链失败矩阵必须有自动化保障。路由层测试归 T3.2。
- `git commit -m "feat: applyVerification write chain with idempotency"`

---

## M3 · API 层

### T3.0 读侧聚合（审查前移，原 T3.3 后半）

- `src/lib/data.ts` 加 `getInsightBench()`（与 getTodos/getInspirations 并列，第三路；读侧 **p-limit(10)** 限流——listInspirationsWithContent 是无界 1+N，核实确认，照搬会打爆配额）+ `dashboard-content.tsx` 的 Promise.all 扩三路（或由 verify-bench 首屏按需取，M4 决定挂载点）。
- `git commit -m "feat: insights bench data layer"`

### T3.1 `/api/insights/route.ts`（POST 建洞察 / GET bench 数据）

- POST → `createInsightFromText`（T2.3 已建，`Add insight INS-{id}` commit）；GET → 调 T3.0 的 `getInsightBench()`。
- `export const maxDuration = 60`（Hobby 上限）。
- `git commit -m "feat: insights create and bench api route"`

### T3.2 `/api/insights/verify/route.ts` 与 `/api/insights/crown/route.ts`

- 路由薄壳：PIN 校验（validatePin）→ 调 service → 错误映射（VERIFY_CONFLICT → 503；其余 instanceof 看 .status——依赖 T0.4 的类型化基建）。
- 两者均显式 `maxDuration`；响应带 `{ ok, already?, traceWritten, countsSynced, board }`（board 复用 T3.0）。
- **路由工厂测试（审查补明手法）**：route.ts 导出 `createVerifyRoute(deps)` / `createCrownRoute(deps)` 工厂，注入 service 与 PIN 校验后测试（仓库现状零路由测试，node:test 下 `mock.module` 在 strip-types 模式不可靠，以工厂注入为准）；覆盖 401 / 409 耗尽→503 / 404 分支。
- `git commit -m "feat: insights verify and crown api routes"`

### T3.3 `/api/insights/invariant/route.ts`

- GET `?dryRun=1` 报告 / POST 显式 reconcile（检测与修复分离）；扫 Journal/ `<<<<<<<` 标记。
- 路由显式 `export const maxDuration = 60`（与 T3.2 同；POST repair 是逐漂移文件 commit 的最慢路径，不许裸跑默认 10s）——验收加「路由文件含 maxDuration 导出」检查。
- `git commit -m "feat: insights invariant endpoint"`

### T3.4 `scripts/verify-insights.mjs` + `package.json` `verify:insights`

- 自读环境变量 APP_PIN；drift 非空退出非零；断言 commit 结构不变量（01 §2 五条）。
- `git commit -m "feat: add verify:insights reconciliation script"`

---

## M4 · UI 层

### T4.1 第 4 tab + 验证台骨架

- `tab-layout.tsx` 加「验证台」tab；`verify-bench.tsx` 五分区（02 §1）；`dashboard-content.tsx` Promise.all 扩三路；`error-boundary.tsx` 独立包验证台。
- `git commit -m "feat: add verify bench tab scaffold"`

### T4.2 验证交互 + outbox

- 卡片 ✅/❌/👀 + 可选证据勾选 + 乐观更新 + `insight:updated` 就地更新；`insights-outbox.ts`（localStorage，60-100 行）+ 未同步 banner + 重放。
- toast 三态文案（全成/部分补齐/失败保留）。
- `git commit -m "feat: verification flow with outbox and optimistic updates"`

### T4.3 记录与归纳入口

- **服务端（审查补，缺此步功能静默失效）**：`src/app/api/daily/route.ts` 的 addNote 分支（:83-96，现硬编码 `insertIntoDailyNotesSection` 写杂记节、不接受 section 参数）新增 `section: "behavior"` 路由——经 `modifyDailyJournal` 调 T2.1 的 `insertBehaviorTrace`；原杂记写入零回归。
- 客户端：`jottings-card.tsx` 杂记/记录模式切换（addNote 请求带 section 参数）；`induct-drawer.tsx` 单步抽屉；灵感卡片「转洞察」菜单入口。
- 验收：手测记录模式的行落「## 行为记录」节、杂记模式仍写杂记节。
- `git commit -m "feat: behavior record mode and induct drawer"`

### T4.4 加冕、对账与保护性交互

- 可加冕徽章 + 二次确认 + `already_crowned` 处理；验证台顶部「对账」按钮（dryRun 报告 → 红色一键修复）；证据门槛软约束；欢迎回来卡片（`welcome-back-card.tsx`）；降级快照（顶栏「数据截至 HH:mm」+ 记录按钮置灰）。
- `sw.js` `CACHE_NAME` 递增（v2 → v3，核实：现值 inspirations-farm-v2）。
- `git commit -m "feat: crown, reconcile ui and protective interactions"`

---

## M5 · 证据回看与收尾

### T5.1 sources 证据回看

- 写②回写 `sources[]`（T2.3 已含）→ 验证台卡片渲染证据行（`parseSourceString`）；「同分钟 N 条，人工确认」并列全部候选。
- 验收：真机一次验证后，卡片能看到可回看证据行。
- `git commit -m "feat: render evidence sources on verify bench"`

### T5.2 真机全链验收（见 04 · 验收标准）

- 记录→归纳→验证→加冕完整链、桌面 obsidian-git 下一分钟 pull 干净合入、`npm run verify:insights` 全绿。
- `git commit -m "docs: complete insights v1 rollout"`

### 第 4 周止损检查点

- 总验证事件 <10 → 冻结全部 v2 工程，退回 Obsidian 手写形态（数据全在 vault，无损）。
- 计数读数：`wc -l Insights/verifications.jsonl`。

---

## v2 触发线（任一命中即启动，v1 期间不写一行 v2 代码）

验证 >50 次/周 · obsidian-git 每分钟 pull 明显变慢 · Insights 文件 >50 条读放大可感 · 首次真实误判需补偿事件（含 falsified 翻案死路第一次被触发）。
