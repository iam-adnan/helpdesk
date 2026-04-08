'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { Ticket, Bell, Users, Settings, BarChart3, Layout, Bot, MessageSquare, LogOut, Menu, X, Shield, ChevronDown, FileText } from 'lucide-react';

const userNav = [
  { href: '/dashboard/tickets', label: 'My Tickets', icon: Ticket },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
];
const adminNav = [
  { href: '/dashboard/tickets', label: 'All Tickets', icon: Ticket },
  { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/admin', label: 'Dashboard', icon: Layout },
  { href: '/dashboard/admin/users', label: 'Users', icon: Users },
  { href: '/dashboard/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/dashboard/admin/templates', label: 'Templates', icon: FileText },
  { href: '/dashboard/admin/settings', label: 'Settings', icon: Settings },
  { href: '/dashboard/admin/integrations', label: 'Slack', icon: MessageSquare },
  { href: '/dashboard/admin/ai-setup', label: 'AI Setup', icon: Bot },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loadUser, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('tokens')) router.replace('/login');
  }, [router]);

  const nav = user?.role === 'admin' || user?.role === 'agent' ? adminNav : userNav;

  if (!user) return <div className="min-h-screen bg-dark-950 flex items-center justify-center"><div className="text-dark-400">Loading...</div></div>;

  return (
    <div className="min-h-screen bg-dark-950 flex">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-dark-900 border-r border-dark-700 transform transition-transform lg:translate-x-0 lg:static ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 p-5 border-b border-dark-700">
          <div className="w-9 h-9 bg-accent rounded-lg flex items-center justify-center"><Shield className="w-5 h-5 text-white" /></div>
          <span className="font-bold text-white text-lg">Mindstorm</span>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden ml-auto text-dark-400"><X size={20} /></button>
        </div>
        <nav className="p-3 space-y-1 flex-1">
          {user.role === 'admin' && <div className="px-3 py-2 text-xs font-semibold text-dark-500 uppercase tracking-wider">Admin</div>}
          {nav.map(item => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${pathname === item.href ? 'bg-accent/10 text-accent' : 'text-dark-300 hover:bg-dark-800 hover:text-dark-100'}`}
              onClick={() => setSidebarOpen(false)}>
              <item.icon size={18} />{item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-dark-700">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center text-accent text-sm font-semibold">
              {(user.first_name?.[0] || user.email[0]).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-dark-100 truncate">{user.first_name || user.username}</div>
              <div className="text-xs text-dark-500 truncate">{user.email}</div>
            </div>
            <button onClick={logout} className="text-dark-400 hover:text-danger"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      {/* Main */}
      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-30 bg-dark-950/80 backdrop-blur border-b border-dark-800 px-6 py-4 flex items-center gap-4">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-dark-400"><Menu size={20} /></button>
          <h2 className="text-lg font-semibold text-white flex-1">{nav.find(n => n.href === pathname)?.label || 'Helpdesk'}</h2>
          <Link href="/dashboard/tickets/new" className="btn-primary text-sm flex items-center gap-2"><Ticket size={16} /> New Ticket</Link>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
