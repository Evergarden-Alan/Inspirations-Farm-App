# 专注播放队列功能规划

> **状态：阶段 0B 已实现并部署；桌面 Chromium 通过，Android/iOS 真机验证待完成**
>
> **修正原因：Bilibili CDN Referer 校验阻断浏览器直连，改由个人服务器做受限、无落盘的音频中继**
>
> 配置路径：`Areas/FocusPlaylists/playlists.json`
>
> 媒体来源：Bilibili 公开 UGC 合集
>
> 阶段 0B 局域网服务器：`192.168.31.108`（仅用于同一局域网内的 HTTP 验证，不是生产地址）

## 一、产品目标

为专注模式增加尽量不吸引视觉注意力的 Bilibili 音频播放能力：

- 合集配置集中在独立设置页面。
- 专注界面不展示视频画面、封面、标题、序号或播放列表。
- 应用自动从用户配置的合集里随机挑选内容。
- 通过个人音频中继只播放 Bilibili 提供的独立音频流。
- 用户只面对上一首、播放/暂停、下一首三个控制。
- 音频服务于专注，不成为新的内容浏览入口。

## 二、首版范围

首版支持：

- `https://www.bilibili.com/video/BV.../` 视频链接。
- 从视频元数据识别 UP 主 UGC 合集。
- 以合集实体 ID 去重。
- 配置多个合集。
- 随机选择合集和视频。
- 播放公开、无 DRM 视频的独立 DASH 音频。
- 由个人服务器瞬时解析并流式转发音频字节。
- 浏览器以支持 Range 的普通 `<audio>` 播放中继地址。
- 恢复当前播放内容和进度。
- 保存播放历史，支持上一首和随机下一首。
- 音频播放完毕后自动换一首。
- 专注暂停与音频暂停联动。
- 收起专注弹窗后继续播放。

首版不支持：

- 不属于合集的单个视频。
- Bilibili 收藏夹、UP 主普通系列、番剧或课程。
- 私密、会员、付费、DRM 或地区限制内容。
- `b23.tv` 短链接。
- 用户登录 Bilibili。
- 下载或离线缓存音频文件。
- 浏览器直接连接 Bilibili CDN。
- 通过 Vercel 转发音频媒体字节。
- 在个人服务器落盘、长期缓存或转码音频。
- 保证锁屏或 PWA 进入系统后台后持续播放。
- 为 Bilibili 非公开接口提供永久稳定性保证。

## 三、设置页面

新增独立路由：

```text
/settings
```

在现有顶部导航右侧增加设置入口。当前设置页只包含“专注播放队列”，不加入其他应用设置。

页面提供：

- Playlist URL 输入框。
- “解析并加入”按钮。
- 解析、校验和保存状态。
- 已加入合集列表。
- 删除合集操作。
- 返回主页入口。

合集列表可以显示封面、合集标题、UP 主、视频数量、来源链接和添加时间。为保持配置最小化，首版不提供默认合集、权重、随机模式、循环模式、手动排序、启用开关或音质配置。所有已保存合集都会参与随机播放；暂时不想使用某个合集时通过删除处理。

## 四、长期配置

GitHub 中的固定路径：

```text
Areas/FocusPlaylists/playlists.json
```

配置结构：

```json
{
  "version": 1,
  "updatedAt": "2026-07-30T22:30:00+08:00",
  "playlists": [
    {
      "id": "bilibili:ugc-season:3458136",
      "provider": "bilibili",
      "kind": "ugc-season",
      "sourceUrl": "https://www.bilibili.com/video/BV1f53B6qEB6/",
      "sourceBvid": "BV1f53B6qEB6",
      "canonicalUrl": "https://space.bilibili.com/31467140/lists/3458136?type=season",
      "seasonId": "3458136",
      "ownerMid": "31467140",
      "ownerName": "Verasmelody",
      "title": "新古典主义·学习｜工作｜居家｜冥想",
      "cover": "https://archive.biliimg.com/...",
      "itemCount": 485,
      "addedAt": "2026-07-30T22:30:00+08:00",
      "metadataUpdatedAt": "2026-07-30T22:30:00+08:00"
    }
  ]
}
```

约束：

- 外部平台 ID 全部按字符串保存。
- `version` 用于未来结构迁移。
- 不保存 Cookie、账号、会员信息或 Bilibili 原始响应。
- 不保存完整音频地址或音频文件。
- 不把完整视频条目列表写入 GitHub。
- 配置没有发生变化时不产生 Git commit。
- 文件不存在时自动创建。
- 文件损坏或版本不支持时拒绝覆盖并返回明确错误。

同一个合集被再次提交时：

- 配置不存在：新增。
- 配置存在且元数据相同：直接返回已有记录，不写 GitHub。
- 配置存在但标题、封面或数量改变：更新元数据后写入。
- 不产生重复合集。

## 五、重复判断

不按用户输入 URL 或当前 BVID 去重，而是使用规范化合集 ID：

```text
bilibili:ugc-season:{seasonId}
```

示例：

```text
bilibili:ugc-season:3458136
```

同一合集中的不同视频链接都会解析成相同 ID。去重必须在 GitHub 写入前由服务端执行，防止多个设备同时添加造成重复。

重复提交采用幂等结果：

```json
{
  "ok": true,
  "created": false,
  "updated": false,
  "reason": "DUPLICATE_PLAYLIST",
  "playlist": {
    "id": "bilibili:ugc-season:3458136"
  }
}
```

界面提示“该合集已经在专注播放队列中”，不显示为错误。

## 六、合集解析流程

