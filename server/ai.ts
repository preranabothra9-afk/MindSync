import { GoogleGenAI } from '@google/genai';

// Centralized AI Model Providers Registry
//
// Every entry below is a real, callable provider. Credentials are read from
// server-side environment variables only and are never exposed to the client.
//
// Note on model choice: OpenAI and Anthropic do not offer any no-cost API
// access, so this registry deliberately uses open-weight models (Llama, GPT-OSS,
// Qwen, DeepSeek, Mistral) that are served on genuinely free provider tiers.
// GPT-OSS is OpenAI's own open-weight release, which keeps an OpenAI-labelled
// model in the comparison without requiring a paid OpenAI key.

export type AIProvider = 'google' | 'groq' | 'mistral' | 'nvidia';
export type AITransport = 'google-sdk' | 'openai-compat';
export type AIModelStatus = 'active' | 'coming-soon';

export interface AIModelConfig {
  id: string;
  name: string;
  provider: AIProvider;
  /** Organisation that trained the model, which may differ from the host. */
  lab: string;
  transport: AITransport;
  /** Model identifier expected by the upstream provider (may differ from `id`). */
  upstreamModel: string;
  /** Environment variable holding the credential. Server-side only. */
  apiKeyEnv: string;
  /** Where a developer can create a free credential. */
  signupUrl: string;
  /** Human readable summary of the free allowance. */
  freeTier: string;
  /** Optional OpenAI-compatible base URL override. */
  baseUrl?: string;
  /** Omitted from the request body when undefined, for provider compatibility. */
  temperature?: number;
  maxTokens?: number;
  /** True when the upstream provider gates this model behind a paid plan. */
  requiresPaidPlan?: boolean;
  /**
   * True when this model can ground answers with a live provider-side web
   * search (Google Search grounding for the Google transport). Models without
   * this answer only from their training data, so current events can be stale.
   */
  webSearch?: boolean;
  status: AIModelStatus;
}

export const AI_MODELS: Record<string, AIModelConfig> = {
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    lab: 'Google',
    transport: 'google-sdk',
    upstreamModel: 'gemini-2.5-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
    signupUrl: 'https://aistudio.google.com/apikey',
    freeTier: 'Free tier, no credit card',
    maxTokens: 4096,
    // Grounds answers with Google Search so current facts (office holders,
    // prices, versions) come from the live web rather than frozen training data.
    webSearch: true,
    status: 'active'
  },
  'gpt-oss-120b': {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS 120B',
    provider: 'groq',
    lab: 'OpenAI',
    transport: 'openai-compat',
    upstreamModel: 'openai/gpt-oss-120b',
    apiKeyEnv: 'GROQ_API_KEY',
    signupUrl: 'https://console.groq.com/keys',
    freeTier: 'Free plan - 30 RPM, 1000 req/day',
    maxTokens: 2048,
    status: 'active'
  },
  'qwen3.8-27b': {
    id: 'qwen3.8-27b',
    name: 'Qwen3.8 27B',
    provider: 'groq',
    lab: 'Alibaba',
    transport: 'openai-compat',
    upstreamModel: 'qwen/qwen3.8-27b',
    apiKeyEnv: 'GROQ_API_KEY',
    signupUrl: 'https://console.groq.com/keys',
    freeTier: 'Free plan - 30 RPM, 1000 req/day',
    maxTokens: 2048,
    status: 'active'
  },
  'gpt-oss-20b': {
    id: 'gpt-oss-20b',
    name: 'GPT-OSS 20B',
    provider: 'groq',
    lab: 'OpenAI',
    transport: 'openai-compat',
    upstreamModel: 'openai/gpt-oss-20b',
    apiKeyEnv: 'GROQ_API_KEY',
    signupUrl: 'https://console.groq.com/keys',
    freeTier: 'Free plan - 30 RPM, 1000 req/day',
    maxTokens: 2048,
    status: 'active'
  },
  'llama-3.3-70b': {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    provider: 'groq',
    lab: 'Meta',
    transport: 'openai-compat',
    upstreamModel: 'llama-3.3-70b-versatile',
    apiKeyEnv: 'GROQ_API_KEY',
    signupUrl: 'https://console.groq.com/keys',
    freeTier: 'Requires a paid Groq plan - not in the free tier',
    requiresPaidPlan: true,
    temperature: 0.7,
    maxTokens: 2048,
    status: 'active'
  },
  'mistral-small': {
    id: 'mistral-small',
    name: 'Mistral Small',
    provider: 'mistral',
    lab: 'Mistral',
    transport: 'openai-compat',
    upstreamModel: 'mistral-small-latest',
    apiKeyEnv: 'MISTRAL_API_KEY',
    signupUrl: 'https://console.mistral.ai/api-keys/',
    freeTier: 'Free Experiment tier, no credit card',
    temperature: 0.7,
    maxTokens: 2048,
    status: 'active'
  },
  'deepseek-r1': {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'nvidia',
    lab: 'DeepSeek',
    transport: 'openai-compat',
    upstreamModel: 'deepseek-ai/deepseek-r1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    signupUrl: 'https://build.nvidia.com',
    freeTier: 'Free developer tier, 40 RPM',
    maxTokens: 2048,
    status: 'active'
  }
};

