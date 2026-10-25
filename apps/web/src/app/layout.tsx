import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { Providers } from '@/ui/providers';
import './globals.css';

const font = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Ụm Bò Milk HR', template: '%s | Ụm Bò Milk HR' },
  description: 'Hệ thống quản trị nhân sự Ụm Bò Milk',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFFFFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={font.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