```text
用户提交视频 URL
    ↓
校验长度、协议、域名和路径
    ↓
提取 BVID
    ↓
请求 Bilibili view 元数据
    ↓
检查 data.ugc_season
    ↓
提取 seasonId、mid、标题、封面和数量
    ↓
生成规范化合集 ID
    ↓
读取 GitHub 最新配置并判断重复
    ↓
解析合集视频列表
    ↓
写入或更新 GitHub 配置
    ↓
将视频列表返回浏览器并写入 IndexedDB
```

列表提取策略：

1. 优先使用 `ugc_season.sections[].episodes`。
2. 将提取数量与 `ugc_season.ep_count` 对比。
3. 数量一致时直接使用。
4. 数量不完整时调用合集分页接口补齐。
5. 分页接口遇到 `-352` 或其他业务错误时，有限次数退避重试。服务端可使用明确、最小的请求头策略，但不能依赖伪造浏览器标识绕过风控。浏览器端 JavaScript 无法自行设置 `User-Agent`；`Referer`/`Origin` 也不是任意可控的请求头。
6. 重试后仍失败时不写入半成品配置，返回结构化错误。

## 七、视频列表缓存

完整视频列表属于可重新解析的派生数据，存入 IndexedDB：

```typescript
interface FocusPlaylistCache {
  id: string;
  schemaVersion: 1;
  fetchedAt: string;
  total: number;
  items: FocusPlaylistItem[];
}

interface FocusPlaylistItem {
  bvid: string;
  cid: string | null;
  sourceIndex: number;
  title: string;
  duration: number;
}
```

字段说明：

- `cid` 用于请求音频播放信息。
- `sourceIndex` 是视频在原合集中的位置，只用于内部恢复。
- 标题保存在缓存中，但不在专注界面显示。
- 不为每条视频保存封面，减少缓存体积。

缓存规则：

- 添加合集后立即写入。
- 专注时优先读取本地缓存。
- 缓存超过 24 小时后允许后台刷新。
- 后台刷新不会无条件修改 GitHub 配置。
- Bilibili 暂时不可用时继续使用旧缓存。
- 新设备没有缓存时按需重新解析。
- 删除合集时同步删除对应缓存。
- 如果选中的视频缺少 CID，播放前通过 BVID 补充。

## 八、应用接口

```text
GET    /api/focus-playlists
POST   /api/focus-playlists
DELETE /api/focus-playlists
GET    /api/focus-playlists/items?id=...
POST   /api/focus-playlists/audio-ticket
```

职责：

- `GET /api/focus-playlists`：读取 GitHub 长期配置。
- `POST /api/focus-playlists`：解析 URL、判断重复并添加。
- `DELETE /api/focus-playlists`：删除指定合集。
- `GET /api/focus-playlists/items`：为新设备或过期缓存重新获取合集条目。
- `POST /api/focus-playlists/audio-ticket`：确认请求条目属于已配置合集，并签发仅适用于该 BVID/CID 的短效中继 URL。

应用接口继续使用现有 PIN 鉴权。个人服务器另提供：

```text
GET  /healthz
GET  /v1/audio/{bvid}?cid=...&exp=...&sig=...
HEAD /v1/audio/{bvid}?cid=...&exp=...&sig=...
```

中继不接收用户提供的上游 URL，也不直接使用应用 PIN。它只接受由应用服务端 HMAC 签名的 BVID、CID 和过期时间。

结构化错误码包括：

```text
INVALID_URL
UNSUPPORTED_HOST
INVALID_BVID
INVALID_CID
NOT_IN_COLLECTION
DUPLICATE_PLAYLIST
PLAYLIST_NOT_FOUND
BILIBILI_UNAVAILABLE
BILIBILI_RATE_LIMITED
INVALID_UPSTREAM_RESPONSE
AUDIO_NOT_AVAILABLE
RELAY_UNAVAILABLE
INVALID_RELAY_TOKEN
EXPIRED_RELAY_TOKEN
CONFIG_CONFLICT
CONFIG_CORRUPTED
```

## 九、音频解析与播放

### 9.1 最终链路

浏览器直连 Bilibili CDN 已在阶段 0A 证实不可行。修正后的链路为：

```text
浏览器 <audio>
    ↓ 请求 audio-ticket
Vercel / Next.js 应用服务端
    ↓ 校验合集成员并签发短效 HMAC URL
个人音频中继
    ↓ 以固定 Bilibili 视频页 Referer 请求 playurl/CDN
Bilibili 公开 DASH 音频
```

职责边界：

- GitHub 仍是合集长期配置的唯一来源。
- 浏览器保存可重建的视频列表缓存和当前播放状态。
- Vercel 处理 PIN、配置、合集解析和中继票据签发，不承载媒体字节。
- 个人服务器只做受限音频解析与流式转发，不保存媒体文件。
- Bilibili 仍是动态内容来源，因此博主更新合集后可通过缓存刷新自动出现新内容。

### 9.2 中继票据

浏览器向 `POST /api/focus-playlists/audio-ticket` 提交：

```json
{
  "playlistId": "bilibili:ugc-season:3458136",
  "bvid": "BV1f53B6qEB6",
  "cid": "40377256216"
}
```

应用服务端必须确认 BVID/CID 属于该已配置合集，不能只信任浏览器的 IndexedDB。校验通过后，用仅存在于 Vercel 和个人服务器环境变量中的共享密钥，对版本、BVID、CID 和过期时间做 HMAC 签名。

返回结构示例：

```json
{
  "ok": true,
  "audio": {
    "url": "http://192.168.31.108:<port>/v1/audio/BV1f53B6qEB6?cid=40377256216&exp=...&sig=...",
    "mimeType": "audio/mp4",
    "expiresAt": 1785443400000
  }
}
```

约束：

