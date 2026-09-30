# 01 · 架构决策与数据模型

> 创建时间：2026-10-01
> 来源：《真知浮现最终架构报告》§3 + 证据核实修正（见 [05-evidence-check.md](./05-evidence-check.md)）
> 本文自包含：不看报告也能据此开工。行号均为 2026-10-01 核实值（HEAD d4b54c8）。

## 1. 总判决

**v1 用 Contents API 3×PUT（固定顺序 + 事件先行 + 幂等 + 对账），不引 Git Data API。**

- 「真知浮现」= 用户以自己的行为记录为证据，验证自己提出的因果假设（INS），达到阈值后人工加冕为真知（knowledge）。
- 一次验证要写 3 个文件：事件流（唯一事实源）→ INS frontmatter（可重建物化视图）→ 日记留痕（fail-soft）。Contents API 每次 PUT 一个独立 commit，不原子——但事件流唯一事实源 + frontmatter 可重建的语义把「原子性要求」降级为「可收敛性要求」。
- Git Data API 单原子 commit 是 v2 演进目标，按触发线在 `insights-github.ts` 内部局部替换，service/UI/事件 schema 零改动。

**底座已验证就绪**（核实结论）：

| 底座能力 | 代码证据（2026-10-01 核实） |
|---|---|
| 409 乐观锁重试 | `github-client.ts:55-70` `withConflictRetry`：仅 409、最多 2 次、fn 内部重 GET 最新 sha+内容 |
| 类型化错误 | `github-client.ts:27-44` `GitHubApiError`（.status）/`GitHubConflictError`(409) |
| 日记读改写 + 退避 | `github.ts:736-781` `modifyDailyJournal`，0/500ms 退避、create-if-missing 跳过再 GET |
| 结构化 frontmatter 写入 | `markdown-utils.ts:106-114` `setFrontmatterField`（非全文正则） |
| 域模块模板 | focus-playlist 七层 1232 行（lib 927 + 路由 305），服务层 DI 离线可测（`focus-playlist-service.ts:41-51`） |
| 鉴权 | `auth.ts:10-36` PIN + `x-app-pin` + timingSafeEqual；⚠️ APP_PIN 未配置时生产 deny-all |
| 测试基建 | 11 文件 68 例 node:test 离线全绿（实测 174ms）；`tests/register-hooks.mjs` strip-types 钩子 |

## 2. 写路径：applyVerification（服务端唯一写入口）

位置：`src/lib/insights-service.ts`，依赖注入风格（照 `focus-playlist-service.ts:41-51` 先例），可完全离线单测。

```
applyVerification({insightId, verdict, note, evidence, clientEventId})

 0) 单点读齐（缩小 Contents API 读副本漂移面）:
    Promise.all([ readVerifications(), readInsightFile(insightId), readRecentJournals(3) ])
    —— 证据窗必须含近 3 天，否则「早睡→次日不犯困」演不出来

 1) 幂等查重: parseVerifications(jsonl) 三态解析（valid / damaged 残行上报不计入 / duplicate 去重告警）
    事件 id 已存在 → return { ok: true, already: true }

 2) 写① 事件流先行（唯一事实源）:
    事件 = { id: clientEventId, type: "verify"|"crown", ts: 北京时间带时区 ISO 串,
             insight, verdict, note, source: {date, anchor}|null }
    withConflictRetry(() => appendVerification(ev))   ← 必须包裹，不复刻 appendInspirationPatch 无重试的缺陷
    409 耗尽 → 抛 VERIFY_CONFLICT → 路由映射 503；事件在客户端 outbox，重试安全

 3) 写② frontmatter（可重建物化视图）:
    计数取自写①成功后的「全量重放」（覆盖 vc/fc/last_verified/status/sources），绝不取写①前快照
    【可见性守卫】写后立即 GET 可能拿到陈旧副本（github.ts:744-746 注释已明示此坑）：
    readVerificationsUntilVisible(ev.id, { backoffMs: [0,500,1000] })——GET→parse→不含 ev.id 则退避重读；
    三次耗尽仍不可见 → 按写②失败处置（countsSynced=false + Sentry），绝不在未确认可见性的副本上重放
    updateInsightFrontmatter(id, { verify_count, falsify_count, last_verified, status, sources })
      status 只降不升；knowledge 仅由 crown 事件 + 人工按钮产生
      sources 由写②统一回写（唯一写入者），格式经 sourceToString() 序列化
    catch → countsSynced=false，不阻塞（事件已在，invariant/reconcile 回写）

 4) 写③ 日记留痕（fail-soft，INSIGHTS_TRACE_MODE 三态）:
    v1 默认 per-event：每次验证当场写一行，无跨日语义负担（daily-batch 的跨日归属 v2 届时定义）
    modifyDailyJournal(today, c => insertBehaviorTrace(c, {...}))   ← 自带重试+退避
    日记不存在 → 模板创建并直接采用 create 返回 sha（跳过再 GET）
    catch → traceWritten=false，绝不回滚前两写

 返回 { ok, traceWritten, countsSynced }
```