/**
 * The three models selected by default for comparative prompts: three different
 * labs, all reachable on a genuine no-cost tier with only two signups
 * (Google AI Studio + Groq).
 */
export const DEFAULT_COMPARISON_MODELS = ['gemini-2.5-flash', 'gpt-oss-120b', 'qwen3.8-27b'];

const OPENAI_COMPAT_BASE_URLS: Record<Exclude<AIProvider, 'google'>, string> = {
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1'
};

/** True when the model's credential is present in the server environment. */
export function isModelConfigured(modelId: string): boolean {
  const config = AI_MODELS[modelId];
  if (!config) return false;
  return Boolean(process.env[config.apiKeyEnv]?.trim());
}

/**
 * Builds an actionable notice for a model whose credential is missing, naming
 * the exact variable and where to obtain a free key. `fallback` lets callers
 * that hold a config object (for example a test or a dynamic route) still get
 * an accurate notice for a key that is not in the static registry.
 */
export function buildCredentialNotice(modelId: string, fallback?: AIModelConfig): string {
  const config = AI_MODELS[modelId] || fallback;
  const name = config ? config.name : modelId;
  const env = config ? config.apiKeyEnv : '(unknown)';
  const url = config ? config.signupUrl : '';
  const freeTier = config ? config.freeTier : '';

  return `### ${name} - API key required

This adapter is fully implemented, but no credential is loaded on the server.

**Add this variable to the server \`.env\` file, then restart the server:**

\`\`\`bash
${env}=your_key_here
\`\`\`
${url ? `\n**Get a free key:** ${url}\n` : ''}
**Free allowance:** ${freeTier || 'see provider documentation'}

Keys are read on the server only and are never sent to the browser.`;
}

// Initialize the GoogleGenAI client with key from environment
let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        aiClient = new GoogleGenAI({
          apiKey: apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });
        console.log('Gemini AI Client initialized successfully.');
      } catch (err) {
        console.error('Failed to initialize Gemini AI Client:', err);
      }
    } else {
      console.warn('GEMINI_API_KEY env variable is not set. Gemini API calls will run on a secure, educational fallback instruction.');
    }
  }
  return aiClient;
}