- 签名只授权一个确定的 BVID/CID，不授权任意 Bilibili 内容或任意 URL。
- 默认有效期建议为 6 小时，以覆盖长音频、专注会话和稍后的 seek；实现时允许在安全范围内配置。
- 中继按规范化字段重新计算签名并使用恒定时间比较。
- 过期、篡改、缺字段或格式不合法的请求在连接上游前拒绝。
- 签名 URL 不写入 GitHub、localStorage、持久日志或错误上报；刷新恢复时重新申请。

### 9.3 中继解析与流式转发

示例视频已验证其 `dash.audio[]` 包含：

```text
mimeType: audio/mp4
codecs: mp4a.40.2
```

中继处理流程：

```text
校验方法、BVID、CID、exp 和 HMAC
    ↓
请求 Bilibili playurl，并使用对应视频页作为固定上游 Referer
    ↓
读取 dash.audio，过滤普通 AAC-LC 音轨
    ↓
按顺序尝试主 CDN 和备用 CDN
    ↓
将浏览器 Range 请求流式转发给 CDN
```

只选择公开的 `audio/mp4`、`mp4a.40.2` 音轨，暂不选择 Dolby、FLAC、特殊会员音质或需要登录的音轨。上游 Referer 由中继根据已校验 BVID 构造，绝不接受客户端传入 Referer 或上游地址。

Range 和流式语义必须完整保留：

- 只向上游转发经过 allowlist 的 `Range`、`If-Range` 等媒体请求头。
- 保留上游 `200`、`206`、`416` 状态码。
- 转发 `Content-Type`、`Content-Length`、`Content-Range`、`Accept-Ranges`、`ETag` 和 `Last-Modified` 等必要响应头。
- 使用流式 backpressure，不先读取完整音频到内存或磁盘。
- 浏览器断开时立即中止上游请求。
- 每个新的 Range 请求都可重新解析已过期的 Bilibili 签名地址。
- 只有在响应头尚未发送前才能切换备用 CDN；已发送部分字节后不拼接不同上游响应，由浏览器重新发起 Range 请求。
- 中继响应使用 `Cache-Control: private, no-store`，日志只记录状态、字节数、耗时、CDN host 和脱敏路径哈希。

### 9.4 局域网验证地址

`192.168.31.108` 是 RFC1918 私有 IPv4，只能用于阶段 0B 的同局域网验证：

```text
http://192.168.31.108:<port>
```

- 端口在部署前根据服务器现有服务布局确定，不能从 IP 推断。
- 开发应用本身也必须通过 HTTP 访问，例如桌面使用 `http://localhost:3000`，手机使用 `http://<开发主机局域网IP>:3000`。
- Android/iOS 访问的开发主机和 `192.168.31.108` 必须处于同一可互访局域网，防火墙仅开放测试所需端口。
- 阶段 0B 也使用完整 HMAC 票据，不因处于内网而跳过鉴权，以便验证真实链路。
- HTTPS 页面不能加载 HTTP 音频；因此该地址不能配置到生产 Vercel/PWA。

### 9.5 生产入口

生产环境需要独立域名和有效 HTTPS 证书，例如：

```text
https://media.example.com
```

推荐顺序：

1. 为个人服务器配置域名、AAAA 记录、动态 DNS（如果 IPv6 前缀会变化）、TLS 和最小化的 443 入站规则。
2. 从蜂窝网络验证目标设备确实具备 IPv6；只有公网 IPv6 的服务器无法服务仅有 IPv4 的客户端。
3. 如果客户端 IPv6 覆盖不足，选择 Tailscale HTTPS 或受控的双栈入口；所有播放设备都加入 Tailscale 时，私有方案更简单。
4. 若考虑第三方 Tunnel/CDN，先确认其媒体流量、Range 转发和服务条款，不默认把大流量音频交给免费隧道。

生产环境禁止使用裸 IPv6 HTTP URL，也不能把 `192.168.31.108` 暴露为应用配置。最终生产域名、TLS 终止方式和 IPv4 回退方案在阶段 0C 确认。

播放失败时：

1. 单个上游音轨失败：中继尝试备用 CDN 或重新解析一次地址。
2. 当前内容仍不可用：客户端随机切换下一首并显示低干扰提示。
3. 中继整体不可达或票据服务失败：暂停音频但保留专注计时，不反复随机切歌；显示“专注播放暂不可用”。
4. 用户恢复网络后可手动重试，刷新恢复仍指向原 BVID/CID 和播放位置。

## 十、随机播放策略

所有已配置合集组成播放池。为避免大合集垄断概率，使用两阶段均匀随机：

```text
随机选择一个合集
    ↓
从该合集中随机选择一个视频
```

因此每个合集被选中的概率相同，合集内部每个视频被选中的概率相同。

同一专注会话内保留最近播放历史：

- 避免立即重复当前视频。
- 尽量避免最近 20 首重复。
- 候选内容不足时逐步放宽去重限制。
- 所有候选耗尽时重新开始随机池。

随机函数单独实现为纯函数，并允许测试时注入确定性随机源。

## 十一、上一首、下一首与自动播放

最终语义：

- 下一首：选择新的随机视频。
- 上一首：返回本次专注真正播放过的上一首。
- 从历史回退后点击下一首：优先沿已有历史向前。
- 到达历史末尾后再次点击下一首：生成新的随机视频。
- 当前音频自然结束：自动执行下一首。

界面不显示标题，按钮使用图标，但必须提供：

```text
aria-label="上一首"
aria-label="播放"
aria-label="暂停"
aria-label="换一首"
```

## 十二、专注界面

没有配置合集时：

- 显示简短提示。
- 提供“前往设置”入口。
- 不阻止正常专注计时。

有配置合集时：

- 不显示标题、封面、合集名称、当前序号、总数或进度条。
- 不显示内容浏览列表。
- 不嵌入 Bilibili iframe。
- 不显示浏览器原生音频控件。
- 只提供三个自定义音频控制按钮。

