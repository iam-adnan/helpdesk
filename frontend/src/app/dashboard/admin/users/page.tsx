'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { UserPlus, Shield, X } from 'lucide-react';

interface UserType {
  id: string; email: string; username: string; first_name: string; last_name: string;
  role: string; department: string; is_active: boolean; created_at: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserType[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email:'', username:'', first_name:'', last_name:'', role:'user', department:'', password:'' });

  const load = async () => {
    try { const { data } = await api.get('/auth/admin/users/'); setUsers(data.results || data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const createUser = async () => {
    try {
      await api.post('/auth/admin/users/', form);
      toast.success('User created');
      setShowCreate(false);
      setForm({ email:'', username:'', first_name:'', last_name:'', role:'user', department:'', password:'' });
      load();
    } catch (e: any) {
      const data = e.response?.data;
      if (data && typeof data === 'object') {
        const msgs = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        msgs.slice(0, 3).forEach(m => toast.error(m));
      } else {
        toast.error('Failed to create user');
      }
    }
  };

  const setRole = async (id: string, role: string) => {
    try { await api.post(`/auth/admin/users/${id}/set_role/`, { role }); toast.success('Role updated'); load(); }
    catch { toast.error('Failed'); }
  };

  const resetPw = async (id: string) => {
    try {
      const { data } = await api.post(`/auth/admin/users/${id}/reset_password/`);
      toast.success(`Temp password: ${data.temporary_password}`, { duration: 10000 });
    } catch { toast.error('Failed'); }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) => setForm({...form, [k]: e.target.value});

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold text-white">User Management</h2>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><UserPlus size={16} /> Add User</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="card w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">Create User</h3>
              <button onClick={() => setShowCreate(false)} className="text-dark-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <input value={form.email} onChange={set('email')} placeholder="Email" className="input-field" />
              <input value={form.username} onChange={set('username')} placeholder="Username" className="input-field" />
              <div className="grid grid-cols-2 gap-3">
                <input value={form.first_name} onChange={set('first_name')} placeholder="First Name" className="input-field" />
                <input value={form.last_name} onChange={set('last_name')} placeholder="Last Name" className="input-field" />
              </div>
              <input value={form.password} onChange={set('password')} type="password" placeholder="Password (optional)" className="input-field" />
              <select value={form.role} onChange={set('role')} className="input-field">
                <option value="user">User</option><option value="agent">Agent</option><option value="admin">Admin</option>
              </select>
              <input value={form.department} onChange={set('department')} placeholder="Department" className="input-field" />
              <button onClick={createUser} className="btn-primary w-full">Create User</button>
            </div>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-dark-700 text-left">
            <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">User</th>
            <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Role</th>
            <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Dept</th>
            <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Status</th>
            <th className="px-4 py-3 text-xs font-semibold text-dark-400 uppercase">Actions</th>
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-dark-800">
                <td className="px-4 py-3">
                  <div className="text-sm text-dark-100">{u.first_name} {u.last_name}</div>
                  <div className="text-xs text-dark-500">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={e => setRole(u.id, e.target.value)} className="input-field text-xs py-1 px-2 w-auto">
                    <option value="user">User</option><option value="agent">Agent</option><option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-sm text-dark-400">{u.department || '-'}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                <td className="px-4 py-3"><button onClick={() => resetPw(u.id)} className="text-xs text-accent hover:text-accent-light">Reset Password</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
