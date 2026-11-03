'use client';

import { Button, Descriptions, Flex, Modal, Space } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, CloseOutlined,
  CompressOutlined, ExpandOutlined, EyeOutlined, LinkOutlined, ScheduleOutlined, TrophyOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { buildQuickDetailSpec, type QuickDetailField, type QuickDetailKind } from './record-quick-detail-builders';

export interface QuickDetailActionOptions {
  onApprovePlannerOff?: (record: Record<string, unknown>) => void;
  onRejectPlannerOff?: (record: Record<string, unknown>) => void;
  onPromoteProbation?: (record: Record<string, unknown>) => void;
  onOpenProbationSchedule?: (record: Record<string, unknown>) => void;
}

export type ShowQuickDetailFn = (kind: QuickDetailKind, record: unknown, options?: QuickDetailActionOptions) => void;

const QuickDetailContext = createContext<ShowQuickDetailFn>(() => undefined);

export function useQuickDetail(): ShowQuickDetailFn {
  return useContext(QuickDetailContext);
}

export function QuickDetailProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ kind: QuickDetailKind; record: unknown; options?: QuickDetailActionOptions } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const showDetail = useCallback<ShowQuickDetailFn>((kind, record, options) => {
    setActive({ kind, record, options });
  }, []);

  const handleClose = () => {
    setActive(null);
    setExpanded(false);
  };

  const spec = active ? buildQuickDetailSpec(active.kind, active.record) : null;
  const rawRec = (active?.record && typeof active.record === 'object' ? active.record : {}) as Record<string, unknown>;
  const isPlannerOff = active?.kind === 'plannerOff';
  const decidedAtRaw = rawRec.decidedAt || rawRec.decided_at;
  const decisionReasonRaw = rawRec.decisionReason || rawRec.decision_reason;

  const extraFields: QuickDetailField[] = [];
  if (isPlannerOff && decidedAtRaw) {
    extraFields.push({ label: 'Thời điểm phê duyệt', value: dayjs(String(decidedAtRaw)).format('HH:mm · DD/MM/YYYY') });
  }
  if (isPlannerOff && decisionReasonRaw) {
    extraFields.push({ label: 'Ghi chú phê duyệt', value: String(decisionReasonRaw) });
  }
  const fields = spec ? [...spec.fields, ...extraFields] : [];

  const isPendingPlannerOff = isPlannerOff && (rawRec.status === 'PENDING' || rawRec.status === 'DRAFT');
  const approveFn = isPendingPlannerOff ? active?.options?.onApprovePlannerOff : undefined;
  const rejectFn = isPendingPlannerOff ? active?.options?.onRejectPlannerOff : undefined;
  const isPlannerProbation = active?.kind === 'plannerProbation';
  const promoteFn = isPlannerProbation && Boolean(rawRec.readyForOfficial) ? active?.options?.onPromoteProbation : undefined;
  const openProbScheduleFn = isPlannerProbation ? active?.options?.onOpenProbationSchedule : undefined;
  const hasDecisionBtns = Boolean(approveFn || rejectFn || promoteFn || openProbScheduleFn);

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
              <Button icon={<LinkOutlined />} href={spec.externalLink.href} target="_blank" rel="noreferrer">
                {spec.externalLink.label}
              </Button>
            )}
            {openProbScheduleFn && (
              <Button icon={<ScheduleOutlined />} onClick={() => { handleClose(); openProbScheduleFn(rawRec); }}>
                {rawRec.isLocked ? 'Xem lịch chu kỳ' : 'Chốt lịch chu kỳ'}
              </Button>
            )}
            {promoteFn && (
              <Button type="primary" icon={<TrophyOutlined />} onClick={() => { handleClose(); promoteFn(rawRec); }}>
                Duyệt chuyển Nhân viên chính thức
              </Button>
            )}
            {approveFn && (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => { handleClose(); approveFn(rawRec); }}
              >
                Phê duyệt đơn nghỉ OFF
              </Button>
            )}
            {rejectFn && (
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => { handleClose(); rejectFn(rawRec); }}
              >
                Từ chối đơn nghỉ OFF
              </Button>
            )}
            <Button type={hasDecisionBtns ? 'default' : 'primary'} icon={<CloseOutlined />} onClick={handleClose}>
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
            {fields.map((f, idx) => (
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
