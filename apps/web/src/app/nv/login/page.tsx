import { Suspense } from 'react';
import { LoginForm } from '@/ui/LoginForm';

export const metadata = { title: 'Đăng nhập nhân viên' };

export default function EmployeeLoginPage() {
  return (
    <Suspense>
      <LoginForm app="employee" />
    </Suspense>
  );
}
