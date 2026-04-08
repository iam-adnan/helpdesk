'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from 'recharts';

const COLORS = ['#e8792f','#22c55e','#3b82f6','#eab308','#ef4444','#8b5cf6'];

export default function ReportsPage() {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    api.get('/reports/dashboard/', { params: { days } }).then(r => setData(r.data)).catch(() => {});
  }, [days]);

  if (!data) return <div className="text-dark-400 text-center py-12">Loading reports...</div>;

  const statusData = Object.entries(data.status_breakdown || {}).map(([k,v]) => ({ name: k.replace('_',' '), value: v }));
  const priorityData = Object.entries(data.priority_breakdown || {}).map(([k,v]) => ({ name: k, value: v }));
  const dailyData = data.daily_tickets || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Reports & Analytics</h2>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="input-field w-auto text-sm">
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card text-center">
          <div className="text-3xl font-bold text-white">{data.total_tickets}</div>
          <div className="text-sm text-dark-400 mt-1">Total Tickets</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-accent">{data.avg_resolution_hours || 'N/A'}{data.avg_resolution_hours ? 'h' : ''}</div>
          <div className="text-sm text-dark-400 mt-1">Avg Resolution Time</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-blue-400">{data.avg_first_response_mins || 'N/A'}{data.avg_first_response_mins ? 'm' : ''}</div>
          <div className="text-sm text-dark-400 mt-1">Avg First Response</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">Daily Ticket Volume</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dailyData}><CartesianGrid strokeDasharray="3 3" stroke="#40414f" /><XAxis dataKey="date" stroke="#8e8ea0" tick={{fontSize:11}} /><YAxis stroke="#8e8ea0" tick={{fontSize:11}} /><Tooltip contentStyle={{background:'#2d2d3a',border:'1px solid #40414f',borderRadius:8,color:'#ececf1'}} /><Line type="monotone" dataKey="count" stroke="#e8792f" strokeWidth={2} dot={false} /></LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">By Status</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart><Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value" label={({name,value})=>`${name}: ${value}`}>
              {statusData.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
            </Pie><Tooltip contentStyle={{background:'#2d2d3a',border:'1px solid #40414f',borderRadius:8,color:'#ececf1'}} /></PieChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">By Priority</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={priorityData}><CartesianGrid strokeDasharray="3 3" stroke="#40414f" /><XAxis dataKey="name" stroke="#8e8ea0" tick={{fontSize:11}} /><YAxis stroke="#8e8ea0" tick={{fontSize:11}} /><Tooltip contentStyle={{background:'#2d2d3a',border:'1px solid #40414f',borderRadius:8,color:'#ececf1'}} /><Bar dataKey="value" fill="#e8792f" radius={[4,4,0,0]} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">Agent Performance</h3>
          <div className="space-y-3">
            {(data.agent_performance || []).map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-dark-800 last:border-0">
                <div><div className="text-sm text-dark-100">{a.assigned_to__first_name} {a.assigned_to__last_name}</div><div className="text-xs text-dark-500">{a.assigned_to__email}</div></div>
                <div className="text-right"><div className="text-sm text-dark-100">{a.total} assigned</div><div className="text-xs text-green-400">{a.resolved} resolved</div></div>
              </div>
            ))}
            {(!data.agent_performance || data.agent_performance.length === 0) && <div className="text-dark-500 text-sm">No data yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
