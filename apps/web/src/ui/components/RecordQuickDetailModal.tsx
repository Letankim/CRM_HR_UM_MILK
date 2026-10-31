'use client';

import { Button, Descriptions, Modal, Space } from 'antd';
import { CloseOutlined, EyeOutlined, LinkOutlined } from '@ant-design/icons';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { buildQuickDetailSpec, type QuickDetailKind } from './record-quick-detail-builders';

export type ShowQuickDetailFn = (kind: QuickDetailKind, record: unknown) => void;

const QuickDetailContext = createContext<ShowQuickDetailFn>(() => undefined);

export function useQuickDetail(): ShowQuickDetailFn {
  return useContext(QuickDetailContext);
}

export function QuickDetailProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ kind: QuickDetailKind; record: unknown } | null>(null);
  const showDetail = useCallback<ShowQuickDetailFn>((kind, record) => {
    setActive({ kind, record });
  }, []);

  const spec = active ? buildQuickDetailSpec(active.kind, active.record) : null;

  return (
    <QuickDetailContext.Provider value={showDetail}>
      {children}
      <Modal
        open={Boolean(spec)}
        onCancel={() => setActive(null)}
        destroyOnHidden
        centered
        width="min(780px, 94vw)"
        title={
          <Space size={8}>
            <EyeOutlined style={{ color: '#2563EB' }} />
            <span>{spec?.title ?? 'Chi tiết bản ghi'}</span>
          </Space>
        }
        footer={
          <Space size={8} wrap>
            {spec?.externalLink && (
              <Button
                icon={<LinkOutlined />}
                href={spec.externalLink.href}
                target="_blank"
                rel="noreferrer"
              >
                {spec.externalLink.label}
              </Button>
            )}
            <Button type="primary" icon={<CloseOutlined />} onClick={() => setActive(null)}>
              Đóng
            </Button>
          </Space>
        }
      >
        {spec && (
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            {spec.fields.map((f, idx) => (
              <Descriptions.Item key={`${f.label}-${idx}`} label={f.label} span={f.span ?? 1}>
                {f.value}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Modal>
    </QuickDetailContext.Provider>
  );
}
