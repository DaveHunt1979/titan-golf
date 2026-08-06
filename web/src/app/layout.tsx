import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import Navbar from '@/components/Navbar';

const justSans = localFont({
  src: [
    { path: '../assets/fonts/JUSTSans-Regular.otf', weight: '400', style: 'normal' },
    { path: '../assets/fonts/JUSTSans-ExBold.otf',  weight: '800', style: 'normal' },
  ],
  variable: '--font-justsans',
});

export const metadata: Metadata = {
  title: 'Titan Golf — Society Golf Platform',
  description: 'Track rounds, tournaments, and stats for your golf society.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={justSans.variable}>
      <body className="min-h-screen bg-black text-white antialiased">
        <Navbar />
        <main className="pt-16">{children}</main>
      </body>
    </html>
  );
}
