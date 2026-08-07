// Shared key resolver for all edge functions
// Handles primary keys + backup key chain + manual assignments + AI routing + usage logging

export interface KeyEntry {
  id: string;
  key: string;
  provider: string;
  label: string;
}

export interface BackupKey {
  id: string;
  label: string;
  provider: string;
  task_type: 'image' | 'text';
  key: string;
  created_at?: string;
}

/** Fire-and-forget usage logger — never throws */
export function logUsage(
  supabaseAdmin: any,
  entry: {
    task_type: string;
    feature: string;
    key_label: string;
    key_id: string;
    provider: string;
    success: boolean;
    latency_ms?: number;
    error_msg?: string;
  }
): void {
  supabaseAdmin
    .from('api_usage_logs')
    .insert(entry)
    .then(() => {})
    .catch((e: any) => console.warn('Usage log skipped:', String(e).slice(0, 80)));
}

/**
 * Resolve ordered list of API keys to try.
 * Priority:
 *  1. Admin-pinned backup (from assignments)
 *  2. Primary DB key
 *  3. Env-variable fallback (if different from DB key — safety net)
 *  4. Remaining backup keys
 *
 * AI-routing: if apiKeys.ai_routing[featureName] is set, that provider is preferred.
 */
export function resolveKeyChain(
  apiKeys: Record<string, any>,
  taskType: 'image' | 'text',
  featureName?: string,
): KeyEntry[] {
  const out: KeyEntry[] = [];
  if (!apiKeys) return out;

  const backupKeys: BackupKey[] = Array.isArray(apiKeys.backup_keys)
    ? apiKeys.backup_keys.filter(
        (k: any) => k && typeof k.key === 'string' && k.key.trim().length > 10
      )
    : [];

  const assignments: Record<string, string> = apiKeys.assignments || {};
  const aiRouting: Record<string, string> = apiKeys.ai_routing || {};

  // Determine primary provider: AI routing > task-type default
  const routedProvider = featureName ? aiRouting[featureName] : undefined;
  const primaryProvider =
    routedProvider === 'openrouter' || routedProvider === 'groq'
      ? routedProvider
      : taskType === 'image'
        ? 'openrouter'
        : 'groq';

  const primaryKey = (apiKeys[primaryProvider] || '').trim();
  const envKey = (apiKeys[`_env_${primaryProvider}`] || '').trim(); // stored separately in each function
  const assignedId = assignments[taskType] || 'primary';

  const taskBackups = backupKeys.filter((k) => k.task_type === taskType);

  // 1. Admin-pinned backup
  if (assignedId !== 'primary') {
    const pinned = taskBackups.find((k) => k.id === assignedId);
    if (pinned && pinned.key.trim().length > 10) {
      out.push({
        id: pinned.id,
        key: pinned.key.trim(),
        provider: pinned.provider || primaryProvider,
        label: pinned.label,
      });
    }
  }

  // 2. Primary DB key
  if (primaryKey && !out.find((e) => e.id === 'primary')) {
    out.push({
      id: 'primary',
      key: primaryKey,
      provider: primaryProvider,
      label: `Primary ${primaryProvider === 'openrouter' ? 'OpenRouter' : 'Groq'}`,
    });
  }

  // 3. Env variable safety-net (if different from DB key)
  if (envKey && envKey !== primaryKey && !out.find((e) => e.key === envKey)) {
    out.push({
      id: 'env_fallback',
      key: envKey,
      provider: primaryProvider,
      label: `System Env ${primaryProvider === 'openrouter' ? 'OpenRouter' : 'Groq'}`,
    });
  }

  // 4. Remaining backup keys
  for (const bk of taskBackups) {
    if (!out.find((e) => e.id === bk.id) && bk.key.trim().length > 10) {
      out.push({
        id: bk.id,
        key: bk.key.trim(),
        provider: bk.provider || primaryProvider,
        label: bk.label,
      });
    }
  }

  return out;
}

/** OpenAI-compatible base URL */
export function getApiBaseUrl(provider: string): string {
  return provider === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://openrouter.ai/api/v1';
}

/** Best text model for provider */
export function getTextModel(provider: string): string {
  return provider === 'groq'
    ? 'llama-3.3-70b-versatile'
    : 'google/gemini-2.5-flash';
}

/** Best vision model for provider */
export function getVisionModel(provider: string): string {
  return provider === 'groq'
    ? 'llama-3.2-11b-vision-preview'
    : 'google/gemini-2.5-flash';
}

/** Build standard request headers */
export function buildHeaders(provider: string, key: string): Record<string, string> {
  const trimmedKey = typeof key === 'string' ? key.trim() : '';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${trimmedKey}`,
    'HTTP-Referer': 'https://visionavaxforex.onspace.app',
    'X-Title': 'VISION AVAX FOREX',
  };
}
