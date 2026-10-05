import { DefaultChatTransport } from "ai";

/** 流式请求的认证头：useChat 的 transport 走原生 fetch，不带 apiFetch 的
 *  x-app-pin——缺了它生产（设置 APP_PIN）每条消息必 401。每次请求时读取
 *  localStorage，PIN 变更即时生效。 */
export function getChatHeaders(): Record<string, string> {
  // globalThis.localStorage：浏览器即 window.localStorage；SSR/测试下可能不存在
  const storage = globalThis.localStorage;
  if (!storage) return { "x-app-pin": "" };
  return { "x-app-pin": storage.getItem("app_pin") ?? "" };
}

export function createChatTransport() {
  return new DefaultChatTransport({
    api: "/api/chat",
    headers: getChatHeaders,
  });
}