```text
        ◀      ⏸      ▶
```

必要时可以增加非常轻微的播放状态指示，但不使用频繁动画、封面旋转或视觉频谱。

## 十三、音频生命周期

音频控制器的生命周期绑定专注会话，不绑定弹窗可见性：

- 开始专注：随机准备一个音频。
- 浏览器允许时尝试播放。
- 浏览器阻止自动播放时，等待用户点击中央播放按钮。
- 手动暂停音频：只暂停音频，不暂停计时。
- 暂停专注：音频同步暂停。
- 继续专注：如果音频此前正在播放，则尝试恢复。
- 收起弹窗：音频继续，计时继续。
- 重新打开：控制同一个音频实例。
- 结束或中止专注：停止并清理音频状态。
- 当前音频播放完毕：自动随机下一首。
- 导航离开当前页面：播放可能停止，但恢复信息保留。

实现上，`FocusAudioController` 挂载在 `DailyDashboard` 层，`FocusTimer` 只渲染控制按钮。弹窗关闭不会卸载音频元素，计时器通过共享控制器或回调同步暂停和恢复。

## 十四、刷新恢复

播放状态使用独立的 localStorage 键：

```text
farm_focus_player
```

不修改现有 `farm_focus_timer`。

```json
{
  "version": 1,
  "focusSessionId": "focus-...",
  "playlistId": "bilibili:ugc-season:3458136",
  "bvid": "BV1f53B6qEB6",
  "cid": "40377256216",
  "sourceIndex": 484,
  "currentTime": 1284.5,
  "historyCursor": 3,
  "history": [
    {
      "playlistId": "bilibili:ugc-season:3458136",
      "bvid": "BV...",
      "cid": "...",
      "sourceIndex": 12
    }
  ],
  "updatedAt": 1785421800000
}
```

持久化时机：

- 切换音频时。
- 播放或暂停时。
- 每 10 秒保存一次播放位置。
- `pagehide` 时。
- 页面可见性变化时。
- 收起专注弹窗时。

恢复流程：

```text
恢复专注 sessionId
    ↓
读取 farm_focus_player
    ↓
确认 sessionId 一致
    ↓
重新申请短效中继票据
    ↓
设置 currentTime
    ↓
等待用户手势继续播放
```

不保存短期音频 URL。如果恢复的视频已被删除或不可播放，则保留专注计时，清理失效条目并随机选择下一首，不用错误弹窗打断用户。历史最多保存最近 20 首。

## 十五、设置导航和应用壳层

设置页需要复用顶部品牌栏、主题切换、PIN 锁屏、Toast、统一背景和移动端安全区。可能需要将现有 `Home` 中的公共壳层拆出，避免设置页重复显示首页介绍区域和快速记录按钮。

首页顶部新增齿轮按钮：

```text
aria-label="打开设置"
```

设置页提供返回主页按钮，并保留完整键盘操作。

## 十六、安全和资源限制

URL 校验：

- 只接受 HTTP/HTTPS 输入，最终规范化为 HTTPS。
- 首版只允许 `www.bilibili.com` 视频路径。
- 拒绝伪造子域名、相似域名和非法路径。
- 限制 URL 最大长度并严格校验 BVID 格式。

应用服务端请求：

- 上游域名写死，不代理用户提供的任意 URL。
- 设置请求超时和上游响应大小限制。
- 校验响应结构。
- 对合集数量、分页数量和视频数量设置上限。
- `audio-ticket` 必须先校验条目属于已配置合集，再签发中继 URL。
- 共享签名密钥只存在于服务端环境变量，绝不进入 `NEXT_PUBLIC_*`、浏览器或 GitHub。
- 票据响应使用 `Cache-Control: no-store`。
- 不向 GitHub 写入短期签名地址。

个人中继：

- 只开放健康检查和固定的音频路由，不实现通用代理接口。
- 只接受 `GET`/`HEAD`、合法 BVID/CID、未过期 HMAC 和允许的查询字段。
- Bilibili API 与 CDN 主机使用 allowlist；不跟随到 allowlist 之外的重定向。
- 不转发客户端 Cookie、Authorization、Referer 或其他敏感请求头。
- 上游请求使用独立超时；浏览器断开后中止，限制并发连接、单 IP 速率和最大持续时间。
- 局域网阶段通过服务器防火墙限制测试端口；公网阶段只开放 HTTPS 入口。
- 日志不记录完整查询串、签名、中继 URL 或 Bilibili 签名 URL。
- HMAC 密钥支持轮换；泄露后可以只更换密钥，不影响 GitHub 配置。

媒体与合规边界：

- 不落盘、不长期缓存、不转码、不预下载音频文件。
- 不绕过登录、付费、DRM 或区域限制。
- 不通过 Vercel 转发媒体字节。
- 个人服务器只在播放期间瞬时转发当前公开音轨，并保留 Range 语义。
- 仅处理 Bilibili 当前公开返回的普通 AAC 音轨。
- 这是依赖非公开接口的个人集成，仍存在接口变更、平台条款和版权风险；若平台明确禁止该用法，应停止中继而不是继续绕过限制。

## 十七、预计代码范围

预计新增：

```text
src/app/settings/page.tsx
src/app/settings/focus-playlist-settings.tsx

src/app/api/focus-playlists/route.ts
src/app/api/focus-playlists/items/route.ts
src/app/api/focus-playlists/audio-ticket/route.ts

src/lib/bilibili.ts
src/lib/focus-playlists.ts
src/lib/focus-playlist-cache.ts
src/lib/focus-player-state.ts
src/lib/focus-shuffle.ts

src/app/focus-audio-player.tsx

tests/bilibili.test.mjs
tests/focus-playlists.test.mjs
tests/focus-player.test.mjs
```

