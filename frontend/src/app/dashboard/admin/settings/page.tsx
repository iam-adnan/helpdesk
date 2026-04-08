'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';

export default function SettingsPage() {
  const [general, setGeneral] = useState({ app_name:'', allowed_email_domain:'', support_teams:'' });
  const [smtp, setSmtp] = useState({ smtp_host:'', smtp_port:587, smtp_user:'', smtp_password:'', smtp_from_email:'', smtp_from_name:'' });

  useEffect(() => {
    api.get('/settings/general/').then(r => setGeneral(r.data)).catch(() => {});
    api.get('/settings/smtp/').then(r => setSmtp(r.data)).catch(() => {});
  }, []);

  const saveGeneral = async () => {
    try { await api.post('/settings/general/', general); toast.success('Saved'); } catch { toast.error('Failed'); }
  };
  const saveSMTP = async () => {
    try { await api.post('/settings/smtp/', smtp); toast.success('Saved'); } catch { toast.error('Failed'); }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">General Settings</h3>
        <div className="space-y-4">
          <div><label className="block text-sm text-dark-300 mb-1">App Name</label><input value={general.app_name} onChange={e => setGeneral({...general, app_name: e.target.value})} className="input-field" /></div>
          <div><label className="block text-sm text-dark-300 mb-1">Allowed Email Domain</label><input value={general.allowed_email_domain} onChange={e => setGeneral({...general, allowed_email_domain: e.target.value})} className="input-field" /></div>
          <div><label className="block text-sm text-dark-300 mb-1">Support Teams (comma separated)</label><input value={general.support_teams} onChange={e => setGeneral({...general, support_teams: e.target.value})} className="input-field" /></div>
          <button onClick={saveGeneral} className="btn-primary flex items-center gap-2"><Save size={14} /> Save</button>
        </div>
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold text-white mb-4">Email (SMTP) Settings</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-dark-300 mb-1">SMTP Host</label><input value={smtp.smtp_host} onChange={e => setSmtp({...smtp, smtp_host: e.target.value})} className="input-field" /></div>
            <div><label className="block text-sm text-dark-300 mb-1">Port</label><input type="number" value={smtp.smtp_port} onChange={e => setSmtp({...smtp, smtp_port: Number(e.target.value)})} className="input-field" /></div>
          </div>
          <div><label className="block text-sm text-dark-300 mb-1">SMTP User</label><input value={smtp.smtp_user} onChange={e => setSmtp({...smtp, smtp_user: e.target.value})} className="input-field" /></div>
          <div><label className="block text-sm text-dark-300 mb-1">SMTP Password</label><input type="password" value={smtp.smtp_password} onChange={e => setSmtp({...smtp, smtp_password: e.target.value})} className="input-field" placeholder="••••••" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-dark-300 mb-1">From Email</label><input value={smtp.smtp_from_email} onChange={e => setSmtp({...smtp, smtp_from_email: e.target.value})} className="input-field" /></div>
            <div><label className="block text-sm text-dark-300 mb-1">From Name</label><input value={smtp.smtp_from_name} onChange={e => setSmtp({...smtp, smtp_from_name: e.target.value})} className="input-field" /></div>
          </div>
          <button onClick={saveSMTP} className="btn-primary flex items-center gap-2"><Save size={14} /> Save</button>
        </div>
      </div>
    </div>
  );
}
