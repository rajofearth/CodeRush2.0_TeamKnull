/**
 * Pluggable AI SDK providers.
 * Add a new entry here — resolveModel / the agent loop stay unchanged.
 *
 * OpenAI-compatible endpoints (OpenRouter, Cerebras) use @ai-sdk/openai
 * with a custom baseURL so we stay on AI SDK 4 (v1 models).
 */

export type ProviderId =
  | "groq"
  | "openrouter"
  | "cerebras"
  | "openai"
  | "anthropic"
  | "gemini"
  | "gateway"
  | "deepseek";

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
  /** Extra env names that also satisfy this provider (e.g. SDK aliases). */
  envKeyAliases?: string[];
  defaultModel: string;
  create: (apiKey: string, modelId: string) => Promise<AnyLanguageModel>;
};

function providerEnvKeys(def: ProviderDef): string[] {
  return [def.envKey, ...(def.envKeyAliases ?? [])];
}

function resolveProviderApiKey(def: ProviderDef): string | undefined {
  for (const key of providerEnvKeys(def)) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

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
  groq: {
    id: "groq",
    envKey: "GROQ_API_KEY",
    defaultModel: "openai/gpt-oss-20b",
    create: (apiKey, modelId) =>
      openaiCompatible(apiKey, modelId, {
        baseURL: "https://api.groq.com/openai/v1",
        name: "groq",
      }),
  },
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
  gemini: {
    id: "gemini",
    envKey: "GEMINI_API_KEY",
    // @ai-sdk/google defaults to GOOGLE_GENERATIVE_AI_API_KEY
    envKeyAliases: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    // Confirmed against https://ai.google.dev/gemini-api/docs/models (Gemini 3.5 Flash-Lite)
    defaultModel: "gemini-3.5-flash-lite",
    create: async (apiKey, modelId) => {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      // Gemini 3.x requires thought signatures on replayed functionCall parts.
      // AI SDK 4's @ai-sdk/google does not round-trip them; inject Google's
      // documented sentinel so multi-step tool loops (maxSteps) keep working.
      // https://ai.google.dev/gemini-api/docs/thought-signatures
      const fetchWithThoughtSignatures: typeof fetch = async (input, init) => {
        if (init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body) as {
              contents?: Array<{
                parts?: Array<Record<string, unknown>>;
              }>;
            };
            let patched = false;
            for (const content of body.contents ?? []) {
              for (const part of content.parts ?? []) {
                if (
                  part.functionCall != null &&
                  part.thoughtSignature == null &&
                  part.thought_signature == null
                ) {
                  part.thoughtSignature = "skip_thought_signature_validator";
                  patched = true;
                }
              }
            }
            if (patched) {
              init = { ...init, body: JSON.stringify(body) };
            }
          } catch {
            // leave body alone
          }
        }
        return fetch(input, init);
      };
      return createGoogleGenerativeAI({
        apiKey,
        fetch: fetchWithThoughtSignatures,
      })(modelId);
    },
  },
  /**
   * Vercel AI Gateway — one key, many models via OpenAI-compatible /v1.
   * https://vercel.com/docs/ai-gateway
   * Model ids are provider-prefixed, e.g. google/gemini-2.5-flash-lite
   */
  gateway: {
    id: "gateway",
    envKey: "AI_GATEWAY_API_KEY",
    envKeyAliases: ["VERCEL_AI_GATEWAY_API_KEY"],
    // Gateway free-tier–friendly Gemma (set CLAI_MODEL to override).
    defaultModel: "google/gemma-4-31b-it",
    create: (apiKey, modelId) =>
      openaiCompatible(apiKey, modelId, {
        baseURL: "https://ai-gateway.vercel.sh/v1",
        name: "vercel-ai-gateway",
      }),
  },
  /**
   * DeepSeek — OpenAI-compatible Chat Completions.
   * https://api-docs.deepseek.com/
   * `deepseek-v4-flash` resolves to DeepSeek-V4-Flash-0731.
   */
  deepseek: {
    id: "deepseek",
    envKey: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-v4-flash",
    create: (apiKey, modelId) =>
      openaiCompatible(apiKey, modelId, {
        baseURL: "https://api.deepseek.com",
        name: "deepseek",
      }),
  },
};

/** Default provider — Groq for fast free/hackathon runs. */
export const DEFAULT_PROVIDER: ProviderId = "groq";

export function listProviders(): ProviderId[] {
  return Object.keys(PROVIDERS) as ProviderId[];
}

export function providerEnvKey(id: ProviderId): string {
  return PROVIDERS[id].envKey;
}

export function hasAnyProviderKey(): boolean {
  return listProviders().some((id) => hasProviderKey(id));
}

export function hasProviderKey(id: ProviderId): boolean {
  return Boolean(resolveProviderApiKey(PROVIDERS[id]));
}

export function pickProviderId(prefer?: ProviderId): ProviderId {
  const fromEnv = process.env.CLAI_PROVIDER as ProviderId | undefined;
  // Explicit prefer (CLI/tests) must win or fail clearly — never silently fall
  // through to another provider with a mismatched CLAI_MODEL.
  if (prefer) {
    if (!PROVIDERS[prefer]) {
      throw new Error(`Unknown provider: ${prefer}`);
    }
    if (!hasProviderKey(prefer)) {
      throw new Error(
        `CLAI_PROVIDER=${prefer} but ${providerEnvKeys(PROVIDERS[prefer]).join(" / ")} is not set. Add it to .env or pick another provider.`,
      );
    }
    return prefer;
  }
  if (fromEnv) {
    if (!PROVIDERS[fromEnv]) {
      throw new Error(`Unknown CLAI_PROVIDER: ${fromEnv}`);
    }
    if (!hasProviderKey(fromEnv)) {
      throw new Error(
        `CLAI_PROVIDER=${fromEnv} but ${providerEnvKeys(PROVIDERS[fromEnv]).join(" / ")} is not set. Add it to .env or unset CLAI_PROVIDER.`,
      );
    }
    return fromEnv;
  }
  const order: ProviderId[] = [DEFAULT_PROVIDER];
  for (const id of listProviders()) {
    if (!order.includes(id)) order.push(id);
  }
  for (const id of order) {
    if (hasProviderKey(id)) return id;
  }
  throw new Error(
    `No API key found. Set one of: ${listProviders()
      .flatMap((id) => providerEnvKeys(PROVIDERS[id]))
      .join(", ")}. Or run \`clai demo\` offline.`,
  );
}

export async function createProviderHandle(
  prefer?: ProviderId,
  modelIdOverride?: string,
): Promise<ProviderHandle> {
  const id = pickProviderId(prefer);
  const def = PROVIDERS[id];
  const apiKey = resolveProviderApiKey(def);
  if (!apiKey) {
    throw new Error(
      `Missing ${providerEnvKeys(def).join(" or ")} for provider ${id}`,
    );
  }
  const modelId =
    modelIdOverride ?? process.env.CLAI_MODEL ?? def.defaultModel;
  const model = await def.create(apiKey, modelId);
  return { id, model, modelId };
}
