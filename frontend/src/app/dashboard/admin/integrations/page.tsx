'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Save, MessageSquare, CheckCircle, Hash } from 'lucide-react';

export default function IntegrationsPage() {
  const [form, setForm] = useState({ bot_token:'', app_token:'', channel_id:'', team_channel_id:'' });
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    api.get('/integrations/slack/').then(r => {
      setForm({
        bot_token: r.data.bot_token || '',
        app_token: r.data.app_token || '',
        channel_id: r.data.channel_id || '',
        team_channel_id: r.data.team_channel_id || '',
      });
      setConfigured(r.data.configured);
    }).catch(() => {});
  }, []);

  const save = async () => {
    try {
      await api.post('/integrations/slack/', {
        slack_bot_token: form.bot_token,
        slack_app_token: form.app_token,
        slack_channel_id: form.channel_id,
        slack_team_channel_id: form.team_channel_id,
      });
      toast.success('Saved! Now run: docker compose restart slack-bot');
      setConfigured(true);
    } catch { toast.error('Failed to save'); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center"><MessageSquare className="text-purple-400" size={20} /></div>
          <div>
            <h3 className="text-lg font-semibold text-white">Slack Integration (Socket Mode)</h3>
            {configured && <div className="flex items-center gap-1 text-xs text-green-400"><CheckCircle size={12} /> Configured</div>}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-dark-800 rounded-lg p-4 text-sm text-dark-300 space-y-2">
            <p className="font-medium text-dark-100">Setup (no port forwarding needed!):</p>
            <p>1. Go to <a href="https://api.slack.com/apps" target="_blank" className="text-accent">api.slack.com/apps</a></p>
            <p>2. <b>Socket Mode</b> → Enable → Generate App Token with <code className="text-accent">connections:write</code> → copy <code className="text-accent">xapp-...</code></p>
            <p>3. <b>Slash Commands</b> → <code className="text-accent">/helpdesk</code> (URL: https://localhost)</p>
            <p>4. <b>OAuth Scopes</b>: <code className="text-accent">chat:write, commands, users:read, users:read.email</code></p>
            <p>5. Install to workspace → copy Bot Token <code className="text-accent">xoxb-...</code></p>
          </div>

          <div>
            <label className="block text-sm text-dark-300 mb-1">Bot Token (xoxb-...)</label>
            <input value={form.bot_token} onChange={e => setForm({...form, bot_token: e.target.value})} className="input-field" type="password" placeholder="xoxb-..." />
          </div>
          <div>
            <label className="block text-sm text-dark-300 mb-1">App-Level Token (xapp-...)</label>
            <input value={form.app_token} onChange={e => setForm({...form, app_token: e.target.value})} className="input-field" type="password" placeholder="xapp-..." />
          </div>

          <div className="border-t border-dark-700 pt-4 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Hash size={16} className="text-dark-400" />
              <span className="text-sm font-medium text-dark-200">Channel Settings</span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-dark-300 mb-1">IT Team Channel ID</label>
                <input value={form.team_channel_id} onChange={e => setForm({...form, team_channel_id: e.target.value})} className="input-field" placeholder="C0XXXXXXX — IT team gets detailed ticket cards here" />
                <p className="text-xs text-dark-500 mt-1">Right-click channel → View channel details → copy Channel ID at bottom</p>
              </div>
              <div>
                <label className="block text-sm text-dark-300 mb-1">General Notification Channel ID (optional)</label>
                <input value={form.channel_id} onChange={e => setForm({...form, channel_id: e.target.value})} className="input-field" placeholder="C0XXXXXXX — one-line alerts (optional, can be same as above)" />
              </div>
            </div>
          </div>

          <button onClick={save} className="btn-primary flex items-center gap-2 w-full justify-center"><Save size={14} /> Save Settings</button>
          <p className="text-xs text-dark-500 text-center">After saving, run: <code>docker compose restart slack-bot</code></p>
        </div>
      </div>
    </div>
  );
}
