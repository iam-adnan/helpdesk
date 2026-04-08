'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { format } from 'date-fns';
import { Bell, Mail, MessageSquare, Check } from 'lucide-react';
import type { Notification } from '@/lib/types';
import Link from 'next/link';
import toast from 'react-hot-toast';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all'|'email'|'slack'>('all');

  const load = async () => {
    try {
      const { data } = await api.get('/notifications/');
      setNotifications(data.results || data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id: string) => {
    await api.post(`/notifications/${id}/mark_read/`);
    load();
  };

  const markAllRead = async () => {
    await api.post('/notifications/mark_all_read/');
    toast.success('All marked as read');
    load();
  };

  const filtered = filter === 'all' ? notifications : notifications.filter(n => n.channel === filter);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          {(['all','email','slack'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-accent text-white' : 'bg-dark-800 text-dark-300 hover:bg-dark-700'}`}>
              {f === 'email' && <Mail size={14} className="inline mr-1.5" />}
              {f === 'slack' && <MessageSquare size={14} className="inline mr-1.5" />}
              {f === 'all' && <Bell size={14} className="inline mr-1.5" />}
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <button onClick={markAllRead} className="btn-secondary text-sm flex items-center gap-1.5"><Check size={14} /> Mark all read</button>
      </div>

      <div className="space-y-2">
        {loading ? <div className="text-dark-500 text-center py-12">Loading...</div>
        : filtered.length === 0 ? <div className="text-dark-500 text-center py-12">No notifications</div>
        : filtered.map(n => (
          <div key={n.id} onClick={() => !n.read && markRead(n.id)}
            className={`card cursor-pointer transition-colors ${!n.read ? 'border-accent/30 bg-accent/5' : 'opacity-70'}`}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${n.channel === 'slack' ? 'bg-purple-500/20' : 'bg-blue-500/20'}`}>
                {n.channel === 'slack' ? <MessageSquare size={14} className="text-purple-400" /> : <Mail size={14} className="text-blue-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-dark-100">{n.title}</span>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-accent" />}
                </div>
                <p className="text-sm text-dark-400 mt-0.5 line-clamp-2">{n.message}</p>
                <span className="text-xs text-dark-500 mt-1">{format(new Date(n.created_at), 'MMM d, h:mm a')}</span>
              </div>
              {n.ticket_id && <Link href={`/dashboard/tickets/${n.ticket_id}`} className="text-xs text-accent hover:text-accent-light whitespace-nowrap">View Ticket</Link>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