**服务端时限**：`/api/insights/verify`、`/api/insights/crown`、`/api/insights/invariant` 显式配置 `export const maxDuration`（Vercel Hobby 上限 60s），不许裸跑默认值（默认 10s 量级扛不住三写链最坏情形）。退避参数与 maxDuration 联动封顶：三写链最坏耗时 + 写后读退避总长须在 maxDuration 内留约 30% 余量；逼近上限主动降级为「只保写①，写②③留给 reconcile」。

**客户端 outbox（localStorage 发件箱，v1 必做）**：提交前先落 localStorage（`ev-{北京timestamp}-{rand4}`）→ 请求 → 成功 markSynced、失败保留 → 网络恢复/下次打开一键重放（幂等键天然安全）。`AuthError` 交锁屏接管；不可幂等重放的操作禁自动重试（借鉴 /api/attachment `retryOnNetworkError: false` 先例，见 05 新发现 6）。

### 失败矩阵（每格都有确定语义）

| 故障点 | 后果 | 处置 |
|---|---|---|
| 写①失败 | 零局部状态 | 客户端报错，outbox 保留事件，重试安全（幂等键） |
| 写①成 + 写②读副本陈旧 | 无异常信号，裸读会把旧计数写回 | `readVerificationsUntilVisible` 退避重读，耗尽才按写②失败（countsSynced:false + Sentry） |
| 写①成 + 写②败 | 数据不丢（事件在流里） | toast「已记录，计数稍后自动同步」，invariant 检出 drift → reconcile 回写 |
| 写①②成 + 写③败 | 仅留痕缺失 | toast「已验证，日记留痕稍后补齐」，jsonl 重放可回填 |
| 重复提交/双击 | — | eventId 查重 → `200 already` |
| 加冕双击/竞态 | 非法加冕 | 服务端提交前重读 frontmatter，status 已是 knowledge → `200 already_crowned` |
| 服务端函数超时 | 响应未达客户端但写①可能已成功 | outbox 保留重试 → 服务端幂等查重 `200 already`；「事件先行」保证任意点超时都安全收敛 |

### 冲突/重试语义分级（Contents 期与 v2 Git Data 期共用）

| 现象 | 判定 | 处置 |
|---|---|---|
| Contents PUT 409 | 文件级陈旧 | `withConflictRetry`：重 GET → 重放同一变换（最多 2 次） |
| 409 耗尽 | 无法收敛 | 503 明确失败，客户端保留输入 + outbox，宁可见失败不静默丢 |
| v2：PATCH ref 非快进（现实多为 422，文档亦列 409） | ref 已移动 | 重读 head → 全重放 |
| 422 spam / 403 / 429 secondary limit | 限流 | 按 retry-after 指数退避，禁止立即重放 |

