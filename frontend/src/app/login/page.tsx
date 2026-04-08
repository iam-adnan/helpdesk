'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Shield, Loader2 } from 'lucide-react';

function getErrorMessage(err: any): string {
  const d = err?.response?.data;
  if (!d) return err?.message || 'Cannot connect to server.';
  if (typeof d.detail === 'string') return d.detail;
  if (Array.isArray(d.errors) && d.errors.length) return String(d.errors[0]);
  if (typeof d.error === 'string') return d.error;
  return 'Login failed.';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!email.trim()) { setError('Enter your email.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.push('/dashboard/tickets');
    } catch (err: any) {
      const msg = getErrorMessage(err);
      setError(msg); toast.error(msg);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center"><Shield className="w-7 h-7 text-white" /></div>
            <h1 className="text-2xl font-bold text-white">Mindstorm Helpdesk</h1>
          </div>
          <p className="text-dark-400">Sign in to your account</p>
        </div>
        <div className="card">
          {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} className="input-field" placeholder="you@mindstormstudios.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} className="input-field" placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading && <Loader2 size={16} className="animate-spin" />} {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <p className="text-center text-dark-400 text-sm mt-4">Don&apos;t have an account?{' '}<Link href="/register" className="text-accent hover:text-accent-light">Register</Link></p>
        </div>
      </div>
    </div>
  );
}
