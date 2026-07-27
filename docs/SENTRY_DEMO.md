# Sentry 实际作用演示

## Sentry 能帮你做什么？

### 场景 1: 用户遇到 Bug，你立即知道

**没有 Sentry 之前**:
```
用户: "我点删除按钮，页面就白屏了"
你: "能截图吗？用的什么浏览器？"
用户: "Chrome，但我已经刷新了，现在又好了"
你: "...那我不知道哪里出错了"
```

**有了 Sentry 之后**:
```
[邮件通知] TypeError: Cannot read property 'sha' of undefined

你打开 Sentry 看到：
- 错误位置: inspiration-feed.tsx 第 245 行
- 用户设备: Chrome 120, Windows 11
- 操作路径: 点击标签 "rust" → 点击删除按钮 → 崩溃
- 堆栈跟踪: handleDelete() → deleteFile() → sha 为 undefined

你马上定位：删除功能没检查 sha 是否存在
5 分钟修复，10 分钟部署，问题解决
```

---

## 实际例子

### 例子 1: 网络错误追踪

**发生的错误**:
```javascript
// 用户在地铁里，网络不稳定
fetch('/api/github')  // 超时 3 次后失败
```

**Sentry 记录**:
```
Error: Network error after 3 retries
Context:
  - url: /api/github
  - attempt: 2
  - maxRetries: 2
  - userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)
  - timestamp: 2026-07-27 14:32:15
```

**你的收获**:
- 发现移动端用户经常遇到网络错误
- 决定增加重试次数或离线模式
- 数据驱动决策，不是瞎猜

---

### 例子 2: React 组件崩溃

**发生的错误**:
```javascript
// daily-dashboard.tsx
const tasks = state.tasks.map(t => t.title)
// 但 state.tasks 是 undefined！
```

**Sentry 记录**:
```
TypeError: Cannot read property 'map' of undefined
Component Stack:
  at DailyDashboard (daily-dashboard.tsx:89)
  at Home (home.tsx:52)
  at RootLayout (layout.tsx:45)

User Action Before Crash:
  1. 打开应用
  2. 输入 PIN
  3. 崩溃
```

**你的收获**:
- 发现首次加载时 state.tasks 未初始化
- 添加默认值: `state.tasks?.map(...) || []`
- 避免其他用户遇到相同问题

---

### 例子 3: 生产环境独有的 Bug

**发生的错误**:
```javascript
// 本地测试正常，线上突然报错
JSON.parse(localStorage.getItem('theme'))
// localStorage 被用户浏览器插件污染！
```

**Sentry 记录**:
```
SyntaxError: Unexpected token in JSON at position 0
Extra Data:
  - rawValue: "[object Object]"
  - browser: Chrome 120 with extension "Dark Reader"
```

**你的收获**:
- 发现是浏览器插件导致的
- 添加 try-catch 和默认值
- 本地永远测不出来，只有真实用户才会遇到

---

## 实际操作：如何使用 Sentry

### 1. 查看错误列表

访问 https://sentry.io → 登录 → 选择你的项目

你会看到：
```
[Issues 页面]
┌─────────────────────────────────────────┐
│ TypeError: Cannot read property 'sha'   │
│ 10 次，最后发生 2 分钟前                │
│ Chrome 120, Windows 11                  │
└─────────────────────────────────────────┘
│ Network error after 3 retries           │
│ 3 次，最后发生 1 小时前                 │
│ Safari, iPhone 15                       │
└─────────────────────────────────────────┘
```

### 2. 点击错误查看详情

```
[错误详情页]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TypeError: Cannot read property 'sha' of undefined

at handleDelete (inspiration-feed.tsx:245:12)
at onClick (inspiration-feed.tsx:678:5)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Tags]
environment: production
browser: Chrome 120
os: Windows 11
url: /

[Breadcrumbs] (用户操作路径)
14:32:10 - 打开页面
14:32:15 - 点击标签 "rust"
14:32:18 - 点击删除按钮
14:32:18 - 💥 崩溃

[Additional Data]
componentStack: at InspirationFeed...
errorBoundary: true
```

