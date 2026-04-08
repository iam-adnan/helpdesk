'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const tokens = localStorage.getItem('tokens');
    router.replace(tokens ? '/dashboard/tickets' : '/login');
  }, [router]);
  return <div className="min-h-screen bg-dark-950 flex items-center justify-center"><div className="text-dark-400">Loading...</div></div>;
}
