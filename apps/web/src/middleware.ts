import { NextResponse, type NextRequest } from 'next/server';

/**
 * Chuyển hướng nhanh về trang đăng nhập khi chưa có cookie phiên.
 * Không tự động redirect ngược từ /login -> /dashboard bằng cookie chưa xác thực
 * để tránh vòng lặp redirect khi access token hết hạn.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const marker = req.cookies.get('umbm_s')?.value;
  const isEmployee = pathname === '/nv' || pathname.startsWith('/nv/');
  const loginUrl = isEmployee ? '/nv/login' : '/login';

  if (pathname === '/login' || pathname === '/nv/login') {
    return NextResponse.next();
  }

  if (!marker) {
    const url = new URL(loginUrl, req.url);
    if (pathname !== '/' && pathname !== '/nv') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|socket.io|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webmanifest)$).*)'],
};
