import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  resolveKeyChain,
  getApiBaseUrl,
  getVisionModel,
  buildHeaders,
  logUsage,
} from '../_shared/keyResolver.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settingsData } = await supabaseAdmin
      .from('site_settings')
      .select('api_keys')
      .eq('id', 'main')
      .single();

    // Env vars as independent safety nets
    const envOpenrouterKey = (Deno.env.get('OPENROUTER_API_KEY') || '').trim();
    const envGroqKey = (Deno.env.get('GROQ_API_KEY') || '').trim();
    const dbOpenrouterKey = (settingsData?.api_keys?.openrouter || '').trim();
    const dbGroqKey = (settingsData?.api_keys?.groq || '').trim();

    const apiKeys: Record<string, any> = {
      ...(settingsData?.api_keys || {}),
      openrouter: dbOpenrouterKey || envOpenrouterKey,
      groq: dbGroqKey || envGroqKey,
      _env_openrouter: envOpenrouterKey,
      _env_groq: envGroqKey,
    };

    const { imageUrl, mode } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'imageUrl is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── SYSTEM PROMPTS ──────────────────────────────────────────────
    const systemPrompt =
      mode === 'result'
        ? `You are a professional forex trade result analyst. Analyze this trading result screenshot.

EXTRACT:
- result: "win" if profit/green, "loss" if loss/red
- pips: exact pips with sign (e.g. "+45" or "-20"). Calculate from price difference if not shown.
- notes: One sentence describing what happened (max 12 words)

Respond ONLY with this exact JSON format — no extra text, no markdown:
{"result":"win","pips":"+45","notes":"TP hit at resistance, clean breakout entry"}

RULES:
- result must be exactly "win" or "loss"
- pips must include "+" for win, "-" for loss
- If values are unclear, use empty string ""`

        : `You are an expert TradingView chart signal extractor. Analyze this forex/gold/crypto chart screenshot.

EXTRACT ALL signal parameters with maximum accuracy.

DIRECTION DETECTION (CRITICAL):
- Green/up arrow OR "Long" OR "Buy" label = "BUY"
- Red/down arrow OR "Short" OR "Sell" label = "SELL"
- If stop_loss > entry → SELL (price must go DOWN to hit SL above entry)
- If stop_loss < entry → BUY (price must go UP, SL is below)
- Double-check: BUY means entry < take_profit, SELL means entry > take_profit

EXTRACT:
- pair: exact trading pair (e.g. "EUR/USD", "XAU/USD", "BTC/USDT")
- direction: "BUY" or "SELL"
- type: "forex" for currencies, "gold" for XAU/GOLD, "crypto" for BTC/ETH/etc
- entry: entry price as string number
- stop_loss: stop loss price as string number
- take_profit: take profit price as string number (first TP if multiple)
- notes: brief analysis in max 12 words

Respond ONLY with this exact JSON format — no extra text, no markdown:
{"pair":"XAU/USD","direction":"BUY","type":"gold","entry":"2315.50","stop_loss":"2298.00","take_profit":"2345.00","notes":"Bullish OB entry, strong momentum above key level"}

RULES:
- NEVER add text outside the JSON
- If a value is not visible, use empty string ""`;

    const userMsg = {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            mode === 'result'
              ? 'Analyze this trade result screenshot and extract the outcome:'
              : 'Analyze this TradingView chart and extract all signal parameters:',
        },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    };

    // ── Key chain: OpenRouter primary (+ env fallback + backups) ──
    // resolveKeyChain now validates key formats — non-OpenRouter backup keys are auto-skipped
    const keyChain = resolveKeyChain(apiKeys, 'image', 'analyze-signal');

    if (keyChain.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No valid OpenRouter API key configured. Go to Admin → API Keys → Save an OpenRouter key (must start with sk-or-v1-). Note: OpenAI, Google, or ElevenLabs keys will NOT work here.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let rawText = '';
    let usedKeyEntry: typeof keyChain[number] | null = null;

    for (const keyEntry of keyChain) {
      // getVisionModel returns:
      // - 'google/gemini-2.5-flash' for openrouter
      // - 'meta-llama/llama-4-scout-17b-16e-instruct' for groq (llama-3.2-11b deprecated)
      const model = getVisionModel(keyEntry.provider);
      const apiUrl = `${getApiBaseUrl(keyEntry.provider)}/chat/completions`;
      const keyStart = Date.now();

      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: buildHeaders(keyEntry.provider, keyEntry.key),
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: systemPrompt }, userMsg],
            temperature: 0.05,
            max_tokens: 300,
          }),
        });

        const keyLatency = Date.now() - keyStart;

        if (res.ok) {
          const data = await res.json();
          const candidate = data.choices?.[0]?.message?.content ?? '';
          if (candidate) {
            rawText = candidate;
            usedKeyEntry = keyEntry;
            logUsage(supabaseAdmin, {
              task_type: 'image', feature: 'analyze-signal',
              key_label: keyEntry.label, key_id: keyEntry.id, provider: keyEntry.provider,
              success: true, latency_ms: keyLatency,
            });
            console.log(`analyze-signal: ✅ success [${keyEntry.label}] model=${model} ${keyLatency}ms`);
            break;
          }
        } else {
          const errTxt = await res.text().catch(() => '');
          console.warn(
            `analyze-signal: ❌ [${keyEntry.label}] HTTP ${res.status} — trying next`,
            errTxt.slice(0, 150)
          );
          logUsage(supabaseAdmin, {
            task_type: 'image', feature: 'analyze-signal',
            key_label: keyEntry.label, key_id: keyEntry.id, provider: keyEntry.provider,
            success: false, latency_ms: keyLatency,
            error_msg: `HTTP ${res.status}: ${errTxt.slice(0, 100)}`,
          });
        }
      } catch (netErr) {
        console.warn(`analyze-signal: ❌ [${keyEntry.label}] network error — trying next`, String(netErr));
        logUsage(supabaseAdmin, {
          task_type: 'image', feature: 'analyze-signal',
          key_label: keyEntry.label, key_id: keyEntry.id, provider: keyEntry.provider,
          success: false, error_msg: String(netErr).slice(0, 100),
        });
      }
    }

    if (!rawText) {
      return new Response(
        JSON.stringify({
          error:
            'All API keys failed. Fix: Go to Admin → API Keys → Save a valid OpenRouter key (must start with sk-or-v1-). Keys from OpenAI, Google, or ElevenLabs will not work with OpenRouter.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Parse JSON from AI response ──────────────────────────────────
    let parsed: Record<string, string> = {};
    try {
      const jsonMatch =
        rawText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        rawText.match(/(\{[\s\S]*?\})/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

        // Normalize direction
        if (parsed.direction) {
          const d = parsed.direction.toUpperCase().trim();
          parsed.direction = d === 'SELL' || d === 'SHORT' || d === 'S' ? 'SELL' : 'BUY';
        }

        // Auto-correct direction based on SL vs entry
        if (parsed.entry && parsed.stop_loss) {
          const entry = parseFloat(parsed.entry);
          const sl = parseFloat(parsed.stop_loss);
          if (!isNaN(entry) && !isNaN(sl)) {
            if (sl > entry && parsed.direction === 'BUY') parsed.direction = 'SELL';
            else if (sl < entry && parsed.direction === 'SELL') parsed.direction = 'BUY';
          }
        }

        // Auto-detect type from pair
        if (parsed.pair) {
          const p = parsed.pair.toUpperCase();
          if (p.includes('XAU') || p.includes('GOLD')) parsed.type = 'gold';
          else if (['BTC', 'ETH', 'USDT', 'DOGE', 'SOL', 'BNB', 'XRP'].some((c) => p.includes(c)))
            parsed.type = 'crypto';
          else if (!parsed.type) parsed.type = 'forex';
        }
      }
    } catch (e) {
      console.error('JSON parse error:', e, 'raw:', rawText.slice(0, 200));
    }

    return new Response(
      JSON.stringify({ success: true, data: parsed, provider: usedKeyEntry?.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('analyze-signal error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
