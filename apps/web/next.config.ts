import type { NextConfig } from 'next';

// 127.0.0.1 thay vì localhost: Node 22 phân giải localhost thành IPv6 (::1).
const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['@umbm/shared'],
  // Socket.IO dùng đường dẫn "/socket.io/" (có dấu "/" cuối). Next.js mặc định redirect 308
  // để bỏ dấu "/" cuối, làm hỏng bước bắt tay của Socket.IO — tắt hành vi đó.
  skipTrailingSlashRedirect: true,
  // Dev: chuyển /api và /socket.io sang service api. Production: Caddy làm việc này,
  // trình duyệt chỉ thấy một origin nên cookie hoạt động và không cần CORS.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/socket.io/', destination: `${API}/socket.io/` },
      { source: '/socket.io/:path*', destination: `${API}/socket.io/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