阶段 0B 需要重建最小技术探针，建议路径：

```text
src/app/settings/focus-playlist-lab/page.tsx
src/app/settings/focus-playlist-lab/focus-playlist-lab.tsx
src/app/api/focus-playlists/audio-probe/route.ts
src/lib/bilibili.ts
```

个人中继作为独立部署单元，建议代码边界为：

```text
services/focus-audio-relay/
  src/
  tests/
  deployment/
```

目录名、运行语言、容器方式和反向代理需先适配 `192.168.31.108` 上现有服务布局，规划不预设必须使用 Docker、Node 或某一种代理。中继至少需要健康检查、HMAC 校验、playurl 解析、Range 流式转发、结构化脱敏日志和优雅终止。

预计修改：

```text
src/app/home.tsx
src/app/daily-dashboard.tsx
src/app/focus-timer.tsx
src/lib/github.ts
src/lib/github-client.ts
tests/focus-features.test.mjs
```

文件划分可在实现时根据 Next.js 16 当前路由规范微调。

应用环境变量：

```text
FOCUS_AUDIO_RELAY_BASE_URL
FOCUS_AUDIO_RELAY_SIGNING_SECRET
```

个人中继至少配置同一签名密钥及上游超时、并发和日志策略。局域网与生产使用不同的 `FOCUS_AUDIO_RELAY_BASE_URL`。

## 十八、测试计划

### 纯逻辑与服务端

- 从合法视频 URL 提取 BVID，并正确忽略 query 和 hash。
- 拒绝伪造域名、非法路径和非法 BVID。
- 正确识别 UGC 合集，不属于合集的视频被拒绝。
- 两个不同 BVID 指向同一 seasonId 时去重。
- 重复 POST 不重复写入。
- 配置文件不存在时创建，损坏时不覆盖。
- GitHub 409 时重新读取并重试。
- episodes 完整时不分页，不完整时分页补齐。
- Bilibili `-352` 和超时正确处理。
- 从 `dash.audio` 选择普通 AAC，不选择视频流、Dolby 或 FLAC。
- 只有已配置合集中的 BVID/CID 可以获得中继票据。
- HMAC 对合法请求通过，对篡改字段、错误签名和过期票据拒绝。
- 音频签名 URL 不进入持久状态或日志。
- 两阶段随机、近期防重复和确定性随机测试。
- 上一首返回真实历史，历史末尾的下一首生成随机内容。
- 播放状态损坏时安全清理，sessionId 不一致时不恢复旧播放。

### 个人中继

- 不存在可传入任意上游 URL 的代码路径。
- 无 `Range` 请求可返回可播放的 `200`；合法 Range 返回 `206` 和正确 `Content-Range`。
- 超出范围时保留上游 `416` 语义。
- 只转发允许的响应头，不泄露上游签名 URL。
- 上游主地址失败时在发送响应头前尝试备用 CDN。
- Bilibili 地址过期后重新解析，浏览器后续 seek 仍成功。
- 客户端断开时上游请求被取消，慢客户端触发 backpressure 而非整段缓冲。
- 测试期间服务器磁盘不出现媒体文件，内存不随完整文件长度增长。
- 并发、速率限制、超时和安全关闭符合预期。

### 界面与集成

- 设置页添加示例合集、重复提示和删除。
- 空状态跳转设置页。
- 专注模式只显示三个音频按钮。
- 不渲染 iframe、标题、封面或列表。
- 暂停专注同步暂停音频，手动暂停音频不暂停计时。
- 收起弹窗后音频继续，结束或中止后音频停止。
- 刷新后恢复当前内容和时间。
- 自动播放被浏览器阻止时提供播放按钮。
- 单条音频失败时自动换一首，中继整体不可用时不连续切歌。

### 实际设备

- Chromium 桌面版。
- Android Chrome。
- iOS Safari。
- iOS 主屏 PWA。
- 通过 `http://192.168.31.108:<port>` 播放 `.m4s` AAC 中继流。
- 每个环境至少连续播放 30 秒并成功 seek。
- 短效中继票据、Bilibili 地址过期后可重新签发或重新解析。
- 标签页切换、网络中断与恢复。
- 记录设备型号、OS、浏览器、`canPlayType`、中继响应状态、CDN host、deadline、媒体事件和错误。
- 阶段 0C 再从蜂窝网络通过生产 HTTPS 域名验证，不把局域网成功等同于公网可用。

### 工程验证

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## 十九、验收标准

使用示例：

```text
https://www.bilibili.com/video/BV1f53B6qEB6/
```

添加后应写入 `Areas/FocusPlaylists/playlists.json`，并解析为：

```text
id: bilibili:ugc-season:3458136
title: 新古典主义·学习｜工作｜居家｜冥想
itemCount: 485
```

完整验收：

- 首次添加成功，同合集其他视频不重复添加。
- 重复操作不产生无意义 Git commit。
- 换设备后能读取长期配置。
- 专注时自动准备随机音频。
- 专注界面不展示内容元数据。
- 浏览器只连接个人中继；中继实际只请求 `dash.audio`，不加载视频流。
- 中继 URL 必须是条目级短效签名 URL，不能改写为其他 BVID/CID。
- Range 请求返回 `206`，四个目标环境均连续播放至少 30 秒并成功 seek。
- 中继全程流式传输，不在 `192.168.31.108` 落盘或转码。
- 下一首随机，上一首回到实际历史。
- 音频结束后自动随机下一首。
- 暂停专注同步暂停音频，收起弹窗继续播放。
- 刷新后恢复同一 BVID 和播放位置。
- 浏览器要求用户手势时不报错并显示播放按钮。
- 结束或中止专注后彻底停止。
- 上游失败不会损坏 GitHub 配置或专注计时。
- 生产页面只使用有效 HTTPS 中继域名，不引用 `192.168.31.108` 或 HTTP 媒体地址。

