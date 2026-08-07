/**
 * Pluggable AI SDK providers.
 * Add a new entry here — resolveModel / the agent loop stay unchanged.
 *
 * OpenAI-compatible endpoints (OpenRouter, Cerebras) use @ai-sdk/openai
 * with a custom baseURL so we stay on AI SDK 4 (v1 models).
 */

export type ProviderId = "openrouter" | "cerebras" | "openai" | "anthropic";

/** Opaque AI SDK language model. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLanguageModel = any;

export type ProviderHandle = {
  id: ProviderId;
  model: AnyLanguageModel;
  modelId: string;
};

type ProviderDef = {
  id: ProviderId;
  envKey: string;
  defaultModel: string;
  create: (apiKey: string, modelId: string) => Promise<AnyLanguageModel>;
};

async function openaiCompatible(
  apiKey: string,
  modelId: string,
  opts: { baseURL: string; name: string; headers?: Record<string, string> },
): Promise<AnyLanguageModel> {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const client = createOpenAI({
    apiKey,
    baseURL: opts.baseURL,
    name: opts.name,
    headers: opts.headers,
  });
  return client.chat(modelId);
}

const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openrouter: {
    id: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    // Free-tier Gemma 4 31B IT on OpenRouter
    defaultModel: "google/gemma-4-31b-it:free",
    create: async (apiKey, modelId) => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      // Free endpoints need data_collection allow (or toggle at
      // https://openrouter.ai/settings/privacy).
      const fetchWithFreePolicy: typeof fetch = async (input, init) => {
        if (init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body) as Record<string, unknown>;
            const provider =
              typeof body.provider === "object" && body.provider
                ? { ...(body.provider as Record<string, unknown>) }
                : {};
            if (provider.data_collection == null) {
              provider.data_collection = "allow";
            }
            body.provider = provider;
            init = { ...init, body: JSON.stringify(body) };
          } catch {
            // leave body alone
          }
        }
        return fetch(input, init);
      };
      const client = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        name: "openrouter",
        headers: {
          "HTTP-Referer": "https://github.com/rajofearth/CodeRush2.0_TeamKnull",
          "X-Title": "CLAI",
        },
        fetch: fetchWithFreePolicy,
      });
      return client.chat(modelId);
    },
  },
  cerebras: {
    id: "cerebras",
    envKey: "CEREBRAS_API_KEY",
    defaultModel: "gemma-4-31b",
    create: (apiKey, modelId) =>
      openaiCompatible(apiKey, modelId, {
        baseURL: "https://api.cerebras.ai/v1",
        name: "cerebras",
      }),
  },
  openai: {
    id: "openai",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    create: async (apiKey, modelId) => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey }).chat(modelId);
    },
  },
  anthropic: {
    id: "anthropic",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
    create: async (apiKey, modelId) => {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey })(modelId);
    },
  },
};

/** Default provider — free OpenRouter models for the hackathon. */
export const DEFAULT_PROVIDER: ProviderId = "openrouter";

export function listProviders(): ProviderId[] {
  return Object.keys(PROVIDERS) as ProviderId[];
}

export function providerEnvKey(id: ProviderId): string {
  return PROVIDERS[id].envKey;
}

export function hasAnyProviderKey(): boolean {
  return listProviders().some((id) => Boolean(process.env[PROVIDERS[id].envKey]));
}

export function hasProviderKey(id: ProviderId): boolean {
  return Boolean(process.env[PROVIDERS[id].envKey]);
}

export function pickProviderId(prefer?: ProviderId): ProviderId {
  const fromEnv = process.env.CLAI_PROVIDER as ProviderId | undefined;
  const order: ProviderId[] = [];
  if (prefer) order.push(prefer);
  if (fromEnv && PROVIDERS[fromEnv]) order.push(fromEnv);
  order.push(DEFAULT_PROVIDER);
  for (const id of listProviders()) {
    if (!order.includes(id)) order.push(id);
  }
  for (const id of order) {
    if (hasProviderKey(id)) return id;
  }
  throw new Error(
    `No API key found. Set one of: ${listProviders()
      .map((id) => PROVIDERS[id].envKey)
      .join(", ")}. Or run \`clai demo\` offline.`,
  );
}

export async function createProviderHandle(
  prefer?: ProviderId,
  modelIdOverride?: string,
): Promise<ProviderHandle> {
  const id = pickProviderId(prefer);
  const def = PROVIDERS[id];
  const apiKey = process.env[def.envKey];
  if (!apiKey) {
    throw new Error(`Missing ${def.envKey} for provider ${id}`);
  }
  const modelId =
    modelIdOverride ?? process.env.CLAI_MODEL ?? def.defaultModel;
  const model = await def.create(apiKey, modelId);
  return { id, model, modelId };
}
