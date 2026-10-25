import { Suspense } from 'react';
import { LoginForm } from '@/ui/LoginForm';

export const metadata = { title: 'Đăng nhập quản trị' };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm app="backoffice" />
    </Suspense>
  );
}