## 二十、实施顺序

### 阶段 0A：浏览器直连验证（已完成，No-Go）

- 获取示例视频 DASH 音频地址。
- 验证 AAC-LC 编解码支持正常。
- 证实应用 Referer 或无 Referer 时 CDN 返回 403，Bilibili 视频页 Referer 时返回 206。
- 结论：浏览器直连不可用，详细证据保留在第二十三节。

### 阶段 0B：局域网个人中继（下一步）

- 在 `192.168.31.108` 部署最小中继，先只支持示例 BVID/CID。
- 使用 `http://192.168.31.108:<port>`，实现 HMAC、AAC 选择和无落盘 Range 转发。
- 重建最小探针，使其获取并播放中继 URL。
- 在桌面 Chromium、Android Chrome、iOS Safari 和 iOS 主屏 PWA 完成 30 秒播放及 seek 矩阵。
- 检查 206、`Content-Range`、客户端断开、上游刷新、备用 CDN 和服务器无媒体文件。

Go：四个环境均可播放至少 30 秒并成功 seek。条件 Go：iOS Safari 正常但主屏 PWA 不稳定，并明确不保证 PWA 后台播放。No-Go：任一主要环境无法稳定播放或 seek、中继必须缓存/转码/使用登录态，或无法安全限制为条目级代理。

### 阶段 0C：生产网络入口

- 选择生产域名和有效 HTTPS 证书。
- 配置公网 IPv6 的 AAAA/DDNS、防火墙和 TLS；或选择 Tailscale HTTPS/受控双栈入口。
- 从局域网外和蜂窝网络验证目标设备的 IPv6/IPv4 可达性、Range 与长连接。
- 确认 HTTPS 页面没有 mixed content，票据密钥、限流和日志脱敏有效。

阶段 0B 与 0C 都通过后再进入完整产品实现，不带着媒体链路风险继续堆设置页和播放 UI。

### 阶段 1：领域模型

- URL 和 Bilibili 元数据解析。
- 合集规范化 ID 和配置 Schema。
- 随机、历史及播放状态纯逻辑。
- 单元测试。

### 阶段 2：GitHub 配置

- 创建和读取 `Areas/FocusPlaylists/playlists.json`。
- 幂等添加、删除和 409 冲突重试。
- 配置校验。

### 阶段 3：应用接口与个人中继

- 合集设置、视频列表和 `audio-ticket` 接口。
- 个人中继的签名验证、上游解析、Range 流式转发和安全限制。
- 错误映射、超时、限流和脱敏日志。

### 阶段 4：设置页面

- 设置入口、URL 输入、解析和保存状态。
- 已添加合集、重复提示和删除确认。
- 移动端适配。

### 阶段 5：缓存与播放状态

- IndexedDB 视频列表。
- `farm_focus_player`、播放历史和播放位置恢复。
- 过期缓存刷新。

### 阶段 6：专注音频

- 常驻 `FocusAudioController` 和三按钮界面。
- 暂停联动、收起继续、自动下一首和失败回退。

### 阶段 7：综合验证

- 单元测试、UI 测试和实际 Bilibili 测试。
- Android、iOS 和 PWA 验证。
- Lint、类型检查和生产构建。
- 项目说明更新。

## 二十一、已确认的产品决策

- 路径为 `Areas/FocusPlaylists/playlists.json`。
- 设置页面只管理 Playlist URL。
- 首版只支持 UGC 合集。
- 同一 `seasonId` 视为重复。
- 重复提交幂等，不视为错误。
- 专注界面不显示视频信息。
- 不嵌入 Bilibili iframe，只播放独立音频。
- 每个合集具有相同随机权重。
- 下一首随机，上一首返回真实播放历史。
- 播放完成自动下一首。
- 刷新恢复同一内容及播放位置。
- 收起弹窗后继续播放。
- 暂停专注同步暂停音频。
- Vercel 不代理音频媒体。
- 个人服务器负责受限、瞬时、无落盘的音频中继。
- `192.168.31.108` 只用于局域网阶段 0B，不是生产地址。
- 生产环境必须使用独立域名和有效 HTTPS。
- 中继只接受条目级短效 HMAC URL，不能成为开放代理。
- 不缓存、下载或转码音频文件。
- 仍使用 Bilibili UGC 合集作为动态内容源，以保留博主更新带来的便利。

## 二十二、实施约束与修正

**平台约束**（2026-07-30 确认）：

- 应用侧 Route Handler 显式声明 `export const runtime = "nodejs"`，避免 Edge Runtime 与现有 GitHub/Bilibili 服务端逻辑不一致。
- `audio-ticket` 必须返回 `Cache-Control: no-store`，不能静态化短效签名 URL。
- 应用侧 view/合集分页请求使用独立超时并受总请求预算约束；中继侧 playurl、CDN 建连和空闲流分别设置超时，不能用一个短总超时截断长音频播放。
- 上游请求头采用 allowlist；不转发客户端 `Cookie`、`Authorization` 或敏感头；不在日志、响应或存储中记录完整签名 URL。
- 日志脱敏：只保留 CDN host、路径哈希和 deadline，绝不输出查询串签名。

**Bilibili 接口约束**：

- view、playurl、UGC season 接口不是 Bilibili 公开 API 合约，应按不稳定上游处理。
- `-352` 归类为 `BILIBILI_RISK_CONTROL`；有限次数退避重试后安全失败，不写入半成品配置。
- 不实施 WBI/风控绕过、Cookie 注入、登录态转发或 UA 伪装以追求成功率。
- 响应结构必须逐字段校验；HTTP 200 不代表业务成功（需检查 `code` 字段）。

**浏览器播放约束**：

