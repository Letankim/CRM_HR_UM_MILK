'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined } from '@ant-design/icons';
import { Alert, Flex, Input, Modal, Space, Tag, Typography } from 'antd';

export interface WorkflowDecisionPromptConfig {
  title: string;
  subtitle?: string;
  alertNode?: React.ReactNode;
  extraNode?: React.ReactNode;
  noteLabel?: string;
  placeholder?: string;
  required?: boolean;
  requiredMessage?: string;
  minLength?: number;
  maxLength?: number;
  initialNote?: string;
  suggestions?: string[];
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: (note: string) => Promise<void> | void;
}

interface WorkflowDecisionModalProps {
  open: boolean;
  config: WorkflowDecisionPromptConfig | null;
  onClose: () => void;
}

export function WorkflowDecisionModal({ open, config, onClose }: WorkflowDecisionModalProps) {
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && config) {
      setNote(config.initialNote ?? '');
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [open, config]);

  if (!config) return null;

  const isDanger = Boolean(config.danger);
  const isRequired = Boolean(config.required);
  const minLen = config.minLength ?? (isRequired ? 3 : 0);
  const maxLen = config.maxLength ?? 300;
  const labelText = config.noteLabel ?? (isDanger ? 'Lý do từ chối / xử lý' : 'Ghi chú phê duyệt / xác nhận');

  const handleOk = async () => {
    const trimmed = note.trim();
    if (isRequired && trimmed.length < minLen) {
      setErrorMsg(config.requiredMessage ?? `Vui lòng nhập nội dung lý do rõ ràng (tối thiểu ${minLen} ký tự).`);
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await config.onConfirm(trimmed);
      onClose();
    } catch {
      // Giữ popup mở để người dùng chỉnh sửa hoặc thử lại khi API báo lỗi
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      destroyOnHidden
      width={560}
      onCancel={submitting ? undefined : onClose}
      closable={!submitting}
      maskClosable={!submitting}
      onOk={() => void handleOk()}
      confirmLoading={submitting}
      okText={config.okText ?? (isDanger ? 'Xác nhận từ chối' : 'Xác nhận phê duyệt')}
      cancelText={config.cancelText ?? 'Hủy bỏ'}
      okButtonProps={{
        danger: isDanger,
        icon: isDanger ? <CloseCircleOutlined /> : <CheckCircleOutlined />,
      }}
      title={
        <Space size={8}>
          {isDanger ? <CloseCircleOutlined style={{ color: '#DC2626' }} /> : <EditOutlined style={{ color: '#2563EB' }} />}
          <span>{config.title}</span>
        </Space>
      }
    >
      <Flex vertical gap={12} style={{ marginTop: 8 }}>
        {config.subtitle && (
          <div style={{ padding: '8px 12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
            <Typography.Text style={{ fontSize: 13, color: '#334155' }}>{config.subtitle}</Typography.Text>
          </div>
        )}

        {config.alertNode}
        {config.extraNode}

        <div>
          <Flex justify="space-between" align="center" style={{ marginBottom: 6 }}>
            <Typography.Text strong style={{ fontSize: 13, color: '#0F172A' }}>
              {isRequired && <span style={{ color: '#DC2626', marginRight: 4 }}>*</span>}
              {labelText}
            </Typography.Text>
            {!isRequired && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Không bắt buộc
              </Typography.Text>
            )}
          </Flex>
          <Input.TextArea
            rows={3}
            value={note}
            maxLength={maxLen}
            showCount
            autoFocus
            status={errorMsg ? 'error' : undefined}
            placeholder={
              config.placeholder ??
              (isDanger
                ? 'Nhập lý do cụ thể để nhân sự / bộ phận liên quan nắm rõ thông tin...'
                : 'Nhập ghi chú phê duyệt hoặc hướng dẫn bổ sung (nếu có)...')
            }
            onChange={(e) => {
              setNote(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
          />
          {errorMsg && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 8, padding: '6px 10px' }}
              message={<span style={{ fontSize: 12.5 }}>{errorMsg}</span>}
            />
          )}
        </div>

        {config.suggestions && config.suggestions.length > 0 && (
          <Flex wrap="wrap" gap={6} align="center" style={{ marginTop: 2 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Gợi ý nhanh:
            </Typography.Text>
            {config.suggestions.map((item) => (
              <Tag
                key={item}
                style={{ cursor: 'pointer', margin: 0, borderRadius: 2, userSelect: 'none' }}
                color={note.trim() === item ? 'blue' : undefined}
                onClick={() => {
                  setNote(item);
                  if (errorMsg) setErrorMsg(null);
                }}
              >
                {item}
              </Tag>
            ))}
          </Flex>
        )}
      </Flex>
    </Modal>
  );
}

export function useWorkflowDecisionModal() {
  const [config, setConfig] = useState<WorkflowDecisionPromptConfig | null>(null);
  const promptDecision = useCallback((next: WorkflowDecisionPromptConfig) => setConfig(next), []);
  const closeDecision = useCallback(() => setConfig(null), []);
  const decisionModalElement = (
    <WorkflowDecisionModal open={Boolean(config)} config={config} onClose={closeDecision} />
  );
  return { promptDecision, closeDecision, decisionModalElement };
}
