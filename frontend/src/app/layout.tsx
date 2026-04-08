import type { Metadata } from 'next';
import '@/styles/globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'Mindstorm Helpdesk',
  description: 'Internal Support Portal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Toaster position="top-right" toastOptions={{
          style: { background: '#2d2d3a', color: '#ececf1', border: '1px solid #40414f' },
          duration: 4000,
        }} />
        {children}
      </body>
    </html>
  );
}
