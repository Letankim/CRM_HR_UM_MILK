'use client';

import { App, Typography } from 'antd';
import { CloseOutlined, DeleteOutlined, FileExcelOutlined, RiseOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useMemo, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { BulkActionItem } from '@/ui/components/BulkActionBar';
import { DateStringPicker } from '@/ui/components/DateTimePickers';
import { exportEmployeesExcel, type EmployeeRowItem } from '@/ui/components/employee-table-columns';
import { useWorkflowDecisionModal } from '@/ui/components/WorkflowDecisionModal';

interface UseEmployeesBulkActionsOptions {
  canManage: boolean;
  canPromote: boolean;
}

const PROMOTE_SUGGESTIONS = [
  'Hoàn thành chu kỳ thử việc, đạt điểm TEST nghiệp vụ, chuyển sang Nhân viên chính thức',
  'Đạt yêu cầu tác phong và kỹ năng vận hành tại cửa hàng, đủ điều kiện chuyển chính thức',
];

function OfficialFromDateField({ initialDate, onSelect }: { initialDate: string; onSelect: (val: string) => void }) {
  const [dateVal, setDateVal] = useState(initialDate);
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <Typography.Text strong style={{ fontSize: 13, color: '#0F172A' }}>
          <span style={{ color: '#DC2626', marginRight: 4 }}>*</span>
          Ngày hiệu lực Chính thức
        </Typography.Text>
      </div>
      <DateStringPicker
        value={dateVal}
        onChange={(next) => {
          setDateVal(next);
          onSelect(next);
        }}
      />
    </div>
  );
}

/**
 * Thao tác hàng loạt trên danh sách hồ sơ nhân sự (Chuyển chính thức có popup ngày hiệu lực & đánh giá HR, Xóa mềm, Xuất Excel).
 */
export function useEmployeesBulkActions({ canManage, canPromote }: UseEmployeesBulkActionsOptions) {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { promptDecision, decisionModalElement } = useWorkflowDecisionModal();
  const officialFromRef = useRef(dayjs().format('YYYY-MM-DD'));

  const bulkAction = useMutation({
    mutationFn: (payload: {
      action: 'PROMOTE_OFFICIAL' | 'DELETE';
      rows: EmployeeRowItem[];
      official_from?: string;
      evaluation_summary?: string;
      note?: string;
      clear?: () => void;
    }) =>
      api.post<{ processedCount: number }>('/admin/employees/bulk-action', {
        action: payload.action,
        official_from: payload.official_from,
        evaluation_summary: payload.evaluation_summary,
        note: payload.note,
        items: payload.rows.map((r) => ({ id: r.id, version: r.version })),
      }),
    onSuccess: (res, vars) => {
      message.success(
        vars.action === 'DELETE'
          ? `Đã xóa ${res.processedCount}/${vars.rows.length} hồ sơ nhân sự`
          : `Đã chuyển chính thức ${res.processedCount}/${vars.rows.length} nhân sự đã chọn`,
      );
      vars.clear?.();
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thao tác hàng loạt thất bại'),
  });

  const bulkActions: BulkActionItem<EmployeeRowItem>[] = useMemo(() => {
    const items: BulkActionItem<EmployeeRowItem>[] = [];
    if (canPromote) {
      items.push({
        key: 'bulk-promote',
        label: 'Chuyển Chính thức đã chọn',
        type: 'primary',
        icon: <RiseOutlined />,
        loading: bulkAction.isPending && bulkAction.variables?.action === 'PROMOTE_OFFICIAL',
        eligibleFilter: (r) => r.stage === 'PROBATION',
        onClick: (rows, clear) => {
          const todayStr = dayjs().format('YYYY-MM-DD');
          officialFromRef.current = todayStr;
          promptDecision({
            title: 'Xét duyệt Chuyển Chính thức hàng loạt',
            subtitle: `Áp dụng cho ${rows.length} nhân sự thử việc đã chọn. Mã nhân sự hiện hành sẽ được giữ nguyên và lưu vết lịch sử chuyển giai đoạn.`,
            extraNode: (
              <OfficialFromDateField
                initialDate={todayStr}
                onSelect={(val) => {
                  officialFromRef.current = val;
                }}
              />
            ),
            required: true,
            noteLabel: 'Đánh giá của HR & Điều kiện phê duyệt',
            placeholder: 'Nhập nhận xét đánh giá kết quả thử việc, điểm TEST nghiệp vụ và quyết định phê duyệt của HR...',
            okText: 'Xác nhận Chuyển Chính thức',
            suggestions: PROMOTE_SUGGESTIONS,
            onConfirm: async (note) => {
              if (!officialFromRef.current) {
                message.warning('Vui lòng chọn Ngày hiệu lực Chính thức');
                throw new Error('MISSING_OFFICIAL_FROM');
              }
              await bulkAction.mutateAsync({
                action: 'PROMOTE_OFFICIAL',
                rows,
                official_from: officialFromRef.current,
                evaluation_summary: note,
                note,
                clear,
              });
            },
          });
        },
      });
    }
    if (canManage) {
      items.push({
        key: 'bulk-delete',
        label: 'Xóa đã chọn',
        danger: true,
        icon: <DeleteOutlined />,
        loading: bulkAction.isPending && bulkAction.variables?.action === 'DELETE',
        onClick: (rows, clear) => {
          modal.confirm({
            title: `Xác nhận xóa ${rows.length} hồ sơ nhân sự?`,
            content: 'Các hồ sơ nhân sự đã chọn sẽ được xóa khỏi danh sách đang làm việc.',
            okText: 'Xác nhận xóa',
            okButtonProps: { danger: true, icon: <DeleteOutlined /> },
            cancelText: 'Hủy bỏ',
            cancelButtonProps: { icon: <CloseOutlined /> },
            onOk: () => bulkAction.mutateAsync({ action: 'DELETE', rows, clear }),
          });
        },
      });
    }
    items.push({
      key: 'bulk-export',
      label: 'Xuất Excel đã chọn',
      icon: <FileExcelOutlined style={{ color: '#15803D' }} />,
      onClick: (rows) => {
        exportEmployeesExcel(rows);
        message.success(`Đã xuất ${rows.length} hồ sơ nhân sự ra file Excel`);
      },
    });
    return items;
  }, [bulkAction, canManage, canPromote, message, modal, promptDecision]);

  return { bulkActions, decisionModalElement };
}
