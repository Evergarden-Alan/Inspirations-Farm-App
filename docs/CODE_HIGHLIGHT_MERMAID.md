# 代码高亮 + Mermaid 图表使用指南

## 功能概述

Inspirations Farm 现在支持：
- ✅ **代码语法高亮** — 15+ 编程语言自动着色
- ✅ **Mermaid 图表** — 流程图、时序图、甘特图等
- ✅ **暗色模式适配** — 自动切换高亮主题
- ✅ **移动端优化** — 代码块横向滚动

---

## 代码高亮

### 支持的语言

**主流语言**:
- JavaScript / TypeScript
- Python
- Rust
- Go
- Java
- C++

**其他语言**:
- Bash / Shell
- JSON / YAML
- SQL
- CSS / HTML
- Markdown

### 使用方法

在灵感内容中使用三个反引号 + 语言名称：

````markdown
```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
}

greet('World');
```
````

**效果**: JavaScript 代码会自动高亮，关键字着色

### 示例

#### JavaScript
````markdown
```javascript
const fetchUser = async (id) => {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
};
```
````

#### TypeScript
````markdown
```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```
````

#### Python
````markdown
```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
```
````

#### Rust
````markdown
```rust
fn main() {
    let numbers = vec![1, 2, 3, 4, 5];
    let sum: i32 = numbers.iter().sum();
    println!("Sum: {}", sum);
}
```
````

#### Bash
````markdown
```bash
#!/bin/bash
for file in *.txt; do
  echo "Processing $file"
  cat "$file" | wc -l
done
```
````

#### SQL
````markdown
```sql
SELECT u.name, COUNT(p.id) as post_count
FROM users u
LEFT JOIN posts p ON u.id = p.user_id
GROUP BY u.id
HAVING post_count > 10;
```
````

---

## Mermaid 图表

### 支持的图表类型

1. **Flowchart** — 流程图
2. **Sequence** — 时序图
3. **Gantt** — 甘特图
4. **Class** — 类图
5. **State** — 状态图
6. **Pie** — 饼图
7. **Git** — Git 图

### 使用方法

使用三个反引号 + `mermaid`：

````markdown
```mermaid
graph TD
    A[开始] --> B{条件判断}
    B -->|是| C[执行操作]
    B -->|否| D[跳过]
```
````

---

## Mermaid 示例

### 1. 流程图 (Flowchart)

````markdown
```mermaid
graph TD
    A[用户登录] --> B{验证成功?}
    B -->|是| C[显示主页]
    B -->|否| D[显示错误]
    C --> E[加载数据]
    E --> F[渲染界面]
    D --> G[返回登录]
```
````

**方向控制**:
- `graph TD` — 从上到下 (Top Down)
- `graph LR` — 从左到右 (Left Right)
- `graph BT` — 从下到上 (Bottom Top)
- `graph RL` — 从右到左 (Right Left)

### 2. 时序图 (Sequence Diagram)

````markdown
```mermaid
sequenceDiagram
    participant 用户
    participant 前端
    participant API
    participant 数据库

    用户->>前端: 点击按钮
    前端->>API: POST /api/inspirations
    API->>数据库: 插入记录
    数据库-->>API: 返回 ID
    API-->>前端: 返回成功
    前端-->>用户: 显示提示
```
````

**箭头类型**:
- `->` — 实线箭头
- `-->` — 虚线箭头
- `->>` — 实线箭头（带箭头）
- `-->>` — 虚线箭头（带箭头）

### 3. 甘特图 (Gantt Chart)

````markdown
```mermaid
gantt
    title 项目开发计划
    dateFormat  YYYY-MM-DD
    section 需求分析
    需求调研           :a1, 2026-08-01, 7d
    需求文档           :a2, after a1, 5d
    section 开发
    前端开发           :b1, 2026-08-13, 14d
    后端开发           :b2, 2026-08-13, 14d
    section 测试
    单元测试           :c1, after b1, 5d
    集成测试           :c2, after c1, 3d
```
````

### 4. 类图 (Class Diagram)

````markdown
```mermaid
classDiagram
    class User {
        +String id
        +String name
        +String email
        +login()
        +logout()
    }
    class Post {
        +String id
        +String title
        +String content
        +publish()
    }
    User "1" --> "N" Post : writes
```
````

### 5. 状态图 (State Diagram)

````markdown
```mermaid
stateDiagram-v2
    [*] --> 草稿
    草稿 --> 审核中 : 提交
    审核中 --> 已发布 : 通过
    审核中 --> 草稿 : 驳回
    已发布 --> 已归档 : 归档
    已归档 --> [*]
```
````