**既有代码注意（核实修正）**：`updateDailyJournal`（github.ts:696-720）**有意不加** `withConflictRetry`——全文档替换不能拿新 SHA 写旧内容，409 必须透传客户端重放。新验证链不要「顺手统一」它。

### 建节规则（写路径最要害的拼图）

「## 行为记录」节位于「## 今日杂记」**之前**。节的三个来源，缺一不可：

1. **vault 模板**（主通道）：`Templates/Diary_Template.md`（`DIARY_TEMPLATE_PATH`，github.ts:636-637，可用环境变量覆盖）在杂记节**之前**插空节——M0 手改一次，07:31 cron 后新建日记自带。插错位置（杂记之后）= 把串节 bug 写进模板源头。
2. **代码内建节兜底**（`insights-daily.ts` `insertBehaviorTrace`）：

```ts
const lines = content.split("\n");
const sec = findHeading(lines, "## 行为记录");
if (sec >= 0) return insertAtSectionEnd(lines, sec, buildTraceLine(trace));   // 节在 → 节尾追加

const jottings = findHeading(lines, "## 今日杂记");
if (jottings >= 0)
  return insertLinesBefore(lines, jottings, ["## 行为记录", buildTraceLine(trace), ""]);  // 紧贴杂记标题之前
return appendLinesAtEnd(lines, ["", "## 行为记录", buildTraceLine(trace)]);   // 异构日记 → 文件尾整节追加
// 不变量：任何成功写入后，「## 行为记录」标题行号 < 「## 今日杂记」标题行号，恒成立
```

3. **配套单测三条**：① 模板日记（有节 → 节内追加，节序不变）；② 存量旧日记无节（建节紧贴杂记前，两节互不串行，`headingEnds d===1` 断言）；③ 无杂记节的异构日记（文件尾整节追加，解析正常）。

**串节 bug 现状（核实补充）**：`markdown-utils.ts` 的 `SectionEndOptions` 参数化机制**已存在**（:605-610 interface、:614-627 `findSectionEndLine`），无需再造；但三者（含 `findHeadingLine` :596）目前为模块私有，需先 export（03 · T0.5 前置小改动）。`d===1` 谓词（只认 H1/`---` 结节，H2 互不终结）出现在 4 个调用点（:443-446、:541-544、:762-765、:815-818），**读取路径（杂记渲染解析）同样受影响**。行为节落地（H2 紧邻杂记之前）后，此现状 bug 会从理论变为每日可见——行为节的写入函数必须传 `headingEnds: () => true`（照 `appendInspirationPatchLine` :673-676 先例），且 T0.5 的 characterization 单测 + T1.3 的顺修（4 处调用点 + 全量日记解析回归）共同兜住这条回归线。

### 对账协议（检测与修复分离，废除「GET 自动修复」）

```
GET  /api/insights/invariant?dryRun=1 → { drift[], damagedLines[], conflictMarkers[], events:N }
       · replay(jsonl) vs frontmatter 逐条比对 vc/fc/last_verified/status/sources（不只计数）
       · 扫 Journal/ 下 <<<<<<< 冲突标记（obsidian-git pull 冲突巡检自动化）
POST /api/insights/invariant          → 显式 reconcile：以事件流为准回写漂移文件
       · commit message: `Reconcile INS-x from events (vc=3 fc=0)`
scripts/verify-insights.mjs           → 自读环境变量 APP_PIN，drift 非空退出非零 + 断言 commit 结构不变量
```

**commit 结构不变量（verify:insights 的断言面）**：

```
record(📌)  = 恰 1 commit   · message 含行为行锚信息
induct      = 恰 1 commit   · `Add insight INS-{id}`（含命题前 40 字）
verify      = ≤3 commits 且严格 jsonl → frontmatter → 日记顺序 · `verify(INS-x): confirm +1 (vc=3)`
crown       = ≤2 commits 且 jsonl → frontmatter 顺序 · `Crown INS-x to knowledge`
reconcile   = 每漂移文件 1 commit · `Reconcile INS-x from events`
```

