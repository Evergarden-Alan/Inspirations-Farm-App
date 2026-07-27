# Vercel 环境变量配置指南

## 方法 1: 网页控制台（推荐）

### 步骤 1: 登录 Vercel
1. 访问 https://vercel.com
2. 用 GitHub 账号登录
3. 进入你的项目（inspirations-farm-app）

### 步骤 2: 打开环境变量设置
1. 点击项目名称进入项目详情
2. 点击顶部菜单的 **Settings** 标签
3. 左侧菜单找到 **Environment Variables**

### 步骤 3: 添加 Sentry DSN
1. 在 **Key** 输入框填写：
   ```
   NEXT_PUBLIC_SENTRY_DSN
   ```

2. 在 **Value** 输入框粘贴你的 DSN：
   ```
   https://ccc6b031add43b018c62a32034fbdeeb@o4511807496388608.ingest.us.sentry.io/4511807507791877
   ```

3. **Environment** 选择：
   - ✅ Production
   - ✅ Preview
   - ✅ Development
   
   （建议全选，这样所有环境都能追踪错误）

4. 点击 **Save** 按钮

### 步骤 4: 重新部署
1. 回到项目主页（点击顶部的项目名）
2. 点击右上角的 **Redeploy** 按钮
3. 确认 **Redeploy**
4. 等待部署完成（约 1-2 分钟）

### 步骤 5: 验证配置
1. 部署完成后，访问你的网站
2. 打开浏览器控制台（F12）
3. 应该看到：`[Sentry] Initialized with DSN: https://ccc...`
4. 触发一个错误（比如在搜索框输入特殊字符）
5. 去 https://sentry.io 查看 Issues 页面

---

## 方法 2: 通过 Vercel CLI

### 安装 Vercel CLI
```bash
npm install -g vercel
```

### 登录
```bash
vercel login
```

### 添加环境变量
```bash
vercel env add NEXT_PUBLIC_SENTRY_DSN
```

然后按提示：
1. 粘贴 DSN 值
2. 选择环境：Production, Preview, Development（空格选择，回车确认）
3. 完成

### 重新部署
```bash
vercel --prod
```

---

## 方法 3: 通过 vercel.json（不推荐敏感信息）

⚠️ **警告**: 不要在 `vercel.json` 中存储密钥，会被提交到 Git！

仅用于非敏感的配置：
```json
{
  "env": {
    "NEXT_PUBLIC_SENTRY_DSN": "你的DSN"
  }
}
```

---

## 已配置的环境变量清单

以下是你需要在 Vercel 中配置的所有环境变量：

| 变量名 | 值（示例） | 必需？ | 说明 |
|--------|-----------|--------|------|
| `GITHUB_PAT` | `ghp_08Vk5h2...` | ✅ 是 | GitHub 访问令牌 |
| `REPO_OWNER` | `Evergarden-Alan` | ✅ 是 | GitHub 用户名 |
| `REPO_NAME` | `Note` | ✅ 是 | 仓库名 |
| `APP_PIN` | `1234` | ⚠️ 推荐 | 访问 PIN 码 |
| `CRON_SECRET` | `inspirations-farm-cron-secret-2026` | ✅ 是 | Cron 任务密钥 |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://ccc6b031...` | ⚪ 可选 | Sentry 错误追踪 |

### 检查清单

在 Vercel Settings → Environment Variables 页面，确保已配置：

- [x] `GITHUB_PAT`
- [x] `REPO_OWNER`
- [x] `REPO_NAME`
- [x] `APP_PIN`
- [x] `CRON_SECRET`
- [ ] `NEXT_PUBLIC_SENTRY_DSN` ← **今天新增**

---

## 常见问题

### Q: 配置后不生效？
A: 必须重新部署。环境变量只在构建时注入。

### Q: Production 和 Preview 有什么区别？
A: 
- **Production**: 主分支（main）部署的正式环境
- **Preview**: PR 或其他分支的预览环境
- **Development**: 本地开发（用 `vercel dev` 时）

### Q: NEXT_PUBLIC_ 前缀的作用？
A: Next.js 规定：
- `NEXT_PUBLIC_` 开头：打包到客户端 JS，浏览器可访问
- 无前缀：仅服务端可访问

Sentry DSN 需要在浏览器中初始化，所以必须加 `NEXT_PUBLIC_` 前缀。

### Q: 如何删除环境变量？
A: 
1. Settings → Environment Variables
2. 找到要删除的变量
3. 点击右侧的 **···** 菜单
4. 选择 **Remove**

### Q: 如何更新环境变量的值？
A: 
1. 删除旧的变量
2. 添加新的变量（同名）
3. 重新部署

或者直接点击变量名旁边的 **Edit** 图标。

### Q: 本地 .env.local 和 Vercel 环境变量有什么关系？
A: 完全独立：
- `.env.local`: 本地开发用（不提交到 Git）
- Vercel 环境变量: 线上部署用（存储在 Vercel 服务器）

两边需要分别配置相同的值。

---

## 安全提示

### ✅ 安全做法
- 通过 Vercel 控制台配置敏感信息
- 不要在代码中硬编码密钥
- 不要提交 `.env.local` 到 Git
- 定期轮换 `GITHUB_PAT` 和 `CRON_SECRET`

### ❌ 危险做法
- 在 `vercel.json` 中存储密钥
- 在代码注释中写密钥
- 在公开的 Issue/PR 中贴密钥
- 截图时包含环境变量页面

---

## 快速操作链接

**你的项目环境变量设置页面**:
```
https://vercel.com/[你的用户名]/inspirations-farm-app/settings/environment-variables
```

直接访问这个链接可以快速到达配置页面。

---

**配置完成后记得**:
1. ✅ 点击 Save
2. ✅ 点击 Redeploy
3. ✅ 等待部署完成
4. ✅ 访问网站验证
5. ✅ 去 Sentry 查看是否收到初始化信号
