'use client';

import { Button, Descriptions, Flex, Modal, Space } from 'antd';
import { CloseOutlined, CompressOutlined, ExpandOutlined, EyeOutlined, LinkOutlined } from '@ant-design/icons';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { buildQuickDetailSpec, type QuickDetailKind } from './record-quick-detail-builders';

export type ShowQuickDetailFn = (kind: QuickDetailKind, record: unknown) => void;

const QuickDetailContext = createContext<ShowQuickDetailFn>(() => undefined);

export function useQuickDetail(): ShowQuickDetailFn {
  return useContext(QuickDetailContext);
}

export function QuickDetailProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ kind: QuickDetailKind; record: unknown } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const showDetail = useCallback<ShowQuickDetailFn>((kind, record) => {
    setActive({ kind, record });
  }, []);

  const handleClose = () => {
    setActive(null);
    setExpanded(false);
  };

  const spec = active ? buildQuickDetailSpec(active.kind, active.record) : null;

  return (
    <QuickDetailContext.Provider value={showDetail}>
      {children}
      <Modal
        open={Boolean(spec)}
        onCancel={handleClose}
        destroyOnHidden
        centered
        width={expanded ? '96vw' : 'min(1060px, 94vw)'}
        style={{ maxWidth: expanded ? '96vw' : '94vw', top: expanded ? 12 : undefined }}
        styles={{
          body: {
            maxHeight: expanded ? 'calc(100vh - 156px)' : '78vh',
            overflowY: 'auto',
            paddingTop: 10,
          },
        }}
        title={
          <Flex justify="space-between" align="center" gap={12} style={{ paddingRight: 28 }}>
            <Space size={8}>
              <EyeOutlined style={{ color: '#2563EB', fontSize: 16 }} />
              <span style={{ fontSize: 16, fontWeight: 700 }}>{spec?.title ?? 'Chi tiết bản ghi'}</span>
            </Space>
            <Button
              size="small"
              icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Thu gọn khung' : 'Phóng to'}
            </Button>
          </Flex>
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
            <Button type="primary" icon={<CloseOutlined />} onClick={handleClose}>
              Đóng
            </Button>
          </Space>
        }
      >
        {spec && (
          <Descriptions
            bordered
            size="middle"
            column={1}
            styles={{
              label: {
                width: 260,
                fontWeight: 600,
                fontSize: 13.5,
                color: '#334155',
                background: '#F8FAFC',
                padding: '13px 18px',
                verticalAlign: 'top',
              },
              content: {
                fontSize: 14,
                color: '#0F172A',
                padding: '13px 20px',
                lineHeight: 1.6,
              },
            }}
          >
            {spec.fields.map((f, idx) => (
              <Descriptions.Item key={`${f.label}-${idx}`} label={f.label} span={1}>
                {f.value}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Modal>
    </QuickDetailContext.Provider>
  );
}
