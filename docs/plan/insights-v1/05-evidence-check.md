# 证据核实记录 —— 架构报告 vs 当前代码库

> 创建时间：2026-10-01
> 核实对象：《InspirationsFarm扩展_真知浮现_最终架构报告.md》（`/mnt/data/Projects/ImproveSystem/`，修改于 2026-10-01）
> 核实基准：本地仓库 HEAD `d4b54c8`（main，工作区 clean）
> 核实方法：5 个并行 agent 按代码层逐条打开文件核对，共 **40 条主张**

## 总判定

**报告可信度高**：40 条主张中 33 条 verified、5 条 partial（细节出入，不影响方向）、1 条 refuted（需修正计划前提）。报告的核心架构决策（Contents API 3×PUT、事件流唯一事实源、建节规则、串节 bug 诊断）**全部得到代码证据支撑**。

以下差异必须反映到本计划文件夹的其余文档中。

## 判定为 partial / refuted 的 6 条（计划前提修正）

| # | 主张 | 判定 | 实际情况 | 对计划的影响 |
|---|---|---|---|---|
| B4 | 插行函数的 `SectionEndOptions` 参数化「尚未发生」，列为 v0 尖刺改造项 | **REFUTED** | 参数化机制**已存在**：`markdown-utils.ts:605-610`（interface）、`:614-627`（`findSectionEndLine` 接收 opts）；且调用方已在用两种策略——`parseInspirationPatches`（:161-164）与 `appendInspirationPatchLine`（:673-676）传 `{ headingEnds: () => true, thematicBreakEnds: false }`，日记相关四处传 `{ headingEnds: (d) => d === 1, thematicBreakEnds: true }` | v0 第 5 件事从「做参数化改造」改为「**直接复用现有 `SectionEndOptions`** 写行为节写入函数 + 单测」，工作量下降 |
| D1 | `api/daily/route.ts` 用 `message.includes("404")` 字符串判断错误 | **PARTIAL** | `daily/route.ts` **已全面 instanceof 判断**（PUT :241 `err instanceof GitHubConflictError ? 409 : 500`；PATCH :320-322），全文无一处 `includes("404")`；字符串判断是 `api/github/route.ts` 独有的旧模式 | 卫生修复 B 的范围**缩小为仅 `api/github/route.ts`** 五处（:31/:105/:133/:173/:209，行号精确命中） |
| A5 | `appendInspirationPatch` 是**唯一**没有 `withConflictRetry` 的写路径 | **PARTIAL** | 行号（:486-526）与无重试属实，但 `updateDailyJournal`（:696-720）同样未包裹——且是**有意设计**（docstring :690-695：全文档替换不能拿新 SHA 写旧内容，409 必须透传客户端重放变更）。create 类路径（createInspiration :126 等）无 SHA 自然不 409 | 卫生修复 A 仍做（append 是读-改-写、可安全重试），但描述需修正；**禁止**顺手给 `updateDailyJournal` 加重试——那会破坏客户端重放机制 |
| A4 | `setFrontmatterField` 在 github.ts | **PARTIAL** | 定义在 `markdown-utils.ts:106-114`（github.ts :29 仅 import 使用，:331/:370/:428 三处调用）；结构化写入语义（matter 解析→赋值→重序列化，日期字段字符串保护）属实 | v1 写②引用位置按实际写 |
| C1 | focus-playlist 域 = 六层文件，实测 927 行 | **PARTIAL** | 实为 **7 个 lib 文件（927 行，含未列举的 `focus-playlist-cache.ts` 177 行）+ 4 个 API 路由文件（305 行）= 1232 行**；927 恰为「5 个枚举文件 + cache」之和，报告口径自相矛盾 | v1 新域照抄模板时按**七层**参照（类型/校验/GitHub/服务/缓存(可选)/路由/API 辅助） |
| C4 | 四件套 test/tsc/lint/build 都是 npm script | **PARTIAL** | test(:10)/lint(:9)/build(:7) 存在；**无 tsc/typecheck script**——类型检查只是 README 里的 ad-hoc 命令 | M0 顺手补 `typecheck` script（30 秒），v1 验收四件套才有统一入口 |
| D8 | `data.ts` 加第三路 `getInsightBench()`（报告称现有两路为 getDailyDashboard 语境） | **PARTIAL** | `data.ts` 确为服务端读取入口（:1-7 注释、getTodos :17、getInspirations :23、syncCompletedIdeas :33），但**不存在 `getDailyDashboard` 函数**；`getDailyJournal` 本体在 `lib/github.ts`。`dashboard-content.tsx:15-18` 两路 `Promise.all([getTodos(), getInspirations()])` 精确属实 | v1 第三路写法：在 `data.ts` 新增 `getInsightBench()` 与 `getTodos`/`getInspirations` 并列，`dashboard-content.tsx` 的 `Promise.all` 扩为三路 |

## 核实中的新发现（报告未覆盖）

