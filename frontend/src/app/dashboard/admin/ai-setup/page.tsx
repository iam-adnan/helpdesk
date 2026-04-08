'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Save, Bot, CheckCircle } from 'lucide-react';

export default function AISetupPage() {
  const [form, setForm] = useState({ anthropic_api_key:'', ai_enabled:true, ai_model:'claude-sonnet-4-20250514', ai_system_prompt:'' });
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    api.get('/integrations/ai/').then(r => { setForm({ anthropic_api_key:'', ai_enabled: r.data.ai_enabled, ai_model: r.data.ai_model, ai_system_prompt: r.data.ai_system_prompt }); setConfigured(r.data.configured); }).catch(() => {});
  }, []);

  const save = async () => {
    try {
      const payload = { ...form };
      if (!payload.anthropic_api_key && configured) delete (payload as any).anthropic_api_key;
      await api.post('/integrations/ai/', payload);
      toast.success('AI settings saved');
      setConfigured(true);
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center"><Bot className="text-purple-400" size={20} /></div>
          <div>
            <h3 className="text-lg font-semibold text-white">AI Auto-Responder</h3>
            {configured && <div className="flex items-center gap-1 text-xs text-green-400"><CheckCircle size={12} /> Configured</div>}
          </div>
        </div>
        <p className="text-sm text-dark-400 mb-4">AI will automatically send a brief first response to new tickets using the Anthropic Claude API.</p>
        <div className="space-y-4">
          <div><label className="block text-sm text-dark-300 mb-1">Anthropic API Key</label><input value={form.anthropic_api_key} onChange={e => setForm({...form, anthropic_api_key: e.target.value})} className="input-field" type="password" placeholder={configured ? '••••••••(saved)' : 'sk-ant-...'} /></div>
          <div><label className="block text-sm text-dark-300 mb-1">Model</label>
            <select value={form.ai_model} onChange={e => setForm({...form, ai_model: e.target.value})} className="input-field">
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-dark-300">Enable AI Responder</label>
            <button onClick={() => setForm({...form, ai_enabled: !form.ai_enabled})}
              className={`w-11 h-6 rounded-full transition-colors ${form.ai_enabled ? 'bg-accent' : 'bg-dark-600'}`}>
              <div className={`w-5 h-5 rounded-full bg-white transition-transform`} style={{transform: form.ai_enabled ? 'translateX(22px)' : 'translateX(2px)'}} />
            </button>
          </div>
          <div><label className="block text-sm text-dark-300 mb-1">System Prompt</label>
            <textarea value={form.ai_system_prompt} onChange={e => setForm({...form, ai_system_prompt: e.target.value})} className="input-field min-h-[120px]" placeholder="You are a helpful IT support assistant..." />
          </div>
          <button onClick={save} className="btn-primary flex items-center gap-2"><Save size={14} /> Save Settings</button>
        </div>
      </div>
    </div>
  );
}