- `<audio>` 默认不设置 `crossOrigin` 属性，按非 CORS 方式获取跨域资源。
- 只接受 `mimeType === "audio/mp4"` 且 `codecs` 精确包含 `mp4a.40.2` 的 AAC-LC 音轨。
- 不依赖 `fetch(url).blob()` 或 Web Audio 解码作为回退，避免 CORS、整段内存下载和 iOS 兼容性问题。
- `audio.play()` 的 `NotAllowedError` 是正常产品分支，需捕获并展示播放按钮。

**阶段 0 硬闸门**：

- 0A 已确认浏览器直连 No-Go，不再重复尝试通过前端设置 Referer、blob 或伪造请求头解决。
- 0B Go 标准：四个目标环境（Chromium 桌面、Android Chrome、iOS Safari、iOS 主屏 PWA）均可通过无 `crossOrigin` 的 `<audio>` 播放局域网中继 AAC-LC 至少 30 秒；seek 后恢复播放；Range、备用 CDN 和重新解析正常；服务器不落盘。
- 条件 Go：iOS Safari 正常，但主屏 PWA 不稳定；明确保持"不保证 PWA 后台播放"并记录支持限制。
- 0B No-Go：任一主要环境无法加载或 seek、必须缓存/转码/转发登录态、无法把中继限制为签名条目，或风控导致正常使用不可行。
- 0C Go 标准：生产 HTTPS 域名可从目标局域网和蜂窝网络访问，没有 mixed content；若常用网络存在 IPv4-only 场景，IPv4 回退或私网接入策略已明确。

**实施修正**：

- 不在 `playlists.json` 中添加 `_lastOp` 等调试字段，保持已批准结构。
- 测试继续使用现有 `node:test`；不提前引入 Jest 或 Playwright。
- 阶段 0B/0C 必须在真实设备上验证 Bilibili API、中继流、Range 和跨浏览器播放，失败则不进入阶段 1。

---

## 二十三、实施教训（2026-07-30）

### **阶段 0A 验证结果：浏览器直连 No-Go**

**执行时间**：2026-07-30

**验证环境**：Arch Linux + Chromium 150.0.7871.186

**结论**：浏览器直连路线 No-Go；保留证据并转入阶段 0B 个人中继验证

### **失败根因：Bilibili CDN Referer 校验**

原规划假设"浏览器可直接播放 Bilibili CDN 音频流"，但桌面实测发现：

1. **技术现实**：
   - Bilibili CDN 要求请求头 `Referer` 为 Bilibili 视频页面
   - 浏览器 `<audio>` 元素发起的媒体请求自动携带应用自身的 Referer
   - 普通网页无法伪造 `<audio>` 的 Referer（浏览器安全限制）
   - CDN 返回 403 HTML 错误页面而非音频流
   - Chromium 将其报告为 `MediaError 4: Format error`

2. **验证证据**：
   - `canPlayType('audio/mp4; codecs="mp4a.40.2"')` → `"probably"`（编解码支持正常）
   - 无 Referer 或应用 Referer → HTTP 403 HTML
   - Bilibili 视频页 Referer → HTTP 206 正确媒体数据（`ftyp` 开头的 MP4）
   - 最终状态：`readyState=0`、`networkState=3`、`NotSupportedError: The element has no supported sources`

3. **不可行性**：
   原规划的两个核心约束无法同时满足：
   - 浏览器直接播放 Bilibili CDN 音频
   - Vercel 不代理媒体内容

### **评估的替代方案**

#### **方案 1：Bilibili 官方 iframe 播放器**
- ✅ 技术可行、无 Referer 问题
- ❌ **严重违反产品目标**：
  - 无法实现"极简三按钮"（播放器有完整控制栏）
  - 无法隐藏内容元数据（播放器会显示标题）
  - 仍会加载视频流（带宽消耗 3-10 倍）
  - 播放器 API 未公开文档，随时可能失效
  - 每次切歌需重载 iframe，延迟 2-5 秒
- **结论**：技术降级方案，产品体验与原目标相差太大

#### **方案 2：自有或授权音频源**
- ✅ 完整保留原规划的极简纯音频体验
- ✅ 无 Referer 限制、无非公开 API 依赖
- ❌ 放弃 Bilibili 生态
- ❌ 需重新选择内容源（SoundCloud / Internet Archive / 自建 CDN）
- **结论**：如果产品目标是"专注时的背景音频"而非"Bilibili 内容消费"，这是更可持续路径

#### **方案 3：个人服务器受限音频中继**
- ✅ 保留 Bilibili + 纯音频
- ✅ 复用用户已有的 7×24 服务器，避免 Vercel 流量配额和 Serverless 长连接限制
- ✅ 能正确控制上游 Referer、Range、地址刷新和备用 CDN
- ❌ 高复杂度（Range 请求、流式代理、超时处理）
- ❌ 仍有家庭上行、公网可达性、运维和平台条款风险
- **结论**：采用，但必须做成条目级签名、无落盘、无登录态的窄中继，并通过阶段 0B/0C 硬闸门

### **决策与后续行动**

**最终选择**：方案 3（个人服务器受限音频中继）

**理由**：
- 原规划的产品目标（`一、产品目标`）明确要求"极简三按钮"、"不展示内容元数据"、"音频服务于专注"
- 方案 1（iframe）虽然技术可行，但产品体验降级严重，违反核心目标
- 用户追更的 Bilibili 合集会由博主持续更新，继续使用该来源能避免手工同步内容
- `192.168.31.108` 已在同一局域网内 7×24 运行服务，适合先低成本验证流式中继
- 把媒体流量放在个人服务器而非 Vercel，可以保留产品体验并隔离 Serverless 带宽风险

