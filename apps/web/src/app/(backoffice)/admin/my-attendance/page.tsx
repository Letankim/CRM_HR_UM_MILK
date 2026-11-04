'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';

export default function MyAttendancePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/nv/diem-danh');
  }, [router]);

  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <Spin tip="Đang chuyển hướng sang Cổng Điểm danh..." size="large">
        <div style={{ width: 160, height: 48 }} />
      </Spin>
    </div>
  );
}
