'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Ticket, Users, Clock, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.get('/tickets/stats/').then(r => setStats(r.data)).catch(() => {});
  }, []);

  if (!stats) return <div className="text-dark-400 text-center py-12">Loading...</div>;

  const cards = [
    { label: 'Total Tickets', value: stats.total, icon: Ticket, color: 'text-blue-400 bg-blue-500/20' },
    { label: 'Open', value: stats.open, icon: AlertTriangle, color: 'text-yellow-400 bg-yellow-500/20' },
    { label: 'In Progress', value: stats.in_progress, icon: Clock, color: 'text-accent bg-accent/20' },
    { label: 'Resolved', value: stats.resolved, icon: CheckCircle, color: 'text-green-400 bg-green-500/20' },
    { label: 'Closed', value: stats.closed, icon: TrendingUp, color: 'text-dark-300 bg-dark-600/30' },
    { label: 'Urgent', value: stats.urgent, icon: AlertTriangle, color: 'text-red-400 bg-red-500/20' },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {cards.map(c => (
          <div key={c.label} className="card text-center">
            <div className={`w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center ${c.color}`}><c.icon size={20} /></div>
            <div className="text-2xl font-bold text-white">{c.value}</div>
            <div className="text-xs text-dark-400 mt-1">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
