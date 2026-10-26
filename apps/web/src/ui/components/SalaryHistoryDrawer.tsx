'use client';

import { App, Button, Descriptions, Drawer, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { CalendarOutlined, CloseOutlined, DeleteOutlined, DollarOutlined, EditOutlined, ExpandAltOutlined, GiftOutlined, LockOutlined, PlusOutlined, ShrinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { StatusTag } from '@/ui/StatusTag';
import { useClientPagination } from '../hooks/useClientPagination';
import { fmtVnd, type SalaryProfile } from './payroll-types';
import { RowActionButtons } from './RowActionButtons';

const fmtDate = (d: string | null) => (d ? dayjs(d).format('DD/MM/YYYY') : 'Không thời hạn');

export function SalaryProfileDetailModal({
  profile,
  onClose,
  onEdit,
  onAdjust,
  canManage,
}: {
  profile: SalaryProfile | null;
  onClose: () => void;
  onEdit?: (p: SalaryProfile) => void;
  onAdjust?: (p: SalaryProfile) => void;
  canManage?: boolean;
}) {
  return (
    <Modal
      title={profile ? `Chi tiết Mức lương — ${profile.employeeName} (${profile.employeeCode})` : 'Chi tiết mức lương'}
      open={!!profile}
      onCancel={onClose}
      width="70vw"
      destroyOnHidden
      footer={
        <Space>
          {profile && canManage && !profile.locked && onEdit && (
            <Button icon={<EditOutlined />} onClick={() => { const target = profile; onClose(); onEdit(target); }}>
              Chỉnh sửa mức lương này
            </Button>
          )}
          {profile && canManage && onAdjust && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { const target = profile; onClose(); onAdjust(target); }}>
              Điều chỉnh lương mới
            </Button>
          )}
          <Button icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
        </Space>
      }
    >
      {profile && (
        <Tabs
          defaultActiveKey="rate"
          items={[
            {
              key: 'rate',
              label: <span><DollarOutlined /> Mức lương &amp; Công chuẩn</span>,
              children: (
                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                  <Descriptions.Item label="Nhân sự áp dụng" span={2}><strong>{profile.employeeName}</strong> ({profile.employeeCode})</Descriptions.Item>
                  <Descriptions.Item label="Hình thức tính lương">
                    <Tag color={profile.rateType === 'MONTHLY' ? 'purple' : profile.rateType === 'SHIFT' ? 'cyan' : 'blue'} style={{ borderRadius: 2, margin: 0 }}>{profile.rateTypeLabel}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Trạng thái hiệu lực"><StatusTag value={profile.status} label={profile.statusLabel} /></Descriptions.Item>
                  <Descriptions.Item label="Mức lương chính thức">
                    <span className="num" style={{ fontWeight: 700, color: '#2563EB' }}>{fmtVnd(profile.amountVnd)}/{profile.unitLabel}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label="Mức lương thử việc">
                    <span className="num" style={{ fontWeight: 600 }}>{fmtVnd(profile.probationAmountVnd)}/{profile.unitLabel} ({profile.probationPercent}%)</span>
                  </Descriptions.Item>
                  <Descriptions.Item label="Số ngày công chuẩn / tháng">{profile.standardWorkDays} ngày</Descriptions.Item>
                  <Descriptions.Item label="Số giờ chuẩn / ngày">{profile.standardHoursPerDay} giờ</Descriptions.Item>
                  <Descriptions.Item label="Hệ số tăng ca (OT)" span={2}><span className="num" style={{ fontWeight: 600 }}>{profile.otMultiplier}x</span> đơn giá giờ tiêu chuẩn</Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'allowances',
              label: <span><GiftOutlined /> Phụ cấp &amp; Thưởng cố định</span>,
              children: (
                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
                  <Descriptions.Item label="Phụ cấp ăn ca / ca"><span className="num">{fmtVnd(profile.mealAllowancePerShiftVnd)}</span></Descriptions.Item>
                  <Descriptions.Item label="Thưởng chuyên cần / kỳ"><span className="num">{fmtVnd(profile.attendanceBonusVnd)}</span></Descriptions.Item>
                  <Descriptions.Item label="Phụ cấp đi lại / xăng xe"><span className="num">{fmtVnd(profile.transportAllowanceVnd)}</span></Descriptions.Item>
                  <Descriptions.Item label="Phụ cấp trách nhiệm"><span className="num">{fmtVnd(profile.responsibilityAllowanceVnd)}</span></Descriptions.Item>
                  <Descriptions.Item label="Phụ cấp cố định khác" span={2}><span className="num">{fmtVnd(profile.otherAllowanceVnd)}</span></Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: 'audit',
              label: <span><CalendarOutlined /> Hiệu lực &amp; Lý do phê duyệt</span>,
              children: (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Thời gian hiệu lực">Từ <strong>{fmtDate(profile.effectiveFrom)}</strong> đến <strong>{fmtDate(profile.effectiveTo)}</strong></Descriptions.Item>
                  <Descriptions.Item label="Tình trạng chốt kỳ lương">
                    {profile.locked ? 'Đã dùng để chốt kỳ lương (Khóa chỉnh sửa / xóa)' : 'Chưa khóa chốt kỳ lương (Có thể chỉnh sửa)'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Lý do thiết lập / điều chỉnh">{profile.changeReason || 'Thiết lập lương ban đầu'}</Descriptions.Item>
                  <Descriptions.Item label="Ghi chú phê duyệt">{profile.note || 'Không có ghi chú bổ sung'}</Descriptions.Item>
                </Descriptions>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
}

export function SalaryHistoryDrawer({
  employee,
  canManage,
  onClose,
  onEdit,
}: {
  employee: { id: string; label: string } | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (p: SalaryProfile) => void;
}) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [viewing, setViewing] = useState<SalaryProfile | null>(null);
  const histPag = useClientPagination(10, 'mức lương');

  const historyQuery = useQuery({
    queryKey: ['salary-history', employee?.id],
    queryFn: () => api.get<SalaryProfile[]>(`/admin/employees/${employee!.id}/salary-profiles`),
    enabled: !!employee,
  });

  const delMut = useMutation({
    mutationFn: (p: SalaryProfile) => api.delete(`/admin/payroll/salary-profiles/${p.id}`, { version: p.version }),
    onSuccess: () => {
      message.success('Đã xóa mức lương và khôi phục mức lương liền trước');
      qc.invalidateQueries({ queryKey: ['salary-history'] });
      qc.invalidateQueries({ queryKey: ['salary-profiles'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa mức lương thất bại'),
  });

  return (
    <>
      <Drawer
        title={employee ? `Lịch sử lương — ${employee.label}` : 'Lịch sử lương'}
        open={!!employee}
        onClose={onClose}
        width={expanded ? '95vw' : '70vw'}
        destroyOnHidden
        extra={
          <Space size={8}>
            <Button size="small" icon={expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Thu gọn' : 'Mở rộng'}
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={onClose}>Đóng</Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Mỗi lần điều chỉnh lương tạo một mức mới có ngày hiệu lực; mức cũ được đóng lại và giữ nguyên để truy vết. Mức lương đã dùng để chốt kỳ lương sẽ bị khóa sửa / xóa.
        </Typography.Paragraph>
        <Table<SalaryProfile>
          size="small"
          rowKey="id"
          loading={historyQuery.isLoading}
          dataSource={historyQuery.data ?? []}
          pagination={histPag}
          columns={[
            { title: 'Hiệu lực', key: 'eff', width: 155, render: (_, p) => <div><strong>{fmtDate(p.effectiveFrom)}</strong><div style={{ fontSize: 12, color: '#64748B' }}>đến {fmtDate(p.effectiveTo)}</div></div> },
            { title: 'Hình thức', dataIndex: 'rateTypeLabel', width: 115, render: (v: string, p) => <Tag color={p.rateType === 'MONTHLY' ? 'purple' : p.rateType === 'SHIFT' ? 'cyan' : 'blue'} style={{ borderRadius: 2 }}>{v}</Tag> },
            { title: 'Lương chính thức', key: 'amt', width: 145, align: 'right', render: (_, p) => <span className="num" style={{ fontWeight: 700 }}>{fmtVnd(p.amountVnd)}/{p.unitLabel}</span> },
            { title: 'Thử việc', key: 'prob', width: 155, align: 'right', render: (_, p) => <span className="num">{fmtVnd(p.probationAmountVnd)}/{p.unitLabel} ({p.probationPercent}%)</span> },
            { title: 'Lý do thiết lập / điều chỉnh', dataIndex: 'changeReason', render: (v: string) => <span>{v || 'Thiết lập lương ban đầu'}</span> },
            { title: 'Trạng thái', key: 'st', width: 135, render: (_, p) => <Space size={4}><StatusTag value={p.status} label={p.statusLabel} />{p.locked && <LockOutlined style={{ color: '#64748B' }} title="Đã dùng chốt kỳ lương" />}</Space> },
            {
              title: 'Thao tác', key: 'act', width: 90, align: 'right',
              render: (_, p, idx) => (
                <RowActionButtons
                  detailTooltip="Xem chi tiết mức lương"
                  onViewDetail={() => setViewing(p)}
                  loading={delMut.isPending && delMut.variables?.id === p.id}
                  menuItems={canManage && !p.locked ? [
                    { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa mức lương', onClick: () => onEdit(p) },
                    ...(idx === 0 ? [{ key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa mức lương mới nhất', onClick: () => modal.confirm({ title: 'Xóa mức lương mới nhất?', content: 'Mức lương liền trước sẽ được mở lại hiệu lực.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delMut.mutateAsync(p) }) }] : []),
                  ] : []}
                />
              ),
            },
          ]}
        />
      </Drawer>

      <SalaryProfileDetailModal profile={viewing} canManage={canManage} onEdit={onEdit} onClose={() => setViewing(null)} />
    </>
  );
}
