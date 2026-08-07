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

/** Detect which provider a key likely belongs to based on prefix */
export function detectKeyProvider(key: string): string {
  const k = (key || '').trim();
  if (k.startsWith('sk-or-v1-')) return 'OpenRouter';
  if (k.startsWith('gsk_')) return 'Groq';
  if (k.startsWith('sk-proj-') || (k.startsWith('sk-') && !k.startsWith('sk-or-'))) return 'OpenAI';
  if (k.startsWith('AQ.') || k.startsWith('AIza')) return 'Google AI Studio';
  if (k.startsWith('sk_')) return 'ElevenLabs';
  return 'unknown provider';
}

/**
 * Validate that a key format matches the intended provider.
 * Returns null if valid, or an error string if mismatched.
 */
export function validateKeyForProvider(key: string, provider: string): string | null {
  const k = (key || '').trim();
  if (!k || k.length < 10) return `Key is too short (minimum 10 characters)`;

  if (provider === 'openrouter') {
    if (!k.startsWith('sk-or-v1-')) {
      const detected = detectKeyProvider(k);
      return `Wrong key format for OpenRouter. OpenRouter keys must start with "sk-or-v1-". This key appears to be from ${detected}. Get your key at openrouter.ai/keys`;
    }
  } else if (provider === 'groq') {
    if (!k.startsWith('gsk_')) {
      const detected = detectKeyProvider(k);
      return `Wrong key format for Groq. Groq keys must start with "gsk_". This key appears to be from ${detected}. Get your key at console.groq.com/keys`;
    }
  }
  return null; // Valid
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
 *  2. Primary DB key (format-validated)
 *  3. Env-variable fallback (safety net)
 *  4. Remaining backup keys (format-validated only)
 *
 * AI-routing: if apiKeys.ai_routing[featureName] is set, that provider is preferred.
 * Keys with mismatched format are SKIPPED and logged.
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
  // env safety-net (passed as _env_<provider> by each function)
  const envKey = (apiKeys[`_env_${primaryProvider}`] || '').trim();
  const assignedId = assignments[taskType] || 'primary';

  // All backups for this task type (any provider — we validate format)
  const taskBackups = backupKeys.filter((k) => k.task_type === taskType);

  // 1. Admin-pinned backup
  if (assignedId !== 'primary') {
    const pinned = taskBackups.find((k) => k.id === assignedId);
    if (pinned) {
      const keyTrimmed = pinned.key.trim();
      const pinProvider = pinned.provider || primaryProvider;
      const formatErr = validateKeyForProvider(keyTrimmed, pinProvider);
      if (formatErr) {
        console.warn(`resolveKeyChain: skipping pinned key [${pinned.label}] — ${formatErr}`);
      } else {
        out.push({ id: pinned.id, key: keyTrimmed, provider: pinProvider, label: pinned.label });
      }
    }
  }

  // 2. Primary DB key (validate format)
  if (primaryKey && !out.find((e) => e.id === 'primary')) {
    const formatErr = validateKeyForProvider(primaryKey, primaryProvider);
    if (formatErr) {
      console.warn(`resolveKeyChain: primary key format issue — ${formatErr}`);
    } else {
      out.push({
        id: 'primary',
        key: primaryKey,
        provider: primaryProvider,
        label: `Primary ${primaryProvider === 'openrouter' ? 'OpenRouter' : 'Groq'}`,
      });
    }
  }

  // 3. Env variable safety-net (validate format)
  if (envKey && envKey !== primaryKey && !out.find((e) => e.key === envKey)) {
    const formatErr = validateKeyForProvider(envKey, primaryProvider);
    if (!formatErr) {
      out.push({
        id: 'env_fallback',
        key: envKey,
        provider: primaryProvider,
        label: `System Env ${primaryProvider === 'openrouter' ? 'OpenRouter' : 'Groq'}`,
      });
    }
  }

  // 4. Remaining backup keys — validate format before adding
  for (const bk of taskBackups) {
    if (out.find((e) => e.id === bk.id)) continue;
    const keyTrimmed = bk.key.trim();
    const bkProvider = bk.provider || primaryProvider;
    const formatErr = validateKeyForProvider(keyTrimmed, bkProvider);
    if (formatErr) {
      console.warn(`resolveKeyChain: skipping backup [${bk.label}] — ${formatErr}`);
      continue;
    }
    out.push({ id: bk.id, key: keyTrimmed, provider: bkProvider, label: bk.label });
  }

  if (out.length === 0) {
    console.warn(`resolveKeyChain: NO valid keys found for task=${taskType} feature=${featureName}. Make sure to save a valid ${primaryProvider === 'openrouter' ? 'OpenRouter (sk-or-v1-...)' : 'Groq (gsk_...)'} key in Admin → API Keys.`);
  } else {
    console.log(`resolveKeyChain: ${out.length} valid key(s) ready for ${featureName || taskType}: ${out.map(k => k.label).join(', ')}`);
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

/**
 * Best vision model for provider.
 * ⚠️ llama-3.2-11b-vision-preview is DECOMMISSIONED by Groq.
 * Use meta-llama/llama-4-scout-17b-16e-instruct instead.
 */
export function getVisionModel(provider: string): string {
  return provider === 'groq'
    ? 'meta-llama/llama-4-scout-17b-16e-instruct'  // ✅ Llama 4 Scout — supports vision
    : 'google/gemini-2.5-flash';                    // ✅ OpenRouter vision model
}

/** Build standard request headers */
export function buildHeaders(provider: string, key: string): Record<string, string> {
  const trimmedKey = typeof key === 'string' ? key.trim() : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${trimmedKey}`,
  };
  // OpenRouter requires these extra headers
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://vision-avax-forex.vercel.app';
    headers['X-Title'] = 'VISION AVAX FOREX';
  }
  return headers;
}