## 3. 数据模型

**schema 唯一源** = `src/lib/insights.ts` 的 TS 类型 + 序列化函数（JSON_SCHEMA 字符串化日期防 gray-matter coercion）。vault 内**不建** `Insight_Template.md`，杜绝双源漂移。

### INS 文件

`Insights/INS-{YYYYMMDD-HHmmss}.md`（北京时间命名；目录 + INS 前缀与 Inspirations/Add 逻辑双保险区分）。

| frontmatter 字段 | 说明 |
|---|---|
| `type` | 恒 `insight` |
| `id` | `INS-20260930-213001` 形态 |
| `statement` | 单行因果命题 |
| `status` | `hypothesis \| verified \| falsified \| knowledge` |
| `verify_count` / `falsify_count` | 由写②从事件流全量重放回写 |
| `last_verified` | 字符串化日期 |
| `created` | 字符串化日期 |
| `topics[]` | 命中 LEARNING_TOPICS 打分加成 |
| `sources[]` | `Journal/2026-09-30.md@2135` 字符串，写②唯一回写，人工不直编（手改会被 reconcile 当 drift 清掉）。**归纳期不写此字段**（审查设计裁决）：「转洞察」的来源杂记指针写 INS 正文（`- 来源：…` 行）——frontmatter sources 仅由 verify/crown 事件重放产生，否则 invariant 从第一天就报 drift |
| `related[]` | v1 恒空，schema 预留 |

### 事件流 `Insights/verifications.jsonl`（应用独占，obsidian-git 不编辑）

```json
{"id":"ev-20260930213501-2f8a","type":"verify","ts":"2026-09-30T21:35:01+08:00","insight":"INS-20260930-213001","verdict":"confirm","source":{"date":"2026-09-30","anchor":"2105"},"note":"昨晚 21:05 记录，今天下午确实不困"}
{"id":"ev-20260930215010-9c3d","type":"crown","ts":"2026-09-30T21:50:10+08:00","insight":"INS-20260930-213001","from":"hypothesis","to":"knowledge","source":null,"note":"连续 5 次验证通过，人工加冕"}
```

- 事件流补 crown 类型（`from`/`to`）——没有它 replay 重建不出 knowledge 状态，reconcile 会把人工加冕静默打回 hypothesis。
- `source` 恒为对象 `{"date":"2026-09-30","anchor":"2135"|null}`；INS frontmatter `sources[]` 恒为字符串 `文件路径@HHmm`。**唯一转换点** = `insights.ts` 的 `sourceToString()` / `parseSourceString()`；**唯一写入者** = applyVerification 写②。禁止 UI/路由/脚本任何位置自发拼串。
- 重放规则：vc=confirm 数、fc=refute 数、last_verified=confirm/refute 最大 ts、status 由 verify 降级 + crown 事件重建；unobserved 只落流不改计数。
- 事件 ts 用带时区 ISO 串；日期边界一律北京时间（`beijing-time.ts`，Asia/Shanghai、en-CA YYYY-MM-DD，已核实）。

### 日记行为节

- 节：`## 行为记录`（H2，位于 `## 今日杂记` 之前，绝不碰 `%%TODO_PLACEHOLDER%%`）。
- 行为行：`- **23:05** 📌 上床睡觉`；留痕行：`- **21:35** ✅ INS-20260930-213001 早睡→下午不犯困：符合预期`（✅/❌/👀 = confirm/refute/unobserved）。与杂记行同构。
- **解析器全文件扫描**（`parseBehaviorRecords` 一条正则双型识别，锚定 📌/✅❌👀 前缀）：📌 行不限于行为节内——桌面用户最自然的落笔位置是杂记节，若只扫行为节，桌面记录场景不成立。该节仅约束 **web 写入点**。

