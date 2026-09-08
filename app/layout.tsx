import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'SpineLab — Anatomy Atlas',
  icons: { icon: '/favicon.svg' },
  description:
    'Explore the whole spine in interactive 3D. Adjust disc herniation and height, inspect anatomy, and compare illustrative scenarios.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
