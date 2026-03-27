import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import { formatDistanceToNow, format } from 'date-fns';

/* ── API ──────────────────────────────────────────────────────────────────── */
const api = axios.create({ baseURL: '/api', withCredentials: true });
api.interceptors.request.use(cfg => {
  const c = document.cookie.split(';').find(x => x.trim().startsWith('csrftoken='));
  if (c) cfg.headers['X-CSRFToken'] = c.split('=')[1];
  return cfg;
});

/* ── Context ─────────────────────────────────────────────────────────────── */
const AuthCtx  = createContext(null);
const ToastCtx = createContext(null);
const useAuth  = () => useContext(AuthCtx);
const useToast = () => useContext(ToastCtx);

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const ago  = d => { try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return '—'; }};
const fmt  = d => { try { return format(new Date(d), 'MMM d, yyyy HH:mm'); } catch { return '—'; }};
const fmtSz= b => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;

/* ── Toast ───────────────────────────────────────────────────────────────── */
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div style={{ position:'fixed', bottom:24, right:24, display:'flex', flexDirection:'column', gap:8, zIndex:9999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding:'11px 16px', borderRadius:10, fontSize:13, fontWeight:500,
            animation:'slideUp .2s ease',
            background: t.type==='success' ? 'rgba(0,230,180,.14)' : t.type==='error' ? 'rgba(255,60,80,.14)' : 'rgba(255,200,0,.14)',
            border: `1px solid ${t.type==='success' ? 'rgba(0,230,180,.3)' : t.type==='error' ? 'rgba(255,60,80,.3)' : 'rgba(255,200,0,.3)'}`,
            color: t.type==='success' ? '#00e6b4' : t.type==='error' ? '#ff3c50' : '#ffc800',
            backdropFilter:'blur(8px)', boxShadow:'0 4px 20px rgba(0,0,0,.4)',
          }}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ── Auth ────────────────────────────────────────────────────────────────── */
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    axios.get('/auth/status/', { withCredentials: true })
      .then(r => { if (r.data.authenticated) setUser(r.data.user); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const logout = async () => {
    try { await api.post('/auth/logout/'); } catch {}
    setUser(null);
    window.location.href = '/login';
  };
  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0a0f' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
        <MsLogo size={48} />
        <div style={{ display:'flex', gap:6 }}>
          {[0,1,2].map(i => <div key={i} style={{ width:7, height:7, borderRadius:'50%', background:'#00e6b4', animation:`pulse 1.2s ${i*0.2}s infinite` }} />)}
        </div>
      </div>
    </div>
  );
  return <AuthCtx.Provider value={{ user, setUser, logout }}>{children}</AuthCtx.Provider>;
}

/* ── Mindstorm Logo SVG ──────────────────────────────────────────────────── */
function MsLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <rect width="100" height="100" rx="18" fill="#00e6b4"/>
      <path d="M20 75 L35 30 L50 58 L65 30 L80 75" stroke="#0a0a0f" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="50" cy="22" r="6" fill="#0a0a0f"/>
    </svg>
  );
}

