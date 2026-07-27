# Sentry 错误追踪配置指南

## 什么是 Sentry？

Sentry 是一个错误监控平台，帮你在生产环境捕获和追踪错误。当用户遇到 bug 时，你会立即收到通知，并看到详细的错误信息、堆栈跟踪和用户操作路径。

## 为什么需要？

在开发环境，你能看到控制台的错误信息。但部署到 Vercel 后：
- 用户遇到错误，你不知道
- 即使知道，也没有详细的错误信息
- 无法重现用户的操作路径

**Sentry 解决这些问题**：
- ✅ 自动捕获所有错误
- ✅ 实时邮件/Slack 通知
- ✅ 详细的堆栈跟踪和上下文
- ✅ 用户浏览器/设备信息
- ✅ 完全免费（个人项目）

## 配置步骤（5 分钟）

### 1. 注册账号

访问 https://sentry.io
- 点击「Sign Up」
- 用 GitHub 账号登录（最快）
- 或用邮箱注册

### 2. 创建项目

1. 登录后点击「Create Project」
2. 选择平台：**Next.js**
3. Alert frequency: 选择 **On every new issue**（每个新错误都通知）
4. 项目名称：`inspirations-farm`（或自定义）
5. 点击「Create Project」

### 3. 复制 DSN

创建项目后，你会看到一个设置页面：

```
SENTRY_DSN = "https://abc123def456@o1234567.ingest.sentry.io/7654321"
```

**复制这个 DSN**（整个 URL）

如果页面关闭了，可以在：
- Settings → Projects → [你的项目] → Client Keys (DSN)

### 4. 配置到项目

打开 `.env.local`，添加：

```bash
NEXT_PUBLIC_SENTRY_DSN=https://abc123def456@o1234567.ingest.sentry.io/7654321
```

**注意**：
- 变量名必须是 `NEXT_PUBLIC_SENTRY_DSN`
- 不要有引号
- 等号两边不要有空格

### 5. 部署到 Vercel

在 Vercel 项目设置中：
1. Settings → Environment Variables
2. 添加 `NEXT_PUBLIC_SENTRY_DSN`
3. Value: 粘贴你的 DSN
4. 点击「Save」
5. 重新部署项目

## 验证是否工作

### 本地测试

1. 重启 dev server：`npm run dev`
2. 打开控制台，应该看到：`[Sentry] Initialized with DSN: https://abc...`
3. 触发一个错误（比如删除一个不存在的灵感）
4. 去 Sentry 后台（https://sentry.io）查看 Issues 页面

### 生产环境测试

1. 部署后访问你的 Vercel 网站
2. 触发一个错误
3. 几秒后，你会收到 Sentry 的邮件通知
4. 在 Sentry 后台查看详细错误信息

## 升级到完整版本（可选）

当前实现是简化版本。要使用完整的 Sentry 功能：

### 1. 安装 Sentry SDK

```bash
cd inspirations-farm-app
npm install @sentry/nextjs
```

### 2. 初始化配置

运行 Sentry 向导：

```bash
npx @sentry/wizard@latest -i nextjs
```

它会自动：
- 创建 `sentry.client.config.ts`
- 创建 `sentry.server.config.ts`
- 更新 `next.config.ts`

### 3. 替换我们的简化实现

打开 `src/lib/sentry.ts`，替换为：

```typescript
import * as Sentry from '@sentry/nextjs';

// 初始化在 sentry.client.config.ts 中完成

export function captureError(error: unknown, context?: Record<string, unknown>) {
  const err = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(err, { contexts: { custom: context } });
}

export function logMessage(message: string, level?: "info" | "warning" | "error") {
  Sentry.captureMessage(message, level);
}

export const sentry = Sentry;
```

### 4. 重新部署

```bash
npm run build
git add .
git commit -m "feat: upgrade to full Sentry SDK"
git push
```

## 常见问题

### Q: Sentry 免费吗？

A: 是的。个人项目每月：
- 5,000 个错误事件
- 10,000 个性能事件
- 1GB 附件存储
- 完全够用

### Q: 会泄露用户隐私吗？

A: 当前实现**不会收集**：
- 用户 PIN
- GitHub Token
- 灵感内容

只收集：
- 错误堆栈
- 浏览器/设备信息
- 错误发生的页面 URL

### Q: 不配置 DSN 会怎样？

A: 应用正常运行，错误只在控制台显示，不会上报。

### Q: 可以用其他监控工具吗？

A: 可以。替代品：
- **LogRocket**: 会话重放 + 错误追踪
- **Rollbar**: 类似 Sentry
- **Bugsnag**: 更专注移动端
- **自建**: ELK Stack / Grafana Loki

### Q: 如何关闭 Sentry？

A: 从 `.env.local` 和 Vercel 环境变量中删除 `NEXT_PUBLIC_SENTRY_DSN`，重新部署。

## 进阶功能

配置完整版本后，可以使用：

### 1. 用户追踪

```typescript
import { sentry } from '@/lib/sentry';

// 登录后设置用户
sentry.setUser({ id: 'user-123', email: 'user@example.com' });

// 退出时清除
sentry.setUser(null);
```

### 2. 性能监控

Sentry 会自动追踪：
- 页面加载时间
- API 请求耗时
- 组件渲染性能

在 Sentry 后台 Performance 页面查看。

### 3. Release 追踪

在 `package.json` 添加版本号：

```json
{
  "version": "1.0.2"
}
```

Sentry 会按版本分组错误，方便追踪哪个版本引入了 bug。

### 4. Source Maps

完整版 SDK 自动上传 source maps，让你看到原始 TypeScript 代码行号，而不是压缩后的 JavaScript。

## 需要帮助？

- Sentry 官方文档: https://docs.sentry.io/platforms/javascript/guides/nextjs/
- 社区: https://forum.sentry.io/
- 本项目 Issues: https://github.com/你的用户名/inspirations-farm/issues