**后续工作**：
1. 在 `192.168.31.108` 上确定可用端口和部署方式
2. 实现只支持示例 BVID/CID 的最小 HMAC + Range 中继
3. 重建最小探针并执行阶段 0B 四环境验证
4. 确定生产域名、HTTPS、公网 IPv6 和 IPv4 回退/私网接入策略
5. 通过阶段 0C 后继续执行阶段 1-7

### **关键教训**

1. **提前验证外部依赖的核心假设**：
   - 原规划假设"Bilibili CDN 允许跨站直连"，但未在规划阶段验证
   - 应在详细设计前先用最小探针验证关键技术路径
   - 阶段 0 设为硬闸门是正确的，但应更早执行

2. **产品目标优先于技术便利性**：
   - 当技术路径与产品目标冲突时，优先保留产品目标
   - iframe 方案虽然"能用"，但违反了"极简"、"不显示内容"的核心承诺
   - 宁可更换数据源，也不降低用户体验

3. **非公开 API 的风险**：
   - Bilibili 接口（view / playurl / season）不是官方开放 API
   - CDN Referer 校验是平台风控策略，不是文档化的稳定行为
   - 依赖非公开 API 时，应假设其随时可能变化或收紧

4. **区分 Vercel 代理与个人窄中继**：
   - Vercel 继续不承载媒体，避免 Serverless 带宽、执行时长和成本风险
   - 个人中继只接受签名 BVID/CID，并以流式方式瞬时转发，不等同于开放代理或媒体仓库
   - 中继仍会引入稳定性和平台条款风险，因此 Range、无落盘、限流和停止条件必须先验证

### **可复用的验证页面**

本次实施中创建的阶段 0A 技术探针已删除，当前工作区和 Git 历史均没有可直接恢复的源码。其验证方法仍可作为阶段 0B 重建探针的规格：
- 固定示例音频地址 → 获取元数据
- 检测 `canPlayType` 兼容性
- 记录媒体事件（loadstart / error / stalled）
- 验证 Range 请求和 seek
- 脱敏日志（CDN host / deadline / 不记录签名）

阶段 0B 可沿用 `src/lib/bilibili.ts`、`src/app/api/focus-playlists/audio-probe/route.ts`、`src/app/settings/focus-playlist-lab/` 这些建议路径重新创建。正式功能稳定后再决定是否保留实验页。

---

## 二十四、部署信息

阶段 0B 已确认：

- SSH 用户为 `tv`，服务器为 Debian 13。
- 服务器已有 Docker、Nginx Proxy Manager 和公网 IPv6；宿主机普通 user service 端口受防火墙限制。
- 中继以无写入卷的只读 Docker 容器运行，容器名为 `focus-audio-relay`。
- 部署目录为 `/home/tv/services/focus-audio-relay`。
- 阶段 0B 只绑定 `192.168.31.108:8787`，不在公网 IPv6 上发布 HTTP 端口。
- 容器设置自动重启、无新增 capability、`no-new-privileges`、256 MiB 内存、1 CPU 和 64 PID 上限。

阶段 0C 仍待确认：

- 服务器公网 IPv6 是否固定；若会变化，采用哪一种 DDNS。
- 生产中继域名及 TLS 证书终止位置。
- 手机常用网络是否稳定提供 IPv6；不足时选择 Tailscale HTTPS 还是受控双栈入口。
- 家庭上行带宽、预期同时播放数和可接受的限流阈值。

阶段 0C 的信息在配置生产 HTTPS 入口前确认。

---

## 二十五、阶段 0B 实施记录（2026-07-31）

已实现：

- 独立 Node.js 音频中继：HMAC、BVID/CID 校验、AAC-LC 选择、CDN allowlist、Range、备用 CDN、backpressure、客户端断开取消、限流和脱敏日志。
- Docker 只读部署及健康检查，局域网地址为 `http://192.168.31.108:8787`。
- Next.js 固定示例票据接口 `/api/focus-playlists/audio-probe`，使用现有 PIN 鉴权和 `Cache-Control: no-store`。
- 验证页 `/settings/focus-playlist-lab`，提供 `canPlayType`、脱敏诊断、手动播放、seek 和媒体事件日志。
- 本地配置同步脚本和脱敏端到端 Range 验证脚本。

自动化验证结果：

- 中继测试 12 项通过；应用测试 25 项通过。
- ESLint、TypeScript 和 Next.js 生产构建通过。
- Bilibili 示例音轨返回 `audio/mp4` / `mp4a.40.2`，解析时 CDN 签名 deadline 距今约 7200 秒。
- 首段 `bytes=0-1023` 返回 `206`，`Content-Range: bytes 0-1023/60872331`，前缀为 MP4 `ftyp`。
- seek 段 `bytes=1048576-1049599` 返回 `206`，字节数和 `Content-Range` 正确。
- 容器健康状态为 healthy、只读根文件系统、0 个挂载卷；浏览器结束后上游流收到取消信号。

桌面实际播放证据：

- 设备：AtomMan X Series；系统：Arch Linux 7.1.5；浏览器：Chromium 150.0.7871.186。
- `canPlayType('audio/mp4; codecs="mp4a.40.2"')` 返回 `probably`。
- 连续播放至 31.3 秒，无媒体错误，`readyState=4`。
- 从约 31 秒 seek 到约 91 秒，出现 `seeking → waiting → seeked → canplay → playing`，继续播放至 96.2 秒。
- 页面文本未暴露 `sig=`；移动视口 390×844 无横向溢出。

尚未满足完整 Go：

- 当前主机没有 `adb`，也没有可由 `idevice_id` 识别的 iOS 设备。
- 移动视口模拟不计作 Android Chrome、iOS Safari 或 iOS 主屏 PWA 真机证据。
- 阶段 0B 保持“待真机验证”，通过三类移动环境后才能进入阶段 0C/阶段 1。
