import { EmployeeShell } from '@/ui/EmployeeShell';

export default function EmployeeLayout({ children }: { children: React.ReactNode }) {
  return <EmployeeShell>{children}</EmployeeShell>;
}
