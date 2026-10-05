"use client";

import { useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, AuthError, clearPin } from "@/lib/api";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { toast } from "@/components/app-shell/toast";
import { createChatTransport } from "@/features/chat/transport";

const STORAGE_KEY = "chat-history-v1";

// 模块级单例：headers 每次请求时动态读 PIN，transport 本身不随渲染重建
const chatTransport = createChatTransport();

const WRITE_TOOLS = new Set(["update_plan_file", "append_journal", "append_inspiration"]);

interface WriteToolOutput {
  ok?: boolean;
  path?: string;
  commit?: string;
  url?: string | null;
  alreadyReverted?: boolean;
  error?: string;
}

interface SessionInfo {
  fetchedAt: string;
  degraded: boolean;
  providers: string[];
  coverage: {
    note: { cached: number; total: number };
    review: { cached: number; total: number };
  };
}

export function ChatWorkspace() {
  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: chatTransport,
    onError: (err) => {
      // 与 apiFetch 的 401 惯例对齐：清 PIN + 触发全局锁屏
      if (err.message.includes("Unauthorized")) {
        clearPin();
        window.dispatchEvent(new CustomEvent("auth:expired"));
      }
    },
  });
  const [input, setInput] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [provider, setProvider] = useState<string | undefined>(undefined);
  const [reverting, setReverting] = useState<string | null>(null);

  // 恢复上次会话 + session 引导（暖缓存 + 热集）
  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setMessages(parsed);
      } catch {
        /* 坏数据直接忽略 */
      }
    }
    apiFetch("/api/chat/session", { method: "POST" })
      .then((res) => res.json())
      .then((data: SessionInfo) => {
        setSession(data);
        setProvider((cur) => cur ?? data.providers?.[0]);
      })
      .catch(() => setSession(null));
  }, [setMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    setInput("");
    sendMessage({ text }, { body: { provider } });
  }, [input, provider, sendMessage, status]);

  const revert = useCallback(async (path: string, commit: string) => {
    setReverting(commit);
    try {
      const res = await apiFetch("/api/chat/revert", {
        method: "POST",
        body: JSON.stringify({ repoId: "review", path, commit }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(data.alreadyReverted ? "早已回滚，无需操作" : "已回滚");
      } else {
        toast.error(data.error ?? "回滚失败");
      }
    } catch (err) {
      toast.error(err instanceof AuthError ? "请重新解锁" : "回滚失败");
    } finally {
      setReverting(null);
    }
  }, []);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-68px)] max-w-[1280px] flex-col gap-3 px-4 py-4">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">计划参谋</h1>
        <div className="flex items-center gap-3">
          {session && session.providers && session.providers.length > 1 && (
            <select
              value={provider ?? ""}
              onChange={(e) => setProvider(e.target.value || undefined)}
              aria-label="模型供应商"
              className="rounded-lg border border-[var(--farm-line)] bg-[var(--farm-paper)] px-2 py-1 text-xs"
            >
              {session.providers.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          )}
          {session && (
            <span className="text-xs text-[var(--farm-muted)]">
              数据截至{" "}
              {new Date(session.fetchedAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {session.degraded ? "（部分降级）" : ""}
            </span>
          )}
        </div>
      </header>

      {error && (
        <Card className="border-red-400/40">
          <CardContent className="py-3 text-sm text-red-600 dark:text-red-400">
            对话出错：{error.message}
            <Button variant="ghost" size="sm" className="ml-2" onClick={() => sendMessage()}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-[var(--farm-muted)]">
            试试问：「这周计划合理吗？」「把下周三的套卷挪到周二」「我最近一周状态如何」
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            <div className="text-xs text-[var(--farm-muted)]">
              {message.role === "user" ? "你" : "参谋"}
            </div>
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return <MarkdownRenderer key={i} content={part.text} />;
              }
              if (part.type?.startsWith("tool-")) {
                const name = part.type.slice(5);
                const isWrite = WRITE_TOOLS.has(name);
                const output = (
                  "output" in part ? part.output : undefined
                ) as WriteToolOutput | undefined;
                return (
                  <Card key={i} className="border-dashed">
                    <CardHeader className="py-2">
                      <CardTitle className="text-sm font-medium">
                        🔧 {name}
                        {output?.path ? ` · ${output.path}` : ""}
                        {output?.ok === false ? " · 失败" : ""}
                      </CardTitle>
                    </CardHeader>
                    {isWrite && output && (
                      <CardContent className="flex items-center gap-2 py-2 text-xs">
                        {output.url && (
                          <a href={output.url} target="_blank" rel="noreferrer" className="underline">
                            查看 commit
                          </a>
                        )}
                        {name === "update_plan_file" && output.commit && !output.alreadyReverted && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={reverting !== null}
                            onClick={() => revert(output.path!, output.commit!)}
                          >
                            {reverting === output.commit ? "回滚中…" : "回滚"}
                          </Button>
                        )}
                        {output.error && <span className="text-red-600">{output.error}</span>}
                      </CardContent>
                    )}
                  </Card>
                );
              }
              return null;
            })}
          </div>
        ))}
        {status === "streaming" && (
          <p className="text-sm text-[var(--farm-muted)]">参谋正在思考……</p>
        )}
      </div>

      <div className="sticky bottom-0 flex gap-2 bg-[var(--farm-paper)]/90 pb-2 pt-2 backdrop-blur">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="和参谋聊聊计划……"
          className="min-h-11"
        />
        <Button
          onClick={submit}
          disabled={!input.trim() || status === "streaming" || status === "submitted"}
        >
          发送
        </Button>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setMessages([]);
              window.localStorage.removeItem(STORAGE_KEY);
            }}
          >
            清空
          </Button>
        )}
      </div>
    </div>
  );
}