### 3. 设置邮件通知

Settings → Alerts → 创建规则：
- 当错误首次出现时 → 发邮件
- 当错误超过 10 次/小时 → 发 Slack 消息

---

## 真实案例：你可能会遇到的错误

### Bug #1: 时区问题
```
用户反馈："为什么我 18:05 还是亮色模式？"

Sentry 显示：
- 用户时区: GMT+9 (日本)
- 服务器时区: GMT+8 (北京)
- getAutoTheme() 使用了 new Date().getHours()
  → 在客户端执行，用的是日本时间 19:05
  → 应该是暗色，但代码判断错误

修复：使用 Intl.DateTimeFormat 获取用户本地时间
```

### Bug #2: 老旧浏览器
```
Sentry 记录：
SyntaxError: Unexpected token '?'
Browser: Chrome 78 (太老了)

原因：代码用了 optional chaining (?.)
Chrome 78 不支持

修复：配置 Babel 转译，或提示用户升级浏览器
```

### Bug #3: 移动端触摸问题
```
Sentry 记录：
多次触发 handlePlant()
Device: iPhone 12, iOS 16

原因：双击"种下灵感"按钮导致创建了两条重复灵感

修复：添加防抖，或 disabled={submitting}
```

---

## Sentry 的统计功能

### 错误趋势图
```
[过去 7 天错误趋势]
40 │             ╭╮
30 │            ╭╯╰╮
20 │         ╭──╯  ╰─╮
10 │   ╭─────╯       ╰───
 0 └────────────────────────
   周一  周二  周三  周四  周五
   
发现：周三错误暴增
→ 检查 GitHub commits，发现周三上线了新功能
→ 回滚或热修复
```

### 浏览器分布
```
Chrome:  85% | ████████████████████
Safari:  10% | ███
Firefox:  3% | █
Edge:     2% | █

决策：优先支持 Chrome 和 Safari
```

### 错误频率排行
```
1. Network error           43 次  🔥 高优先级
2. TypeError sha undefined 12 次  ⚠️  中优先级  
3. JSON parse error         3 次  ℹ️  低优先级
```

---

## 实际演示：触发一个测试错误

### 方法 1: 在 Sentry 测试页面
访问你的网站，打开控制台，运行：
```javascript
throw new Error("Sentry 测试错误 - 可以忽略");
```

几秒后去 Sentry 后台，应该能看到这个错误。

### 方法 2: 触发真实错误
1. 创建一个灵感
2. 快速连续点击"删除"按钮 10 次
3. 如果有 race condition bug，会被 Sentry 捕获

### 方法 3: 网络错误模拟
1. 打开浏览器 DevTools → Network
2. 选择 "Offline"
3. 尝试创建灵感
4. Sentry 会记录网络错误

---

## 总结

### Sentry 让你知道：
✅ **什么** 错误发生了（堆栈跟踪）  
✅ **何时** 发生的（时间戳）  
✅ **谁** 遇到的（设备、浏览器）  
✅ **哪里** 出错的（代码行号）  
✅ **为什么** 出错（用户操作路径）  

### 没有 Sentry：
❌ 用户投诉，你不知道原因  
❌ Bug 只在生产环境出现，本地无法重现  
❌ 不知道哪个功能最容易出错  
❌ 不知道用户设备/浏览器分布  

### 有了 Sentry：
✅ 错误自动上报，邮件通知  
✅ 详细的上下文和堆栈跟踪  
✅ 数据驱动的 bug 修复优先级  
✅ 生产环境问题快速定位  

---

## 下一步

1. **等待真实错误** — 部署后，如果有用户遇到问题，你会收到通知
2. **主动测试** — 在网站上尝试各种操作，看 Sentry 是否记录
3. **查看 Dashboard** — 每周看一次，了解应用健康状况

---

**现在 Sentry 已经在后台默默工作，守护你的应用了！** 🛡️
