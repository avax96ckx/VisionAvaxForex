// Shared key resolver for all edge functions
// Handles primary keys + backup key chain + manual assignments
// + AI routing + usage logging

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

/**
 * Detect which provider a key likely belongs to based on prefix.
 */
export function detectKeyProvider(key: string): string {
  const k = (key || '').trim();

  if (k.startsWith('sk-or-v1-')) {
    return 'OpenRouter';
  }

  if (k.startsWith('gsk_')) {
    return 'Groq';
  }

  if (
    k.startsWith('sk-proj-') ||
    (k.startsWith('sk-') && !k.startsWith('sk-or-'))
  ) {
    return 'OpenAI';
  }

  if (k.startsWith('AQ.') || k.startsWith('AIza')) {
    return 'Google AI Studio';
  }

  if (k.startsWith('sk_')) {
    return 'ElevenLabs';
  }

  return 'unknown provider';
}

/**
 * Validate that a key format matches the intended provider.
 *
 * Returns:
 *   null  -> valid
 *   string -> error message
 */
export function validateKeyForProvider(
  key: string,
  provider: string
): string | null {
  const k = (key || '').trim();

  if (!k || k.length < 10) {
    return 'Key is too short (minimum 10 characters)';
  }

  const normalizedProvider = (provider || '').toLowerCase();

  if (normalizedProvider === 'openrouter') {
    if (!k.startsWith('sk-or-v1-')) {
      const detected = detectKeyProvider(k);

      return (
        `Wrong key format for OpenRouter. ` +
        `OpenRouter keys must start with "sk-or-v1-". ` +
        `This key appears to be from ${detected}. ` +
        `Get your key from OpenRouter.`
      );
    }
  }

  if (normalizedProvider === 'groq') {
    if (!k.startsWith('gsk_')) {
      const detected = detectKeyProvider(k);

      return (
        `Wrong key format for Groq. ` +
        `Groq keys must start with "gsk_". ` +
        `This key appears to be from ${detected}. ` +
        `Get your key from the Groq console.`
      );
    }
  }

  return null;
}

/**
 * Fire-and-forget usage logger.
 * Logging failure must never break an AI request.
 */
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
  try {
    supabaseAdmin
      .from('api_usage_logs')
      .insert(entry)
      .then(() => {})
      .catch((e: any) => {
        console.warn(
          'Usage log skipped:',
          String(e).slice(0, 120)
        );
      });
  } catch (e) {
    console.warn(
      'Usage logger error:',
      String(e).slice(0, 120)
    );
  }
}

/**
 * Resolve ordered list of API keys to try.
 *
 * Priority:
 *
 * 1. Admin-pinned backup
 * 2. Primary DB key
 * 3. Environment variable fallback
 * 4. Remaining backup keys
 *
 * AI routing:
 * apiKeys.ai_routing[featureName]
 *
 * Supported providers:
 * - groq
 * - openrouter
 */