/* ── Icons ───────────────────────────────────────────────────────────────── */
const I = {
  Grid:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
  Ticket:   p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5v2M15 11v2M15 17v2M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z"/></svg>,
  List:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  Users:    p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Clock:    p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Settings: p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>,
  Template: p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  Bell:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  Plus:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  X:        p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Search:   p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Send:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Clip:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
  Merge:    p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>,
  Link:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  Logout:   p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Warn:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Loader:   p => <svg {...p} style={{...(p.style||{}), animation:'spin .7s linear infinite'}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>,
  Slack:    p => <svg {...p} viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>,
  Lock:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  ChevronR: p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
  Menu:     p => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
};

const ico = (C, sz=15) => <C width={sz} height={sz} />;

/* ── Styles ──────────────────────────────────────────────────────────────── */
const css = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
  @keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }

  :root {
    --bg0: #0a0a0f;
    --bg1: #0f0f18;
    --bg2: #141420;
    --bg3: #1a1a28;
    --bg4: #222235;
    --bg5: #2a2a40;
    --acc: #00e6b4;
    --acc2: #00b8e6;
    --acc-dim: rgba(0,230,180,.1);
    --acc-border: rgba(0,230,180,.2);
    --t1: #f0f0f8;
    --t2: #9090b0;
    --t3: #50507a;
    --border: rgba(255,255,255,.06);
    --border2: rgba(255,255,255,.1);
    --red: #ff3c50;
    --orange: #ff8c40;
    --yellow: #ffc840;
    --green: #00e6b4;
    --purple: #a080ff;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg0); color: var(--t1); font-family: 'Barlow', sans-serif; font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  a { color: var(--acc); text-decoration: none; }
  input, select, textarea, button { font-family: inherit; }

  .app { display: flex; min-height: 100vh; }

  /* Sidebar */
  .sidebar {
    width: 220px; flex-shrink: 0;
    background: var(--bg1);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    position: fixed; height: 100vh; z-index: 200;
    transition: transform .25s ease;
  }
  .sidebar.mobile-hidden { transform: translateX(-100%); }
  .sidebar-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.7); z-index:199; }
  .sidebar-overlay.active { display:block; }

  .sb-logo { padding: 20px 16px; border-bottom: 1px solid var(--border); display:flex; align-items:center; gap:10px; }
  .sb-logo-text { line-height:1.1; }
  .sb-logo-text .top { font-family:'Barlow Condensed',sans-serif; font-size:16px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--t1); }
  .sb-logo-text .bot { font-family:'Barlow',sans-serif; font-size:10px; font-weight:500; color:var(--t3); letter-spacing:.12em; text-transform:uppercase; }

  .sb-nav { flex:1; padding:10px 8px; overflow-y:auto; }
  .sb-section { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.12em; color:var(--t3); padding:14px 10px 5px; }
  .sb-link {
    display:flex; align-items:center; gap:9px;
    padding:9px 10px; border-radius:8px;
    font-size:13px; font-weight:500; color:var(--t2);
    cursor:pointer; transition:all .15s; border:1px solid transparent;
    text-decoration:none; margin-bottom:1px;
  }
  .sb-link:hover { background:var(--bg4); color:var(--t1); }
  .sb-link.active { background:var(--acc-dim); color:var(--acc); border-color:var(--acc-border); }
  .sb-badge { margin-left:auto; background:var(--acc); color:#0a0a0f; font-size:9px; font-weight:800; padding:1px 6px; border-radius:10px; }

  .sb-user { padding:10px 8px; border-top:1px solid var(--border); }
  .sb-user-row { display:flex; align-items:center; gap:9px; padding:8px 10px; border-radius:8px; cursor:pointer; transition:background .15s; }
  .sb-user-row:hover { background:var(--bg4); }
  .sb-avatar { width:28px; height:28px; border-radius:50%; background:var(--acc-dim); border:1px solid var(--acc-border); display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; color:var(--acc); flex-shrink:0; overflow:hidden; }
  .sb-avatar img { width:100%; height:100%; object-fit:cover; }
  .sb-user-name { font-size:12px; font-weight:600; color:var(--t1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
  .sb-user-role { font-size:10px; color:var(--t3); text-transform:capitalize; }

  /* Main */
  .main { flex:1; margin-left:220px; min-height:100vh; display:flex; flex-direction:column; }
  .topbar-mobile { display:none; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); background:var(--bg1); position:sticky; top:0; z-index:100; }
  .page { padding:28px 32px; flex:1; }

  /* Cards */
  .card { background:var(--bg2); border:1px solid var(--border); border-radius:14px; }
  .card-p { padding:20px; }
  .card-header { padding:16px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
  .card-title { font-size:13px; font-weight:700; color:var(--t1); letter-spacing:.02em; }

  /* Stat grid */
  .stats { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; margin-bottom:20px; }
  .stat { background:var(--bg2); border:1px solid var(--border); border-radius:14px; padding:18px 20px; transition:border-color .2s, transform .2s; }
  .stat:hover { border-color:var(--acc-border); transform:translateY(-2px); }
  .stat-num { font-family:'Barlow Condensed',sans-serif; font-size:36px; font-weight:800; line-height:1; margin-bottom:5px; }
  .stat-label { font-size:11px; color:var(--t2); font-weight:600; text-transform:uppercase; letter-spacing:.06em; }

  /* Buttons */
  .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:none; transition:all .15s; white-space:nowrap; }
  .btn-primary { background:var(--acc); color:#0a0a0f; }
  .btn-primary:hover { background:#00ffcc; transform:translateY(-1px); }
  .btn-secondary { background:var(--bg4); color:var(--t1); border:1px solid var(--border2); }
  .btn-secondary:hover { border-color:var(--acc); color:var(--acc); }
  .btn-ghost { background:transparent; color:var(--t2); }
  .btn-ghost:hover { background:var(--bg4); color:var(--t1); }
  .btn-danger { background:rgba(255,60,80,.12); color:var(--red); border:1px solid rgba(255,60,80,.2); }
  .btn-danger:hover { background:rgba(255,60,80,.2); }
  .btn-sm { padding:5px 12px; font-size:12px; }
  .btn:disabled { opacity:.45; cursor:not-allowed; transform:none !important; }

  /* Badges */
  .badge { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:20px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
  .b-open { background:rgba(0,180,230,.13); color:#00b4e6; border:1px solid rgba(0,180,230,.22); }
  .b-in_progress { background:rgba(160,128,255,.13); color:var(--purple); border:1px solid rgba(160,128,255,.22); }
  .b-pending { background:rgba(255,200,64,.13); color:var(--yellow); border:1px solid rgba(255,200,64,.22); }
  .b-resolved { background:rgba(0,230,180,.13); color:var(--green); border:1px solid rgba(0,230,180,.22); }
  .b-closed { background:rgba(80,80,122,.2); color:var(--t3); border:1px solid rgba(80,80,122,.3); }
  .b-critical { background:rgba(255,60,80,.13); color:var(--red); border:1px solid rgba(255,60,80,.22); }
  .b-high { background:rgba(255,140,64,.13); color:var(--orange); border:1px solid rgba(255,140,64,.22); }
  .b-medium { background:rgba(255,200,64,.13); color:var(--yellow); border:1px solid rgba(255,200,64,.22); }
  .b-low { background:rgba(0,230,180,.13); color:var(--green); border:1px solid rgba(0,230,180,.22); }
  .b-breach { background:rgba(255,60,80,.13); color:var(--red); border:1px solid rgba(255,60,80,.22); }
  .b-slack { background:rgba(160,128,255,.12); color:var(--purple); border:1px solid rgba(160,128,255,.2); }

  /* Table */
  .tbl-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; min-width:600px; }
  thead th { padding:10px 14px; text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.09em; color:var(--t3); border-bottom:1px solid var(--border); white-space:nowrap; }
  tbody tr { border-bottom:1px solid var(--border); cursor:pointer; transition:background .1s; }
  tbody tr:last-child { border-bottom:none; }
  tbody tr:hover td { background:var(--bg3); }
  td { padding:13px 14px; font-size:13px; color:var(--t2); vertical-align:middle; }
  .td-p { color:var(--t1); font-weight:500; }
  .td-mono { font-family:'Barlow Condensed',monospace; font-size:12px; color:var(--acc); font-weight:600; letter-spacing:.04em; }
  .td-sub { font-size:10px; color:var(--t3); margin-top:2px; text-transform:capitalize; }

  /* Forms */
  .form-group { margin-bottom:16px; }
  .form-label { display:block; font-size:11.5px; font-weight:600; color:var(--t2); margin-bottom:6px; text-transform:uppercase; letter-spacing:.06em; }
  .form-input, .form-select, .form-textarea {
    width:100%; padding:10px 13px;
    background:var(--bg3); border:1px solid var(--border2);
    border-radius:9px; color:var(--t1); font-size:13.5px;
    transition:border-color .15s, box-shadow .15s; outline:none;
  }
  .form-input:focus, .form-select:focus, .form-textarea:focus {
    border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-dim);
  }
  .form-textarea { resize:vertical; min-height:100px; line-height:1.6; }
  .form-select option { background:var(--bg3); }
  .form-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .sel-inline { background:var(--bg3); border:1px solid var(--border2); border-radius:7px; color:var(--t1); font-size:12px; padding:5px 9px; outline:none; cursor:pointer; font-family:inherit; }
  .sel-inline:focus { border-color:var(--acc); }

  /* Modal */
  .modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.72); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; animation:fadeIn .15s ease; }
  .modal { background:var(--bg2); border:1px solid var(--border2); border-radius:16px; padding:26px; width:100%; max-width:540px; max-height:90vh; overflow-y:auto; animation:slideUp .2s ease; }
  .modal-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:22px; }
  .modal-title { font-family:'Barlow Condensed',sans-serif; font-size:18px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
  .modal-close { background:none; border:none; color:var(--t3); cursor:pointer; padding:4px; border-radius:5px; display:flex; align-items:center; transition:color .1s; }
  .modal-close:hover { color:var(--t1); }

  /* Detail layout */
  .detail-grid { display:grid; grid-template-columns:1fr 260px; gap:18px; }
  .meta-section { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.12em; color:var(--t3); margin-bottom:14px; }
  .meta-row { margin-bottom:13px; }
  .meta-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--t3); margin-bottom:4px; }
  .meta-value { font-size:13px; font-weight:500; color:var(--t1); }
  .meta-muted { color:var(--t2); font-weight:400; }

  /* Comments */
  .comment { display:flex; gap:10px; padding:13px 0; border-bottom:1px solid var(--border); }
  .comment:last-child { border-bottom:none; }
  .comment.internal-note { background:rgba(255,200,64,.04); border-left:2px solid rgba(255,200,64,.3); padding-left:10px; margin-left:-10px; }
  .c-body { flex:1; }
  .c-header { display:flex; align-items:center; flex-wrap:wrap; gap:7px; margin-bottom:5px; }
  .c-author { font-size:12.5px; font-weight:700; color:var(--t1); }
  .c-time { font-size:10px; color:var(--t3); }
  .c-tag { font-size:9px; padding:2px 7px; border-radius:10px; font-weight:700; text-transform:uppercase; }
  .c-internal { background:rgba(255,200,64,.12); color:var(--yellow); border:1px solid rgba(255,200,64,.22); }
  .c-slack { background:rgba(160,128,255,.12); color:var(--purple); border:1px solid rgba(160,128,255,.2); }
  .c-content { font-size:13px; color:var(--t2); line-height:1.7; white-space:pre-wrap; }

  /* History */
  .hist-item { display:flex; gap:9px; padding:6px 0; font-size:12px; color:var(--t3); }
  .hist-dot { width:5px; height:5px; border-radius:50%; background:var(--bg5); margin-top:5px; flex-shrink:0; }

  /* SLA bar */
  .sla-bar { height:4px; border-radius:3px; background:var(--bg4); overflow:hidden; }
  .sla-fill { height:100%; border-radius:3px; transition:width .5s; }

  /* Filters */
  .filters { display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
  .search-wrap { position:relative; flex:1; min-width:180px; }
  .search-wrap svg { position:absolute; left:11px; top:50%; transform:translateY(-50%); color:var(--t3); pointer-events:none; }
  .search-inp { padding-left:34px !important; }

  /* Empty */
  .empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; text-align:center; }
  .empty-title { font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; margin:14px 0 6px; }
  .empty-sub { font-size:13px; color:var(--t2); margin-bottom:22px; }

  /* Page header */
  .page-hdr { margin-bottom:22px; }
  .page-title { font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
  .page-sub { font-size:12px; color:var(--t2); margin-top:2px; }
  .topbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:22px; }

  /* Login */
  .login { min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg0); position:relative; overflow:hidden; padding:20px; }
  .login-grid { position:absolute; inset:0; opacity:.04; background-image:linear-gradient(var(--acc) 1px,transparent 1px),linear-gradient(90deg,var(--acc) 1px,transparent 1px); background-size:50px 50px; pointer-events:none; }
  .login-glow { position:absolute; top:-200px; left:50%; transform:translateX(-50%); width:600px; height:600px; background:radial-gradient(ellipse, rgba(0,230,180,.06) 0%, transparent 70%); pointer-events:none; }
  .login-card { position:relative; width:100%; max-width:420px; background:var(--bg2); border:1px solid var(--border2); border-radius:20px; padding:44px 40px; text-align:center; }
  .login-logo { display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:32px; }
  .login-logo-text .top { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
  .login-logo-text .bot { font-size:11px; color:var(--t3); letter-spacing:.15em; text-transform:uppercase; font-weight:500; }
  .login-title { font-family:'Barlow Condensed',sans-serif; font-size:28px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; margin-bottom:8px; }
  .login-sub { font-size:13.5px; color:var(--t2); margin-bottom:32px; line-height:1.65; }
  .google-btn { display:flex; align-items:center; justify-content:center; gap:12px; width:100%; padding:13px 18px; background:var(--bg4); border:1px solid var(--border2); border-radius:11px; font-size:15px; font-weight:600; color:var(--t1); cursor:pointer; transition:all .2s; text-decoration:none; }
  .google-btn:hover { border-color:var(--acc); background:var(--acc-dim); color:var(--t1); }
  .login-note { margin-top:18px; padding:10px 14px; background:var(--acc-dim); border:1px solid var(--acc-border); border-radius:9px; font-size:12px; color:var(--acc); }
  .login-err { margin-bottom:18px; padding:10px 14px; background:rgba(255,60,80,.1); border:1px solid rgba(255,60,80,.22); border-radius:9px; font-size:12.5px; color:#ff6070; }

  /* Divider */
  .divider { height:1px; background:linear-gradient(90deg,transparent,rgba(0,230,180,.15),transparent); margin:18px 0; }

  /* Loading */
  .loading { display:flex; align-items:center; justify-content:center; gap:10px; padding:60px; color:var(--t3); font-size:13px; }

  /* Bar charts */
  .bar-row { display:flex; align-items:center; gap:10px; margin-bottom:9px; }
  .bar-label { width:65px; font-size:11px; color:var(--t2); text-transform:capitalize; flex-shrink:0; }
  .bar-track { flex:1; height:5px; background:var(--bg4); border-radius:3px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:3px; transition:width .5s; }
  .bar-count { font-size:12px; font-weight:600; min-width:20px; text-align:right; }

  /* Responsive */
  @media (max-width: 900px) {
    .sidebar { transform:translateX(-100%); }
    .sidebar.mobile-visible { transform:translateX(0); }
    .main { margin-left:0; }
    .topbar-mobile { display:flex; }
    .page { padding:16px; }
    .detail-grid { grid-template-columns:1fr; }
    .form-row { grid-template-columns:1fr; }
    .stats { grid-template-columns:1fr 1fr; }
    .login-card { padding:32px 24px; }
  }

  @media (max-width: 480px) {
    .stats { grid-template-columns:1fr 1fr; }
    .filters { flex-direction:column; }
    .page-title { font-size:20px; }
  }
`;

/* ── Components ──────────────────────────────────────────────────────────── */

function StyleInjector() {
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
  return null;
}

function Avatar({ user, size = 28 }) {
  const initials = ((user?.name || user?.email || '?').split(' ').map(n => n[0]).join('').slice(0, 2)).toUpperCase();
  return (
    <div className="sb-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {user?.avatar
        ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" onError={e => { e.target.style.display='none'; }} />
        : initials}
    </div>
  );
}

function StatusBadge({ status }) {
  const labels = { open:'Open', in_progress:'In Progress', pending:'Pending', resolved:'Resolved', closed:'Closed' };
  return <span className={`badge b-${status}`}>{labels[status] || status}</span>;
}
function PriorityBadge({ priority }) {
  return <span className={`badge b-${priority}`}>{priority}</span>;
}
function SlaBadge({ ticket }) {
  if (!ticket.sla_resolve_due || ['resolved','closed'].includes(ticket.status)) return null;
  if (ticket.sla_resolve_overdue) return <span className="badge b-breach">{ico(I.Warn,10)} Breached</span>;
  if (ticket.sla_response_overdue) return <span className="badge b-breach">{ico(I.Warn,10)} No Response</span>;
  return null;
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
function Sidebar({ openCount, mobileOpen, onClose }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  return (
    <>
      <div className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`} onClick={onClose} />
      <div className={`sidebar ${mobileOpen ? 'mobile-visible' : ''}`}>
        <div className="sb-logo">
          <MsLogo size={34} />
          <div className="sb-logo-text">
            <div className="top">Mindstorm</div>
            <div className="bot">IT Helpdesk</div>
          </div>
        </div>
        <nav className="sb-nav">
          {isAdmin && <NavLink to="/dashboard" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>{ico(I.Grid)} Dashboard</NavLink>}
          <NavLink to="/tickets" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>
            {ico(I.Ticket)} My Tickets
            {openCount > 0 && <span className="sb-badge">{openCount}</span>}
          </NavLink>
          {isAdmin && <NavLink to="/all-tickets" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>{ico(I.List)} All Tickets</NavLink>}
          {isAdmin && <>
            <div className="sb-section">Admin</div>
            <NavLink to="/users" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>{ico(I.Users)} Users</NavLink>
            <NavLink to="/settings/sla" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>{ico(I.Clock)} SLA Policies</NavLink>
            <NavLink to="/settings/auto-assign" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>{ico(I.Settings)} Auto-Assign</NavLink>
            <NavLink to="/settings/canned" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>{ico(I.Template)} Canned Replies</NavLink>
          </>}
          <div className="sb-section">Account</div>
          <NavLink to="/notifications" className={({isActive})=>`sb-link${isActive?' active':''}`} onClick={onClose}>{ico(I.Bell)} Notifications</NavLink>
        </nav>
        <div className="sb-user">
          <div className="sb-user-row" onClick={logout} title="Log out">
            <Avatar user={user} size={28} />
            <div style={{flex:1,minWidth:0}}>
              <div className="sb-user-name">{user?.name || user?.email}</div>
              <div className="sb-user-role">{user?.role}</div>
            </div>
            {ico(I.Logout,13)}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Create Ticket Modal ─────────────────────────────────────────────────── */
function CreateTicketModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ title:'', description:'', category:'hardware', priority:'medium' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k, v) => setForm(f => ({...f, [k]:v}));

  const submit = async e => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return toast('Title and description are required.', 'error');
    setBusy(true);
    try {
      const { data } = await api.post('/tickets/', form);
      for (const file of files) {
        const fd = new FormData(); fd.append('file', file);
        await api.post(`/tickets/${data.id}/attachments/`, fd, { headers:{'Content-Type':'multipart/form-data'} });
      }
      toast(`Ticket ${data.ticket_number} created!`);
      onCreated(data); onClose();
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create ticket.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">New Support Ticket</span>
          <button className="modal-close" onClick={onClose}>{ico(I.X)}</button>
        </div>
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" placeholder="Brief summary of the issue…" value={form.title} onChange={e=>set('title',e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">Description *</label>
            <textarea className="form-textarea" placeholder="Describe the issue in detail — what happened, when, steps to reproduce…" value={form.description} onChange={e=>set('description',e.target.value)} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={e=>set('category',e.target.value)}>
                <option value="hardware">Hardware</option><option value="software">Software</option>
                <option value="network">Network</option><option value="access">Access / Permissions</option>
                <option value="email">Email</option><option value="other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-select" value={form.priority} onChange={e=>set('priority',e.target.value)}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="high">High</option><option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Attachments</label>
            <input type="file" multiple className="form-input" style={{padding:'7px'}} onChange={e=>setFiles(Array.from(e.target.files))} />
            {files.length > 0 && <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{files.map(f=>f.name).join(', ')}</div>}
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:4}}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy?ico(I.Loader):ico(I.Plus)} Create Ticket</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Tickets Page ────────────────────────────────────────────────────────── */
function TicketsPage({ adminView }) {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPriority, setFPriority] = useState('');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/tickets/'); setTickets(data); }
    catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = tickets.filter(t => {
    if (!adminView && t.created_by !== user?.id) return false;
    const s = search.toLowerCase();
    if (s && !t.title.toLowerCase().includes(s) && !t.ticket_number.toLowerCase().includes(s) && !(t.creator_name||'').toLowerCase().includes(s)) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (fPriority && t.priority !== fPriority) return false;
    return true;
  });

  return (
    <div>
      <div className="topbar">
        <div className="page-hdr" style={{margin:0}}>
          <div className="page-title">{adminView ? 'All Tickets' : 'My Tickets'}</div>
          <div className="page-sub">{visible.length} ticket{visible.length!==1?'s':''}</div>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>{ico(I.Plus)} New Ticket</button>
      </div>
      <div className="filters">
        <div className="search-wrap">
          {ico(I.Search,14)}
          <input className="form-input search-inp" placeholder="Search by title, number, requester…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <select className="form-select" style={{width:'auto'}} value={fStatus} onChange={e=>setFStatus(e.target.value)}>
          <option value="">All Statuses</option><option value="open">Open</option>
          <option value="in_progress">In Progress</option><option value="pending">Pending</option>
          <option value="resolved">Resolved</option><option value="closed">Closed</option>
        </select>
        <select className="form-select" style={{width:'auto'}} value={fPriority} onChange={e=>setFPriority(e.target.value)}>
          <option value="">All Priorities</option><option value="critical">Critical</option>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
      </div>
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        {loading ? <div className="loading">{ico(I.Loader)} Loading tickets…</div>
        : visible.length === 0 ? (
          <div className="empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth="1.5"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
            <div className="empty-title">No tickets found</div>
            <div className="empty-sub">Submit a ticket to get support from the IT team.</div>
            <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>{ico(I.Plus)} New Ticket</button>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Ticket #</th><th>Title</th><th>Status</th><th>Priority</th><th>Requester</th><th>Assignee</th><th>SLA</th><th>Created</th></tr></thead>
              <tbody>
                {visible.map(t => (
                  <tr key={t.id} onClick={()=>navigate(`/tickets/${t.id}`)}>
                    <td className="td-mono">
                      {t.ticket_number}
                      {t.source==='slack' && <span style={{marginLeft:5,color:'var(--purple)',fontSize:10}}>{ico(I.Slack,10)}</span>}
                    </td>
                    <td>
                      <div className="td-p" style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.is_merged ? <s style={{opacity:.5}}>{t.title}</s> : t.title}</div>
                      <div className="td-sub">{t.category}{t.attachment_count>0 && <span> · {ico(I.Clip,10)} {t.attachment_count}</span>}</div>
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td style={{fontSize:12}}>{t.creator_name}</td>
                    <td style={{fontSize:12,color:t.assignee_name?'var(--t1)':'var(--t3)'}}>{t.assignee_name||'Unassigned'}</td>
                    <td><SlaBadge ticket={t} /></td>
                    <td style={{fontSize:11}}>{ago(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showCreate && <CreateTicketModal onClose={()=>setShowCreate(false)} onCreated={t=>setTickets(p=>[t,...p])} />}
    </div>
  );
}

/* ── Ticket Detail ───────────────────────────────────────────────────────── */
function TicketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [canned, setCanned] = useState([]);
  const [showCanned, setShowCanned] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeResults, setMergeResults] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef();
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    api.get(`/tickets/${id}/`)
      .then(r => setTicket(r.data))
      .catch(() => navigate('/tickets'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    load();
    if (user?.role==='admin') {
      api.get('/users/').then(r => setAdminUsers(r.data.filter(u=>u.role==='admin'))).catch(()=>{});
      api.get('/canned-responses/').then(r => setCanned(r.data)).catch(()=>{});
    }
  }, [load, user]);

  useEffect(() => {
    if (mergeSearch.length < 3) { setMergeResults([]); return; }
    api.get('/tickets/').then(r => setMergeResults(
      r.data.filter(t => t.id!==parseInt(id) && !t.is_merged &&
        (t.ticket_number.includes(mergeSearch) || t.title.toLowerCase().includes(mergeSearch.toLowerCase())))
      .slice(0,5)
    )).catch(()=>{});
  }, [mergeSearch, id]);

  const patch = async payload => {
    try {
      const { data } = await api.patch(`/tickets/${id}/`, payload);
      setTicket(p => ({...p, ...data}));
      toast('Updated.');
    } catch { toast('Update failed.', 'error'); }
  };

  const submitComment = async e => {
    e.preventDefault();
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(`/tickets/${id}/comments/`, { content:comment, is_internal:internal });
      setTicket(p => ({...p, comments:[...(p.comments||[]), data]}));
      setComment(''); setInternal(false); toast('Reply added.');
    } catch { toast('Failed to add reply.', 'error'); }
    finally { setSubmitting(false); }
  };

  const uploadFile = async e => {
    const file = e.target.files[0]; if (!file) return;
    setUploadBusy(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const { data } = await api.post(`/tickets/${id}/attachments/`, fd, { headers:{'Content-Type':'multipart/form-data'} });
      setTicket(p => ({...p, attachments:[...(p.attachments||[]), data]}));
      toast('File uploaded.');
    } catch (err) { toast(err.response?.data?.error||'Upload failed.', 'error'); }
    finally { setUploadBusy(false); if(fileRef.current) fileRef.current.value=''; }
  };

  const doMerge = async targetId => {
    try {
      await api.post(`/tickets/${id}/merge/`, { target_id:targetId });
      toast('Ticket merged.');
      navigate('/all-tickets');
    } catch (err) { toast(err.response?.data?.error||'Merge failed.', 'error'); }
  };

  if (loading) return <div className="loading">{ico(I.Loader)} Loading…</div>;
  if (!ticket) return null;

  const slaPercent = ticket.sla_resolve_due
    ? Math.min(100, Math.max(0, ((Date.now()-new Date(ticket.created_at))/(new Date(ticket.sla_resolve_due)-new Date(ticket.created_at)))*100))
    : 0;
  const slaColor = slaPercent > 90 ? 'var(--red)' : slaPercent > 70 ? 'var(--orange)' : 'var(--acc)';

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate(-1)}>← Back</button>
        <span style={{color:'var(--t3)'}}>/</span>
        <span className="td-mono">{ticket.ticket_number}</span>
        {ticket.source==='slack' && <span className="badge b-slack" style={{fontSize:10}}>{ico(I.Slack,10)} Slack</span>}
        {ticket.is_merged && <span style={{fontSize:11,color:'var(--t3)',background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:20,padding:'2px 9px'}}>Merged</span>}
        {isAdmin && !ticket.is_merged && (
          <div style={{marginLeft:'auto',display:'flex',gap:6}}>
            <button className="btn btn-secondary btn-sm" onClick={()=>setShowMerge(s=>!s)}>{ico(I.Merge,13)} Merge</button>
          </div>
        )}
      </div>

      {showMerge && (
        <div className="card card-p" style={{marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Merge into another ticket</div>
          <input className="form-input" placeholder="Search by ticket # or title…" value={mergeSearch} onChange={e=>setMergeSearch(e.target.value)} autoFocus />
          {mergeResults.map(t => (
            <div key={t.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <div>
                <span className="td-mono">{t.ticket_number}</span>
                <span style={{fontSize:12,color:'var(--t2)',marginLeft:10}}>{t.title}</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={()=>doMerge(t.id)}>Merge in</button>
            </div>
          ))}
        </div>
      )}

      <div className="detail-grid">
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="card card-p">
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:14}}>
              <h2 style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:700,letterSpacing:'.02em',lineHeight:1.3,flex:1}}>{ticket.title}</h2>
              <div style={{display:'flex',gap:6,flexShrink:0,flexWrap:'wrap'}}>
                <StatusBadge status={ticket.status} />
                <SlaBadge ticket={ticket} />
              </div>
            </div>
            <p style={{fontSize:13.5,color:'var(--t2)',lineHeight:1.75,whiteSpace:'pre-wrap'}}>{ticket.description}</p>
          </div>

          {ticket.links?.length > 0 && (
            <div className="card card-p">
              <div className="card-title" style={{marginBottom:12,display:'flex',alignItems:'center',gap:7}}>{ico(I.Link,13)} Linked Tickets</div>
              {ticket.links.map(l => (
                <div key={l.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid var(--border)',fontSize:12}}>
                  <span style={{color:'var(--t3)',minWidth:80,textTransform:'capitalize'}}>{l.link_type.replace('_',' ')}</span>
                  <span className="td-mono" style={{cursor:'pointer',textDecoration:'underline'}} onClick={()=>navigate(`/tickets/${l.to_ticket}`)}>{l.linked_number}</span>
                  <span style={{color:'var(--t2)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.linked_title}</span>
                  <StatusBadge status={l.linked_status} />
                </div>
              ))}
            </div>
          )}

          <div className="card card-p">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div className="card-title" style={{display:'flex',alignItems:'center',gap:7}}>{ico(I.Clip,13)} Attachments {ticket.attachments?.length > 0 && `(${ticket.attachments.length})`}</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>fileRef.current?.click()}>{uploadBusy?ico(I.Loader):ico(I.Plus)} Upload</button>
              <input ref={fileRef} type="file" style={{display:'none'}} onChange={uploadFile} />
            </div>
            {ticket.attachments?.length === 0 && <p style={{fontSize:12,color:'var(--t3)'}}>No attachments.</p>}
            {ticket.attachments?.map(a => (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid var(--border)',textDecoration:'none'}}>
                {ico(I.Clip,13)}
                <span style={{flex:1,fontSize:12.5,color:'var(--acc)'}}>{a.filename}</span>
                <span style={{fontSize:10,color:'var(--t3)'}}>{fmtSz(a.file_size)}</span>
                <span style={{fontSize:10,color:'var(--t3)'}}>{ago(a.created_at)}</span>
              </a>
            ))}
          </div>

          <div className="card card-p">
            <div className="card-title" style={{marginBottom:14}}>
              Comments {ticket.comments?.length ? `(${ticket.comments.length})` : ''}
            </div>
            {ticket.comments?.length===0 && <p style={{fontSize:12,color:'var(--t3)',marginBottom:14}}>No comments yet.</p>}
            {ticket.comments?.map(c => (
              <div key={c.id} className={`comment${c.is_internal?' internal-note':''}`}>
                <Avatar user={{name:c.author_name,avatar:c.author_avatar}} size={26} />
                <div className="c-body">
                  <div className="c-header">
                    <span className="c-author">{c.author_name}</span>
                    {c.is_internal && <span className="c-tag c-internal">{ico(I.Lock,9)} Internal</span>}
                    {c.source==='slack' && <span className="c-tag c-slack">{ico(I.Slack,9)} Slack</span>}
                    <span className="c-time">{ago(c.created_at)}</span>
                  </div>
                  <div className="c-content">{c.content}</div>
                </div>
              </div>
            ))}
            <div className="divider" />
            <form onSubmit={submitComment}>
              <div style={{position:'relative'}}>
                <textarea className="form-textarea" style={{minHeight:80}} placeholder="Write a reply…" value={comment} onChange={e=>setComment(e.target.value)} />
                {isAdmin && canned.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{position:'absolute',right:8,bottom:8,fontSize:11}} onClick={()=>setShowCanned(s=>!s)}>
                    {ico(I.Template,12)} Templates
                  </button>
                )}
              </div>
              {showCanned && (
                <div style={{background:'var(--bg3)',border:'1px solid var(--border2)',borderRadius:9,marginTop:6,maxHeight:180,overflowY:'auto'}}>
                  {canned.map(cr => (
                    <div key={cr.id} style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid var(--border)'}} onClick={()=>{setComment(cr.content);setShowCanned(false);}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--t1)'}}>{cr.title}</div>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>{cr.content.slice(0,80)}…</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:10}}>
                {isAdmin && (
                  <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,color:'var(--t3)',cursor:'pointer'}}>
                    <input type="checkbox" checked={internal} onChange={e=>setInternal(e.target.checked)} />
                    Internal note only
                  </label>
                )}
                <div style={{marginLeft:'auto'}}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={submitting||!comment.trim()}>
                    {submitting?ico(I.Loader):ico(I.Send,13)} Reply
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:13}}>
          <div className="card card-p">
            <div className="meta-section">Ticket Details</div>

            {ticket.sla_resolve_due && !['resolved','closed'].includes(ticket.status) && (
              <div style={{marginBottom:16}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t3)',marginBottom:5}}>
                  <span style={{textTransform:'uppercase',letterSpacing:'.07em',fontWeight:700}}>SLA Progress</span>
                  <span>{ticket.sla_resolve_overdue ? '🚨 Breached' : fmt(ticket.sla_resolve_due)}</span>
                </div>
                <div className="sla-bar">
                  <div className="sla-fill" style={{width:`${slaPercent}%`,background:slaColor}} />
                </div>
              </div>
            )}

            {[
              ['Status', isAdmin ? (
                <select className="sel-inline" value={ticket.status} onChange={e=>patch({status:e.target.value})}>
                  <option value="open">Open</option><option value="in_progress">In Progress</option>
                  <option value="pending">Pending User</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
                </select>
              ) : <StatusBadge status={ticket.status} />],
              ['Priority', isAdmin ? (
                <select className="sel-inline" value={ticket.priority} onChange={e=>patch({priority:e.target.value})}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                </select>
              ) : <PriorityBadge priority={ticket.priority} />],
              ['Category', <span className="meta-value" style={{textTransform:'capitalize'}}>{ticket.category}</span>],
              ['Assignee', isAdmin ? (
                <select className="sel-inline" value={ticket.assigned_to||''} onChange={e=>patch({assigned_to:e.target.value||null})}>
                  <option value="">Unassigned</option>
                  {adminUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : <span className="meta-value meta-muted">{ticket.assignee_name||'Unassigned'}</span>],
              ['Requester', <span className="meta-value">{ticket.creator_name}</span>],
              ['Source', <span style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--t2)',textTransform:'capitalize'}}>{ticket.source==='slack'&&ico(I.Slack,11)} {ticket.source}</span>],
              ['Created', <span className="meta-value" style={{fontSize:11}}>{fmt(ticket.created_at)}</span>],
              ...(ticket.resolved_at ? [['Resolved', <span className="meta-value" style={{fontSize:11}}>{fmt(ticket.resolved_at)}</span>]] : []),
            ].map(([label, value]) => (
              <div key={label} className="meta-row">
                <div className="meta-label">{label}</div>
                <div>{value}</div>
              </div>
            ))}
          </div>

          {ticket.history?.length > 0 && (
            <div className="card card-p">
              <div className="meta-section">Activity</div>
              {ticket.history.map(h => (
                <div key={h.id} className="hist-item">
                  <div className="hist-dot" />
                  <div>
                    <strong style={{color:'var(--t2)'}}>{h.user_name}</strong>{' '}
                    {h.action==='created' ? 'opened ticket' :
                     h.action==='status_changed' ? <span>changed status to <strong>{h.new_value}</strong></span> :
                     h.action==='priority_changed' ? <span>changed priority to <strong>{h.new_value}</strong></span> :
                     h.action==='assigned'||h.action==='auto_assigned' ? 'assigned ticket' :
                     h.action==='merged_into' ? <span>merged into <strong>{h.new_value}</strong></span> : h.action}
                    <div style={{fontSize:10,marginTop:1,color:'var(--t3)'}}>{ago(h.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */
function Dashboard() {
  const [stats, setStats] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { api.get('/tickets/admin/stats/').then(r=>setStats(r.data)).catch(()=>{}); }, []);
  if (!stats) return <div className="loading">{ico(I.Loader)} Loading…</div>;
  const pc = {'critical':'var(--red)','high':'var(--orange)','medium':'var(--yellow)','low':'var(--green)'};
  return (
    <div>
      <div className="page-hdr"><div className="page-title">Dashboard</div><div className="page-sub">Live overview of all IT activity</div></div>
      <div className="stats">
        {[['Total',stats.total,'var(--t1)'],['Open',stats.open,'var(--acc2)'],['In Progress',stats.in_progress,'var(--purple)'],
          ['Pending',stats.pending,'var(--yellow)'],['Resolved',stats.resolved,'var(--green)'],['SLA Breached',stats.sla_breached,'var(--red)'],
          ['Critical',stats.critical_open,'var(--orange)'],['Via Slack',stats.from_slack,'var(--purple)']].map(([l,v,c])=>(
          <div key={l} className="stat">
            <div className="stat-num" style={{color:c}}>{v}</div>
            <div className="stat-label">{l}</div>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>By Priority</div>
          {stats.by_priority.map(p=>(
            <div key={p.priority} className="bar-row">
              <div className="bar-label">{p.priority}</div>
              <div className="bar-track"><div className="bar-fill" style={{width:stats.total?`${(p.count/stats.total)*100}%`:'0%',background:pc[p.priority]||'var(--t3)'}} /></div>
              <div className="bar-count" style={{color:pc[p.priority]}}>{p.count}</div>
            </div>
          ))}
        </div>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>By Category</div>
          {stats.by_category.map(c=>(
            <div key={c.category} className="bar-row">
              <div className="bar-label">{c.category}</div>
              <div className="bar-track"><div className="bar-fill" style={{width:stats.total?`${(c.count/stats.total)*100}%`:'0%',background:'var(--acc)',opacity:.7}} /></div>
              <div className="bar-count">{c.count}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div className="card-header"><span className="card-title">Recent Tickets</span></div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Ticket #</th><th>Title</th><th>Status</th><th>Priority</th><th>SLA</th><th>Created</th></tr></thead>
            <tbody>
              {stats.recent.map(t=>(
                <tr key={t.id} onClick={()=>navigate(`/tickets/${t.id}`)}>
                  <td className="td-mono">{t.ticket_number}</td>
                  <td className="td-p" style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td><SlaBadge ticket={t} /></td>
                  <td style={{fontSize:11}}>{ago(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Users ───────────────────────────────────────────────────────────────── */
function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api.get('/users/').then(r => setUsers(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const toggleRole = async u => {
    const nr = u.role === 'admin' ? 'user' : 'admin';
    try {
      await api.patch(`/users/${u.id}/role/`, { role: nr });
      setUsers(p => p.map(x => x.id === u.id ? { ...x, role: nr } : x));
      toast(`${u.name} is now ${nr === 'admin' ? 'an Admin' : 'a User'}.`);
    } catch { toast('Failed to update role.', 'error'); }
  };

  const adminCount = users.filter(u => u.role === 'admin').length;

  return (
    <div>
      <div className="topbar">
        <div className="page-hdr" style={{margin:0}}>
          <div className="page-title">Users</div>
          <div className="page-sub">{users.length} registered · {adminCount} admin{adminCount !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div style={{background:'rgba(0,230,180,.06)',border:'1px solid rgba(0,230,180,.15)',borderRadius:10,padding:'12px 16px',marginBottom:16,fontSize:13,color:'var(--t2)',display:'flex',alignItems:'center',gap:10}}>
        {ico(I.Lock,14)}
        <span>Admins have full access. Regular users can only see <strong style={{color:'var(--t1)'}}>My Tickets</strong> and <strong style={{color:'var(--t1)'}}>Notifications</strong>.</span>
      </div>

      <div className="card" style={{padding:0,overflow:'hidden'}}>
        {loading ? <div className="loading">{ico(I.Loader)} Loading users…</div> : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Tickets</th>
                  <th>Last Login</th>
                  <th>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:9}}>
                        <Avatar user={u} size={28}/>
                        <div>
                          <div className="td-p" style={{fontSize:13}}>{u.name}</div>
                          {u.id === me.id && <div style={{fontSize:10,color:'var(--acc)'}}>You</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{fontSize:12,color:'var(--t2)'}}>{u.email}</td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'b-in_progress' : 'b-closed'}`}>
                        {u.role === 'admin' ? '👑 Admin' : '👤 User'}
                      </span>
                    </td>
                    <td style={{fontSize:13,color:'var(--t1)',fontWeight:600}}>{u.ticket_count || 0}</td>
                    <td style={{fontSize:11,color:'var(--t3)'}}>{u.last_login_at ? ago(u.last_login_at) : 'Never'}</td>
                    <td>
                      {u.id !== me.id ? (
                        <button
                          className={`btn btn-sm ${u.role === 'admin' ? 'btn-danger' : 'btn-secondary'}`}
                          onClick={() => toggleRole(u)}
                          style={{fontSize:11}}
                        >
                          {u.role === 'admin' ? '⬇ Make User' : '⬆ Make Admin'}
                        </button>
                      ) : (
                        <span style={{fontSize:11,color:'var(--t3)',fontStyle:'italic'}}>Cannot change own role</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── SLA Settings ────────────────────────────────────────────────────────── */
function SLASettings() {
  const [policies, setPolicies] = useState([]);
  const [form, setForm] = useState({name:'',priority:'medium',response_hours:8,resolve_hours:72,is_active:true});
  const toast = useToast();
  useEffect(()=>{ api.get('/sla-policies/').then(r=>setPolicies(r.data)).catch(()=>{}); },[]);
  const save = async e => {
    e.preventDefault();
    try { const {data}=await api.post('/sla-policies/',form); setPolicies(p=>[...p,data]); toast('SLA policy created.'); setForm({name:'',priority:'medium',response_hours:8,resolve_hours:72,is_active:true}); }
    catch { toast('Save failed.', 'error'); }
  };
  const del = async id => {
    try { await api.delete(`/sla-policies/${id}/`); setPolicies(p=>p.filter(x=>x.id!==id)); toast('Deleted.'); }
    catch { toast('Delete failed.', 'error'); }
  };
  return (
    <div>
      <div className="page-hdr"><div className="page-title">SLA Policies</div><div className="page-sub">Response and resolution time targets per priority level</div></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>Current Policies</div>
          {policies.length===0 ? <p style={{fontSize:12,color:'var(--t3)'}}>No policies yet.</p> : policies.map(p=>(
            <div key={p.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}><span style={{fontSize:13,fontWeight:600}}>{p.name}</span><PriorityBadge priority={p.priority}/></div>
                <div style={{fontSize:11,color:'var(--t3)'}}>Response: {p.response_hours}h · Resolve: {p.resolve_hours}h</div>
              </div>
              <button className="btn btn-danger btn-sm" onClick={()=>del(p.id)}>Delete</button>
            </div>
          ))}
        </div>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>Add Policy</div>
          <form onSubmit={save}>
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Critical SLA" required /></div>
            <div className="form-group"><label className="form-label">Priority</label>
              <select className="form-select" value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
                <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Response (hours)</label><input type="number" className="form-input" value={form.response_hours} onChange={e=>setForm(f=>({...f,response_hours:+e.target.value}))} min="0.5" step="0.5" required /></div>
              <div className="form-group"><label className="form-label">Resolve (hours)</label><input type="number" className="form-input" value={form.resolve_hours} onChange={e=>setForm(f=>({...f,resolve_hours:+e.target.value}))} min="1" step="1" required /></div>
            </div>
            <button type="submit" className="btn btn-primary" style={{width:'100%'}}>{ico(I.Plus)} Add Policy</button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ── Auto Assign ─────────────────────────────────────────────────────────── */
function AutoAssignSettings() {
  const [rules, setRules] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({category:'hardware',assign_to:'',is_active:true});
  const toast = useToast();
  useEffect(()=>{
    api.get('/auto-assign-rules/').then(r=>setRules(r.data)).catch(()=>{});
    api.get('/users/').then(r=>setUsers(r.data.filter(u=>u.role==='admin'))).catch(()=>{});
  },[]);
  const save = async e => {
    e.preventDefault();
    try { const {data}=await api.post('/auto-assign-rules/',form); setRules(p=>[...p,data]); toast('Rule saved.'); }
    catch { toast('Failed — category may already have a rule.', 'error'); }
  };
  const del = async id => { try { await api.delete(`/auto-assign-rules/${id}/`); setRules(p=>p.filter(x=>x.id!==id)); toast('Deleted.'); } catch { toast('Failed.','error'); } };
  return (
    <div>
      <div className="page-hdr"><div className="page-title">Auto-Assign Rules</div><div className="page-sub">Automatically route tickets to specific IT staff by category</div></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>Current Rules</div>
          {rules.length===0 ? <p style={{fontSize:12,color:'var(--t3)'}}>No rules yet. Tickets will be unassigned.</p> : rules.map(r=>(
            <div key={r.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <div><div style={{fontSize:13,fontWeight:600,textTransform:'capitalize'}}>{r.category}</div><div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>→ {r.assign_to_name}</div></div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:10,color:r.is_active?'var(--green)':'var(--t3)'}}>{r.is_active?'Active':'Off'}</span>
                <button className="btn btn-danger btn-sm" onClick={()=>del(r.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>Add Rule</div>
          <form onSubmit={save}>
            <div className="form-group"><label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                {['hardware','software','network','access','email','other'].map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Assign To</label>
              <select className="form-select" value={form.assign_to} onChange={e=>setForm(f=>({...f,assign_to:e.target.value}))} required>
                <option value="">Select admin…</option>
                {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" style={{width:'100%'}}>{ico(I.Plus)} Add Rule</button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ── Canned Responses ────────────────────────────────────────────────────── */
function CannedSettings() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({title:'',content:'',category:''});
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  useEffect(()=>{ api.get('/canned-responses/').then(r=>setList(r.data)).catch(()=>{}); },[]);
  const save = async e => {
    e.preventDefault();
    try {
      if (editing) { const {data}=await api.put(`/canned-responses/${editing}/`,form); setList(p=>p.map(x=>x.id===editing?data:x)); setEditing(null); }
      else { const {data}=await api.post('/canned-responses/',form); setList(p=>[data,...p]); }
      toast('Saved.'); setForm({title:'',content:'',category:''});
    } catch { toast('Save failed.', 'error'); }
  };
  const del = async id => { try { await api.delete(`/canned-responses/${id}/`); setList(p=>p.filter(x=>x.id!==id)); toast('Deleted.'); } catch { toast('Failed.','error'); } };
  return (
    <div>
      <div className="page-hdr"><div className="page-title">Canned Responses</div><div className="page-sub">Quick reply templates for common IT issues</div></div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>Templates ({list.length})</div>
          {list.length===0 ? <p style={{fontSize:12,color:'var(--t3)'}}>No templates yet.</p> : list.map(r=>(
            <div key={r.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
                <span style={{fontSize:13,fontWeight:600}}>{r.title}</span>
                <div style={{display:'flex',gap:6}}>
                  <button className="btn btn-ghost btn-sm" onClick={()=>{setForm({title:r.title,content:r.content,category:r.category});setEditing(r.id);}}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={()=>del(r.id)}>Del</button>
                </div>
              </div>
              <div style={{fontSize:11,color:'var(--t3)'}}>{r.content.slice(0,90)}… · Used {r.use_count}×</div>
            </div>
          ))}
        </div>
        <div className="card card-p">
          <div className="card-title" style={{marginBottom:14}}>{editing?'Edit Template':'New Template'}</div>
          <form onSubmit={save}>
            <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} required /></div>
            <div className="form-group"><label className="form-label">Category (optional)</label>
              <select className="form-select" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                <option value="">Any</option><option value="hardware">Hardware</option><option value="software">Software</option><option value="network">Network</option><option value="access">Access</option><option value="email">Email</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Content</label><textarea className="form-textarea" style={{minHeight:120}} value={form.content} onChange={e=>setForm(f=>({...f,content:e.target.value}))} required /></div>
            <div style={{display:'flex',gap:8}}>
              {editing && <button type="button" className="btn btn-secondary" onClick={()=>{setEditing(null);setForm({title:'',content:'',category:''});}}>Cancel</button>}
              <button type="submit" className="btn btn-primary" style={{flex:1}}>{ico(I.Plus)} {editing?'Save Changes':'Add Template'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ── Notification Settings ───────────────────────────────────────────────── */
function NotificationSettings() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({notify_slack: user?.notify_slack ?? true, notify_email: user?.notify_email ?? false});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async e => {
    e.preventDefault(); setBusy(true);
    try {
      const { data } = await api.patch('/users/me/notifications/', form);
      setUser(data);
      toast('Preferences saved.');
    } catch { toast('Save failed.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-hdr">
        <div className="page-title">Notifications</div>
        <div className="page-sub">Control how you receive ticket updates</div>
      </div>
      <div className="card card-p" style={{maxWidth:500}}>
        <form onSubmit={save}>
          <div style={{marginBottom:20}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,letterSpacing:'.04em',textTransform:'uppercase',marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
              {ico(I.Slack,15)} Slack Notifications
            </div>
            <div style={{background:'rgba(0,230,180,.06)',border:'1px solid rgba(0,230,180,.14)',borderRadius:9,padding:'10px 14px',marginBottom:14,fontSize:12,color:'var(--t2)'}}>
              ✅ Slack DMs are sent automatically using your email <strong style={{color:'var(--acc)'}}>{user?.email}</strong>. No Slack ID required — just make sure you use the same email in Slack.
            </div>
            <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
              <input type="checkbox" checked={form.notify_slack} onChange={e=>setForm(f=>({...f,notify_slack:e.target.checked}))} style={{marginTop:3}} />
              <div>
                <div style={{fontSize:13,fontWeight:600}}>Receive Slack DMs for ticket updates</div>
                <div style={{fontSize:11.5,color:'var(--t3)',marginTop:2}}>When your ticket is created, updated, replied to, or resolved</div>
              </div>
            </label>
          </div>

          <div className="divider" />

          <div style={{marginBottom:20}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,letterSpacing:'.04em',textTransform:'uppercase',marginBottom:14,display:'flex',alignItems:'center',gap:8}}>
              {ico(I.Bell,15)} Email Notifications
            </div>
            <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
              <input type="checkbox" checked={form.notify_email} onChange={e=>setForm(f=>({...f,notify_email:e.target.checked}))} style={{marginTop:3}} />
              <div>
                <div style={{fontSize:13,fontWeight:600}}>Receive email updates</div>
                <div style={{fontSize:11.5,color:'var(--t3)',marginTop:2}}>Sent to {user?.email}</div>
              </div>
            </label>
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy} style={{width:'100%',justifyContent:'center'}}>
            {busy ? ico(I.Loader) : 'Save Preferences'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── Login ───────────────────────────────────────────────────────────────── */
function LoginPage() {
  const [tab, setTab] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    // Fetch CSRF cookie so form submissions work
    api.get('/auth/status/').catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const endpoint = tab === 'login' ? '/auth/login/' : '/auth/register/';
      const payload = tab === 'login'
        ? { email: form.email, password: form.password }
        : { email: form.email, password: form.password, name: form.name };
      const { data } = await api.post(endpoint, payload);
      if (data.authenticated) {
        setUser(data.user);
        navigate(data.user.role === 'admin' ? '/dashboard' : '/tickets', { replace: true });
      }
    } catch (e) {
      setErr(e.response?.data?.error || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="login-grid" />
      <div className="login-glow" />
      <div className="login-card">
        <div className="login-logo">
          <MsLogo size={44} />
          <div className="login-logo-text">
            <div className="top">mindstorm</div>
            <div className="bot">Studios</div>
          </div>
        </div>
        <div className="login-title">IT Helpdesk</div>
        <div className="login-sub">Submit and track IT support requests.</div>

        <div style={{display:'flex',background:'var(--bg3)',borderRadius:10,padding:4,marginBottom:22,gap:4}}>
          {[['login','Sign In'],['register','Create Account']].map(([t,l]) => (
            <button key={t} onClick={() => { setTab(t); setErr(''); }}
              style={{flex:1,padding:'8px 0',borderRadius:7,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit',
                background: tab===t ? 'var(--acc)' : 'transparent',
                color: tab===t ? '#0a0a0f' : 'var(--t2)',
                transition:'all .15s'}}>
              {l}
            </button>
          ))}
        </div>

        {err && <div className="login-err">⚠️ {err}</div>}

        <form onSubmit={submit}>
          {tab === 'register' && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" type="text" placeholder="Adnan Akram"
                value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" placeholder="you@mindstormstudios.com"
              value={form.email} onChange={e => set('email', e.target.value)} required />
          </div>
          <div className="form-group" style={{marginBottom:20}}>
            <label className="form-label">Password</label>
            <input className="form-input" type="password" placeholder={tab==='register' ? 'Min 8 characters' : 'Your password'}
              value={form.password} onChange={e => set('password', e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" style={{width:'100%',justifyContent:'center',padding:'11px 0',fontSize:14}} disabled={busy}>
            {busy ? ico(I.Loader) : (tab === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div className="login-note" style={{marginTop:16}}>🔒 Restricted to @mindstormstudios.com accounts</div>
      </div>
    </div>
  );
}

/* ── App Layout ──────────────────────────────────────────────────────────── */
function AppLayout() {
  const { user } = useAuth();
  const [openCount, setOpenCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (user) api.get('/tickets/').then(r => setOpenCount(r.data.filter(t => t.status==='open' && t.created_by===user.id).length)).catch(()=>{});
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;
  const isAdmin = user.role === 'admin';

  return (
    <div className="app">
      <StyleInjector />
      <Sidebar openCount={openCount} mobileOpen={mobileOpen} onClose={()=>setMobileOpen(false)} />
      <div className="main">
        <div className="topbar-mobile">
          <button className="btn btn-ghost btn-sm" style={{padding:'6px'}} onClick={()=>setMobileOpen(true)}>{ico(I.Menu,20)}</button>
          <MsLogo size={28} />
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,letterSpacing:'.06em',fontSize:15}}>Mindstorm Helpdesk</span>
        </div>
        <div className="page">
          <Routes>
            {isAdmin && <Route path="/dashboard" element={<Dashboard />} />}
            <Route path="/tickets" element={<TicketsPage adminView={false} />} />
            {isAdmin && <Route path="/all-tickets" element={<TicketsPage adminView={true} />} />}
            <Route path="/tickets/:id" element={<TicketDetail />} />
            {isAdmin && <Route path="/users" element={<UsersPage />} />}
            {isAdmin && <Route path="/settings/sla" element={<SLASettings />} />}
            {isAdmin && <Route path="/settings/auto-assign" element={<AutoAssignSettings />} />}
            {isAdmin && <Route path="/settings/canned" element={<CannedSettings />} />}
            <Route path="/notifications" element={<NotificationSettings />} />
            <Route path="*" element={<Navigate to={isAdmin?'/dashboard':'/tickets'} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

/* ── Root ────────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <BrowserRouter>
      <StyleInjector />
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginGate />} />
            <Route path="/*" element={<AppLayout />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function LoginGate() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}