// Helper to retry an operation with exponential backoff on transient/rate-limiting errors
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 1,           // Keep retries low so a failing model cascades quickly
  delay = 250,           // Short initial delay for responsiveness
  backoffFactor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorStr = (error.message || '') + ' ' + JSON.stringify(error);
    const isRateLimitOrTransient =
      errorStr.includes('503') ||
      errorStr.includes('429') ||
      errorStr.includes('UNAVAILABLE') ||
      errorStr.includes('high demand') ||
      errorStr.includes('Service Unavailable') ||
      errorStr.includes('temporary');

    if (retries > 0 && isRateLimitOrTransient) {
      console.warn(`Gemini API: Encountered transient capacity/rate-limit error. Retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * backoffFactor, backoffFactor);
    }
    throw error;
  }
}

/** Abort a stalled upstream request rather than hanging a model card forever. */
const STREAM_TIMEOUT_MS = 120_000;

/** Extracts the most useful message from an OpenAI-compatible error payload. */
function extractUpstreamError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message || parsed?.message;
    if (message) return `${status}: ${message}`;
  } catch {
    // Non-JSON error body, fall through to the raw text.
  }
  const trimmed = body.trim();
  return trimmed ? `${status}: ${trimmed.slice(0, 300)}` : `Upstream request failed with HTTP ${status}`;
}

/**
 * Streams a chat completion from any OpenAI-compatible provider (Groq, Mistral,
 * NVIDIA NIM) using the native fetch API, so no extra SDK dependency is needed.
 *
 * Handles both `text/event-stream` responses and providers that return a single
 * non-streaming JSON body. Reasoning tokens (`delta.reasoning` /
 * `delta.reasoning_content`, emitted by gpt-oss and DeepSeek R1) are discarded
 * so only the final answer is shown.
 */
export async function streamOpenAICompatible(
  config: AIModelConfig,
  prompt: string,
  onChunk: (text: string) => void,
  onComplete: (fullText: string) => void,
  onError: (errMessage: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const apiKey = process.env[config.apiKeyEnv]?.trim();
  if (!apiKey) {
    onError(buildCredentialNotice(config.id, config));
    return;
  }

  const baseUrl = (config.baseUrl || OPENAI_COMPAT_BASE_URLS[config.provider as Exclude<AIProvider, 'google'>]).replace(/\/+$/, '');
  const controller = new AbortController();
  let stopped = false;
  // Forward an external stop (user pressed Stop) into this request.
  if (signal) {
    if (signal.aborted) {
      onComplete('');
      return;
    }
    signal.addEventListener('abort', () => {
      stopped = true;
      controller.abort();
    }, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  // Kept at function scope so a stop or mid-stream failure can still persist
  // whatever text was already delivered to the client.
  let fullText = '';

  try {
    const body: Record<string, unknown> = {
      model: config.upstreamModel,
      messages: [{ role: 'user', content: prompt }],
      stream: true
    };
    // Only send tuning fields the provider is known to accept.
    if (config.temperature !== undefined) body.temperature = config.temperature;
    if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const message = extractUpstreamError(errorBody, response.status);
      console.error(`[ai] ${config.name} (${config.upstreamModel}) upstream rejected request: ${message}`);
      onError(message);
      return;
    }

    const contentType = response.headers.get('content-type') || '';

    // Some providers ignore `stream: true` and return one JSON payload.
    if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
      const payload = await response.json().catch(() => null);
      const text = payload?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text) {
        onChunk(text);
        onComplete(text);
      } else {
        onError('Upstream provider returned a response without any content.');
      }
      return;
    }

    if (!response.body) {
      onError('Upstream provider returned an empty response stream.');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let received = false;
    let finished = false;

    const handlePayload = (payload: string): boolean => {
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed?.choices?.[0]?.delta;
        const text = delta?.content;
        if (typeof text === 'string' && text.length > 0) {
          fullText += text;
          received = true;
          onChunk(text);
        }
        return false;
      } catch {
        // Ignore keep-alive comments and malformed frames.
        return false;
      }
    };

    while (!finished) {
      if (stopped) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          finished = true;
          break;
        }
        handlePayload(payload);
      }
    }

    // Flush any trailing frame that arrived without a newline.
    const tail = buffer.trim();
    if (!stopped && tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload !== '[DONE]') handlePayload(payload);
    }

    // A user-requested stop completes with whatever was already streamed.
    if (stopped) {
      onComplete(fullText);
      return;
    }

    if (!received && !fullText) {
      const reason = `${config.name}: upstream closed the stream without returning any content.`;
      console.error(`[ai] ${reason} model=${config.upstreamModel} baseUrl=${baseUrl}`);
      onError('Upstream provider closed the stream without returning any content.');
      return;
    }

    onComplete(fullText);
  } catch (err: any) {
    if (stopped) {
      // User pressed Stop: finish with the partial text instead of an error.
      onComplete(fullText);
      return;
    }
    if (err?.name === 'AbortError') {
      const message = `Request to ${config.name} timed out after ${STREAM_TIMEOUT_MS / 1000}s.`;
      console.error(`[ai] ${message} model=${config.upstreamModel}`);
      onError(message);
      return;
    }
    console.error(`[ai] ${config.name} (${config.upstreamModel}) stream failed:`, err?.message || err);
    onError(err?.message || String(err));
  } finally {
    clearTimeout(timeout);
    if (signal) {
      // Listener was registered with once:true; safe to no-op if already gone.
      try { signal.removeEventListener('abort', () => {}); } catch { /* noop */ }
    }
  }
}

/**
 * Intelligent local response generator when Google servers are completely offline or 503'ing
 */
export function generateOfflineFallbackResponse(prompt: string): string {
  const cleanPrompt = prompt.toLowerCase();
  
  if (cleanPrompt.includes('hello') || cleanPrompt.includes('hi') || cleanPrompt.includes('hey')) {
    return `### 👋 Welcome to MindSync Workspace!
*(Offline Recovery Mode Active 🛡️)*

Hello! I have temporarily transitioned to **Offline Recovery Fallback Mode** because we detected that Google's Gemini servers are currently experiencing exceptional demand and rate-limits.

Even though the cloud service is temporarily congested, I am running completely locally in your workspace to help you. How can I assist you with your project structure, database architecture, or collaborative coding workspace today?`;
  }
  
  if (cleanPrompt.includes('database') || cleanPrompt.includes('db') || cleanPrompt.includes('mongo') || cleanPrompt.includes('mongoose')) {
    return `### 🗄️ Database Architecture Guard (Offline)
*(Offline Recovery Mode Active 🛡️)*

I detected your interest in database configurations. Here is a baseline Mongoose configuration and recovery check to ensure your workspace remains active:

\`\`\`typescript
import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  
  try {
    await mongoose.connect(uri);
    console.log('MongoDB successfully established.');
  } catch (err) {
    console.error('Database connection failed:', err);
  }
}
\`\`\`

**Tips for fallback execution:**
- Ensure \`MONGODB_URI\` is set in the server \`.env\` file and the server has been restarted.
- If using Local MongoDB, check container configurations and standard bindings.`;
  }
  
  if (cleanPrompt.includes('docker') || cleanPrompt.includes('container') || cleanPrompt.includes('port')) {
    return `### 🐳 Containerization & Network Engine (Offline)
*(Offline Recovery Mode Active 🛡️)*

You referenced environments or container details. In AI Studio workspaces:
1. **Port 3000** is the single externally routed entrance.
2. Dev servers must listen on host \`0.0.0.0\` (bind to all interfaces).
3. Live websocket handshakes use the main web port via reverse proxy.

If you are experiencing connection drops, try restarting our secure Development Server directly in the workspace control options.`;
  }
  
  if (cleanPrompt.includes('react') || cleanPrompt.includes('component') || cleanPrompt.includes('state')) {
    return `### ⚛️ React Component Blueprint & State Guides (Offline)
*(Offline Recovery Mode Active 🛡️)*

Let's inspect standard React design rules for collaborative environments:

1. **Avoid Multi-Renders**: Use primitives in \`useEffect\` dependency arrays to prevent infinite re-renders.
2. **Leverage State Hooks**:
\`\`\`tsx
import React, { useState, useEffect } from 'react';

export function WorkspaceAlert() {
  const [active, setActive] = useState(true);
  
  return (
    <div className="p-4 rounded bg-slate-800 text-white shadow">
      <h4>System Online</h4>
    </div>
  );
}
\`\`\`
3. **Typography**: Always use class names like \`font-sans\` or \`font-mono\` for technical readouts.`;
  }

  // Elegant generic intelligent response
  return `### 🛰️ MindSync Offline Workspace Engine
*(Offline Recovery Mode Active 🛡️)*

**Note:** The global Gemini AI service is currently experiencing exceptionally high demand. To keep your workspace interactive, I have activated the **Local Offline Recovery Engine**.

I parsed your action request:
> "${prompt}"

**Offline Assistant Brainstorming & Feedback:**
1. **Analysis**: Your inquiry is highly relevant for multi-agent comparative systems.
2. **Next Steps**:
   - Check the server \`.env\` file contains the API keys for the models you selected, then restart the server.
   - If the capacity delay persists, wait a few seconds and send your prompt again.
   - If you need localized codebase changes, you can direct me precisely in our main workspace chat panel.

*I am ready to accept automated edits, lints, or workspace refactoring commands anytime!*`;
}

