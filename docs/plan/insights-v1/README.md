# 真知浮现（Insights）v0+v1 开发计划

> 创建时间：2026-10-01
> 状态：**待启动**（M0 未开始）
> 来源：《InspirationsFarm扩展_真知浮现_最终架构报告.md》（`/mnt/data/Projects/ImproveSystem/`）+ 2026-10-01 代码证据核实（40 条主张，见 [05-evidence-check.md](./05-evidence-check.md)）

## 一句话

在 Inspirations-Farm-App 上新增第 2 类领域数据「真知浮现」：用户以自己的行为记录（📌）为证据，验证自己提出的因果假设（INS），达到阈值后人工加冕为真知（knowledge）。底座（GitHub 平面文件数据库、冲突重试、日记读写、鉴权、域模块模板）已核实就绪，本计划覆盖环境卫生（v0，0.5 天）与最小可用（v1，1-2 周）。

## 文档索引

| 文档 | 职责 | 何时读 |
|---|---|---|
| [01-architecture.md](./01-architecture.md) | 架构决策、写路径、失败矩阵、数据模型、Obsidian 分工边界 | 动手写代码前 |
| [02-app-flow.md](./02-app-flow.md) | 四 tab 信息架构、四步法用户流程、保护性交互 | 做 UI 前 |
| [03-implementation-plan.md](./03-implementation-plan.md) | **任务序列 T0.x/T1.x-…/M0-M5，commit 粒度与断点续跑** | 每个开发会话 |
| [04-quality-gates.md](./04-quality-gates.md) | 四件套质量门、测试清单、验收标准、风险与放弃信号 | 每任务验收时 |
| [05-evidence-check.md](./05-evidence-check.md) | 架构报告证据核实记录（对报告的 8 处修正 + 6 条新发现） | 质疑某个前提时 |

## 范围

**v1 做**（约 1800-2200 行）：验证台第 4 tab、applyVerification 三写链（事件流先行 + 幂等 + 可见性守卫 + maxDuration）、outbox、invariant UI（dryRun/repair 分离）、crown 事件、转洞察抽屉、行为记录模式、近 3 天证据窗、证据门槛、欢迎回来卡片、降级快照、错误边界、commit 不变量脚本、证据回看（sources 写入 + 渲染）。

**v1 明确砍掉**（每项有升级触发线，见 03 末尾）：Git Data API 单 commit、行级块锚 `^rHHmm`、related UI、独立 /induct 多步页、/trace 溯源页、Review 工作台、热力图、完整离线队列、独立详情页、vault 内 Insight 模板文件、daily-batch 聚合留痕。

## 里程碑总表

| 里程碑 | 内容 | 规模 | 完成标志 |
|---|---|---|---|
| M0（v0） | APP_PIN（⚠️ 生产 deny-all 阻断）、fine-grained PAT、2 个卫生 commit、域骨架+节边界单测、vault 模板、typecheck script | 0.5 天 | 骨架测试跑绿，模板节序正确 |
| M1 | insights 类型/事件流 schema/判据 + T1.3 顺修 4 处 d===1 调用点 | ~0.5 天 | 判据单测绿，日记解析回归绿 |
| M2 | 三写链（insights-daily / insights-github / insights-service + 失败矩阵服务层 DI 测试 7 格；路由测试在 M3/T3.2） | ~2 天 | 失败矩阵 7 格自动化覆盖 |
| M3 | API 路由族（verify/crown/invariant）+ bench 数据层 + verify:insights 脚本 | ~1 天 | 脚本全绿 |
| M4 | UI：验证台五分区、outbox、抽屉、加冕、对账、保护性交互 | ~2 天 | 真机可走完整链 |
| M5 | 证据回看 + 真机全链验收 | ~0.5 天 | 验收标准 5 条全过（04 §3） |

**第 4 周止损检查点**：总验证事件 <10 → 冻结工程，退回 Obsidian 手写形态（数据全在 vault，无损）。放弃信号六条见 04 §5。

## 对架构报告的修正（详见表格见 05）

1. `SectionEndOptions` 参数化**已存在**（markdown-utils.ts:605-627）→ 尖刺改为「复用」。
2. `api/daily/route.ts` 已全面 instanceof → 卫生修复 B 缩小为仅 `api/github/route.ts` 五处。
3. 「appendInspirationPatch 唯一无重试」不准确 → 修复照做，但 `updateDailyJournal` 有意不加、不许动。
4. focus-playlist 模板实为七层 1232 行（报告漏 cache 层）→ 新域按七层参照。
5. `data.ts` 无 getDailyDashboard → v1 第三路命名为 `getInsightBench()` 与 getTodos/getInspirations 并列。
6. package.json 无 typecheck script → M0 补上（T0.7）。
7. **加重**：APP_PIN 缺失 = 生产 deny-all（auth.ts:23-33）→ T0.1 升为最高优先。
8. 串节 bug 同时影响读取路径（4 处 d===1 调用点）→ 已定修：M1 新增 T1.3（顺修 + characterization→修正断言翻转 + 全量日记解析回归）。

## 开工方式

新会话直接说「按 docs/plan/insights-v1 继续」——读 03 文档 + git log 对照断点，从下一个任务继续。

**环境自检**（T0.1/T0.2 是纯环境变更，git log 无痕，用这两条判断是否已做）：
- `grep -q '^APP_PIN=' inspirations-farm-app/.env.local && echo T0.1-done`（有输出 = 已做）
- T0.2：GitHub token 页该 token 类型为 Fine-grained 且限定 Evergarden-Alan/Note = 已做。
