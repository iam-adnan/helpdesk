'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import type { Ticket, Comment } from '@/lib/types';
import { Send, Clock, User, MessageSquare, Bot, ArrowLeft } from 'lucide-react';

const statusColors: Record<string,string> = {
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  waiting: 'bg-purple-500/20 text-purple-400',
  resolved: 'bg-green-500/20 text-green-400',
  closed: 'bg-dark-500/20 text-dark-400',
};
const priorityColors: Record<string,string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
};

export default function TicketDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [commentType, setCommentType] = useState('public');
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/tickets/${id}/`);
      setTicket(data);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        setError('Ticket not found.');
      } else if (status === 403) {
        setError('You do not have permission to view this ticket.');
      } else {
        setError('Failed to load ticket. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const sendComment = async () => {
    if (!comment.trim()) return;
    setSending(true);
    try {
      await api.post(`/tickets/${id}/comment/`, { content: comment, comment_type: commentType });
      setComment('');
      toast.success('Reply sent');
      load();
    } catch { toast.error('Failed to send'); }
    setSending(false);
  };

  const updateStatus = async (status: string) => {
    try {
      await api.patch(`/tickets/${id}/`, { status });
      toast.success('Status updated');
      load();
    } catch { toast.error('Failed to update'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-dark-400">Loading ticket...</div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="card">
          <p className="text-red-400 mb-4">{error || 'Ticket not found'}</p>
          <button onClick={() => router.push('/dashboard/tickets')} className="btn-secondary flex items-center gap-2 mx-auto">
            <ArrowLeft size={16} /> Back to Tickets
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back button */}
      <button onClick={() => router.push('/dashboard/tickets')} className="text-dark-400 hover:text-dark-200 text-sm flex items-center gap-1">
        <ArrowLeft size={14} /> Back to tickets
      </button>

      {/* Header */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-accent font-mono text-sm">{ticket.ticket_number}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[ticket.status] || ''}`}>
                {ticket.status.replace('_', ' ')}
              </span>
              <span className={`text-xs font-medium ${priorityColors[ticket.priority] || ''}`}>
                {ticket.priority.toUpperCase()}
              </span>
            </div>
            <h1 className="text-xl font-semibold text-white">{ticket.subject}</h1>
          </div>
          {(user?.role === 'admin' || user?.role === 'agent') && (
            <select value={ticket.status} onChange={e => updateStatus(e.target.value)} className="input-field w-auto text-sm">
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="waiting">Waiting on User</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          )}
        </div>
        <div className="text-sm text-dark-400 flex flex-wrap gap-4">
          <span>Category: <span className="text-dark-200">{ticket.category}</span></span>
          <span>Team: <span className="text-dark-200">{ticket.support_team}</span></span>
          <span>Created: <span className="text-dark-200">{format(new Date(ticket.created_at), 'MMM d, yyyy h:mm a')}</span></span>
          <span>By: <span className="text-dark-200">{ticket.created_by?.email || 'Unknown'}</span></span>
          {ticket.assigned_to && <span>Assigned: <span className="text-dark-200">{ticket.assigned_to.email}</span></span>}
        </div>
        {ticket.description && (
          <div className="mt-4 p-4 bg-dark-800 rounded-lg text-dark-200 text-sm whitespace-pre-wrap">{ticket.description}</div>
        )}
      </div>

      {/* Comments */}
      <div className="space-y-3">
        {(ticket.comments || []).map(c => (
          <div key={c.id} className={`card ${c.comment_type === 'internal' ? 'border-yellow-500/30 bg-yellow-500/5' : c.comment_type === 'ai' ? 'border-purple-500/30 bg-purple-500/5' : ''}`}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-dark-700 flex items-center justify-center">
                {c.comment_type === 'ai' ? <Bot size={14} className="text-purple-400" /> : <User size={14} className="text-dark-400" />}
              </div>
              <span className="text-sm font-medium text-dark-200">{c.author?.first_name || c.author?.email || 'System'}</span>
              {c.comment_type !== 'public' && <span className="text-xs px-1.5 py-0.5 rounded bg-dark-700 text-dark-400">{c.comment_type}</span>}
              <span className="text-xs text-dark-500 ml-auto">{format(new Date(c.created_at), 'MMM d, h:mm a')}</span>
            </div>
            <div className="text-sm text-dark-200 whitespace-pre-wrap pl-9">{c.content}</div>
          </div>
        ))}
        {(!ticket.comments || ticket.comments.length === 0) && (
          <div className="text-center text-dark-500 text-sm py-6">No replies yet</div>
        )}
      </div>

      {/* Reply box */}
      {ticket.status !== 'closed' && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare size={16} className="text-dark-400" />
            <span className="text-sm font-medium text-dark-300">Add Reply</span>
            {(user?.role === 'admin' || user?.role === 'agent') && (
              <select value={commentType} onChange={e => setCommentType(e.target.value)} className="input-field w-auto text-xs ml-auto py-1 px-2">
                <option value="public">Public</option>
                <option value="internal">Internal Note</option>
              </select>
            )}
          </div>
          <textarea value={comment} onChange={e => setComment(e.target.value)} className="input-field min-h-[100px] resize-y mb-3" placeholder="Type your reply..." />
          <div className="flex justify-end">
            <button onClick={sendComment} disabled={sending || !comment.trim()} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              <Send size={14} /> {sending ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