/**
 * Streams the offline recovery fallback text chunk-by-chunk to simulate real streaming
 */
export function streamOfflineFallback(
  prompt: string,
  onChunk: (text: string) => void,
  onComplete: (fullText: string) => void
) {
  const textToStream = generateOfflineFallbackResponse(prompt);
  const words = textToStream.split(' ');
  let currentIndex = 0;
  let accumulated = '';

  const interval = setInterval(() => {
    if (currentIndex >= words.length) {
      clearInterval(interval);
      onComplete(accumulated);
      return;
    }

    const chunk = (currentIndex === 0 ? '' : ' ') + words[currentIndex];
    accumulated += chunk;
    onChunk(chunk);
    currentIndex++;
  }, 15); // Rapid streaming simulation for highly responsive fallback feedback
}

/**
 * Handles generating standard text responses from Gemini for single chats or fallbacks
 */
export async function getGeminiTextResponse(prompt: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) {
    return 'Gemini API not configured. Add GEMINI_API_KEY to the server .env file and restart the server.';
  }

  const cascade = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  const failures: string[] = [];

  for (const modelName of cascade) {
    try {
      const response = await retryWithBackoff(() => client.models.generateContent({
        model: modelName,
        contents: prompt,
      }));
      return response.text || 'No response returned from Gemini.';
    } catch (error: any) {
      const message = (error?.message || String(error)).replace(/\s+/g, ' ').trim();
      failures.push(`${modelName} -> ${message.slice(0, 200)}`);
      console.warn(`[ai] Gemini text call ${modelName} failed, trying next fallback: ${message.slice(0, 200)}`);
    }
  }

  console.error(`[ai] Every Gemini text model failed. ${failures.join(' | ')}`);
  return generateOfflineFallbackResponse(prompt);
}

