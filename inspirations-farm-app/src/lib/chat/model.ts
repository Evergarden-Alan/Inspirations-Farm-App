import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatConfigError } from "@/lib/chat/repos";

/** OpenAI 兼容端点的模型工厂：默认 GLM，env 换供应商零代码改动。 */
export function createChatModel(
  env: Record<string, string | undefined> = process.env
) {
  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    throw new ChatConfigError("Missing AI_API_KEY（在 Vercel/.env.local 配置后重试）");
  }
  const provider = createOpenAICompatible({
    name: "counselor",
    baseURL: env.AI_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
    apiKey,
  });
  return provider(env.AI_MODEL ?? "glm-4.6");
}
