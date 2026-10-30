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
  title: { default: 'AHr — Hệ thống Quản trị Nhân sự', template: '%s | AHr' },
  applicationName: 'AHr',
  description: 'AHr — Nền tảng Quản trị Nhân sự doanh nghiệp, phát triển và vận hành bởi Auto stack',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: ['/favicon.svg'],
    apple: [{ url: '/favicon.svg' }],
  },
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
