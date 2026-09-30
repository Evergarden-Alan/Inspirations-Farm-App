# 04 · 质量门、验收标准与风险登记

> 创建时间：2026-10-01
> 原则：Quality Gate 不是慢下来，是不让屎山滚下来。验证结果如实记录 passed / failed / not-run。

## 1. 每任务质量门（四件套）

```bash
cd inspirations-farm-app
npm test          # node:test strip-types，现有 68 例 174ms 全绿为基线，零回归
npm run typecheck # T0.7 后可用；此前 npx tsc --noEmit
npm run lint
npm run build
```

任何一项红 → 不进下一任务。commit 粒度 = 可验证小阶段（见 03 任务卡）。

## 2. 测试策略与新增测试清单

现有基线（核实）：11 个测试文件、68 例、node:test + `tests/register-hooks.mjs`，全为纯函数测试；API 路由与 UI 零自动化测试。v1 必须补路由级 DI 测试，否则三写链失败矩阵只是纸面承诺。

| 测试 | 覆盖 | 所在任务 |
|---|---|---|
| `tests/insights-config.test.mjs` | parseVerifications 三态 / replay 含 crown / score / canCrown / nextStatus / sources 两格式互转 | T0.5、T1.2 |
| `tests/markdown-utils-section.test.mjs` | 节边界：现状 characterization 断言（d===1 串节钉住，T0.5）→ 修正断言（T1.3 顺修后翻转） | T0.5、T1.3 |
| `tests/insights-daily.test.mjs` | 建节三条（有节追加/紧贴杂记前建节/异构文件尾）+ 全文件扫描（节外 📌 可读）/ 节序不变量 / traceLine 格式 | T2.1 |
| `tests/insights-github.test.mjs`（DI） | 可见性守卫（陈旧副本不重放、耗尽按失败）/ append 重试 / create 跳过再 GET | T2.2 |
| `tests/insights-service.test.mjs`（DI） | **失败矩阵全 7 格** + crown 幂等 + 三写顺序 | T2.3 |
| 路由测试 | VERIFY_CONFLICT→503 / 404 分流 / PIN 401 | T3.2 |
| `scripts/verify-insights.mjs` | drift 非零退出非零 / commit 结构不变量五条 | T3.4 |

单测纪律照旧：服务层依赖注入、fake client、离线运行、毫秒级。

## 3. v1 完成标志（验收标准）

1. 真机一次完整「记录→归纳→验证→加冕」链。
2. 验证台卡片上至少一条可回看证据行。
3. `npm run verify:insights` 全绿（drift=false、commit 结构不变量通过）。
4. 桌面 Obsidian 下一分钟 pull 干净合入，无冲突标记。
5. 四件套全绿，现有 68 例零回归。

## 4. 风险登记（按杀死系统概率排序）

1. **验证摩擦反超**（第一死因候选）：一次验证 6-9 请求、10-30s，弱网更糟——系统死于「懒得验证」远早于死于「数据撕裂」。缓解：outbox + 乐观更新 + 降级快照，但不消除。部署层同源风险：Vercel serverless 时限（Hobby 默认 10s 量级）vs 三写链最坏数十秒 → `maxDuration=60` 显式配置 + 事件先行幂等结构兜底。
2. **首屏读放大**：bench 第三路 1+N（<10 条约 11 请求）叠加现有两路，冷启动 15-30s 可能。v1 必须 p-limit(10)；>50 条触发 v2 git trees 改造。
3. **静默失效三层化**（Vercel 部署 / GitHub 配额与令牌 / 手机网络）：invariant UI + Sentry + verify:insights 三件覆盖「看起来在跑其实没在记」；退路（Obsidian 手写）要偶尔真的演练。
4. **鉴权薄弱**：PIN 仅视觉门禁（数据随 HTML 下发，能开页面就能看源码）+ PAT 单点。个人自用可接受；对外部署第一件事是把鉴权上移 Server Component/中间件。**核实加重**：APP_PIN 未配置时生产 deny-all（auth.ts:23-33），M0 T0.1 前生产写功能实际不可用。
5. **自维护件清单**（每个都要过「它静默死掉一周我发现得了吗」，答案= invariant 报告）：行为节解析与建节、crown 重放、写②可见性守卫、（v2）锚解析器、模板函数。
6. **测试现状缺口**：路由/UI 零自动化测试 → T2.3 服务层 DI 测试（失败矩阵 7 格）+ T3.2 路由工厂测试（401/503/404）补齐。
7. **概念混淆负债**：Inspirations/Insights 一字之差 → 四重隔离（目录/tab/字段/commit 前缀），坚决不复用灵感流 UI 语义。
8. **已接受缺口：falsified 闭环 v1 是死路**（翻案无通道）：接受理由=单次 refute 不定罪+翻案低频+v1 补偿机制不成比例。过渡出路=新建等价 INS 重走验证。**升级触发=第一次真实翻案诉求 → 提前启动 v2 补偿事件**，此前不写一行代码。

## 5. 放弃信号（六条，与第 4 周止损检查点共用同一读数）

1. 第 4 周总验证事件 <10 → 冻结全部 v2 工程，退回 Obsidian 手写（数据无损）。
2. 连续两周记录步（📌 行）日均 <1 条 → 记录根断，系统名存实亡。
3. 一个月内 ≥3 次「想验证但打开 app 就关掉」 → 摩擦未达阈值，回交互重设计，不堆功能。
4. invariant 连续两周非零 drift 且无法定位根因 → 数据层设计有误，停写修根。
5. obsidian-git 冲突标记反复出现且影响日常写作 → 双写者代价超收益，收缩 web 写日记面（trace off）。
6. 开始用「收藏别人观点」的方式用 Insights → 根性变质，删功能比加功能更重要。

## 6. 会话纪律（vibe-coding 质控）

- 上下文管理：/compact 在用量 ~50% 时手动做；走偏 Esc Esc 回滚 checkpoint，不在错误上下文硬修；修两次没搞定 /clear 靠本文档夹恢复。
- 新会话恢复：读本文件夹 README + 03 文档 → git log 对照断点 → 继续。
- 调试三金规：只说 fix + 完整错误与复现；不微操。
