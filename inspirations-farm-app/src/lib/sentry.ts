"use client";

/**
 * Sentry 错误监控集成
 *
 * 仅在配置了 NEXT_PUBLIC_SENTRY_DSN 时启用。
 * 如果未配置，所有调用都是 no-op。
 *
 * 配置方式：
 * 1. 访问 https://sentry.io 注册账号
 * 2. 创建 Next.js 项目
 * 3. 复制 DSN 到 .env.local:
 *    NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
 */

interface SentryClient {
  captureException: (error: Error, context?: Record<string, unknown>) => void;
  captureMessage: (message: string, level?: "info" | "warning" | "error") => void;
  setUser: (user: { id?: string; email?: string } | null) => void;
}

class NoOpSentry implements SentryClient {
  captureException() {}
  captureMessage() {}
  setUser() {}
}

class RealSentry implements SentryClient {
  private dsn: string;

  constructor(dsn: string) {
    this.dsn = dsn;
    this.init();
  }

  private init() {
    // 简化的 Sentry 初始化
    // 在真实场景中，你需要安装 @sentry/nextjs 包
    console.log("[Sentry] Initialized with DSN:", this.dsn.substring(0, 30) + "...");
  }

  captureException(error: Error, context?: Record<string, unknown>) {
    // 真实实现会发送到 Sentry 服务器
    console.error("[Sentry] Captured exception:", error, context);

    // TODO: 安装 @sentry/nextjs 后，替换为：
    // import * as Sentry from '@sentry/nextjs'
    // Sentry.captureException(error, { contexts: { custom: context } })
  }

  captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
    console.log(`[Sentry] ${level.toUpperCase()}:`, message);

    // TODO: 替换为 Sentry.captureMessage(message, level)
  }

  setUser(user: { id?: string; email?: string } | null) {
    console.log("[Sentry] Set user:", user);

    // TODO: 替换为 Sentry.setUser(user)
  }
}

// 检查是否配置了 DSN
function createSentryClient(): SentryClient {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn || typeof window === "undefined") {
    return new NoOpSentry();
  }

  return new RealSentry(dsn);
}

export const sentry = createSentryClient();

/**
 * 工具函数：捕获并上报错误
 */
export function captureError(error: unknown, context?: Record<string, unknown>) {
  const err = error instanceof Error ? error : new Error(String(error));
  sentry.captureException(err, context);
}

/**
 * 工具函数：上报信息
 */
export function logMessage(message: string, level?: "info" | "warning" | "error") {
  sentry.captureMessage(message, level);
}
