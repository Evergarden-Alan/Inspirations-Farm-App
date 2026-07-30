# 专注计时功能增强实施方案

## 目标与产品语义

1. 从任意未完成任务开始专注。
2. 如果任务存在直接、未完成的子任务，则本次会话以这些子任务为计时目标；否则以任务本身为计时目标。
3. 子任务列表在会话开始时形成快照。计时过程中新增的子任务不自动加入当前会话。
4. 用户可以在目标之间切换，同一目标的多段时间累加。
5. 点击“结束专注并保存”只保存时长，不改变任务完成状态，也不触发父子级联或灵感归档。任务完成仍由任务列表中的完成操作负责。
6. 已有 `⏱️` 时长与本次会话时长累加；全部目标在一次服务端事务中写入 Markdown。

## 核心约束

- 计时状态只有一个事实来源：`FocusTimerState`。组件不得同时维护另一份 sessions 或 active index。
- 所有状态转换使用纯函数先生成完整 `nextState`，再将同一个对象写入 React state 和 localStorage。
- 正在运行的片段不逐秒写 localStorage。持久化 `segmentStartedAt`，恢复时按当前时间计算。
- 切换目标时将当前片段累加到旧目标；暂停时只冻结当前片段，不同时写入 session，避免重复累计。
- 完成保存前同步结算当前片段，并把状态冻结为 paused；失败时保留该状态以便幂等重试。
- 多目标时长必须在一份最新 Markdown 上依次修改，最终只进行一次 GitHub PUT。
- 找不到目标、目标已有时长与会话基线不一致或任一写入无效时，整次操作失败，不允许静默跳过。

## 1. 时长工具 `src/lib/focus-duration.ts`

提供以下纯函数：

```typescript
function parseDurationToSeconds(duration: string | null | undefined): number | null;
function formatSecondsToMdDuration(seconds: number): string;
function addDurations(existing: string | null, additionalSeconds: number): string;
```

规则：

- 接受现有格式：`25m`、`90m`、`1h`、`1h5m`、`1h05m`。
- 解析后统一输出：小于一小时为 `25m`；整小时为 `2h`；带分钟为 `2h05m`。
- 正数但不足一分钟按 `1m` 记录；秒数按整分钟向下取整。
- `90m` 和 `1h90m` 等旧格式可读取，并分别规范为 `1h30m`、`2h30m`。
- 拒绝负数、空字符串、非数字和超出安全整数的值。
- 不静默截断累计时长；如果将来需要展示上限，应只限制 UI，而不破坏持久化数据。

`setTaskFocusDurationAtLine` 保留默认替换行为，并增加可选的累加模式以兼容其他纯 Markdown 调用方。专注会话的服务端提交使用“基线 + 本次增量”算出的绝对目标值，保证重试不会重复累加。

## 2. v2 计时状态

```typescript
interface FocusTargetSession {
  taskLocator: DailyTaskLocator;
  elapsedSeconds: number;
  baseDurationSeconds: number | null;
}

interface FocusTimerState {
  version: 2;
  sessionId: string;
  date: string;
  path: string;
  task: DailyTaskLocator;
  targetMode: "task" | "subtasks";
  sessions: FocusTargetSession[];
  activeSessionIndex: number;
  segmentStartedAt: number;
  segmentElapsedSeconds: number;
  isPaused: boolean;
}
```

字段语义：

- `task` 是打开计时器的根任务，仅用于恢复、标题和防止同时启动另一任务。
- `sessions` 始终至少有一个元素。无子任务模式也使用同一套状态机。
- `elapsedSeconds` 是已经结算到目标的历史片段总和。
- `segmentElapsedSeconds` 是暂停前冻结但尚未结算到 session 的当前片段。
- 运行时当前片段为 `segmentElapsedSeconds + (now - segmentStartedAt)`。
- 总计时为所有 session 的 `elapsedSeconds` 加当前运行片段。
- `baseDurationSeconds` 是会话开始时 Markdown 中已有的时长，用于冲突检测和幂等重试。

状态转换：

- `switchFocusSession(state, index, now)`：结算旧目标片段，切换 index，重置当前片段；暂停状态保持暂停。
- `pauseFocusTimer(state, now)`：把 live 片段冻结到 `segmentElapsedSeconds`，不修改 session。
- `resumeFocusTimer(state, now)`：保留冻结片段并重新设置起点。
- `finalizeFocusTimer(state, now)`：结算当前片段并冻结状态，供保存与失败重试使用。