1. **APP_PIN 缺失的后果比报告说的更严重**：`auth.ts:23-33` 在 `APP_PIN` 未设置时**生产环境一律拒绝请求（deny-all）**，仅 `NODE_ENV=development` 放行。当前 `.env.local`（仅 GITHUB_PAT/REPO_OWNER/REPO_NAME）+ 未同步 Vercel 的状态下，生产部署所有 API 写操作都会 401/403。M0 第 1 件事是**功能性阻断**，不是卫生项。（CLAUDE.md 环境变量清单已列 APP_PIN，与 .env.local 现状不一致。）
2. **串节 bug 影响读取路径**：`d===1` 谓词出现在 **4 个调用点**（`parseDailyNotes` :443-446、`insertImageAfterDailyNote` :541-544、`insertIntoDailySection` :762-765、`insertIntoDailyNotesSection` :815-818）——不只写入，**渲染路径**（杂记解析）也会把紧邻的下一个 H2 节内容误并入「今日杂记」。行为节落地后（H2 紧邻杂记），这个现状 bug 会从理论变为每日可见，M1 的节序单测同时是对现有解析的回归保护。
3. **`modifyDailyJournal` 退避注释与重试上限自相矛盾**：注释宣称 0/500/1000ms 三档（:744-746），但外层 `withConflictRetry` 最多 2 次尝试（github-client.ts:57 `attempt < 2`），1000ms 档实际不可达。文档债，M0 顺手修注释（或调上限，二选一，M0 选修注释——改上限影响面大）。
4. **服务端已有双层 409 重试先例**：daily 路由 addNote/attachImage 经 `modifyDailyJournal` 内置 retry（route.ts:97-98、:139-142 注释）+ 客户端 `withClientRetry`（daily-dashboard.tsx:205-233，maxRetries=2）形成双层重放。v1 验证链的冲突语义与该先例保持一致。
5. **sw.js 缓存版本** `CACHE_NAME = "inspirations-farm-v2"`，HTML network-first、其余 cache-first、/api/ 永不缓存（:27-30）——v1 前端改动后需递增 CACHE_NAME 以刷新 PWA 缓存。
6. **jottings-card 上传链路先例**：`/api/attachment`（multipart、`retryOnNetworkError: false` 防重复上传）+ attachImage 锚点拼接（jottings-card.tsx handleAttach）。v1 若给验证加图片证据可复用；outbox 设计亦应借鉴「不可幂等重放的操作禁自动重试」的思路。

## 全部 40 条判定速览

<details>
<summary>按层展开（点开查看）</summary>

**A · github 层（10 条）**：A1 withConflictRetry 仅 409、最多 2 次、fn 内部重 GET ✅（github-client.ts:55-70）；A2 GitHubConflictError/GitHubApiError ✅（:27-44）；A3 modifyDailyJournal 读改写+退避+create 跳过再 GET ✅（github.ts:736-781）；A4 setFrontmatterField 位置 ⚠️（实为 markdown-utils.ts:106-114）；A5「唯一无重试」⚠️（updateDailyJournal 有意不加）；A6 DIARY_TEMPLATE_PATH ✅（:636-637，可用环境变量覆盖）；A7 p-limit(10)+依赖 ✅（:403，p-limit ^7.3.1 / gray-matter ^4.0.3）；A8 无界 1+N ✅（:237-290，Promise.all 无并发上限，每文件 2 请求）；A9 CRLF 归一 ✅（:551，唯一归一点）；A10 陈旧读注释 ✅（:744-746 等三处）。

**B · markdown 解析层（5 条）**：B1 缺节 fallback ✅（:785-829）；B2 d===1 串节 bug 现存未修 ✅（:815-819 → :614-627）；B3 `**HH:mm**` 行格式 ✅（:486 noteRe）；B4 SectionEndOptions 已存在 ❌（:605-627）；B5 mdast ✅（:11,13, :560-580）。

**C · 域模板与测试（6 条）**：C1 七层 1232 行 ⚠️；C2 服务层 DI 离线可测 ✅（focus-playlist-service.ts:41-51）；C3 11 文件 68 例 ✅（实测 node --test 68/68，174ms）；C4 无 typecheck script ⚠️；C5 capture-fab.tsx 恰 229 行 ✅；C6 register-hooks.mjs ✅（:1-15）。

**D · daily API 与 UI（8 条）**：D1 daily 路由已 instanceof ⚠️；D2 github 路由五处 includes("404") ✅（:31/:105/:133/:173/:209 精确）；D3 三 tab ✅（tab-layout.tsx:6, :14-30）；D4 inspiration-feed.tsx 在 src/app/ ✅（src/components/ 无）；D5 两路 Promise.all ✅（dashboard-content.tsx:15-18）；D6 客户端 409 重放 ✅（daily-dashboard.tsx:178-233「Conflict Retry Helpers」区）；D7 jottings-card + error-boundary 均在 ✅；D8 无 getDailyDashboard 函数 ⚠️。

**E · 鉴权与基建（7 条）**：E1 .env.local 缺 APP_PIN ✅（仅 3 变量；附带发现 deny-all）；E2 PIN + x-app-pin + timingSafeEqual ✅（auth.ts:7,:10-36）；E3 sw.js:28 不缓存 /api/ ✅（:27-30）；E4 beijing-time.ts ✅（Asia/Shanghai、en-CA YYYY-MM-DD）；E5 apiFetch + AuthError ✅（api.ts:9,:37-93，含 401 清 PIN + auth:expired 事件 + 网络退避重试）；E6 CustomEvent + toast ✅（toast.tsx:28-32 emit/toast）；E7 manifest.ts ✅（:1-23，与 sw.js PRECACHE 互证）。

</details>

## 核实局限性

- D 层 agent 的本地文件工具受限，改用 GitHub 镜像仓库 `Evergarden-Alan/Inspirations-Farm-App` 核实；其 HEAD `d4b54c8`（2026-09-13）与本地快照完全一致且工作区 clean，内容等同。
- 所有涉及 `.env.local` 的核实只确认变量名存在与否，未读取、未记录任何 secret 值。
- 行号容差 ±20 行；除注明外行号全部命中。
