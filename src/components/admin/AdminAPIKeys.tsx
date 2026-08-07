import { useState, useEffect } from 'react';
import {
  Key, CheckCircle2, XCircle, Loader2, Save, Eye, EyeOff,
  RefreshCw, Activity, Globe, Shield,
  ChevronDown, ChevronUp, AlertTriangle, BarChart2, CreditCard,
  Gauge, Clock, Plus, Trash2, Camera, MessageSquare, Settings,
  Star, ArrowRightLeft, Zap, List, Info,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────
interface BackupKeyEntry {
  id: string;
  label: string;
  provider: 'openrouter' | 'groq';
  task_type: 'image' | 'text';
  key: string;
  created_at: string;
}
interface Assignments { image: string; text: string; }
interface AiRouting { [featureId: string]: string; }
interface KeyStatus { tested: boolean; working: boolean; latency?: number; error?: string; }
interface BalanceInfo {
  limit_requests?: string | null;
  remaining_requests?: string | null;
  reset_requests?: string | null;
  limit_tokens?: string | null;
  remaining_tokens?: string | null;
  reset_tokens?: string | null;
  latency_ms?: number;
  label?: string;
  usage?: number;
  limit?: number | null;
  is_free_tier?: boolean;
  rate_limit?: { requests: number; interval: string };
}
interface UsageLog {
  id: string;
  task_type: string;
  feature: string;
  key_label: string;
  key_id: string;
  provider: string;
  success: boolean;
  latency_ms?: number;
  error_msg?: string;
  created_at: string;
}
interface HealthResult { feature: string; status: 'ok' | 'error' | 'testing'; latency?: number; error?: string; }

// ── Constants ─────────────────────────────────────────────────────────────────
const PRIMARY_SERVICES = [
  {
    id: 'groq', name: 'Groq Cloud API', taskType: 'text' as const,
    taskLabel: '📝 Text AI', taskDesc: 'AVAX AI Hub, Live Agent, AI Coach',
    description: 'Powers all text-based AI: AVAX AI Hub, Live Agent, Trading Journal AI',
    icon: Zap, color: 'text-orange-400', bgColor: 'rgba(249,115,22,0.15)', accentColor: '#f97316',
    provider: 'groq' as const, placeholder: 'gsk_...', docsUrl: 'https://console.groq.com/keys', docsLabel: 'console.groq.com/keys',
  },
  {
    id: 'openrouter', name: 'OpenRouter API', taskType: 'image' as const,
    taskLabel: '📷 Image AI', taskDesc: 'Signal Analysis, Chart Vision, Challenge AI',
    description: 'Powers all image-based AI: Signal Analysis, Chart Vision (Gemini 2.5 Flash)',
    icon: Globe, color: 'text-blue-400', bgColor: 'rgba(59,130,246,0.15)', accentColor: '#3b82f6',
    provider: 'openrouter' as const, placeholder: 'sk-or-v1-...', docsUrl: 'https://openrouter.ai/keys', docsLabel: 'openrouter.ai/keys',
  },
];

const AI_FEATURES_ROUTING = [
  { id: 'analyze-signal', name: 'Signal Analysis AI', desc: 'Analyzes chart screenshots', defaultProvider: 'openrouter', icon: '📊' },
  { id: 'analyze-challenge', name: 'Challenge AI', desc: 'Compares trader submissions', defaultProvider: 'openrouter', icon: '🏆' },
  { id: 'avax-ai', name: 'AVAX AI Hub', desc: 'All trading education AIs', defaultProvider: 'groq', icon: '🤖' },
  { id: 'live-agent', name: 'Live Agent AI', desc: 'Customer support & admin AI', defaultProvider: 'groq', icon: '💬' },
];

function maskKey(key: string): string {
  if (!key || key.length < 8) return key;
  return key.slice(0, 8) + '•'.repeat(Math.min(18, key.length - 12)) + key.slice(-4);
}
function genId(): string {
  return 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function validateKeyFormat(provider: string, key: string): string | null {
  if (!key || key.length < 10) return null;
  if (provider === 'openrouter' && !key.startsWith('sk-or-v1-')) {
    return 'Warning: OpenRouter keys must start with "sk-or-v1-". This key may be from a different provider.';
  }
  if (provider === 'groq' && !key.startsWith('gsk_')) {
    return 'Warning: Groq keys must start with "gsk_". This key may be from a different provider.';
  }
  return null;
}
function checkIfBalanceLow(provider: string, balance: BalanceInfo): boolean {
  if (provider === 'openrouter') {
    const usage = typeof balance.usage === 'number' ? balance.usage : null;
    const limit = typeof balance.limit === 'number' ? balance.limit : null;
    if (usage !== null && limit !== null && limit > 0) return (limit - usage) / limit < 0.1;
  } else if (provider === 'groq') {
    const remaining = parseInt(balance.remaining_requests || '0');
    const limit = parseInt(balance.limit_requests || '0');
    if (limit > 0) return remaining / limit < 0.1;
  }
  return false;
}

// ── Balance Panels ────────────────────────────────────────────────────────────
function GroqBalancePanel({ b }: { b: BalanceInfo }) {
  const remaining = b.remaining_requests != null ? parseInt(b.remaining_requests) : null;
  const limit = b.limit_requests != null ? parseInt(b.limit_requests) : null;
  const pct = remaining !== null && limit !== null && limit > 0 ? Math.round((remaining / limit) * 100) : null;
  const barColor = pct === null ? '#6b7280' : pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';
  return (
    <div className="space-y-2 p-3 bg-muted/20 border border-border/50 rounded-xl">
      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide flex items-center gap-1">
        <Gauge className="w-3 h-3" /> Groq Rate Limits
        {b.latency_ms !== undefined && <span className="ml-auto font-normal">{b.latency_ms}ms</span>}
      </p>
      {limit !== null && (
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Requests</span>
            <span className="text-[10px] font-bold text-foreground">{remaining}/{limit} {pct !== null && <span className="text-muted-foreground">({pct}% left)</span>}</span>
          </div>
          {pct !== null && (
            <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
            </div>
          )}
          {b.reset_requests && <p className="text-[9px] text-muted-foreground mt-0.5">Resets: {b.reset_requests}</p>}
        </div>
      )}
      {pct !== null && pct < 10 && <p className="text-[10px] text-red-400 font-bold">⚠️ Low credits — top up soon!</p>}
    </div>
  );
}

function OpenRouterBalancePanel({ b }: { b: BalanceInfo }) {
  const usage = typeof b.usage === 'number' ? b.usage : null;
  const limit = typeof b.limit === 'number' ? b.limit : null;
  const pct = usage !== null && limit !== null && limit > 0 ? Math.round(((limit - usage) / limit) * 100) : null;
  const barColor = pct === null ? '#6b7280' : pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444';
  return (
    <div className="space-y-2 p-3 bg-muted/20 border border-border/50 rounded-xl">
      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide flex items-center gap-1">
        <CreditCard className="w-3 h-3" /> OpenRouter Credits
      </p>
      {b.label && <p className="text-xs font-bold text-foreground">{b.label}</p>}
      {b.is_free_tier !== undefined && (
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${b.is_free_tier ? 'bg-green-500/15 text-green-400' : 'bg-blue-500/15 text-blue-400'}`}>
          {b.is_free_tier ? '🆓 Free Tier' : '💳 Paid Account'}
        </span>
      )}
      {usage !== null && (
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Credits Used</span>
            <span className="text-[10px] font-bold text-foreground">${usage.toFixed(4)}{limit !== null && <span className="text-muted-foreground"> / ${limit.toFixed(2)}</span>}</span>
          </div>
          {pct !== null && (
            <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
            </div>
          )}
          {pct !== null && <p className="text-[9px] text-muted-foreground mt-0.5">{pct}% remaining</p>}
        </div>
      )}
      {b.rate_limit && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Rate limit: {b.rate_limit.requests} req / {b.rate_limit.interval}</p>}
      {pct !== null && pct < 10 && <p className="text-[10px] text-red-400 font-bold">⚠️ Low credits — top up soon!</p>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AdminAPIKeys() {
  const [primaryKeys, setPrimaryKeys] = useState<Record<string, string>>({});
  const [savedPrimaryKeys, setSavedPrimaryKeys] = useState<Record<string, string>>({});
  const [showPrimaryKey, setShowPrimaryKey] = useState<Record<string, boolean>>({});
  const [primaryStatuses, setPrimaryStatuses] = useState<Record<string, KeyStatus>>({});
  const [testingPrimary, setTestingPrimary] = useState<Record<string, boolean>>({});
  const [savingPrimary, setSavingPrimary] = useState<Record<string, boolean>>({});
  const [primaryBalances, setPrimaryBalances] = useState<Record<string, BalanceInfo | null>>({});
  const [checkingPrimaryBalance, setCheckingPrimaryBalance] = useState<Record<string, boolean>>({});
  const [backupKeys, setBackupKeys] = useState<BackupKeyEntry[]>([]);
  const [backupStatuses, setBackupStatuses] = useState<Record<string, KeyStatus>>({});
  const [testingBackup, setTestingBackup] = useState<Record<string, boolean>>({});
  const [backupBalances, setBackupBalances] = useState<Record<string, BalanceInfo | null>>({});
  const [checkingBackupBalance, setCheckingBackupBalance] = useState<Record<string, boolean>>({});
  const [showBackupKey, setShowBackupKey] = useState<Record<string, boolean>>({});
  const [newBackup, setNewBackup] = useState({ label: '', provider: 'openrouter' as 'openrouter' | 'groq', task_type: 'image' as 'image' | 'text', key: '', showKey: false });
  const [savingBackup, setSavingBackup] = useState(false);
  const [assignments, setAssignments] = useState<Assignments>({ image: 'primary', text: 'primary' });
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [aiRouting, setAiRouting] = useState<AiRouting>({});
  const [savingRouting, setSavingRouting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showHealth, setShowHealth] = useState(false);
  const [healthResults, setHealthResults] = useState<HealthResult[]>([]);
  const [runningHealth, setRunningHealth] = useState(false);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => { loadSettings(); }, []);

  // Auto balance check after settings load
  useEffect(() => {
    if (loading) return;
    const lastCheck = localStorage.getItem('api_balance_last_check');
    const now = Date.now();
    const TwentyFourH = 24 * 60 * 60 * 1000;
    if (!lastCheck || now - parseInt(lastCheck) > TwentyFourH) {
      const timer = setTimeout(() => runAutoBalanceCheck(), 4000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  async function loadSettings() {
    setLoading(true);
    const { data } = await supabase.from('site_settings').select('api_keys').eq('id', 'main').single();
    if (data?.api_keys) {
      const apiKeys = data.api_keys as Record<string, any>;
      const filled: Record<string, string> = {};
      for (const svc of PRIMARY_SERVICES) {
        if (apiKeys[svc.id]) filled[svc.id] = apiKeys[svc.id];
      }
      setSavedPrimaryKeys(filled);
      setPrimaryKeys(filled);
      if (Array.isArray(apiKeys.backup_keys)) setBackupKeys(apiKeys.backup_keys);
      if (apiKeys.assignments) setAssignments({ image: apiKeys.assignments.image || 'primary', text: apiKeys.assignments.text || 'primary' });
      if (apiKeys.ai_routing) setAiRouting(apiKeys.ai_routing);
    }
    setLoading(false);
  }

  async function getCurrentApiKeys(): Promise<Record<string, any>> {
    const { data } = await supabase.from('site_settings').select('api_keys').eq('id', 'main').single();
    return (data?.api_keys as Record<string, any>) || {};
  }

  async function runAutoBalanceCheck() {
    localStorage.setItem('api_balance_last_check', Date.now().toString());
    for (const svc of PRIMARY_SERVICES) {
      const key = savedPrimaryKeys[svc.id];
      if (!key || key.length < 10) continue;
      try {
        const { data } = await supabase.functions.invoke('avax-ai', {
          body: { aiId: 'forex_basics', _checkBalance: true, _testProvider: svc.provider, _testKey: key },
        });
        if (data?.balance && checkIfBalanceLow(svc.provider, data.balance)) {
          await supabase.from('notifications').insert({
            title: `⚠️ Low API Credits: ${svc.name}`,
            body: `Your ${svc.name} API key is running low on credits (less than 10% remaining). Please top up to avoid service interruptions.`,
            type: 'admin',
            target_user_id: null,
          });
          toast.warning(`⚠️ ${svc.name} is low on credits!`);
        }
      } catch { /* ignore balance check errors */ }
    }
  }

  // ── Primary key: Test ──────────────────────────────────────────
  async function testPrimaryKey(svc: typeof PRIMARY_SERVICES[number]) {
    const keyVal = (primaryKeys[svc.id] || savedPrimaryKeys[svc.id] || '').trim();
    if (!keyVal || keyVal.length < 10) { toast.error('Enter a valid API key first'); return; }
    const formatWarn = validateKeyFormat(svc.provider, keyVal);
    if (formatWarn) toast.warning(formatWarn);
    setTestingPrimary(p => ({ ...p, [svc.id]: true }));
    setPrimaryStatuses(p => ({ ...p, [svc.id]: { tested: false, working: false } }));
    const start = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke('avax-ai', {
        body: { aiId: 'forex_basics', messages: [{ role: 'user', content: 'Reply with exactly: OK' }], _testKey: keyVal, _testProvider: svc.provider, _testMode: true },
      });
      const latency = Date.now() - start;
      if (error) {
        let errMsg = error.message;
        if (error instanceof FunctionsHttpError) { try { errMsg = (await error.context?.text?.()) || error.message; } catch {} }
        setPrimaryStatuses(p => ({ ...p, [svc.id]: { tested: true, working: false, error: errMsg.slice(0, 180) } }));
        toast.error('Test failed: ' + errMsg.slice(0, 100));
      } else if (data?.text || data?.tested) {
        setPrimaryStatuses(p => ({ ...p, [svc.id]: { tested: true, working: true, latency } }));
        toast.success(`✅ ${svc.name} working! (${latency}ms)`);
      } else {
        setPrimaryStatuses(p => ({ ...p, [svc.id]: { tested: true, working: false, error: 'No response from AI' } }));
        toast.error('Empty response from API');
      }
    } catch (err: any) {
      setPrimaryStatuses(p => ({ ...p, [svc.id]: { tested: true, working: false, error: err.message } }));
      toast.error('Test failed: ' + err.message);
    }
    setTestingPrimary(p => ({ ...p, [svc.id]: false }));
  }

  async function savePrimaryKey(svc: typeof PRIMARY_SERVICES[number]) {
    const keyVal = (primaryKeys[svc.id] || '').trim();
    if (!keyVal || keyVal.length < 10) { toast.error('Enter a valid API key'); return; }
    const formatWarn = validateKeyFormat(svc.provider, keyVal);
    if (formatWarn) toast.warning(formatWarn);
    setSavingPrimary(p => ({ ...p, [svc.id]: true }));
    try {
      const existing = await getCurrentApiKeys();
      const { error } = await supabase.from('site_settings').update({ api_keys: { ...existing, [svc.id]: keyVal } } as any).eq('id', 'main');
      if (error) throw error;
      setSavedPrimaryKeys(p => ({ ...p, [svc.id]: keyVal }));
      toast.success(`✅ ${svc.name} key saved!`);
      testPrimaryKey(svc);
    } catch (err: any) { toast.error('Failed to save: ' + err.message); }
    setSavingPrimary(p => ({ ...p, [svc.id]: false }));
  }

  async function checkPrimaryBalance(svc: typeof PRIMARY_SERVICES[number]) {
    const keyVal = (savedPrimaryKeys[svc.id] || primaryKeys[svc.id] || '').trim();
    if (!keyVal || keyVal.length < 10) { toast.error('Save an API key first'); return; }
    setCheckingPrimaryBalance(p => ({ ...p, [svc.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('avax-ai', {
        body: { aiId: 'forex_basics', _checkBalance: true, _testProvider: svc.provider, _testKey: keyVal },
      });
      if (error) {
        let errMsg = error.message;
        if (error instanceof FunctionsHttpError) { try { errMsg = (await error.context?.text?.()) || error.message; } catch {} }
        toast.error('Balance check failed: ' + errMsg.slice(0, 80));
      } else if (data?.balance) {
        setPrimaryBalances(p => ({ ...p, [svc.id]: data.balance }));
        toast.success(`✅ Balance loaded for ${svc.name}`);
      }
    } catch (err: any) { toast.error('Balance check failed: ' + err.message); }
    setCheckingPrimaryBalance(p => ({ ...p, [svc.id]: false }));
  }

  async function saveBackupKey() {
    if (!newBackup.label.trim() || !newBackup.key.trim()) { toast.error('Enter label and key value'); return; }
    if (newBackup.key.length < 10) { toast.error('Key value too short'); return; }
    const formatWarn = validateKeyFormat(newBackup.provider, newBackup.key.trim());
    if (formatWarn) toast.warning(formatWarn);
    setSavingBackup(true);
    try {
      const entry: BackupKeyEntry = {
        id: genId(), label: newBackup.label.trim(), provider: newBackup.provider,
        task_type: newBackup.task_type, key: newBackup.key.trim(), created_at: new Date().toISOString(),
      };
      const existing = await getCurrentApiKeys();
      const currentBackups: BackupKeyEntry[] = Array.isArray(existing.backup_keys) ? existing.backup_keys : [];
      const { error } = await supabase.from('site_settings').update({ api_keys: { ...existing, backup_keys: [...currentBackups, entry] } } as any).eq('id', 'main');
      if (error) throw error;
      setBackupKeys(prev => [...prev, entry]);
      setNewBackup({ label: '', provider: 'openrouter', task_type: 'image', key: '', showKey: false });
      toast.success(`✅ Backup key "${entry.label}" saved!`);
    } catch (err: any) { toast.error('Save failed: ' + err.message); }
    setSavingBackup(false);
  }

  async function deleteBackupKey(id: string) {
    if (!confirm('Delete this backup key?')) return;
    try {
      const existing = await getCurrentApiKeys();
      const currentBackups: BackupKeyEntry[] = Array.isArray(existing.backup_keys) ? existing.backup_keys : [];
      const newAssignments = { ...existing.assignments };
      if (newAssignments?.image === id) newAssignments.image = 'primary';
      if (newAssignments?.text === id) newAssignments.text = 'primary';
      const { error } = await supabase.from('site_settings').update({
        api_keys: { ...existing, backup_keys: currentBackups.filter(k => k.id !== id), assignments: newAssignments },
      } as any).eq('id', 'main');
      if (error) throw error;
      setBackupKeys(prev => prev.filter(k => k.id !== id));
      setAssignments({ image: newAssignments.image || 'primary', text: newAssignments.text || 'primary' });
      toast.success('Backup key deleted');
    } catch (err: any) { toast.error('Delete failed: ' + err.message); }
  }

  async function testBackupKey(bk: BackupKeyEntry) {
    if (!bk.key || bk.key.trim().length < 10) { toast.error('Key is empty or too short'); return; }
    const formatWarn = validateKeyFormat(bk.provider, bk.key);
    if (formatWarn) toast.warning(formatWarn);
    setTestingBackup(p => ({ ...p, [bk.id]: true }));
    setBackupStatuses(p => ({ ...p, [bk.id]: { tested: false, working: false } }));
    const start = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke('avax-ai', {
        body: { aiId: 'forex_basics', messages: [{ role: 'user', content: 'Reply with exactly: OK' }], _testKey: bk.key.trim(), _testProvider: bk.provider, _testMode: true },
      });
      const latency = Date.now() - start;
      if (error) {
        let errMsg = error.message;
        if (error instanceof FunctionsHttpError) { try { errMsg = (await error.context?.text?.()) || error.message; } catch {} }
        setBackupStatuses(p => ({ ...p, [bk.id]: { tested: true, working: false, error: errMsg.slice(0, 200) } }));
        toast.error('Test failed: ' + errMsg.slice(0, 100));
      } else if (data?.text || data?.tested) {
        setBackupStatuses(p => ({ ...p, [bk.id]: { tested: true, working: true, latency } }));
        toast.success(`✅ ${bk.label} working! (${latency}ms)`);
      } else {
        setBackupStatuses(p => ({ ...p, [bk.id]: { tested: true, working: false, error: 'Empty response from API' } }));
        toast.error('Empty response');
      }
    } catch (err: any) {
      setBackupStatuses(p => ({ ...p, [bk.id]: { tested: true, working: false, error: err.message } }));
      toast.error('Test failed: ' + err.message);
    }
    setTestingBackup(p => ({ ...p, [bk.id]: false }));
  }

  async function checkBackupBalance(bk: BackupKeyEntry) {
    if (!bk.key || bk.key.trim().length < 10) { toast.error('Key is empty or too short'); return; }
    setCheckingBackupBalance(p => ({ ...p, [bk.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('avax-ai', {
        body: { aiId: 'forex_basics', _checkBalance: true, _testProvider: bk.provider, _testKey: bk.key.trim() },
      });
      if (error) {
        let errMsg = error.message;
        if (error instanceof FunctionsHttpError) { try { errMsg = (await error.context?.text?.()) || error.message; } catch {} }
        toast.error('Balance check failed: ' + errMsg.slice(0, 80));
      } else if (data?.balance) {
        setBackupBalances(p => ({ ...p, [bk.id]: data.balance }));
        toast.success(`✅ Balance loaded for ${bk.label}`);
      }
    } catch (err: any) { toast.error('Balance check failed: ' + err.message); }
    setCheckingBackupBalance(p => ({ ...p, [bk.id]: false }));
  }

  async function saveAssignments() {
    setSavingAssignments(true);
    try {
      const existing = await getCurrentApiKeys();
      const { error } = await supabase.from('site_settings').update({ api_keys: { ...existing, assignments } } as any).eq('id', 'main');
      if (error) throw error;
      toast.success('✅ Task assignments saved!');
    } catch (err: any) { toast.error('Save failed: ' + err.message); }
    setSavingAssignments(false);
  }

  async function saveAiRouting() {
    setSavingRouting(true);
    try {
      const existing = await getCurrentApiKeys();
      const { error } = await supabase.from('site_settings').update({ api_keys: { ...existing, ai_routing: aiRouting } } as any).eq('id', 'main');
      if (error) throw error;
      toast.success('✅ AI Routing saved! Each AI will now use the selected provider.');
    } catch (err: any) { toast.error('Save failed: ' + err.message); }
    setSavingRouting(false);
  }

  async function loadUsageLogs() {
    setLoadingLogs(true);
    const { data } = await supabase.from('api_usage_logs').select('*').order('created_at', { ascending: false }).limit(20);
    if (data) setUsageLogs(data);
    setLoadingLogs(false);
  }

  async function runHealthCheck() {
    setRunningHealth(true);
    setShowHealth(true);
    const features = [
      { feature: 'AVAX AI Hub (Text/Groq)', fn: 'avax-ai', body: { aiId: 'forex_basics', messages: [{ role: 'user', content: 'Say OK' }] } },
      { feature: 'Live Agent (Text/Groq)', fn: 'live-agent', body: { messages: [{ role: 'user', content: 'Hi' }] } },
      { feature: 'Signal Analysis (Image/OpenRouter)', fn: 'analyze-signal', body: { imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=300', mode: 'setup' } },
      { feature: 'Challenge AI (Image/OpenRouter)', fn: 'analyze-signal', body: { imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=300', mode: 'result' } },
    ];
    setHealthResults(features.map(f => ({ feature: f.feature, status: 'testing' as const })));
    await Promise.all(
      features.map(async (f, idx) => {
        const start = Date.now();
        try {
          const { data, error } = await supabase.functions.invoke(f.fn, { body: f.body });
          const latency = Date.now() - start;
          let result: HealthResult;
          if (error) {
            let errMsg = error.message;
            if (error instanceof FunctionsHttpError) { try { errMsg = (await error.context?.text?.()) || error.message; } catch {} }
            result = { feature: f.feature, status: 'error', latency, error: errMsg.slice(0, 120) };
          } else if (data?.text || data?.success || data?.data || data?.message || data?.tested) {
            result = { feature: f.feature, status: 'ok', latency };
          } else {
            result = { feature: f.feature, status: 'error', latency, error: JSON.stringify(data || 'Empty response').slice(0, 100) };
          }
          setHealthResults(prev => { const u = [...prev]; u[idx] = result; return u; });
        } catch (err: any) {
          setHealthResults(prev => { const u = [...prev]; u[idx] = { feature: f.feature, status: 'error', error: err.message.slice(0, 80) }; return u; });
        }
      })
    );
    setRunningHealth(false);
    toast.success('Health check complete');
  }

  const imageBackups = backupKeys.filter(k => k.task_type === 'image');
  const textBackups = backupKeys.filter(k => k.task_type === 'text');

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-48 bg-muted/30 rounded-2xl animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="bg-gradient-to-r from-primary/10 to-blue-500/10 border border-primary/25 rounded-2xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-black text-foreground text-sm">AI API Keys Manager</p>
            <p className="text-xs text-muted-foreground">Auto-fallback to backup keys when primary fails. Keys must match correct format.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl text-center">
            <Zap className="w-4 h-4 text-orange-400 mx-auto mb-1" />
            <p className="text-[10px] font-bold text-orange-400">Groq = Text AI</p>
            <p className="text-[9px] text-muted-foreground">Key starts: gsk_</p>
          </div>
          <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl text-center">
            <Globe className="w-4 h-4 text-blue-400 mx-auto mb-1" />
            <p className="text-[10px] font-bold text-blue-400">OpenRouter = Image AI</p>
            <p className="text-[9px] text-muted-foreground">Key starts: sk-or-v1-</p>
          </div>
        </div>
      </div>

      {/* Primary Keys */}
      {PRIMARY_SERVICES.map(svc => {
        const status = primaryStatuses[svc.id];
        const isTesting = testingPrimary[svc.id];
        const isSaving = savingPrimary[svc.id];
        const isCheckingBal = checkingPrimaryBalance[svc.id];
        const currentKey = primaryKeys[svc.id] || '';
        const savedKey = savedPrimaryKeys[svc.id] || '';
        const isVisible = showPrimaryKey[svc.id];
        const hasSaved = savedKey.length > 0;
        const balance = primaryBalances[svc.id];
        const isActive = (svc.taskType === 'image' ? assignments.image : assignments.text) === 'primary';
        const formatWarn = validateKeyFormat(svc.provider, currentKey);

        return (
          <div key={svc.id} className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-4 pb-3 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: svc.bgColor }}>
                  <svc.icon className={`w-5 h-5 ${svc.color}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-black text-foreground text-sm">{svc.name}</p>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border" style={{ background: svc.bgColor, color: svc.accentColor, borderColor: svc.accentColor + '40' }}>
                      {svc.taskLabel}
                    </span>
                    {status?.tested && (
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.working ? 'bg-green-500/15 text-green-400 border border-green-500/25' : 'bg-red-500/15 text-red-400 border border-red-500/25'}`}>
                        {status.working ? <><CheckCircle2 className="w-3 h-3" /> {status.latency}ms</> : <><XCircle className="w-3 h-3" /> Failed</>}
                      </div>
                    )}
                    {!status?.tested && hasSaved && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/25">
                        <Shield className="w-3 h-3" /> Saved
                      </div>
                    )}
                    {isActive && <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary border border-primary/25"><Star className="w-3 h-3" /> Priority</div>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{svc.description}</p>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {hasSaved && (
                <div className="flex items-center gap-2 p-2.5 bg-muted/30 rounded-xl border border-border/50">
                  <Shield className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground">Saved key</p>
                    <p className="text-xs font-mono text-foreground truncate">{maskKey(savedKey)}</p>
                  </div>
                </div>
              )}
              {balance && (svc.provider === 'groq' ? <GroqBalancePanel b={balance} /> : <OpenRouterBalancePanel b={balance} />)}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Get key from <a href={svc.docsUrl} target="_blank" rel="noreferrer" className="text-primary underline">{svc.docsLabel}</a>
                  {svc.provider === 'openrouter' && <span className="ml-1 text-blue-400">(must start with sk-or-v1-)</span>}
                  {svc.provider === 'groq' && <span className="ml-1 text-orange-400">(must start with gsk_)</span>}
                </p>
                <div className="relative">
                  <input
                    type={isVisible ? 'text' : 'password'}
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-foreground text-sm outline-none focus:border-primary font-mono pr-10"
                    placeholder={svc.placeholder}
                    value={currentKey}
                    onChange={e => setPrimaryKeys(p => ({ ...p, [svc.id]: e.target.value }))}
                  />
                  <button onClick={() => setShowPrimaryKey(p => ({ ...p, [svc.id]: !isVisible }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded press">
                    {isVisible ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                </div>
                {formatWarn && currentKey && (
                  <div className="mt-1.5 flex items-start gap-1.5 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <p className="text-[10px] text-yellow-400">{formatWarn}</p>
                  </div>
                )}
              </div>
              {status?.tested && !status.working && status.error && (
                <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400 break-all">{status.error}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => testPrimaryKey(svc)} disabled={isTesting || (!currentKey && !savedKey)}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-muted border border-border rounded-xl text-foreground text-xs font-bold press disabled:opacity-40 justify-center">
                  {isTesting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing...</> : <><RefreshCw className="w-3.5 h-3.5" /> Test Key</>}
                </button>
                <button onClick={() => savePrimaryKey(svc)} disabled={isSaving || !currentKey || currentKey.length < 10}
                  className="flex items-center gap-1.5 px-3 py-2.5 gradient-pink rounded-xl text-white text-xs font-bold press disabled:opacity-40 justify-center">
                  {isSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : <><Save className="w-3.5 h-3.5" /> Save & Activate</>}
                </button>
              </div>
              {hasSaved && (
                <button onClick={() => checkPrimaryBalance(svc)} disabled={isCheckingBal}
                  className="w-full flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold press disabled:opacity-40 justify-center border"
                  style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)', color: '#818cf8' }}>
                  {isCheckingBal ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...</> : <><BarChart2 className="w-3.5 h-3.5" /> Check Balance / Credits</>}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* AI Feature Routing */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/15 flex items-center justify-center flex-shrink-0">
              <Settings className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="font-black text-foreground text-sm">AI Feature Routing</p>
              <p className="text-xs text-muted-foreground">Choose which API provider each AI feature uses as primary</p>
            </div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="p-2.5 bg-purple-500/5 border border-purple-500/15 rounded-xl">
            <p className="text-[10px] text-purple-400 flex items-center gap-1.5">
              <Info className="w-3 h-3" />
              Default: Image AIs use OpenRouter, Text AIs use Groq. Change here to route any AI to a different provider.
            </p>
          </div>
          {AI_FEATURES_ROUTING.map(feat => (
            <div key={feat.id} className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl border border-border/50">
              <span className="text-lg flex-shrink-0">{feat.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{feat.name}</p>
                <p className="text-[10px] text-muted-foreground">{feat.desc}</p>
              </div>
              <select
                value={aiRouting[feat.id] || 'auto'}
                onChange={e => setAiRouting(p => ({ ...p, [feat.id]: e.target.value }))}
                className="bg-muted border border-border rounded-xl px-2.5 py-2 text-foreground text-xs outline-none focus:border-primary flex-shrink-0"
              >
                <option value="auto">Auto ({feat.defaultProvider})</option>
                <option value="openrouter">OpenRouter</option>
                <option value="groq">Groq</option>
              </select>
            </div>
          ))}
          <button onClick={saveAiRouting} disabled={savingRouting}
            className="w-full py-3 gradient-pink rounded-xl text-white text-sm font-bold press disabled:opacity-40 flex items-center justify-center gap-2">
            {savingRouting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Settings className="w-4 h-4" /> Save AI Routing</>}
          </button>
        </div>
      </div>

      {/* Backup Keys Section */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/15 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="font-black text-foreground text-sm">Backup API Keys</p>
              <p className="text-xs text-muted-foreground">Auto-used when primary key fails. OpenRouter keys: sk-or-v1-... · Groq keys: gsk_...</p>
            </div>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {/* Add backup form */}
          <div className="p-3 bg-muted/20 border border-border/50 rounded-xl space-y-3">
            <p className="text-xs font-bold text-foreground flex items-center gap-2"><Plus className="w-3.5 h-3.5 text-primary" /> Add New Backup Key</p>
            <input
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm outline-none focus:border-primary"
              placeholder="Label (e.g. Backup OpenRouter #2)"
              value={newBackup.label}
              onChange={e => setNewBackup(p => ({ ...p, label: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Provider</p>
                <select
                  className="w-full bg-muted border border-border rounded-xl px-2 py-2 text-foreground text-xs outline-none focus:border-primary"
                  value={newBackup.provider}
                  onChange={e => {
                    const provider = e.target.value as 'openrouter' | 'groq';
                    setNewBackup(p => ({ ...p, provider, task_type: provider === 'openrouter' ? 'image' : 'text' }));
                  }}
                >
                  <option value="openrouter">OpenRouter (Image)</option>
                  <option value="groq">Groq (Text)</option>
                </select>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Task Type</p>
                <select
                  className="w-full bg-muted border border-border rounded-xl px-2 py-2 text-foreground text-xs outline-none focus:border-primary"
                  value={newBackup.task_type}
                  onChange={e => setNewBackup(p => ({ ...p, task_type: e.target.value as 'image' | 'text' }))}
                >
                  <option value="image">📷 Image Analysis</option>
                  <option value="text">📝 Text AI</option>
                </select>
              </div>
            </div>
            <div className="relative">
              <input
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-foreground text-sm outline-none focus:border-primary font-mono pr-10"
                placeholder={newBackup.provider === 'openrouter' ? 'sk-or-v1-...' : 'gsk_...'}
                type={newBackup.showKey ? 'text' : 'password'}
                value={newBackup.key}
                onChange={e => setNewBackup(p => ({ ...p, key: e.target.value }))}
              />
              <button onClick={() => setNewBackup(p => ({ ...p, showKey: !p.showKey }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded press">
                {newBackup.showKey ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            </div>
            {newBackup.key && validateKeyFormat(newBackup.provider, newBackup.key) && (
              <div className="flex items-start gap-1.5 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                <AlertTriangle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-yellow-400">{validateKeyFormat(newBackup.provider, newBackup.key)}</p>
              </div>
            )}
            <button onClick={saveBackupKey} disabled={savingBackup || !newBackup.label.trim() || !newBackup.key.trim()}
              className="w-full py-2.5 gradient-pink rounded-xl text-white text-sm font-bold press disabled:opacity-40 flex items-center justify-center gap-2">
              {savingBackup ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Backup Key</>}
            </button>
          </div>

          {/* Saved backup keys */}
          {backupKeys.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No backup keys saved yet</p>
              <p className="text-xs mt-1">Add backup keys above to enable auto-fallback</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Saved Backup Keys ({backupKeys.length})</p>
              {backupKeys.map(bk => {
                const bkStatus = backupStatuses[bk.id];
                const isTestingBk = testingBackup[bk.id];
                const isCheckingBkBal = checkingBackupBalance[bk.id];
                const bkBalance = backupBalances[bk.id];
                const bkIsVisible = showBackupKey[bk.id];
                const isPinned = (bk.task_type === 'image' ? assignments.image : assignments.text) === bk.id;
                const fmtWarn = validateKeyFormat(bk.provider, bk.key);

                return (
                  <div key={bk.id} className="border border-border rounded-xl overflow-hidden">
                    <div className="p-3">
                      <div className="flex items-start gap-2 mb-3">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${bk.task_type === 'image' ? 'bg-blue-500/15' : 'bg-orange-500/15'}`}>
                          {bk.task_type === 'image' ? <Camera className="w-4 h-4 text-blue-400" /> : <MessageSquare className="w-4 h-4 text-orange-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-bold text-foreground">{bk.label}</p>
                            {isPinned && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary/15 text-primary border border-primary/25 flex items-center gap-1"><Star className="w-2.5 h-2.5" /> Priority</span>}
                            {bkStatus?.tested && <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${bkStatus.working ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>{bkStatus.working ? `✓ ${bkStatus.latency}ms` : '✗ Failed'}</span>}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {bk.provider === 'openrouter' ? 'OpenRouter' : 'Groq'} · {bk.task_type === 'image' ? '📷 Image' : '📝 Text'} · Fallback #{backupKeys.indexOf(bk) + 1}
                          </p>
                          {fmtWarn && <p className="text-[10px] text-yellow-400 mt-0.5">⚠️ {fmtWarn.split('.')[0]}</p>}
                        </div>
                        <button onClick={() => deleteBackupKey(bk.id)} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg press text-red-400 flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="flex-1 p-2 bg-muted/30 rounded-lg">
                          <p className="text-[10px] font-mono text-muted-foreground truncate">{bkIsVisible ? bk.key : maskKey(bk.key)}</p>
                        </div>
                        <button onClick={() => setShowBackupKey(p => ({ ...p, [bk.id]: !bkIsVisible }))} className="p-1.5 bg-muted rounded-lg press">
                          {bkIsVisible ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground" />}
                        </button>
                      </div>
                      {bkStatus?.tested && !bkStatus.working && bkStatus.error && (
                        <div className="mb-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                          <p className="text-[10px] text-red-400 break-all">{bkStatus.error}</p>
                        </div>
                      )}
                      {bkBalance && <div className="mb-2">{bk.provider === 'groq' ? <GroqBalancePanel b={bkBalance} /> : <OpenRouterBalancePanel b={bkBalance} />}</div>}
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => testBackupKey(bk)} disabled={isTestingBk}
                          className="flex items-center gap-1.5 px-2 py-2 bg-muted border border-border rounded-lg text-foreground text-[11px] font-bold press disabled:opacity-40 justify-center">
                          {isTestingBk ? <><Loader2 className="w-3 h-3 animate-spin" /> Testing...</> : <><RefreshCw className="w-3 h-3" /> Test Key</>}
                        </button>
                        <button onClick={() => checkBackupBalance(bk)} disabled={isCheckingBkBal}
                          className="flex items-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-bold press disabled:opacity-40 justify-center border"
                          style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)', color: '#818cf8' }}>
                          {isCheckingBkBal ? <><Loader2 className="w-3 h-3 animate-spin" /> Checking...</> : <><BarChart2 className="w-3 h-3" /> Balance</>}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Task Assignments */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
              <ArrowRightLeft className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="font-black text-foreground text-sm">Custom Key Assignment</p>
              <p className="text-xs text-muted-foreground">Choose which key to try FIRST for each task type</p>
            </div>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="p-2.5 bg-blue-500/5 border border-blue-500/15 rounded-xl">
            <p className="text-[10px] text-blue-400">⚡ Auto-fallback is ALWAYS enabled — if selected key fails, system tries others automatically.</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2"><Camera className="w-4 h-4 text-blue-400" /><p className="text-sm font-bold text-foreground">📷 Image Analysis</p></div>
            <select className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-foreground text-sm outline-none focus:border-primary" value={assignments.image} onChange={e => setAssignments(p => ({ ...p, image: e.target.value }))}>
              <option value="primary">🌐 Primary OpenRouter (Default)</option>
              {imageBackups.map(bk => <option key={bk.id} value={bk.id}>{bk.label} ({bk.provider})</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2"><MessageSquare className="w-4 h-4 text-orange-400" /><p className="text-sm font-bold text-foreground">📝 Text AI</p></div>
            <select className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-foreground text-sm outline-none focus:border-primary" value={assignments.text} onChange={e => setAssignments(p => ({ ...p, text: e.target.value }))}>
              <option value="primary">⚡ Primary Groq (Default)</option>
              {textBackups.map(bk => <option key={bk.id} value={bk.id}>{bk.label} ({bk.provider})</option>)}
            </select>
          </div>
          <button onClick={saveAssignments} disabled={savingAssignments}
            className="w-full py-3 gradient-pink rounded-xl text-white text-sm font-bold press disabled:opacity-40 flex items-center justify-center gap-2">
            {savingAssignments ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Settings className="w-4 h-4" /> Save Assignments</>}
          </button>
        </div>
      </div>

      {/* Usage Logs */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <button onClick={() => { setShowLogs(!showLogs); if (!showLogs) loadUsageLogs(); }} className="w-full flex items-center gap-3 p-4 press">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <List className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1 text-left">
            <p className="font-black text-foreground text-sm">Usage Logs</p>
            <p className="text-xs text-muted-foreground">Last 20 AI calls — which key was used, success/fail, latency</p>
          </div>
          {showLogs ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showLogs && (
          <div className="border-t border-border/50">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
              <p className="text-xs text-muted-foreground">Recent AI calls</p>
              <button onClick={loadUsageLogs} disabled={loadingLogs} className="p-1 press">
                <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loadingLogs ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {loadingLogs ? (
              <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted/30 rounded-xl animate-pulse" />)}</div>
            ) : usageLogs.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                <BarChart2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No usage logs yet. AI calls will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {usageLogs.map(log => (
                  <div key={log.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.success ? 'bg-green-400' : 'bg-red-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{log.feature}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{log.key_label} · {log.provider}</p>
                      {!log.success && log.error_msg && <p className="text-[10px] text-red-400 truncate">{log.error_msg}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${log.task_type === 'image' ? 'bg-blue-500/15 text-blue-400' : 'bg-orange-500/15 text-orange-400'}`}>{log.task_type}</span>
                      {log.latency_ms && <p className="text-[10px] text-muted-foreground mt-0.5">{log.latency_ms}ms</p>}
                    </div>
                    <div className="text-[9px] text-muted-foreground flex-shrink-0 w-16 text-right">
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* API Health Check */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <button onClick={() => setShowHealth(!showHealth)} className="w-full flex items-center gap-3 p-4 press">
          <div className="w-10 h-10 rounded-2xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
            <Activity className="w-5 h-5 text-green-400" />
          </div>
          <div className="flex-1 text-left">
            <p className="font-black text-foreground text-sm">API Health Check</p>
            <p className="text-xs text-muted-foreground">Test all AI features (Image + Text) simultaneously</p>
          </div>
          {showHealth ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showHealth && (
          <div className="px-4 pb-4 space-y-3 border-t border-border/50">
            <button onClick={runHealthCheck} disabled={runningHealth}
              className="mt-3 w-full py-3 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 press disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #16a34a, #22c55e)' }}>
              {runningHealth ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing All...</> : <><Activity className="w-4 h-4" /> Test All AI Features</>}
            </button>
            {healthResults.length > 0 && (
              <div className="space-y-2">
                {healthResults.map((r, i) => {
                  const isSlowOk = r.status === 'ok' && r.latency && r.latency > 5000;
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl"
                      style={{
                        background: r.status === 'ok' ? (isSlowOk ? 'rgba(234,179,8,0.08)' : 'rgba(34,197,94,0.08)') : r.status === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${r.status === 'ok' ? (isSlowOk ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)') : r.status === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)'}`,
                      }}>
                      <div className="flex-shrink-0">
                        {r.status === 'testing' && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
                        {r.status === 'ok' && !isSlowOk && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                        {r.status === 'ok' && isSlowOk && <AlertTriangle className="w-4 h-4 text-yellow-400" />}
                        {r.status === 'error' && <XCircle className="w-4 h-4 text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground">{r.feature}</p>
                        {r.status === 'error' && r.error && <p className="text-[10px] text-red-400 truncate">{r.error}</p>}
                        {r.status === 'ok' && isSlowOk && <p className="text-[10px] text-yellow-400">Slow — check quota</p>}
                        {r.status === 'testing' && <p className="text-[10px] text-muted-foreground">Testing...</p>}
                      </div>
                      {r.latency !== undefined && <span className={`text-[10px] font-bold flex-shrink-0 ${r.status === 'ok' ? (isSlowOk ? 'text-yellow-400' : 'text-green-400') : 'text-muted-foreground'}`}>{r.latency}ms</span>}
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground text-center pt-1">⚡ &lt;3s = healthy · ⚠️ 5–8s = near limit · 🔴 &gt;8s = quota exhausted</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer"
          className="block py-3 text-center rounded-xl text-white text-xs font-bold press"
          style={{ background: 'linear-gradient(135deg, #f97316, #eab308)' }}>
          ⚡ Get Groq Key →
        </a>
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
          className="block py-3 text-center rounded-xl text-white text-xs font-bold press"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>
          🌐 Get OpenRouter Key →
        </a>
      </div>
    </div>
  );
}