### 纯计算判据（`insights-config.ts`，参数钉死不做配置项）

- `score = (1+vc) × 0.5^(距最近验证天数/halfLife)`；halfLife 默认 14，LEARNING_TOPICS（硬编码常量，用户随代码人工维护，如 `["睡眠","专注","复盘",...]`）命中取 10；last_verified 空取 created。
- `canCrown = status==="hypothesis" && vc>=5 && fc===0`。
- `nextStatus`：confirm 不变；refute → fc+1 且 knowledge/verified 降回 hypothesis（**只降不升，falsified 仅人工标记**，单次 refute 不自动定罪）。
- 加冕唯一升格通道：人工「确认升格」按钮 + 二次确认 + crown 事件入流。
- **已接受缺口（显式登记）**：falsified 闭环 v1 是死路——falsified 收 confirm 永远停留，canCrown 只认 hypothesis，无翻案通道。过渡期人工出路：新建等价 INS 重走验证（数据纯文本，成本≈复制一行命题）。升级触发：真实出现第一次翻案诉求 → 命中 v2 补偿事件触发线。

## 4. 与桌面 Obsidian 的分工边界

| 事项 | 归属 | 边界规则 |
|---|---|---|
| 日记正文、任务、⏱️ 时长、杂记自由文本、07:31 建日记 cron | Obsidian | web 绝不碰 `%%TODO_PLACEHOLDER%%` 与杂记段（杂记段里桌面手写的 📌 行属行为数据，全文件扫描会读走） |
| `Insights/` 目录与 `verifications.jsonl` | **web 独占** | 与 obsidian-git 零文件交集，只有 fast-forward 层面 409，重试即收敛；INS- 前缀 + commit 前缀与应用 Inspirations 逻辑四重区分 |
| `## 行为记录` 节 | 双端共用，追加型 | 解析器全文件扫描；节仅约束 web 写入点（modifyDailyJournal 退避 + 只追加进桌面几乎不打开的节）；节序由模板 + 兜底共同保证 |
| 桌面 web 记录入口 | 不做 | 桌面 = Obsidian 手写（落笔自由）；web 桌面只做验证与对账，README 写明分工 |
| 状态字段回写 | 禁止 | 不对用户正在编辑的文件做字段级回写（除 INS frontmatter——应用独占）；sources 由写②唯一回写 |
| 双写者软纪律 | 人 | 「手机验证时别在桌面同时保存当日日记」；`<<<<<<<` 巡检已自动化进 invariant 报告 |
| 断档期降级 | Obsidian | 手写 jsonl 事件行（vault 常备 JSON 模板行），恢复后 reconcile 正常吸收；**不要**手改 frontmatter 计数与 sources |

EOL 已由 `.gitattributes` 强制 LF；残余桌面旧缓冲区覆盖是 last-write-wins，靠 obsidian-git `pullBeforePush` + 1 分钟收敛周期兜底。

## 5. v2 演进预留（v1 不写一行代码）

- `git-data-client.ts`：`GET ref → POST tree → POST commit → PATCH ref(force:false)`，5 请求/次原子提交；CAS 按 422/409/429 语义分级。触发线：验证 >50 次/周、obsidian-git 明显变慢、Insights >50 条读放大可感、首次误判补偿诉求。
- 行级块锚 `^rHHmm`（`ensureBlockAnchor`/`resolveBlockAnchor` 配单测）：sources 升级为可点击跳转、「同分钟 N 条」歧义 UI 退役，schema 不变。
- `git trees?recursive=1` 读改造（>50 条触发）、完整离线队列、误判补偿事件、daily-batch 聚合留痕（跨日语义届时定义）、related UI。
- v3：/trace 溯源页、打分 trace 工作台、热力图、wikilink 图谱、周报。