export function resolveKeyChain(
  apiKeys: Record<string, any>,
  taskType: 'image' | 'text',
  featureName?: string,
): KeyEntry[] {
  const out: KeyEntry[] = [];

  if (!apiKeys) {
    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // Backup keys
  // ─────────────────────────────────────────────────────────────

  const backupKeys: BackupKey[] = Array.isArray(
    apiKeys.backup_keys
  )
    ? apiKeys.backup_keys.filter(
        (k: any) =>
          k &&
          typeof k.key === 'string' &&
          k.key.trim().length > 10
      )
    : [];

  // ─────────────────────────────────────────────────────────────
  // Admin assignments
  // ─────────────────────────────────────────────────────────────

  const assignments: Record<string, string> =
    apiKeys.assignments || {};

  // ─────────────────────────────────────────────────────────────
  // AI routing
  // ─────────────────────────────────────────────────────────────

  const aiRouting: Record<string, string> =
    apiKeys.ai_routing || {};

  const routedProvider =
    featureName
      ? String(aiRouting[featureName] || '').toLowerCase()
      : '';

  // ─────────────────────────────────────────────────────────────
  // Determine primary provider
  // ─────────────────────────────────────────────────────────────

  const primaryProvider =
    routedProvider === 'openrouter' ||
    routedProvider === 'groq'
      ? routedProvider
      : taskType === 'image'
        ? 'openrouter'
        : 'groq';

  // ─────────────────────────────────────────────────────────────
  // Primary DB key
  // ─────────────────────────────────────────────────────────────

  const primaryKey = String(
    apiKeys[primaryProvider] || ''
  ).trim();

  // ─────────────────────────────────────────────────────────────
  // Environment fallback key
  // ─────────────────────────────────────────────────────────────

  const envKey = String(
    apiKeys[`_env_${primaryProvider}`] || ''
  ).trim();

  // ─────────────────────────────────────────────────────────────
  // Admin assignment
  // ─────────────────────────────────────────────────────────────

  const assignedId =
    assignments[taskType] || 'primary';

  // ─────────────────────────────────────────────────────────────
  // Backups belonging to this task type
  // ─────────────────────────────────────────────────────────────

  const taskBackups = backupKeys.filter(
    (k) => k.task_type === taskType
  );

  // ═════════════════════════════════════════════════════════════
  // 1. ADMIN-PINNED BACKUP
  // ═════════════════════════════════════════════════════════════

  if (assignedId !== 'primary') {
    const pinned = taskBackups.find(
      (k) => k.id === assignedId
    );

    if (pinned) {
      const keyTrimmed = pinned.key.trim();

      const pinProvider = (
        pinned.provider ||
        primaryProvider
      ).toLowerCase();

      const formatErr =
        validateKeyForProvider(
          keyTrimmed,
          pinProvider
        );

      if (formatErr) {
        console.warn(
          `resolveKeyChain: skipping pinned key ` +
          `[${pinned.label}] — ${formatErr}`
        );
      } else {
        out.push({
          id: pinned.id,
          key: keyTrimmed,
          provider: pinProvider,
          label: pinned.label,
        });
      }
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 2. PRIMARY DATABASE KEY
  // ═════════════════════════════════════════════════════════════

  if (
    primaryKey &&
    !out.find((e) => e.id === 'primary')
  ) {
    const formatErr =
      validateKeyForProvider(
        primaryKey,
        primaryProvider
      );

    if (formatErr) {
      console.warn(
        `resolveKeyChain: primary key format issue — ` +
        `${formatErr}`
      );
    } else {
      out.push({
        id: 'primary',
        key: primaryKey,
        provider: primaryProvider,
        label:
          primaryProvider === 'openrouter'
            ? 'Primary OpenRouter'
            : 'Primary Groq',
      });
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 3. ENVIRONMENT VARIABLE FALLBACK
  // ═════════════════════════════════════════════════════════════

  if (
    envKey &&
    envKey !== primaryKey &&
    !out.find((e) => e.key === envKey)
  ) {
    const formatErr =
      validateKeyForProvider(
        envKey,
        primaryProvider
      );

    if (!formatErr) {
      out.push({
        id: 'env_fallback',
        key: envKey,
        provider: primaryProvider,
        label:
          primaryProvider === 'openrouter'
            ? 'System Env OpenRouter'
            : 'System Env Groq',
      });
    } else {
      console.warn(
        `resolveKeyChain: environment key rejected — ` +
        `${formatErr}`
      );
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 4. REMAINING BACKUP KEYS
  // ═════════════════════════════════════════════════════════════

  for (const bk of taskBackups) {
    if (out.find((e) => e.id === bk.id)) {
      continue;
    }

    const keyTrimmed = bk.key.trim();

    const bkProvider = (
      bk.provider ||
      primaryProvider
    ).toLowerCase();

    const formatErr =
      validateKeyForProvider(
        keyTrimmed,
        bkProvider
      );

    if (formatErr) {
      console.warn(
        `resolveKeyChain: skipping backup ` +
        `[${bk.label}] — ${formatErr}`
      );
      continue;
    }

    out.push({
      id: bk.id,
      key: keyTrimmed,
      provider: bkProvider,
      label: bk.label,
    });
  }

  // ═════════════════════════════════════════════════════════════
  // LOG RESULT
  // ═════════════════════════════════════════════════════════════

  if (out.length === 0) {
    console.warn(
      `resolveKeyChain: NO valid keys found ` +
      `for task=${taskType} feature=${featureName}. ` +
      `Make sure a valid ${
        primaryProvider === 'openrouter'
          ? 'OpenRouter (sk-or-v1-...)'
          : 'Groq (gsk_...)'
      } key is configured.`
    );
  } else {
    console.log(
      `resolveKeyChain: ${out.length} valid key(s) ` +
      `ready for ${featureName || taskType}: ` +
      `${out.map((k) => k.label).join(', ')}`
    );
  }

  return out;
}

/**
 * OpenAI-compatible API base URL.
 */
export function getApiBaseUrl(
  provider: string
): string {
  const normalizedProvider =
    (provider || '').toLowerCase();

  if (normalizedProvider === 'groq') {
    return 'https://api.groq.com/openai/v1';
  }

  if (normalizedProvider === 'openrouter') {
    return 'https://openrouter.ai/api/v1';
  }

  // Safe fallback
  return 'https://openrouter.ai/api/v1';
}

/**
 * Best text model for each provider.
 *
 * Groq:
 * openai/gpt-oss-20b
 *
 * OpenRouter:
 * google/gemini-2.5-flash
 */
export function getTextModel(
  provider: string
): string {
  const normalizedProvider =
    (provider || '').toLowerCase();

  if (normalizedProvider === 'groq') {
    return 'openai/gpt-oss-20b';
  }

  return 'google/gemini-2.5-flash';
}

/**
 * Best vision model for each provider.
 *
 * Groq:
 * meta-llama/llama-4-scout-17b-16e-instruct
 *
 * OpenRouter:
 * google/gemini-2.5-flash
 */
export function getVisionModel(
  provider: string
): string {
  const normalizedProvider =
    (provider || '').toLowerCase();

  if (normalizedProvider === 'groq') {
    return 'meta-llama/llama-4-scout-17b-16e-instruct';
  }

  return 'google/gemini-2.5-flash';
}

/**
 * Build standard OpenAI-compatible request headers.
 */
export function buildHeaders(
  provider: string,
  key: string
): Record<string, string> {
  const trimmedKey =
    typeof key === 'string'
      ? key.trim()
      : '';

  const normalizedProvider =
    (provider || '').toLowerCase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${trimmedKey}`,
  };

  // OpenRouter-specific headers
  if (normalizedProvider === 'openrouter') {
    headers['HTTP-Referer'] =
      'https://vision-avax-forex.vercel.app';

    headers['X-Title'] =
      'VISION AVAX FOREX';
  }

  return headers;
}