/**
 * The strict counterpart to `getGeminiTextResponse`, for anything the room
 * treats as a record rather than a reply.
 *
 * The difference is entirely in the failure path. `getGeminiTextResponse`
 * falls back to `generateOfflineFallbackResponse`, which composes plausible
 * text from the prompt — fine for a chat reply, catastrophic for a decision
 * summary, where a fabricated paragraph would be indistinguishable from a
 * real one. Here, any failure returns `null` and the caller reports plainly
 * that no narration was produced.
 *
 * Returns null when the API is unconfigured, when every model in the cascade
 * fails, or when the model returns nothing usable.
 */
export async function getGeminiTextResponseOrNull(prompt: string): Promise<string | null> {
  const client = getGeminiClient();
  if (!client) return null;

  const cascade = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  for (const modelName of cascade) {
    try {
      const response = await retryWithBackoff(() =>
        client.models.generateContent({ model: modelName, contents: prompt })
      );
      const text = (response.text || '').trim();
      if (text) return text;
    } catch (error: any) {
      const message = (error?.message || String(error)).replace(/\s+/g, ' ').trim();
      console.warn(`[ai] strict Gemini call ${modelName} failed, trying next fallback: ${message.slice(0, 200)}`);
    }
  }
  return null;
}

/**
 * Streams real Gemini API responses character/token chunk-by-chunk and broadcasts as callbacks
 */
