'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';

export default function NewTicketPage() {
  const router = useRouter();
  const [form, setForm] = useState({ subject: '', description: '', category: 'problem', priority: 'medium', support_team: 'IT' });
  const [loading, setLoading] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>) => setForm({...form, [k]: e.target.value});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/tickets/', form);
      toast.success(`Ticket ${data.ticket_number || ''} created!`);
      router.push('/dashboard/tickets');
    } catch (err: any) {
      const msg = err.response?.data?.detail
        || err.response?.data?.error
        || 'Failed to create ticket';
      toast.error(msg);
    } finally { setLoading(false); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <h2 className="text-xl font-semibold text-white mb-6">Raise a Ticket</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Subject</label>
            <input value={form.subject} onChange={set('subject')} className="input-field" placeholder="Write something" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1.5">Description <span className="text-dark-500">(optional)</span></label>
            <textarea value={form.description} onChange={set('description')} className="input-field min-h-[120px] resize-y" placeholder="Write something" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Category</label>
              <select value={form.category} onChange={set('category')} className="input-field">
                <option value="problem">Problem</option>
                <option value="request">Request</option>
                <option value="question">Question</option>
                <option value="incident">Incident</option>
                <option value="change">Change Request</option>
                <option value="bug">Bug Report</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Priority</label>
              <select value={form.priority} onChange={set('priority')} className="input-field">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Support Team</label>
              <select value={form.support_team} onChange={set('support_team')} className="input-field">
                <option>IT</option>
                <option>HR</option>
                <option>Finance</option>
                <option>Engineering</option>
                <option>Design</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => router.back()} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">{loading ? 'Submitting...' : 'Submit a ticket'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
