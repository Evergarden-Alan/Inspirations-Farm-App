# AI 参谋（/chat）设计 spec

- 日期：2026-10-05
- 状态：设计已经用户在会话中批准，待实施
- 来源：头脑风暴会话（ultracode 调研工作流 `wf_b787b0cb-f67`，6 路侦察 + 综合）
- 关联：`docs/plan/insights-v1/`（复用其读写纪律）；`docs/superpowers/specs/` 本文件

## 1. 背景与动机

用户的核心痛点：**计划太死板**。证据（调研工作流综合报告）：

- review_status- 仓库中有效计划分散在 5+ 文件（408/数学/英语 各自 wNN、补救计划、调整记录），无统一「当前计划」指针；日期硬编码进表格，调整靠人工重写（review-repo 侦察）。
- App 内 rollover 是自动死规则，无任何自然语言调整入口（README.md）。
- 全库无既有「AI 对话改计划」讨论（docs-plans 侦察 grep 仅 3 处弱命中）。

目标：在 Inspirations Farm App 中新增 AI 对话功能——基于两个远程 GitHub 仓库（`Evergarden-Alan/Note` 日记、`Evergarden-Alan/review_status-` 考研计划）做类 RAG 检索，实时对话分析当前计划、讨论额外工作，并**直接改写计划文档**（全自动、可回滚），让计划可以灵活调配。

## 2. 已裁决的决策

| 决策点 | 结论 |
|--------|------|
| 方案路线 | **方案一：Agentic 工具检索**（无向量库、无 embedding）；吸收「热集预载」 |
| 写权限 | C：对话中 AI 全自动写入，事后 git 回滚 |
| 写入范围 | review_status- 全权可写；Note **仅追加**（新 Daily 条目、新灵感卡，不改历史） |
| 模型 | Vercel AI SDK 统一抽象 + 默认 GLM（OpenAI 兼容端点），env 可切换供应商 |
| 隐私授权 | 用户明示同意个人语料送外部 LLM（GLM）；PAT 仅服务端 |

## 3. 非目标（v1 明确不做）

- 向量/语义检索、embedding 流水线、任何向量存储
- 服务端对话历史持久化（仅客户端 localStorage 恢复上次会话）
- 语音输入输出
- 教材 `sources/` 访问（被 review_status `.gitignore` 排除在 GitHub 之外，**远程永久不可达**；AI 只能引用计划文本中的题号）
- 定时/后台自动运行（只在用户对话时活动，天然满足「断档自检」——不在线即不可用，无静默失效）
- 多用户、分享

## 4. 硬约束（必须遵守）

1. App 运行时只读**远程** GitHub 仓库（Vercel 无本地盘）；服务端 PAT + `REPO_*` env。
2. 复用既有写纪律：Contents API、409 乐观锁 `withConflictRetry`（`src/lib/github-client.ts:55`）、p-limit(10)、类型化错误 `GitHubApiError/GitHubConflictError`。
3. obsidian-git 分钟级双写者竞态无法根除 → 一切写入必须幂等 + 可对账（insights-v1 报告2 风险 2）。
4. Vercel Hobby `maxDuration` 上限 60s（先例：`src/app/api/insights/route.ts:24`）；大陆单请求 1-3s；GitHub 5000 req/h 配额。
5. PIN 鉴权全覆盖（`validatePin`，`src/lib/auth.ts:21`）；APP_PIN 缺失 = deny-all。
6. 数据主权：一切仍以纯 Markdown 落 GitHub，本功能可零迁移移除。
7. 时序建议：insights-v1 仅剩 T5.2 真机验收，建议先完成再开本线（`docs/plan/insights-v1/03-implementation-plan.md` 断点续跑规则）；并行进行则 T5.2 不得被本线阻塞。

## 5. 架构

```
PWA /chat ──apiFetch(x-app-pin)──▶ POST /api/chat/session   引导：暖缓存+热集+数据截至时间
        └──流式对话──────────────▶ POST /api/chat            AI SDK 流式、服务端工具调用
                                      │
                                      ├──▶ GitHub Trees/Contents API（Note + review_status-）
                                      └──▶ GLM OpenAI 兼容端点（AI_BASE_URL/AI_API_KEY/AI_MODEL）
```

