import { Suspense } from 'react';
import { BackofficeShell } from '@/ui/BackofficeShell';

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  return <Suspense><BackofficeShell>{children}</BackofficeShell></Suspense>;
}
