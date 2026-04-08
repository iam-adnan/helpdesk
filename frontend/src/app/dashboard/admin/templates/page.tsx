'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, X, Save } from 'lucide-react';

interface Template { id: string; name: string; event_type: string; channel: string; subject: string; body: string; is_active: boolean; }

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template|null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name:'', event_type:'ticket_created', channel:'email', subject:'', body:'', is_active:true });

  const load = async () => { try { const { data } = await api.get('/notifications/templates/'); setTemplates(data.results || data); } catch {} };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing) { await api.put(`/notifications/templates/${editing.id}/`, form); }
      else { await api.post('/notifications/templates/', form); }
      toast.success('Saved'); setShowNew(false); setEditing(null); load();
      setForm({ name:'', event_type:'ticket_created', channel:'email', subject:'', body:'', is_active:true });
    } catch { toast.error('Failed'); }
  };

  const startEdit = (t: Template) => { setEditing(t); setForm(t as any); setShowNew(true); };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold text-white">Notification Templates</h2>
        <button onClick={() => { setEditing(null); setShowNew(true); }} className="btn-primary text-sm flex items-center gap-2"><Plus size={14} /> New Template</button>
      </div>
      <p className="text-sm text-dark-400 mb-4">Variables: {'{{ticket_number}}, {{subject}}, {{status}}, {{user_name}}, {{comment}}'}</p>

      {showNew && (
        <div className="card mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-white">{editing ? 'Edit' : 'New'} Template</h3>
            <button onClick={() => setShowNew(false)} className="text-dark-400"><X size={18} /></button>
          </div>
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm({...form, name:e.target.value})} placeholder="Template name" className="input-field" />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.event_type} onChange={e => setForm({...form, event_type:e.target.value})} className="input-field">
                <option value="ticket_created">Ticket Created</option><option value="ticket_assigned">Ticket Assigned</option>
                <option value="ticket_updated">Ticket Updated</option><option value="ticket_commented">Comment Added</option>
                <option value="ticket_resolved">Ticket Resolved</option><option value="ticket_closed">Ticket Closed</option>
              </select>
              <select value={form.channel} onChange={e => setForm({...form, channel:e.target.value})} className="input-field">
                <option value="email">Email</option><option value="slack">Slack</option>
              </select>
            </div>
            {form.channel === 'email' && <input value={form.subject} onChange={e => setForm({...form, subject:e.target.value})} placeholder="Email subject" className="input-field" />}
            <textarea value={form.body} onChange={e => setForm({...form, body:e.target.value})} className="input-field min-h-[120px]" placeholder="Template body..." />
            <button onClick={save} className="btn-primary flex items-center gap-2"><Save size={14} /> Save</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {templates.map(t => (
          <div key={t.id} onClick={() => startEdit(t)} className="card cursor-pointer hover:border-dark-600 transition-colors">
            <div className="flex items-center justify-between">
              <div><span className="text-sm font-medium text-dark-100">{t.name}</span><span className="text-xs text-dark-500 ml-2">{t.event_type} • {t.channel}</span></div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${t.is_active ? 'bg-green-500/20 text-green-400' : 'bg-dark-600/30 text-dark-400'}`}>{t.is_active ? 'Active' : 'Disabled'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