- 新路由 `/chat`；nav label「参谋」、icon `message-circle`；改 `src/components/app-shell/navigation-config.ts`（href 联合类型、`WorkspaceIconId`、`WORKSPACE_NAV` 各加一项，测试 `tests/workspace-navigation.test.*` 同步）。
- feature 代码：`src/features/chat/`（UI 组件、状态）；服务端：`src/lib/chat/*.ts`（工具实现、热集装配、语料缓存）+ `src/app/api/chat/` 路由。
- 对话历史仅客户端（localStorage，沿用 outbox 式惯例）。

## 6. 工具集（服务端定义，模型经 tool calling 调用）

| 工具 | 签名要点 | 边界 |
|------|----------|------|
| `read_file` | `(repo: "note"\|"review", path)` | 缓存优先，未命中回源 Contents API |
| `search_text` | `(repo, query, glob?)` | 会话语料缓存上内存正则/字面匹配，返回 路径+行摘录（限 top 20） |
| `list_tree` | `(repo, dir?)` | 全树来自 trees API 缓存，仅列 .md 路径 |
| `update_plan_file` | `(path, new_content, reason)` | **仅 review 仓库**、仅 `.md`；单文件单 commit |
| `append_journal` | `(date, section, text)` | **仅 note 仓库**；按 `markdown-utils` 追加惯例写入当日 Daily 指定节（时间戳 bullet），不暴露任何全文件改写能力 |
| `append_inspiration` | `(title, body, tags)` | note 仓库新建时间戳命名灵感卡（复用 `createInspiration` 约定），天然追加型 |

写权限在**工具层强制**（参数校验 + 路径白名单），不依赖提示词。Note 的两个追加工具是模型仅有的 Note 写通道，历史日记行不可被触碰。

## 7. 写入与回滚协议

- 每次 AI 写入 = Contents API PUT（`withConflictRetry`）= **单文件单 commit**，消息 `[ai-chat] <reason>`（如 `[ai-chat] 调整w40数学：套卷提前至周三`）。
- 回滚：`POST /api/chat/revert {repository, path, commit}` → 取父提交该文件内容 PUT 回去（逆内容单 commit，消息 `[ai-chat] revert ...`）。UI 写卡片带「回滚」按钮。已回滚再点 = 幂等返回。
- 多文件计划调整 = 模型多次工具调用，各自独立提交、独立可回滚。
- 系统提示词注入仓库既有纪律：改计划必须保留/更新「修订依据」段（review_status 「不静默改目标」惯例）；Note 追加格式规范（时间戳 bullet、frontmatter 不动）。
- review_status 既有写入者仅 Hermes 周 job（周日/一 07:33），竞态窗口极小且被乐观锁覆盖。

## 8. 语料缓存与热集

- **缓存**：lambda 模块级内存，按仓库存 `{path, content, fetchedAt}`。装载：`git trees?recursive=1` 全树（1 请求）→ 过滤 .md（Note 361 + review 145 ≈ 506 个）→ p-limit(10) 并发 Contents API 拉取。两仓库合计 ~1.6MB 字符量级，lambda 内存无压力。TTL 5 分钟；`/api/chat/session` 可强制刷新。
- **配额与时限**：冷启动 ≈ 507 请求/仓库对，服务端→GitHub 延迟通常 <1s（1-3s 是大陆手机端到 app 的延迟，不适用于此），507/10 并发 ≈ 25-40s，在 60s 预算内；设 **45s 装载预算**，超时未载完的路径按热度优先级（review 近周 wNN > Journal 近月 > 记忆库/Inspirations > Areas/Archive）部分装载并降级——`search_text` 对未缓存路径明示覆盖率。每小时引导次数 <10，远低于 5000 req/h；暖态零拉取。
- **热集**（系统提示词装配，北京时区解析当前 ISO 周）：三科 `wNN/本周复习计划.md` + `宏观复习规划.md` + 最近一份周总结 + 近 7 天 Daily。≈3-6 万字符，常见问题零工具直答。
- 另注入系统提示词：两仓库目录速览、wNN 文件格式模板、修订依据纪律、追加格式规范、工具使用指引。
- 降级：GitHub 失败时对话降级为只聊热集并明示「数据截至 HH:mm」（复用 insights 降级快照 UX）。

