# Focus Audio Relay

阶段 0B 使用的受限 Bilibili AAC 音频中继。它只接受条目级 HMAC URL，保留 Range 语义并流式转发，不下载、落盘、缓存或转码媒体。

## 本机启动

在仓库根目录已有 `inspirations-farm-app/.env.local` 时，可一次生成并同步本地配置：

```bash
npm run configure:stage0b
npm run start:env
```

脚本只输出脱敏结果；生成的密钥分别写入应用 `.env.local` 与中继 `.env`，两者都被 Git 忽略。若需要手动配置，则复制 `.env.example` 并使用 `openssl rand -hex 32` 生成共享密钥。

默认监听 `0.0.0.0:8787`。确认健康检查：

```bash
curl http://127.0.0.1:8787/healthz
```

局域网部署后使用 `http://192.168.31.108:8787`。端口可通过 `FOCUS_RELAY_PORT` 调整；服务器防火墙应仅允许阶段 0B 所在局域网访问。

## 测试

```bash
npm test
```

服务没有运行时依赖，要求 Node.js 20 或更高版本。生产阶段必须置于有效 HTTPS 入口后，不能让 Vercel 页面加载局域网 HTTP 地址。

## 生产 HTTPS 入口

生产入口复用 Nginx Proxy Manager 已有的 `media.alanevergarden.xyz` 证书，并以独立路径发布：

```text
https://media.alanevergarden.xyz/focus-audio
```

将 `deployment/nginx-proxy-manager-server-proxy.conf` 部署为 NPM 数据卷中的
`/data/nginx/custom/server_proxy.conf`，执行 `nginx -t` 后 reload。配置只允许
`media.alanevergarden.xyz` 的 `GET`/`HEAD` 请求，关闭代理缓冲，并保留 Range 请求头。
应用生产环境的 `FOCUS_AUDIO_RELAY_BASE_URL` 必须设置为上述 HTTPS 路径。
NPM 和中继容器必须同时连接 `gateway_default` 网络，中继使用
`focus-audio-relay` 网络别名；局域网调试端口仍单独绑定到 `192.168.31.108:8787`。

## `192.168.31.108` 部署

当前服务器的宿主机防火墙不会放行普通 user service 端口，但已有 Docker 端口映射可从局域网访问。因此阶段 0B 默认使用只读容器：

```bash
docker build -t inspirations-farm/focus-audio-relay:0.1.0 .
docker run -d \
  --name focus-audio-relay \
  --network gateway_default \
  --restart unless-stopped \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --memory 256m \
  --cpus 1 \
  --pids-limit 64 \
  --env-file .env \
  -p 192.168.31.108:8787:8787 \
  inspirations-farm/focus-audio-relay:0.1.0
```

容器不挂载媒体目录或可写卷。`deployment/focus-audio-relay.user.service` 仍可用于不拦截宿主机端口的其他环境。
