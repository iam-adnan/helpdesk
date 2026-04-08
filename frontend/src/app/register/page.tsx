'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Shield, Loader2 } from 'lucide-react';

function extractErrors(err: any): string[] {
  const data = err?.response?.data;
  if (!data) return [err?.message || 'Cannot connect to server. Please try again.'];
  if (Array.isArray(data.errors) && data.errors.length > 0) return data.errors.map(String);
  if (typeof data.detail === 'string') return [data.detail];
  if (typeof data === 'object') {
    const msgs: string[] = [];
    for (const [field, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        for (const msg of value) {
          msgs.push(field === 'non_field_errors' ? String(msg) : `${field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${msg}`);
        }
      } else if (typeof value === 'string') {
        msgs.push(`${field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${value}`);
      }
    }
    if (msgs.length > 0) return msgs;
  }
  return ['Something went wrong. Please try again.'];
}

export default function RegisterPage() {
  const [form, setForm] = useState({ email:'', username:'', first_name:'', last_name:'', password:'', password_confirm:'' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [globalError, setGlobalError] = useState('');
  const { register } = useAuth();
  const router = useRouter();

  const validate = () => {
    const e: Record<string,string> = {};
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    if (!form.username.trim()) e.username = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!form.email.toLowerCase().endsWith('@mindstormstudios.com')) e.email = 'Only @mindstormstudios.com allowed';
    if (!form.password) e.password = 'Required';
    else if (form.password.length < 8) e.password = 'Min 8 characters';
    if (form.password !== form.password_confirm) e.password_confirm = 'Passwords don\'t match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({}); setGlobalError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await register({ ...form, email: form.email.trim().toLowerCase(), username: form.username.trim() });
      toast.success('Account created!');
      router.push('/dashboard/tickets');
    } catch (err: any) {
      const msgs = extractErrors(err);
      setGlobalError(msgs[0]);
      toast.error(msgs[0]);
    } finally { setLoading(false); }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({...form, [k]: e.target.value});
    if (errors[k]) setErrors({...errors, [k]: ''});
    if (globalError) setGlobalError('');
  };

  const ic = (f: string) => `input-field ${errors[f] ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`;

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center"><Shield className="w-7 h-7 text-white" /></div>
            <h1 className="text-2xl font-bold text-white">Mindstorm Helpdesk</h1>
          </div>
          <p className="text-dark-400">Create your account</p>
        </div>
        <div className="card">
          {globalError && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{globalError}</div>}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1">First Name</label>
                <input value={form.first_name} onChange={set('first_name')} className={ic('first_name')} placeholder="Muhammad" />
                {errors.first_name && <p className="text-red-400 text-xs mt-1">{errors.first_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1">Last Name</label>
                <input value={form.last_name} onChange={set('last_name')} className={ic('last_name')} placeholder="Akram" />
                {errors.last_name && <p className="text-red-400 text-xs mt-1">{errors.last_name}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Username</label>
              <input value={form.username} onChange={set('username')} className={ic('username')} placeholder="adnan.akram" />
              {errors.username && <p className="text-red-400 text-xs mt-1">{errors.username}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Email</label>
              <input type="email" value={form.email} onChange={set('email')} className={ic('email')} placeholder="you@mindstormstudios.com" />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Password</label>
              <input type="password" value={form.password} onChange={set('password')} className={ic('password')} placeholder="••••••••" />
              {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Confirm Password</label>
              <input type="password" value={form.password_confirm} onChange={set('password_confirm')} className={ic('password_confirm')} placeholder="••••••••" />
              {errors.password_confirm && <p className="text-red-400 text-xs mt-1">{errors.password_confirm}</p>}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>
          <p className="text-center text-dark-400 text-sm mt-4">Already have an account?{' '}<Link href="/login" className="text-accent hover:text-accent-light">Sign In</Link></p>
        </div>
      </div>
    </div>
  );
}