## 9. API 契约

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/session` | POST | 暖缓存 + 装配热集；返回 `{hotSetChars, fetchedAt, degraded}` |
| `/api/chat` | POST | `{messages}` → AI SDK 数据流（文本增量 + 工具调用事件）；`maxDuration=60`、`runtime="nodejs"` |
| `/api/chat/revert` | POST | `{repository, path, commit}` → 幂等回滚 |

三端点均 `validatePin` + 路由工厂模式（DI 注入 fake 依赖，离线测试）。

## 10. 错误处理

| 故障 | 行为 |
|------|------|
| GitHub 409 | withConflictRetry（重读 sha 重放，≤2 次）；仍败 → 工具返回错误文本，模型自行调整或告知用户 |
| GitHub 4xx/5xx | 工具返回错误 → 模型说明 + 前端显示降级横幅 |
| LLM 超时/断流 | 流式 error 事件；前端「继续」按钮重发 |
| 60s 截断 | 保留已生成部分，提示继续 |
| PIN 401 | 沿用全局 `apiFetch` 401 锁屏 |
| 工具参数越界（仓库/路径/写权） | 工具返回结构化错误文本，不抛断流 |

## 11. 依赖与环境变量

- 新 npm 依赖：`ai`（AI SDK）、`@ai-sdk/openai-compatible`。不引入向量/嵌入库。
- 新 env（`.env.example` 同步）：`AI_API_KEY`、`AI_BASE_URL`（默认 `https://open.bigmodel.cn/api/paas/v4`）、`AI_MODEL`（默认 `glm-4.6`，实现时核实智谱当前旗舰并取最新）。密钥仅服务端。
- 前置条件：用户在 Vercel 配置 `AI_API_KEY`（GLM）。

## 12. 测试策略（对齐 insights-v1 惯例）

- 路由工厂 DI + fake `githubFetch`（fixture 仓库文件树）+ AI SDK mock 模型 → 全离线毫秒级。
- 单测：热集周号/北京时区解析、`append_journal` 输出格式、revert 逆内容计算、`search_text` 匹配与限额、写权限边界（`update_plan_file` 拒绝 note 仓库/非 md；`append_journal` 拒绝 review 仓库）、缓存 TTL。
- `verify:chat` 脚本：mock 模型驱动端到端场景（问 → 检索 → 改计划 → revert）跑离线 fixture，注册进 package.json scripts 四件套旁。
- 真机验收清单（附录 A）。

## 13. 验收标准

1. `/chat` 出现在底部导航，移动端可流式对话。
2. 热集范围内问题首答不触发工具；范围外问题 AI 能检索到正确文件并给出路径引用。
3. AI 对 review_status 的每次修改 = 独立 `[ai-chat]` commit；UI 一键回滚后远程文件恢复父提交内容。
4. Note 历史内容不可被 AI 改写（工具层无该能力，测试证明）；追加条目格式与 Obsidian 模板一致。
5. 冷启动（lambda 冷 + 空缓存）引导 ≤ 55s 完成且给出数据截至时间；暖态首 token < 3s。
6. `npm test`、`typecheck`、`lint`、`build`、`verify:chat` 全绿。
7. 真机：完成一次「对话调整下周计划 → 查看 commit → 回滚」闭环。

## 附录 A：真机验收清单

- [ ] 手机 PWA 打开 /chat，PIN 后发起对话
- [ ] 「这周计划怎么样」→ 直答（无工具或仅热集）
- [ ] 「把下周三的套卷挪到周二，理由写清楚」→ 观察 update_plan_file 调用、commit 出现在 GitHub
- [ ] 点回滚 → GitHub 文件恢复，幂等二次点击无副作用
- [ ] 「我最近一周状态如何」→ AI 检索近 7 天 Daily 后总结
- [ ] 断网/错 key 场景 → 降级横幅与错误提示正确

## 附录 B：调研事实备查（带来源）

- 语料量级：Note 纯 md ≈ 0.9M 字符（361 md，Journal/Daily 143 篇、模板化 30-45 行/篇）；review_status ≈ 0.7M（145 md，696K）。obsidian-git 分钟级提交（1876 commits，最近 30 天 29 天活跃）。
- review_status 计划四层：宏观周表（W29-W51）→ 每科 wNN 周计划 → 周总结 → 调整记录；`overview.md` 是写给 AI 的常设需求（等效该仓库 system prompt）；无 CLAUDE.md。
- 应用零 AI 基建（无 anthropic/openai/@ai-sdk 依赖）；写路径先例 = Contents API 3×PUT + 事件流；`insights-config.ts` 参数钉死系刻意设计，本功能不改它。
- 既有 UX 先例：降级快照横幅「数据截至 HH:mm」、outbox 幂等重放、DI mock 离线测试（`focus-playlist-service.ts:41-51`、`insights-service.ts`）。
- 完整调研：会话工作流 `wf_b787b0cb-f67` 输出（`w91j9fa5c.output`）。