localStorage 读取必须深度校验 sessions、locator、数值和 index。旧 `version: 1` 状态迁移为单目标 v2 状态；恢复页面在定位任务后补齐旧状态缺失的基线时长并重新保存。

## 3. 服务端原子保存

在 `PATCH /api/daily` 中增加 `saveFocusSession` 动作：

```typescript
interface SaveFocusSessionRequest {
  action: "saveFocusSession";
  date: string;
  sessionId: string;
  sessions: Array<{
    task: DailyTaskLocator;
    baseDurationSeconds: number;
    additionalSeconds: number;
  }>;
}
```

处理过程：

1. 严格校验日期、sessionId、locator、非负有限整数、目标数量及重复 locator。
2. 通过 `modifyDailyJournal` 获取最新 content 和 SHA；GitHub 409 时重新获取并重新执行整个纯变换。
3. 对每个目标在当前 `updatedContent` 上重新 `parseTasks` 和 `locateTask`。
4. 将本次秒数格式化为 Markdown 分钟增量，计算 `target = base + additional`。
5. 当前值等于 base：写入 target；当前值等于 target：视为同一请求已经应用；否则返回 409 时长冲突。
6. 所有目标成功后只提交一次 content；内容已等于目标时不创建无意义提交。
7. 返回最新 `path`、`sha`、`content` 和 `sessionId`，客户端直接刷新本地任务状态。

基线比较让网络响应丢失后的同 payload 重试保持幂等。由于 Markdown 只保存聚合值，两个不同设备从相同基线开始且恰好产生相同增量时无法仅靠数值完全区分；本应用通过 localStorage 单活计时器和 sessionId 降低该风险。若未来要求严格的跨设备 exactly-once，需要在持久层额外保存已应用 sessionId。

## 4. FocusTimer UI

无子任务时保持现有布局，只把主按钮文案改为“结束专注并保存”。

有子任务时增加：

- 根任务标题；
- 可换行或横向滚动的目标切换按钮，使用 `aria-pressed` 表达当前目标；
- 总计时；
- 各目标累计时长，当前目标包含 live 片段；
- 暂停、结束专注并保存、中止按钮。

完成流程必须使用 `finalizeFocusTimer` 的返回值直接构建 payload，不得依赖一次异步 `setState` 后再读取旧状态。保存失败时 final state 留在 localStorage 且保持暂停，用户可以直接重试或继续计时。

## 5. Dashboard 集成与任务变化

开始会话：

1. 取 `parentId === task.id && !done` 的直接子任务。
2. 若结果非空，`targetMode = "subtasks"`；否则 `targetMode = "task"`，目标为根任务。
3. 为每个目标创建 locator，并从 `focusDuration` 解析基线时长。
4. 创建并保存 v2 状态，再打开计时器。

恢复会话：

- 根任务无法定位时清除损坏状态。
- 目标用于展示时逐个重新定位；无法定位时使用 locator 文本作为降级标签。
- 保存时服务端再次定位全部目标。任何目标缺失都会返回冲突，客户端保留计时状态并提示用户，不会静默丢弃。
- 删除任务时，只要待删除子树包含根任务或任一计时目标，就阻止删除并引导用户先结束或中止计时。

## 6. 测试要求

### 纯函数

- 时长解析、规范化、累加及非法输入。
- `0/1/59/60/3599/3600` 秒边界。
- A -> B -> A 重复切换。
- 运行、暂停、恢复、暂停时切换、切换后立即完成。
- 总计时与各 session 计时一致。
- v1 迁移、v2 深度校验和损坏记录清理。

### Markdown 与原子保存

- 替换行为保持兼容，append 正确累加。
- 两个以上目标一次变换后全部保留。
- 相同 payload 重试不重复累加。
- 基线时长发生变化、locator 缺失及重复目标时整次失败。
- 重复任务文本通过 parent locator 正确定位。

### 验证命令

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## 实施清单

- [x] 创建时长工具并扩展 Markdown 写入函数。
- [x] 将计时状态升级为 v2 并实现纯状态转换及 v1 迁移。
- [x] 增加服务端批量变换和 `PATCH /api/daily` 原子保存。
- [x] 改造 FocusTimer 子任务 UI、暂停/切换/完成流程。
- [x] 改造 DailyDashboard 创建、恢复、保存和删除保护。
- [x] 增加自动化测试并通过 test、lint、类型检查和 build。
