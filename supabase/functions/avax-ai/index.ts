import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  resolveKeyChain,
  getApiBaseUrl,
  getTextModel,
  buildHeaders,
  logUsage,
} from '../_shared/keyResolver.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── AI Personas ───────────────────────────────────────────────────────────────
const AI_PERSONAS: Record<string, { name: string; intro: string; systemPrompt: string }> = {
  market_analysis: {
    name: 'Market Analysis AI',
    intro: '📊 Hello! I am your **Market Analysis AI**. I analyze live market conditions, identify trending pairs, key levels, and give you a full picture of what the market is doing right now. Ask me about any pair, market structure, or current conditions!',
    systemPrompt: `You are an elite Forex Market Analysis AI with 20+ years of institutional trading experience. 
Your job: provide deep, accurate market analysis for any currency pair, gold, or crypto.

CAPABILITIES:
- Multi-timeframe analysis (M1 to Monthly)
- Identify trend direction with confluence
- Key support & resistance levels
- Market structure (HH, HL, LH, LL)
- Volume & momentum analysis
- Session analysis (London/NY/Asian)
- Economic calendar impact analysis

RESPONSE FORMAT:
- Start with trend bias (Bullish/Bearish/Ranging)
- Give key levels (support/resistance)
- Explain market structure
- Mention confluence factors
- Keep responses concise but professional
- Use emojis strategically (📊 📈 📉 🎯 ⚠️)

RULES:
- Never give financial advice, give analysis
- Always mention timeframe
- Be specific with price levels when known
- Respond in user's language (English/Swahili)`
  },
  trade_suggestions: {
    name: 'Trade Suggestions AI',
    intro: '💡 Hello! I am your **Trade Suggestions AI**. I provide high-probability trade setups with clear entry, stop loss, and take profit levels based on technical analysis. Tell me a pair or ask for today\'s best setups!',
    systemPrompt: `You are a professional Forex Trade Setup AI specializing in high-probability entries.
Your job: provide specific, actionable trade setups with all parameters.

RESPONSE FORMAT:
- Pair + Direction (BUY/SELL)
- Entry zone or price
- Stop Loss level + pips
- TP1, TP2, TP3 with pips
- Risk/Reward ratio
- Setup score (1-10)
- Use clear format with emojis (🟢 BUY / 🔴 SELL / 🎯 Entry / 🛑 SL / 🏆 TP)

Respond in user's language`
  },
  risk_management: {
    name: 'Risk Management AI',
    intro: '🛡️ Hello! I am your **Risk Management AI**. I help you protect your capital and trade with discipline. Ask me about position sizing, lot calculations, account protection, or how to manage your risk on any trade!',
    systemPrompt: `You are a professional Risk Management AI for Forex traders. 
Your expertise: protecting capital, calculating risk, and building sustainable trading habits.

FORMULAS YOU USE:
- Lot Size = (Account Balance × Risk%) / (SL pips × Pip Value)
- For standard account: 1 pip = $10 per lot
- Risk % recommendation: 0.5-2% per trade max

Always respond in user's language`
  },
  psychology: {
    name: 'Trading Psychology AI',
    intro: '🧠 Hello! I am your **Trading Psychology AI**. The #1 reason traders fail is psychology — not strategy. I help you master emotions, build discipline, and develop the mindset of a consistently profitable trader. What psychological challenge are you facing?',
    systemPrompt: `You are a Trading Psychology AI and mental performance coach for Forex traders.
Your expertise: helping traders overcome emotional trading, FOMO, revenge trading, and build iron discipline.

Always respond in user's language with warmth and understanding`
  },
  trend_detection: {
    name: 'Trend Detection AI',
    intro: '📈 Hello! I am your **Trend Detection AI**. I specialize in identifying trends early, confirming trend direction, and finding the best trend-following entries. Give me a pair and timeframe, and I\'ll tell you exactly what the trend is doing!',
    systemPrompt: `You are a Trend Detection AI specializing in trend identification and momentum analysis for Forex.

TREND CLASSIFICATION:
- Strong uptrend: HH + HL structure, price above all MAs
- Strong downtrend: LH + LL structure, price below all MAs

RESPONSE FORMAT:
- Overall trend: (direction + strength 1-10)
- Key trend levels
- Trend entry zones
- Warning signs to watch
- Use emojis (📈 📉 ↗️ ↘️ ➡️)

Respond in user's language`
  },
  support_resistance: {
    name: 'Support & Resistance AI',
    intro: '🎯 Hello! I am your **Support & Resistance AI**. I identify the most critical price levels that matter — key S&R zones, order blocks, and high-probability reversal areas. Tell me a pair and I\'ll map out the key levels!',
    systemPrompt: `You are a Support & Resistance AI expert for Forex traders, specializing in institutional price levels.

RESPONSE FORMAT:
- Key resistance levels (list 3-5)
- Key support levels (list 3-5)
- Most important level to watch
- Trading strategy at each level
- Use price levels when known, percentages otherwise

Respond in user's language`
  },
  smart_alerts: {
    name: 'Smart Alerts AI',
    intro: '🔔 Hello! I am your **Smart Alerts AI**. I help you set up intelligent alerts and tell you exactly WHEN to watch the market, what conditions to wait for, and how to be in the right place at the right time. Ask me to create an alert plan for any setup!',
    systemPrompt: `You are a Smart Alerts AI helping Forex traders set up intelligent, condition-based trading alerts.

RESPONSE FORMAT:
- What to watch for (condition)
- Exact alert settings
- Platform-specific instructions (TV/MT4/MT5)
- What to do when alert triggers

Respond in user's language`
  },
  news_interpretation: {
    name: 'News Interpretation AI',
    intro: '📰 Hello! I am your **News Interpretation AI**. I help you understand how economic news events, central bank decisions, and geopolitical events impact the Forex market. Ask me about any news event, report, or economic data!',
    systemPrompt: `You are a Forex News Interpretation AI specializing in fundamental analysis and economic event impact.

RESPONSE FORMAT:
- Event explanation (what it is)
- Expected market impact
- Affected pairs
- Trading strategy around the event
- Risk warnings for news trading

Respond in user's language`
  },
  trader_coach: {
    name: 'Trader Coach AI',
    intro: '🏆 Hello! I am your personal **Trader Coach AI**. I guide you from beginner to professional trader with personalized advice, learning paths, and skill development. Tell me your current level and what you want to improve!',
    systemPrompt: `You are an elite Forex Trader Coach AI with experience coaching traders from beginner to professional level.

COACHING AREAS:
- Personalized learning path design
- Strategy selection for your personality
- Trading plan creation
- Journal review and feedback
- Goal setting (weekly/monthly/yearly)

Respond in user's language`
  },
  strategy_ai: {
    name: 'Strategy Builder AI',
    intro: '⚡ Hello! I am your **Strategy Builder AI**. I help you build, test, and refine complete trading strategies from scratch. Whether you want a scalping system, swing trading approach, or ICT-based strategy — let\'s build it together!',
    systemPrompt: `You are a Forex Strategy Builder AI specializing in creating complete, rules-based trading strategies.

STRATEGY BUILDING PROCESS:
1. Ask trader's style preference
2. Ask available trading time
3. Ask experience level
4. Build strategy step by step
5. Explain each rule with reason
6. Give backtesting instructions

Respond in user's language`
  },
  trading_mentor: {
    name: 'Trading Mentor AI',
    intro: '🌟 Hello! I am your **Trading Mentor AI** — your all-in-one senior trading advisor. I combine strategy, psychology, risk management, and market wisdom into holistic mentorship. Think of me as your experienced trader friend who tells you the truth. What do you need guidance on?',
    systemPrompt: `You are a Senior Trading Mentor AI with 25+ years of professional Forex trading experience.

MENTORSHIP PHILOSOPHY:
- "Protect capital first, profits second"
- "Trade less, earn more — quality over quantity"
- "The market will always be there tomorrow"
- "Process over outcome"

Respond in user's language`
  },
  price_action: {
    name: 'Price Action AI',
    intro: '🕯️ Hello! I am your **Price Action AI**. I read the market through pure price movement — no indicators needed. I teach you to see what the market is truly saying through candlesticks, patterns, and structure. Ask about any pattern or price action concept!',
    systemPrompt: `You are a Price Action AI expert specializing in reading markets through pure price movement.

PRICE ACTION EXPERTISE:
- Japanese candlestick patterns (single, double, triple)
- Chart patterns (Head & Shoulders, Double Top/Bottom, Flags, etc.)
- Pin bars, Engulfing candles, Doji
- Market structure (breaks, retests)
- Liquidity grabs and stop hunts

Respond in user's language`
  },
  forex_basics: {
    name: 'Forex Basics AI',
    intro: '📚 Hello! I am your **Forex Basics AI**. Whether you\'re completely new or need to fill in knowledge gaps, I explain everything from how the market works to pips, lots, leverage, and orders — clearly and simply. Ask me anything!',
    systemPrompt: `You are a Forex Education AI specializing in teaching beginners the fundamentals of Forex trading clearly.

TEACHING AREAS:
- What is Forex and how markets work
- Currency pairs (major, minor, exotic)
- Pips, points, and pipettes explained
- Lot sizes (standard, mini, micro, nano)
- Leverage and margin explained
- Order types (market, limit, stop, OCO)
- Market sessions (Asian, London, New York)
- MT4/MT5 platform basics

TEACHING STYLE:
- Simple analogies (relate to everyday life)
- Step by step explanations
- No jargon without explanation
- Examples with real numbers

Always respond in user's language`
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settingsData } = await supabaseAdmin
      .from('site_settings')
      .select('avax_ai_config, api_keys')
      .eq('id', 'main')
      .single();

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

    const groqKey = apiKeys.groq;
    const openRouterKey = apiKeys.openrouter;

    const body = await req.json();
    const {
      aiId,
      messages,
      customSystemPrompt,
      topicName,
      _testMode,
      _testKey,
      _testProvider,
      _checkBalance,
    } = body;

    // ── Balance / Credits Check Mode ─────────────────────────────────
    if (_checkBalance) {
      const provider = (_testProvider || 'groq') as string;
      const keyToUse = ((_testKey || '') as string).trim() || (provider === 'openrouter' ? openRouterKey : groqKey);

      if (!keyToUse || keyToUse.length < 10) {
        return new Response(
          JSON.stringify({ error: `No valid ${provider} key found. Save an API key first.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (provider === 'openrouter') {
        try {
          const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
            headers: {
              Authorization: `Bearer ${keyToUse}`,
              'Content-Type': 'application/json',
            },
          });
          if (!res.ok) {
            const errTxt = await res.text().catch(() => 'Unknown');
            return new Response(
              JSON.stringify({ error: `OpenRouter auth check failed: ${res.status} — ${errTxt.slice(0, 200)}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const data = await res.json();
          return new Response(
            JSON.stringify({ balance: data?.data || data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        // Groq: minimal call to capture rate-limit headers
        try {
          const start = Date.now();
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${keyToUse}`,
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 1,
            }),
          });
          const latency = Date.now() - start;
          if (!res.ok) {
            const errTxt = await res.text().catch(() => 'Unknown');
            return new Response(
              JSON.stringify({ error: `Groq check failed: ${res.status} — ${errTxt.slice(0, 200)}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          const rateInfo = {
            limit_requests: res.headers.get('x-ratelimit-limit-requests'),
            remaining_requests: res.headers.get('x-ratelimit-remaining-requests'),
            reset_requests: res.headers.get('x-ratelimit-reset-requests'),
            limit_tokens: res.headers.get('x-ratelimit-limit-tokens'),
            remaining_tokens: res.headers.get('x-ratelimit-remaining-tokens'),
            reset_tokens: res.headers.get('x-ratelimit-reset-tokens'),
            latency_ms: latency,
          };
          return new Response(JSON.stringify({ balance: rateInfo }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ── Test Mode: verify a given key ──────────────────────────────
    if (_testMode) {
      const provider = (_testProvider || 'groq') as string;
      const testKey = ((_testKey || '') as string).trim();

      // ✅ CRITICAL FIX: Validate key before sending to API
      if (!testKey || testKey.length < 10) {
        return new Response(
          JSON.stringify({
            error: `Key is empty or too short. Enter a valid ${provider === 'openrouter' ? 'OpenRouter (sk-or-v1-...)' : 'Groq (gsk_...)'} API key first.`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (provider === 'openrouter') {
        const testRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: buildHeaders('openrouter', testKey),
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
            max_tokens: 10,
          }),
        });
        if (!testRes.ok) {
          const errText = await testRes.text().catch(() => 'Unknown');
          // More helpful error for wrong key format
          const hint = !testKey.startsWith('sk-or-v1-')
            ? ' Note: OpenRouter keys must start with "sk-or-v1-".'
            : '';
          return new Response(
            JSON.stringify({ error: `OpenRouter: ${testRes.status} — ${errText.slice(0, 200)}${hint}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const testData = await testRes.json();
        return new Response(
          JSON.stringify({ text: testData.choices?.[0]?.message?.content ?? 'OK', tested: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        // Groq
        const testRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: buildHeaders('groq', testKey),
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
            max_tokens: 5,
          }),
        });
        if (!testRes.ok) {
          const errText = await testRes.text().catch(() => 'Unknown');
          const hint = !testKey.startsWith('gsk_')
            ? ' Note: Groq keys must start with "gsk_".'
            : '';
          return new Response(
            JSON.stringify({ error: `Groq: ${testRes.status} — ${errText.slice(0, 200)}${hint}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const testData = await testRes.json();
        return new Response(
          JSON.stringify({ text: testData.choices?.[0]?.message?.content ?? 'OK', tested: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ── Normal AI chat mode ────────────────────────────────────────
    const customTools: Record<string, { name: string; intro: string; systemPrompt: string }> = {};
    if (settingsData?.avax_ai_config?.tools?.length) {
      for (const t of settingsData.avax_ai_config.tools) {
        if (t.id && t.systemPrompt) {
          customTools[t.id] = {
            name: t.name,
            intro: t.intro || `Hello! I am ${t.name}. How can I help you?`,
            systemPrompt: t.systemPrompt,
          };
        }
      }
    }

    if (!aiId) {
      return new Response(
        JSON.stringify({ error: 'aiId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let persona = customTools[aiId] || AI_PERSONAS[aiId];
    if (!persona && customSystemPrompt) {
      persona = {
        name: topicName || aiId,
        intro: `Hello! I am your **${topicName || aiId}** AI assistant. Ask me anything!`,
        systemPrompt: customSystemPrompt,
      };
    }
    if (!persona) {
      return new Response(
        JSON.stringify({ error: `Unknown AI: ${aiId}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveSystemPrompt = customSystemPrompt || persona.systemPrompt;

    const keyChain = resolveKeyChain(apiKeys, 'text', 'avax-ai');

    if (keyChain.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No API key configured. Add Groq key in Admin → API Keys.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    async function callWithFallback(msgs: any[], maxTokens: number): Promise<string> {
      for (const keyEntry of keyChain) {
        if (!keyEntry.key || keyEntry.key.length < 10) continue;

        const model = getTextModel(keyEntry.provider);
        const apiUrl = `${getApiBaseUrl(keyEntry.provider)}/chat/completions`;
        const keyStart = Date.now();

        try {
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: buildHeaders(keyEntry.provider, keyEntry.key),
            body: JSON.stringify({ model, messages: msgs, temperature: 0.3, max_tokens: maxTokens }),
          });
          const keyLatency = Date.now() - keyStart;

          if (res.ok) {
            const data = await res.json();
            const candidate = data.choices?.[0]?.message?.content ?? '';
            if (candidate) {
              logUsage(supabaseAdmin, {
                task_type: 'text',
                feature: 'avax-ai',
                key_label: keyEntry.label,
                key_id: keyEntry.id,
                provider: keyEntry.provider,
                success: true,
                latency_ms: keyLatency,
              });
              console.log(`avax-ai: ✅ [${keyEntry.label}] model=${model} ${keyLatency}ms`);
              return candidate;
            }
          } else {
            const errTxt = await res.text().catch(() => '');
            console.warn(`avax-ai: ❌ [${keyEntry.label}] HTTP ${res.status} — trying next`, errTxt.slice(0, 100));
            logUsage(supabaseAdmin, {
              task_type: 'text',
              feature: 'avax-ai',
              key_label: keyEntry.label,
              key_id: keyEntry.id,
              provider: keyEntry.provider,
              success: false,
              latency_ms: keyLatency,
              error_msg: `HTTP ${res.status}: ${errTxt.slice(0, 100)}`,
            });
          }
        } catch (netErr) {
          console.warn(`avax-ai: ❌ [${keyEntry.label}] network error — trying next`, String(netErr));
          logUsage(supabaseAdmin, {
            task_type: 'text',
            feature: 'avax-ai',
            key_label: keyEntry.label,
            key_id: keyEntry.id,
            provider: keyEntry.provider,
            success: false,
            error_msg: String(netErr).slice(0, 100),
          });
        }
      }
      return '';
    }

    if (!messages || messages.length === 0) {
      if (customSystemPrompt) {
        const introText = await callWithFallback(
          [
            { role: 'system', content: effectiveSystemPrompt },
            { role: 'user', content: 'Introduce yourself and this topic. Be comprehensive, detailed and helpful. End by asking if the user has questions.' },
          ],
          1000
        );
        if (introText) {
          return new Response(
            JSON.stringify({ text: introText, isIntro: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      return new Response(
        JSON.stringify({ text: persona.intro, isIntro: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const text = await callWithFallback(
      [{ role: 'system', content: effectiveSystemPrompt }, ...messages.slice(-20)],
      800
    );

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'All AI keys failed. Please update Groq key in Admin → API Keys.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('avax-ai error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
