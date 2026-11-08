'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, App as AntApp, Card, Flex, Spin, Tabs } from 'antd';
import { ClusterOutlined, DatabaseOutlined, HddOutlined } from '@ant-design/icons';
import { ApiClientError } from '@/lib/api';
import {
  clearDevKey,
  fetchDevSystemStats,
  getSavedDevKey,
  type DevSystemStatsResponse,
} from '@/lib/dev-monitor-api';
import { DevMonitorKeyGate } from '@/ui/components/dev-monitor/DevMonitorKeyGate';
import { DevMonitorKpiStrip } from '@/ui/components/dev-monitor/DevMonitorKpiStrip';
import { DevPostgresStorageTab } from '@/ui/components/dev-monitor/DevPostgresStorageTab';
import { DevDomainStatsTab } from '@/ui/components/dev-monitor/DevDomainStatsTab';
import { DevRuntimeActionsTab } from '@/ui/components/dev-monitor/DevRuntimeActionsTab';

export default function DevMonitorPage() {
  const { message } = AntApp.useApp();
  const [devKey, setDevKey] = useState<string>('');
  const [bootChecked, setBootChecked] = useState(false);
  const [stats, setStats] = useState<DevSystemStatsResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStats = useCallback(
    async (keyToUse: string, forceRefresh = false) => {
      if (!keyToUse) return;
      if (forceRefresh) setRefreshing(true);
      else setInitialLoading(true);
      setLoadError(null);
      try {
        const data = await fetchDevSystemStats(keyToUse, forceRefresh);
        setStats(data);
        if (forceRefresh) message.success('Đã đồng bộ và cập nhật toàn bộ chỉ số hệ thống mới nhất');
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          clearDevKey();
          setDevKey('');
          setStats(null);
          message.warning('Phiên giám sát đã hết hạn hoặc khóa không hợp lệ, vui lòng nhập lại mã khóa');
          return;
        }
        setLoadError(err instanceof ApiClientError ? err.message : 'Không thể tải dữ liệu thống kê hệ thống');
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [message],
  );

  useEffect(() => {
    const saved = getSavedDevKey();
    if (saved) {
      setDevKey(saved);
      void loadStats(saved, false);
    }
    setBootChecked(true);
  }, [loadStats]);

  const handleVerified = (verifiedKey: string) => {
    setDevKey(verifiedKey);
    void loadStats(verifiedKey, false);
  };

  const handleLockSession = () => {
    clearDevKey();
    setDevKey('');
    setStats(null);
    message.info('Đã khóa phiên truy cập trang giám sát kỹ thuật');
  };

  if (!bootChecked) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh', background: '#F8FAFC' }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!devKey) {
    return <DevMonitorKeyGate onVerified={handleVerified} />;
  }

  if (initialLoading && !stats) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh', background: '#F8FAFC' }}>
        <Spin size="large" />
      </Flex>
    );
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#F8FAFC', padding: '20px 24px 36px' }}>
      {loadError ? (
        <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16, borderRadius: 4 }} />
      ) : null}

      {stats ? (
        <>
          <DevMonitorKpiStrip
            stats={stats}
            refreshing={refreshing}
            onRefresh={() => void loadStats(devKey, true)}
            onLockSession={handleLockSession}
          />

          <Card style={{ marginTop: 16, border: '1px solid #E5E7EB', borderRadius: 4 }} styles={{ body: { padding: '8px 18px 18px' } }}>
            <Tabs
              defaultActiveKey="postgres"
              items={[
                {
                  key: 'postgres',
                  label: (
                    <span>
                      <HddOutlined style={{ marginRight: 6 }} />
                      Dung lượng & Bảng PostgreSQL ({stats.postgres.tables.length})
                    </span>
                  ),
                  children: <DevPostgresStorageTab postgres={stats.postgres} />,
                },
                {
                  key: 'domain',
                  label: (
                    <span>
                      <DatabaseOutlined style={{ marginRight: 6 }} />
                      Thống kê Dữ liệu Nghiệp vụ ({stats.domain.totalStores} bảng)
                    </span>
                  ),
                  children: <DevDomainStatsTab domain={stats.domain} />,
                },
                {
                  key: 'runtime',
                  label: (
                    <span>
                      <ClusterOutlined style={{ marginRight: 6 }} />
                      Máy chủ API, Keep-Alive & Tác vụ Dev
                    </span>
                  ),
                  children: (
                    <DevRuntimeActionsTab
                      devKey={devKey}
                      runtime={stats.runtime}
                      onActionCompleted={() => loadStats(devKey, false)}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
