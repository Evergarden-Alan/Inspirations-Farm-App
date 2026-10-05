import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatConfigError } from "@/lib/chat/repos";

export { ChatConfigError };

/** 已知供应商的端点与缺省模型。新增已知供应商 = 各补一行；
 *  未知供应商走 <ID>_BASE_URL / <ID>_MODEL env，不需要改代码。 */
const KNOWN_BASE_URLS: Record<string, string> = {
  glm: "https://open.bigmodel.cn/api/paas/v4",
  deepseek: "https://api.deepseek.com",
};

const KNOWN_MODELS: Record<string, string> = {
  glm: "glm-5.3-flash",
  deepseek: "deepseek-flash",
};

export interface ChatProviderInfo {
  id: string;
  hasKey: boolean;
  model: string;
}

/** 扫描 env 发现供应商：已知 id 直接列出；未知 id 需 <ID>_API_KEY +
 *  <ID>_BASE_URL 才算可构建。裸 AI_API_KEY（旧单供应商键）不算。 */
export function listChatProviders(
  env: Record<string, string | undefined> = process.env
): ChatProviderInfo[] {
  const ids = new Set<string>(Object.keys(KNOWN_BASE_URLS));
  for (const key of Object.keys(env)) {
    const m = /^([A-Z0-9]+)_API_KEY$/.exec(key);
    if (!m) continue;
    const id = m[1].toLowerCase();
    if (id === "ai") continue;
    if (env[`${m[1]}_BASE_URL`] || KNOWN_BASE_URLS[id]) ids.add(id);
  }
  return [...ids].sort().map((id) => {
    const U = id.toUpperCase();
    return {
      id,
      hasKey: Boolean(env[`${U}_API_KEY`]),
      model: env[`${U}_MODEL`] ?? KNOWN_MODELS[id] ?? "",
    };
  });
}

/** 按供应商 id 构建模型实例。全部 OpenAI 兼容端点，一个适配器通吃。 */
export function createChatModelFor(
  id: string,
  env: Record<string, string | undefined> = process.env
) {
  const U = id.toUpperCase();
  const baseURL = env[`${U}_BASE_URL`] ?? KNOWN_BASE_URLS[id];
  if (!baseURL) {
    throw new ChatConfigError(`Provider ${id}: missing ${U}_BASE_URL`);
  }
  const apiKey = env[`${U}_API_KEY`];
  if (!apiKey) {
    throw new ChatConfigError(`Provider ${id}: missing ${U}_API_KEY`);
  }
  const model = env[`${U}_MODEL`] ?? KNOWN_MODELS[id];
  if (!model) {
    throw new ChatConfigError(`Provider ${id}: missing ${U}_MODEL`);
  }
  const provider = createOpenAICompatible({
    name: `counselor-${id}`,
    baseURL,
    apiKey,
  });
  return provider(model);
}

/** 旧的单供应商默认：AI_API_KEY（+可选 AI_BASE_URL/AI_MODEL）。
 *  未指定 provider 时先落这里，注册表里有可用的则优先注册表。 */
export function createChatModel(
  env: Record<string, string | undefined> = process.env
) {
  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    throw new ChatConfigError(
      "Missing AI_API_KEY（或改用 GLM_API_KEY / DEEPSEEK_API_KEY 等多供应商键）"
    );
  }
  const provider = createOpenAICompatible({
    name: "counselor",
    baseURL: env.AI_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    apiKey,
  });
  return provider(env.AI_MODEL ?? "glm-5.3-flash");
}
