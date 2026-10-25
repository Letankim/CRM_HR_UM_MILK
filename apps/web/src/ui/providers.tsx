'use client';

import '@ant-design/v5-patch-for-react-19';
import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { theme } from './theme';
import { ApiClientError, setVersionConflictPrompter } from '@/lib/api';

dayjs.locale('vi');

function VersionConflictBridge({ children }: { children: ReactNode }) {
  const { modal } = AntApp.useApp();

  useEffect(() => {
    setVersionConflictPrompter((latestVersion) =>
      new Promise<boolean>((resolve) => {
        modal.confirm({
          title: 'Dữ liệu vừa có thay đổi mới',
          content: `Bản ghi này vừa được cập nhật lên phiên bản mới trên hệ thống (phiên bản #${latestVersion}). Toàn bộ thông tin bạn vừa nhập vẫn được giữ nguyên trên biểu mẫu. Bạn có muốn áp dụng nội dung đang nhập lên bản mới nhất và lưu ngay không?`,
          okText: 'Áp dụng & Lưu ngay',
          cancelText: 'Xem lại biểu mẫu',
          centered: true,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    );
    return () => setVersionConflictPrompter(null);
  }, [modal]);

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnMount: 'always',
            refetchOnWindowFocus: false,
            retry: (count, error) => !(error instanceof ApiClientError && error.status < 500) && count < 2,
          },
        },
      }),
  );

  return (
    <ConfigProvider theme={theme} locale={viVN}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <VersionConflictBridge>{children}</VersionConflictBridge>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