### 6. 饼图 (Pie Chart)

````markdown
```mermaid
pie title 编程语言使用占比
    "JavaScript" : 35
    "Python" : 25
    "Rust" : 20
    "Go" : 15
    "其他" : 5
```
````

### 7. Git 图

````markdown
```mermaid
gitGraph
    commit
    commit
    branch develop
    checkout develop
    commit
    commit
    checkout main
    merge develop
    commit
```
````

---

## 实际应用场景

### 学习笔记

````markdown
今天学习了 Rust 的所有权系统：

```rust
fn main() {
    let s1 = String::from("hello");
    let s2 = s1; // s1 被移动到 s2
    // println!("{}", s1); // 错误！s1 已失效
    println!("{}", s2); // OK
}
```

**关键概念**:
- 每个值都有一个所有者
- 同一时间只能有一个所有者
- 所有者离开作用域，值被丢弃
````

### 技术方案设计

````markdown
## API 请求流程

```mermaid
sequenceDiagram
    participant Client
    participant Gateway
    participant AuthService
    participant DataService

    Client->>Gateway: 发送请求
    Gateway->>AuthService: 验证 Token
    AuthService-->>Gateway: 返回用户信息
    Gateway->>DataService: 查询数据
    DataService-->>Gateway: 返回数据
    Gateway-->>Client: 返回响应
```

**性能优化**:
1. Gateway 缓存用户信息（5 分钟）
2. DataService 使用 Redis 缓存（1 小时）
````

### 项目规划

````markdown
## Q3 开发计划

```mermaid
gantt
    title Inspirations Farm Q3 路线图
    dateFormat  YYYY-MM-DD
    section 核心功能
    代码高亮           :done, 2026-07-27, 1d
    Mermaid 支持       :done, 2026-07-27, 1d
    虚拟滚动           :active, 2026-08-01, 7d
    section 增强功能
    任务优先级         :2026-08-08, 5d
    离线模式           :2026-08-15, 10d
```
````

### 算法学习

````markdown
## 二叉树遍历

```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def inorder_traversal(root):
    """中序遍历：左-根-右"""
    if not root:
        return []
    return (inorder_traversal(root.left) + 
            [root.val] + 
            inorder_traversal(root.right))
```

**时间复杂度**: O(n)  
**空间复杂度**: O(n)
````

---

## 样式说明

### 亮色模式
- 主题: GitHub
- 背景: 白色
- 代码: 黑色

### 暗色模式
- 主题: GitHub Dark
- 背景: 深灰色
- 代码: 浅色

### 自定义样式
代码块自动适配 Farm 主题：
- 边框: `var(--farm-line)`
- 背景: `var(--farm-paper)`
- 文字: `var(--farm-ink)`

---

## 常见问题

### Q: 代码块不显示高亮？
A: 确保在三个反引号后指定语言名称，如 ` ```javascript `

### Q: Mermaid 图表不显示？
A: 
1. 检查语法是否正确（访问 [Mermaid 官方文档](https://mermaid.js.org/)）
2. 刷新页面重试
3. 查看浏览器控制台错误信息

### Q: 支持哪些语言别名？
A: 常见别名：
- `js` → `javascript`
- `ts` → `typescript`
- `html` → `xml`

### Q: 代码块太长怎么办？
A: 代码块会自动横向滚动，移动端可以左右滑动

### Q: 如何在 Mermaid 中使用中文？
A: 直接使用中文即可，如示例所示

### Q: Mermaid 图表可以导出吗？
A: 暂不支持，可以截图保存

---

## 性能说明

### 包体积增加
- highlight.js: ~80KB (gzipped, 15 languages)
- Mermaid: ~200KB (gzipped)
- 总增加: ~280KB

### 渲染性能
- 代码高亮: <10ms per block
- Mermaid 图表: ~50-200ms per diagram

### 优化建议
1. 避免单个灵感中使用过多图表（建议 <5 个）
2. 复杂图表分拆为多个小图表
3. 代码块保持在 500 行以内

---

## 更新日志

### 2026-07-27
- ✅ 新增代码高亮支持（15+ 语言）
- ✅ 新增 Mermaid 图表支持（7 种图表类型）
- ✅ 自动适配亮色/暗色模式
- ✅ 移动端优化

---

**立即试用**：在灵感内容中添加代码块或 Mermaid 图表，体验全新的内容表达力！