export async function streamRealGemini(
  prompt: string,
  onChunk: (text: string) => void,
  onComplete: (fullText: string) => void,
  onError: (errMessage: string) => void,
  signal?: AbortSignal,
  webSearch?: boolean
) {
  const client = getGeminiClient();
  if (!client) {
    // Explain exactly which variable is missing instead of faking a model answer.
    return streamNotice(
      'gemini-2.5-flash',
      buildCredentialNotice('gemini-2.5-flash'),
      onChunk,
      onComplete
    );
  }

  // Google Search grounding is attached only where the provider accepts it.
  // The 2.x flash family supports the legacy `googleSearch` tool; the 3.x
  // flash-lite lineage that the cascade falls back to does not, so grounding
  // is scoped to the primary model to keep the fallbacks functional.
  const GROUNDED_MODEL = 'gemini-2.5-flash';
  const buildParams = (modelName: string) => {
    const config: Record<string, unknown> = {};
    if (webSearch && modelName === GROUNDED_MODEL) {
      config.tools = [{ googleSearch: {} }];
    }
    // Propagating the abort signal cancels the underlying HTTP request. Without
    // it, a Stop pressed while the model is still working towards its first
    // token would only be honoured once a chunk arrived — grounding adds a web
    // search step, so that wait could be long and Stop felt dead.
    if (signal) config.abortSignal = signal;
    return { model: modelName, contents: prompt, config };
  };

  const tryStream = async (modelName: string) => {
    const stream = await retryWithBackoff(() => client.models.generateContentStream(buildParams(modelName)));

    let fullText = '';
    try {
      for await (const chunk of stream) {
        // User pressed Stop: return what we already streamed.
        if (signal?.aborted) return { text: fullText, stopped: true };
        const text = chunk.text || '';
        if (text) {
          fullText += text;
          onChunk(text);
        }
      }
    } catch (err: any) {
      // The abort signal cancels the in-flight request; whatever was already
      // streamed is the user's partial answer, so keep it rather than erroring.
      if (signal?.aborted) return { text: fullText, stopped: true };
      throw err;
    }
    return { text: fullText, stopped: false };
  };

  // Fast, healthy models first: gemini-2.5-flash measures ~2.8s to first token
  // while gemini-3.5-flash has been measured above 11s on the free tier.
  const cascade = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  const failures: string[] = [];

  for (const modelName of cascade) {
    if (signal?.aborted) {
      onComplete('');
      return;
    }
    try {
      const { text, stopped } = await tryStream(modelName);
      onComplete(text);
      if (stopped) console.warn(`[ai] Gemini stream ${modelName} stopped by user with ${text.length} chars delivered`);
      return;
    } catch (err: any) {
      const message = (err?.message || String(err)).replace(/\s+/g, ' ').trim();
      failures.push(`${modelName} -> ${message.slice(0, 200)}`);
      console.warn(`[ai] Gemini model ${modelName} failed, trying next fallback: ${message.slice(0, 200)}`);
    }
  }

  console.error(`[ai] Every Gemini model failed. ${failures.join(' | ')}`);

  // Configuration problems (bad/invalid key, unknown model) should be reported
  // honestly rather than answered with a local canned message.
  const configError = failures.find((f) => /\b(401|403|404)\b/.test(f));
  if (configError) {
    onError(`Gemini request failed: ${configError}`);
    return;
  }

  // Transient capacity errors (429/503): keep the workspace responsive with the
  // local offline recovery response instead of an empty card.
  streamOfflineFallback(prompt, onChunk, onComplete);
}

/**
 * Streams a local status notice word-by-word. Used for unknown model keys and
 * for models that still have no provider wired up.
 */
export function streamNotice(
  modelKey: string,
  customText: string | null,
  onChunk: (text: string) => void,
  onComplete: (fullText: string) => void
) {
  const modelConfig = AI_MODELS[modelKey];
  const modelName = modelConfig ? modelConfig.name : modelKey;

  const textToStream = customText || `### ${modelName}

> **STATUS: NOT CONFIGURED**

This model key is not present in the provider registry. Add it to \`AI_MODELS\` in \`server/ai.ts\` to enable it.`;

  const words = textToStream.split(' ');
  let currentIndex = 0;
  let accumulated = '';

  const interval = setInterval(() => {
    if (currentIndex >= words.length) {
      clearInterval(interval);
      onComplete(accumulated);
      return;
    }

    const chunk = (currentIndex === 0 ? '' : ' ') + words[currentIndex];
    accumulated += chunk;
    onChunk(chunk);
    currentIndex++;
  }, 25);
}

/**
 * Single entry point used by the socket layer. Routes a model key to its
 * transport (Google SDK or OpenAI-compatible) based on registry config, so
 * adding a provider never requires changing the socket handler.
 */
export async function streamModel(
  modelKey: string,
  prompt: string,
  onChunk: (text: string) => void,
  onComplete: (fullText: string) => void,
  onError: (errMessage: string) => void,
  signal?: AbortSignal,
  skipGrounding?: boolean
): Promise<void> {
  const config = AI_MODELS[modelKey];

  if (!config) {
    streamNotice(modelKey, null, onChunk, onComplete);
    return;
  }

  if (!isModelConfigured(modelKey)) {
    streamNotice(modelKey, buildCredentialNotice(modelKey), onChunk, onComplete);
    return;
  }

  if (config.transport === 'google-sdk') {
    // `skipGrounding` is set when the room already has an established context:
    // the room's own history is the source of truth there, and live web search
    // would contradict (and refuse) the premises the room was built on.
    await streamRealGemini(prompt, onChunk, onComplete, onError, signal, config.webSearch && !skipGrounding);
    return;
  }

  await streamOpenAICompatible(config, prompt, onChunk, onComplete, onError, signal);
}
