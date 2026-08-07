import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  resolveKeyChain,
  getApiBaseUrl,
  getVisionModel,
  buildHeaders,
  logUsage,
} from '../_shared/keyResolver.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const { challengeId } = await req.json();
    if (!challengeId)
      return new Response(
        JSON.stringify({ error: 'challengeId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settingsForKey } = await supabase
      .from('site_settings')
      .select('api_keys')
      .eq('id', 'main')
      .single();

    const envOpenrouterKey = (Deno.env.get('OPENROUTER_API_KEY') || '').trim();
    const envGroqKey = (Deno.env.get('GROQ_API_KEY') || '').trim();
    const dbOpenrouterKey = (settingsForKey?.api_keys?.openrouter || '').trim();
    const dbGroqKey = (settingsForKey?.api_keys?.groq || '').trim();

    const apiKeys: Record<string, any> = {
      ...(settingsForKey?.api_keys || {}),
      openrouter: dbOpenrouterKey || envOpenrouterKey,
      groq: dbGroqKey || envGroqKey,
      _env_openrouter: envOpenrouterKey,
      _env_groq: envGroqKey,
    };

    // Get pairs with result images
    const { data: pairs } = await supabase
      .from('challenge_pairs')
      .select('*')
      .eq('challenge_id', challengeId)
      .eq('result_published', true)
      .not('result_image_url', 'is', null);

    if (!pairs || pairs.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No pairs with results found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pairIds = pairs.map((p: any) => p.id);
    const { data: submissions } = await supabase
      .from('challenge_submissions')
      .select('*, user_profiles(username)')
      .in('pair_id', pairIds)
      .not('analysis_image_url', 'is', null)
      .eq('is_processed', false);

    if (!submissions || submissions.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No submissions to process' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const keyChain = resolveKeyChain(apiKeys, 'image', 'analyze-challenge');

    if (keyChain.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No image API key configured. Add OpenRouter key in Admin → API Keys.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are a Forex trading expert judge for a trading challenge. 
Your job is to analyze a participant's chart analysis and compare it with the actual result.

Rules:
- Look at the participant's analysis image (entry, stop loss, take profit levels)
- Compare with the result image (actual price movement)
- Determine if the trade would be a WIN or LOSS
- Estimate pips gained (positive) or lost (negative)

Respond ONLY with a JSON object in this exact format:
{"is_win": true/false, "pips": 45.5, "reasoning": "Brief explanation"}

For pips calculation:
- If WIN: positive number (typical forex pip range: 10-200 pips)
- If LOSS: negative number (typical: -10 to -100 pips)
- If analysis image is unclear or no clear trade setup: {"is_win": false, "pips": 0, "reasoning": "No clear setup found"}`;

    let processed = 0;
    for (const sub of submissions) {
      const pair = pairs.find((p: any) => p.id === sub.pair_id);
      if (!pair || !pair.result_image_url || !sub.analysis_image_url) continue;

      let result = { is_win: false, pips: 0 };
      let submissionProcessed = false;

      for (const keyEntry of keyChain) {
        if (!keyEntry.key || keyEntry.key.length < 10) continue;

        const model = getVisionModel(keyEntry.provider);
        const apiUrl = `${getApiBaseUrl(keyEntry.provider)}/chat/completions`;
        const keyStart = Date.now();

        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: buildHeaders(keyEntry.provider, keyEntry.key),
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: `Pair: ${pair.pair_name}. First image is participant's analysis. Second image is the actual result. Analyze and return JSON.`,
                    },
                    { type: 'image_url', image_url: { url: sub.analysis_image_url } },
                    { type: 'image_url', image_url: { url: pair.result_image_url } },
                  ],
                },
              ],
              max_tokens: 200,
            }),
          });

          const keyLatency = Date.now() - keyStart;

          if (response.ok) {
            const aiData = await response.json();
            const content = aiData.choices?.[0]?.message?.content || '';
            try {
              const jsonMatch = content.match(/\{[^}]+\}/);
              if (jsonMatch) result = JSON.parse(jsonMatch[0]);
            } catch { /* use default */ }
            logUsage(supabase, {
              task_type: 'image',
              feature: 'analyze-challenge',
              key_label: keyEntry.label,
              key_id: keyEntry.id,
              provider: keyEntry.provider,
              success: true,
              latency_ms: keyLatency,
            });
            console.log(`analyze-challenge: ✅ [${keyEntry.label}] processed sub ${sub.id}`);
            submissionProcessed = true;
            break;
          } else {
            const errTxt = await response.text().catch(() => '');
            console.warn(`analyze-challenge: ❌ [${keyEntry.label}] HTTP ${response.status} — trying next`, errTxt.slice(0, 100));
            logUsage(supabase, {
              task_type: 'image',
              feature: 'analyze-challenge',
              key_label: keyEntry.label,
              key_id: keyEntry.id,
              provider: keyEntry.provider,
              success: false,
              latency_ms: keyLatency,
              error_msg: `HTTP ${response.status}: ${errTxt.slice(0, 100)}`,
            });
          }
        } catch (err) {
          console.error(`analyze-challenge: ❌ [${keyEntry.label}] error — trying next`, err);
          logUsage(supabase, {
            task_type: 'image',
            feature: 'analyze-challenge',
            key_label: keyEntry.label,
            key_id: keyEntry.id,
            provider: keyEntry.provider,
            success: false,
            error_msg: String(err).slice(0, 100),
          });
        }
      }

      if (!submissionProcessed) {
        console.error(`analyze-challenge: all keys failed for sub ${sub.id}`);
        continue;
      }

      await supabase
        .from('challenge_submissions')
        .update({ pips_gained: result.pips || 0, is_win: result.is_win || false, is_processed: true })
        .eq('id', sub.id);

      processed++;
    }

    // Recalculate total pips + ranks
    const { data: allSubs } = await supabase
      .from('challenge_submissions')
      .select('user_id, pips_gained')
      .eq('challenge_id', challengeId)
      .eq('is_processed', true);

    if (allSubs) {
      const pipsByUser: Record<string, number> = {};
      for (const s of allSubs) {
        pipsByUser[s.user_id] = (pipsByUser[s.user_id] || 0) + (s.pips_gained || 0);
      }
      for (const [userId, totalPips] of Object.entries(pipsByUser)) {
        await supabase
          .from('challenge_participants')
          .update({ total_pips: totalPips })
          .eq('challenge_id', challengeId)
          .eq('user_id', userId);
      }
      const { data: participants } = await supabase
        .from('challenge_participants')
        .select('id, total_pips')
        .eq('challenge_id', challengeId)
        .order('total_pips', { ascending: false });
      if (participants) {
        for (let i = 0; i < participants.length; i++) {
          await supabase.from('challenge_participants').update({ rank: i + 1 }).eq('id', participants[i].id);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('analyze-challenge error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
