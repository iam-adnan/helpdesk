'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { format } from 'date-fns';
import { Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Ticket } from '@/lib/types';

const statusColors: Record<string,string> = {
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  waiting: 'bg-purple-500/20 text-purple-400',
  resolved: 'bg-green-500/20 text-green-400',
  closed: 'bg-dark-500/20 text-dark-400',
};
const priorityColors: Record<string,string> = {
  low: 'bg-dark-600/30 text-dark-300',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-orange-500/20 text-orange-400',
  urgent: 'bg-red-500/20 text-red-400',
};

export default function TicketsPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const params: any = { page, search };
        if (statusFilter) params.status = statusFilter;
        const { data } = await api.get('/tickets/', { params });
        setTickets(data.results || data);
        setTotal(data.count || 0);
      } catch {}
      setLoading(false);
    };
    load();
  }, [page, search, statusFilter]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search tickets..." className="input-field pl-9" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input-field w-auto">
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting">Waiting</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-700 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Ticket</th>
                <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Subject</th>
                <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Priority</th>
                <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Created</th>
                {user?.role !== 'user' && <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Requester</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-dark-500">Loading...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-dark-500">No tickets found</td></tr>
              ) : tickets.map(t => (
                <tr key={t.id} className="border-b border-dark-800 hover:bg-dark-800/50 transition-colors cursor-pointer">
                  <td className="px-4 py-3"><Link href={`/dashboard/tickets/${t.id}`} className="text-accent font-mono text-sm">{t.ticket_number}</Link></td>
                  <td className="px-4 py-3"><Link href={`/dashboard/tickets/${t.id}`} className="text-dark-100 hover:text-white">{t.subject}</Link></td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[t.status]||''}`}>{t.status.replace('_',' ')}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityColors[t.priority]||''}`}>{t.priority}</span></td>
                  <td className="px-4 py-3 text-sm text-dark-400">{format(new Date(t.created_at), 'MMM d, yyyy')}</td>
                  {user?.role !== 'user' && <td className="px-4 py-3 text-sm text-dark-400">{t.created_by?.email}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > 25 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-dark-700">
            <span className="text-sm text-dark-400">{total} tickets</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="btn-secondary text-sm px-3 py-1 disabled:opacity-30"><ChevronLeft size={14} /></button>
              <span className="text-sm text-dark-300 px-2 py-1">Page {page}</span>
              <button onClick={() => setPage(p => p+1)} disabled={tickets.length < 25} className="btn-secondary text-sm px-3 py-1 disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
