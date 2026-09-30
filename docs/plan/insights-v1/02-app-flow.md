# 02 · UI 信息架构与用户流程

> 创建时间：2026-10-01
> 来源：《真知浮现最终架构报告》§3.4 + 现有 UI 核实（tab-layout.tsx:6 现为三 tab「今日/灵感池/杂记」）
> 语境：移动端 PWA 为主场景（手机 + 大陆网络 + api.github.com 单请求 1-3s 是设计前提，不是异常）。

## 1. 信息架构

底部 **四 tab**：`今日 / 灵感池 / 杂记 / 验证台`。现有 `tab-layout.tsx` 的 `Tab` 类型与 `TABS` 数组扩一项即可（已核实当前为三项）。

**概念隔离（不可妥协）**：Inspirations（别人的点子）与 Insights（自己的假设）一字之差，靠独立目录（`Inspirations/` vs `Insights/`）、独立 tab、正交字段、独立 commit 前缀四重隔离。**坚决不复用灵感流 UI 语义。**

### 验证台五分区（第 4 tab 首屏）

| 分区 | 内容 | 数据来源 |
|---|---|---|
| 真知常驻 | knowledge 横条 | frontmatter status |
| 今日浮现 top15 | score 降序卡片：statement/topics/vc/fc/last_verified/score 打分明细/**证据回看行** | `getInsightBench()`（data.ts 新增，与 getTodos/getInspirations 并列，`dashboard-content.tsx:15-18` 的 Promise.all 扩为三路；读侧 p-limit(10) 限流） |
| 新芽 | created < 7d 且 vc=0 | 同上 |
| 已证伪 | 折叠 | 同上 |
| 近 3 天行为流 | 📌 + ✅❌👀 行，跨日证据可见 | `parseBehaviorRecords` 全文件扫描（桌面写进杂记段的 📌 行同样计入） |

证据回看行样式：`「09-30 21:35 · 早睡→下午不犯困」`，来自 frontmatter `sources[]` 经 `parseSourceString()` 反解。同分钟多条行为行时显示「同分钟 N 条，人工确认」并列出全部候选，**绝不静默择一**。

## 2. 四步法 → 用户流程（成功态/错误态）

### 记录（📌）

- **入口**：杂记 tab 内「杂记/记录」模式切换（`jottings-card.tsx` 扩展）。
- 流程：切换到记录模式 → 输入行为 → `POST /api/daily` addNote 带 section 参数 → 行写入「## 行为记录」节。
- 成功态：行出现在行为流分区；错误态：toast 报错、输入保留。

### 归纳（转洞察）

- **入口**：杂记条目菜单 + 灵感卡片菜单（`inspiration-feed.tsx` 在 `src/app/` 下）上的「转洞察」。
- 流程：单步抽屉（`induct-drawer.tsx`，仿 capture-fab 229 行模板）→ statement 预填（可编辑）、topics 勾选、来源杂记指针自动记入 INS **正文**（`- 来源：…` 行；不进 frontmatter `sources[]`——该字段唯一写入者是验证写②）→ 提交 → `POST /api/insights` → `Add insight INS-{id}` commit。
- 成功态：toast「已建 INS-xxx」；错误态：抽屉保留输入。

### 验证

- **入口**：验证台卡片上的 ✅/❌/👀。
- 流程：点 ✅ →（可选）勾选一条行为行作证据 → 提交。乐观更新即时变色，端到端 10-30s（含网络，诚实口径，不承诺秒回）。
- **证据门槛软约束**：当日无 📌 行点 ✅ → 非阻塞提示「今日无对应行为记录，凭印象验证？」+「改记 👀」快捷键。
- 写入终态显性化：toast 区分「3 项全部写入 GitHub ✓」/「已记录，部分写入稍后自动补齐」（对应 `traceWritten`/`countsSynced`）。
- 事件流：`dispatch("insight:updated", { detail: board })` 带 detail 就地更新，无 detail 降级 refetch（沿用 `daily:updated`/`inspiration:updated` 同款 CustomEvent + toast 事件总线模式，已核实 toast.tsx:28-32）。
- 失败：outbox 保留事件，banner「有 N 条未同步」，网络恢复/下次打开一键重放；`AuthError` 交锁屏接管（api.ts 现有行为）。

### 加冕（人工，唯一升格通道）

- **入口**：验证台卡片「可加冕」徽章（`canCrown = hypothesis && vc>=5 && fc===0`）。
- 流程：点徽章 → 二次确认 → `POST /api/insights/crown` → crown 事件入流。
- 服务端幂等：提交前重读 frontmatter，status 已是 knowledge → `200 already_crowned`。

### 对账

- **入口**：验证台顶部「对账」按钮（手机可点，`npm run verify:insights` 仅留作 CI/桌面第二入口）。
- 流程：`GET /api/insights/invariant?dryRun=1` → 渲染报告（drift/damagedLines/conflictMarkers）→ 绿色=无事发生；红色 →「一键修复」→ POST → 逐文件 `Reconcile INS-x from events` commit。

## 3. 保护性交互

| 机制 | 行为 |
|---|---|
| 错误边界 | `error-boundary.tsx`（已核实存在于 `src/app/`）独立包一层验证台，防白掉整页 |
| GitHub 401/403/429 | 锁屏层显式提示「令牌过期/配额耗尽」，而非无限 toast |
| 欢迎回来 | 中断回归（>14 天未验证）首开显示 top5 存活 hypothesis + 最后行为流，一键继续（`welcome-back-card.tsx`） |
| 读侧降级快照 | bench SSR 超时或 GitHub 4xx/5xx → 回退上次成功数据，顶栏「数据截至 HH:mm」，记录按钮置灰并说明原因——打开永远有东西可看可判 |

## 4. 桌面端做减法

桌面 = Obsidian 手写 📌 行（格式兼容，落笔位置不限——全文件扫描都读见），web 桌面只做验证与对账，**不维护第二套记录入口**。README 写明分工。
