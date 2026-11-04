'use client';

import { Alert, Button, Descriptions, Space, Table, Tabs, Tag, Typography } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, FileTextOutlined, HistoryOutlined, IdcardOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useClientPagination } from '../hooks/useClientPagination';
import { buildClickableRowProps } from './BulkActionBar';
import { LOG_STATUS_COLORS, payslipLines, type PayslipLine } from './payroll-sheet-helpers';
import { allowancesOf, deductionsOf, fmtVnd, type PayrollSnapshotItem, type PayslipRevisionItem, type ShiftPayrollLog } from './payroll-types';
import { PayslipSignatureBoxes } from './PayslipSignatureBoxes';

export function PayslipDetailTabs({
  snapshot: s,
  revisions,
  pendingRevision,
  isAdmin = false,
  decidingRevision = false,
  onDecideRevision,
  onInspectShift,
  onInspectRevision,
}: {
  snapshot: PayrollSnapshotItem;
  revisions?: PayslipRevisionItem[];
  pendingRevision?: PayslipRevisionItem | null;
  isAdmin?: boolean;
  decidingRevision?: boolean;
  onDecideRevision?: (rev: PayslipRevisionItem, action: 'APPROVE' | 'REJECT') => void;
  onInspectShift?: (assignmentId: string) => void;
  onInspectRevision?: (rev: PayslipRevisionItem) => void;
}) {
  const logPag = useClientPagination(10, 'ca');
  const revPag = useClientPagination(10, 'lần điều chỉnh');
  const lines = payslipLines(s);
  const revList = revisions ?? s.revisions ?? [];
  const pRev = pendingRevision !== undefined ? pendingRevision : (s.pendingRevision ?? revList.find((r) => r.status === 'PENDING') ?? null);

  return (
    <>
      {pRev && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 10 }}
          message={`Có điều chỉnh phiếu lương lần #${pRev.revision} (${pRev.delta_vnd >= 0 ? `+${fmtVnd(pRev.delta_vnd)}` : fmtVnd(pRev.delta_vnd)}) đang chờ Ban Quản trị phê duyệt`}
          description={
            <div>
              <div>Thực lĩnh hiện tại: <strong className="num">{fmtVnd(pRev.before_amount_vnd)}</strong> → Thực lĩnh sau điều chỉnh: <strong className="num" style={{ color: '#2563EB' }}>{fmtVnd(pRev.after_amount_vnd)}</strong></div>
              <div>Lý do Kế toán trình duyệt: <strong>{pRev.reason}</strong>{pRev.createdByName ? ` · Người lập: ${pRev.createdByName}` : ''}</div>
            </div>
          }
          action={
            isAdmin && onDecideRevision ? (
              <Space direction="vertical" size={6}>
                <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={decidingRevision} onClick={() => onDecideRevision(pRev, 'APPROVE')}>Duyệt điều chỉnh</Button>
                <Button size="small" danger icon={<CloseCircleOutlined />} loading={decidingRevision} onClick={() => onDecideRevision(pRev, 'REJECT')}>Từ chối điều chỉnh</Button>
              </Space>
            ) : undefined
          }
        />
      )}

      <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px', marginBottom: 10 }}>
        <Space size={[6, 6]} wrap>
          <Tag color="blue" style={{ margin: 0 }}>Tổng công: {s.totalShiftsCount ?? 0} ca ({s.approvedHours ?? 0} giờ · {s.workedDays ?? 0} ngày)</Tag>
          <Tag color="green" style={{ margin: 0 }}>Điểm danh GPS: {s.checkedInShiftsCount ?? 0} ca</Tag>
          {(s.adjustedShiftsCount ?? 0) > 0 && <Tag color="cyan" style={{ margin: 0 }}>Bổ sung công: {s.adjustedShiftsCount} ca</Tag>}
          <Tag color="gold" style={{ margin: 0 }}>Nghỉ OFF: {s.leaveOffCount ?? 0} ngày</Tag>
          <Tag color="purple" style={{ margin: 0 }}>Đổi ca: +{s.shiftSwapCount ?? 0} / -{s.swappedOutCount ?? 0}</Tag>
          {s.rateVnd > 0 && <Tag color="geekblue" style={{ margin: 0 }}>{s.rateTypeLabel}: {fmtVnd(s.rateVnd)}/{s.unitLabel}{s.probationPercent ? ` · TV ${s.probationPercent}%` : ''}</Tag>}
        </Space>
      </div>

      <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered style={{ marginBottom: 10 }}>
        <Descriptions.Item label="Nhân sự & Chi nhánh">
          <strong>{s.fullName}</strong> ({s.employeeCode}) · {s.branchName} · <Tag color="blue" style={{ margin: 0 }}>{s.stageLabel || 'Nhân sự'}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Mã phiếu & Trạng thái">
          <span className="num">{s.payslipCode || s.periodCode}</span>
          {(s.payslipRevision ?? 1) > 1 && <Tag color="blue" style={{ marginLeft: 6 }}>ĐC lần #{s.payslipRevision}</Tag>}
          {pRev && <Tag color="orange" style={{ marginLeft: 6 }}>Chờ Quản trị duyệt ĐC</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label="Hình thức & Đơn giá">
          <strong>{s.rateTypeLabel || 'Theo giờ'}</strong> — <span className="num">{fmtVnd(s.rateVnd || 0)}/{s.unitLabel || 'giờ'}</span>
          {s.probationPercent ? ` (Thử việc ${s.probationPercent}%: ${fmtVnd(s.probationRateVnd || Math.round((s.rateVnd || 0) * s.probationPercent / 100))}/${s.unitLabel || 'giờ'})` : ''}
          {s.rateType === 'MONTHLY' && s.standardWorkDays ? ` · ${s.standardWorkDays} ngày công chuẩn (${s.standardHoursPerDay || 8}h/ngày)` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Tài khoản nhận lương">
          {s.bankName || 'Chưa cập nhật ngân hàng'} · <strong className="num">{s.bankAccountNumber || '—'}</strong>{s.bankAccountHolder ? ` (${s.bankAccountHolder})` : ''}
        </Descriptions.Item>
      </Descriptions>

      <Tabs
        defaultActiveKey="lines"
        items={[
          {
            key: 'lines',
            label: <span><FileTextOutlined /> Chi tiết Khoản mục &amp; Chữ ký ({lines.length})</span>,
            children: (
              <>
                <Table<PayslipLine>
                  size="small"
                  rowKey={(r, i) => `${r.label}-${i}`}
                  pagination={false}
                  dataSource={lines}
                  columns={[
                    { title: 'Khoản mục lương / thưởng / khấu trừ', dataIndex: 'label', render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
                    { title: 'Diễn giải & Cách tính chi tiết', dataIndex: 'detail', render: (v: string) => <span style={{ fontSize: 12, color: '#64748B' }}>{v}</span> },
                    { title: 'Số tiền (VNĐ)', dataIndex: 'amount', align: 'right', width: 145, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: v < 0 ? '#DC2626' : '#0F172A' }}>{v >= 0 ? fmtVnd(v) : fmtVnd(v)}</span> },
                  ]}
                  summary={() => (
                    <>
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}>Tổng thu nhập (Gross) · Phụ cấp: {fmtVnd(allowancesOf(s))} · Khấu trừ: {fmtVnd(deductionsOf(s))}</Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 700 }}>{fmtVnd(s.grossVnd)}</span></Table.Summary.Cell>
                      </Table.Summary.Row>
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={2}><strong>THỰC LĨNH (NET)</strong> · {s.bankName || 'Chưa cập nhật ngân hàng'} {s.bankAccountNumber}</Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 800, color: '#15803D', fontSize: 15 }}>{fmtVnd(s.netVnd)}</span></Table.Summary.Cell>
                      </Table.Summary.Row>
                    </>
                  )}
                />
                <PayslipSignatureBoxes
                  adminSignatureUrl={s.adminSignatureUrl}
                  adminSignedBy={s.adminSignedBy}
                  adminSignedAt={s.adminSignedAt}
                  financeSignatureUrl={s.financeSignatureUrl}
                  financeSignedBy={s.financeSignedBy}
                  financeSignedAt={s.financeSignedAt}
                  employeeSignatureUrl={s.employeeSignatureUrl}
                  employeeName={`${s.fullName} (${s.employeeCode})`}
                  employeeConfirmedAt={s.employeeConfirmedAt}
                />
              </>
            ),
          },
          {
            key: 'attendance-logs',
            label: <span><CalendarOutlined /> Đối soát Chấm công ({(s.shiftLogs ?? []).length})</span>,
            children: (
              <Table<ShiftPayrollLog>
                size="small"
                rowKey={(r, i) => `${r.date}-${r.shiftCode}-${i}`}
                pagination={logPag}
                dataSource={s.shiftLogs ?? []}
                locale={{ emptyText: 'Chưa có ca làm việc phát sinh trong kỳ lương này' }}
                onRow={(r) => r.assignmentId && onInspectShift ? buildClickableRowProps(r, (item) => onInspectShift(String(item.assignmentId))) : {}}
                columns={[
                  { title: 'Ngày', dataIndex: 'date', width: 100, render: (v: string) => <strong className="num">{dayjs(v).format('DD/MM/YYYY')}</strong> },
                  { title: 'Ca làm việc', width: 160, render: (_, r) => <div><strong>{r.shiftLabel}</strong><div style={{ fontSize: 11, color: '#64748B' }}>{r.shiftTime}</div></div> },
                  { title: 'Vào – Ra', width: 120, render: (_, r) => <span className="num">{r.checkInHm || '—'} – {r.checkOutHm || '—'}</span> },
                  { title: 'Trạng thái', width: 200, render: (_, r) => <Space size={4} wrap><Tag color={LOG_STATUS_COLORS[r.status] || 'default'} style={{ margin: 0 }}>{r.statusLabel}</Tag>{r.isSwapIn && <Tag color={(r.swapAllowanceVnd ?? 0) > 0 ? 'purple' : 'default'} style={{ margin: 0 }}>{(r.swapAllowanceVnd ?? 0) > 0 ? `+${fmtVnd(r.swapAllowanceVnd!)} đổi ca` : 'Nhận đổi ca'}</Tag>}</Space> },
                  { title: 'Giờ công', width: 100, align: 'right', render: (_, r) => <span className="num"><strong>{r.hours} giờ</strong>{r.otHours > 0 ? <div style={{ fontSize: 11, color: '#2563EB' }}>+{r.otHours}h OT</div> : null}</span> },
                  { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (v: string) => v || '—' },
                ]}
              />
            ),
          },
          {
            key: 'info',
            label: <span><IdcardOutlined /> Ngân hàng &amp; Hồ sơ</span>,
            children: (
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Nhân sự">{s.fullName} ({s.employeeCode}) · {s.branchName} · {s.stageLabel}</Descriptions.Item>
                <Descriptions.Item label="Ký xác nhận NV">{s.employeeConfirmedAt ? `Đã ký trực tiếp lúc ${dayjs(s.employeeConfirmedAt).format('HH:mm DD/MM/YYYY')}` : (s.confirmationLabel || 'Chờ nhân sự ký tay')}{s.payslipCode ? ` · Mã phiếu: ${s.payslipCode}` : ''}</Descriptions.Item>
                <Descriptions.Item label="Hình thức &amp; Mức lương">{s.rateTypeLabel} — {fmtVnd(s.rateVnd)}/{s.unitLabel}{s.probationPercent ? ` · Thử việc ${s.probationPercent}% (${fmtVnd(s.probationRateVnd)}/${s.unitLabel})` : ''}</Descriptions.Item>
                <Descriptions.Item label="Giờ công thử việc / chính thức">Thử việc: {s.probationHours ?? 0} giờ ({fmtVnd(s.probationPayVnd ?? 0)}) · Chính thức: {s.officialHours ?? 0} giờ ({fmtVnd(s.officialPayVnd ?? 0)}) · Tăng ca OT: {s.otHours ?? 0} giờ ({fmtVnd(s.otPayVnd ?? 0)})</Descriptions.Item>
                <Descriptions.Item label="Tài khoản nhận lương">{s.bankName || 'Chưa cập nhật'} · {s.bankAccountNumber || '—'}{s.bankAccountHolder ? ` · Chủ TK: ${s.bankAccountHolder}` : ''}</Descriptions.Item>
              </Descriptions>
            ),
          },
          {
            key: 'revisions',
            label: <span><HistoryOutlined /> Lịch sử Điều chỉnh ({revList.length})</span>,
            children: (
              <Table<PayslipRevisionItem>
                size="small"
                rowKey="id"
                pagination={revPag}
                dataSource={revList}
                locale={{ emptyText: 'Chưa có điều chỉnh cá nhân nào trên phiếu lương này' }}
                onRow={(r) => onInspectRevision ? buildClickableRowProps(r, (item) => onInspectRevision(item)) : {}}
                columns={[
                  { title: 'Lần ĐC', dataIndex: 'revision', width: 95, render: (v: number) => <Tag color="geekblue">Lần #{v}</Tag> },
                  { title: 'Chênh lệch (+/-)', dataIndex: 'delta_vnd', width: 135, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: v >= 0 ? '#16A34A' : '#DC2626' }}>{v >= 0 ? `+${fmtVnd(v)}` : fmtVnd(v)}</span> },
                  { title: 'Thực lĩnh sau ĐC', dataIndex: 'after_amount_vnd', width: 140, render: (v: number) => <span className="num" style={{ fontWeight: 700 }}>{fmtVnd(v)}</span> },
                  {
                    title: 'Trạng thái duyệt', width: 175,
                    render: (_, r) => {
                      const st = r.status ?? 'APPROVED';
                      const color = st === 'PENDING' ? 'orange' : st === 'REJECTED' ? 'red' : 'green';
                      const icon = st === 'PENDING' ? <ClockCircleOutlined /> : st === 'REJECTED' ? <CloseCircleOutlined /> : <CheckCircleOutlined />;
                      return <Tag color={color} icon={icon} style={{ margin: 0 }}>{r.statusLabel || (st === 'PENDING' ? 'Chờ Ban Quản trị duyệt' : st === 'REJECTED' ? 'Ban Quản trị từ chối' : 'Đã phê duyệt')}</Tag>;
                    },
                  },
                  { title: 'Lý do điều chỉnh', dataIndex: 'reason' },
                  ...(isAdmin && onDecideRevision
                    ? [{
                        title: 'Phê duyệt', key: 'act', width: 175, align: 'right' as const,
                        render: (_: unknown, r: PayslipRevisionItem) =>
                          r.status === 'PENDING' ? (
                            <Space size={4} data-no-row-click>
                              <Button size="small" type="primary" icon={<CheckCircleOutlined />} loading={decidingRevision} onClick={(e) => { e.stopPropagation(); onDecideRevision(r, 'APPROVE'); }}>Duyệt</Button>
                              <Button size="small" danger icon={<CloseCircleOutlined />} loading={decidingRevision} onClick={(e) => { e.stopPropagation(); onDecideRevision(r, 'REJECT'); }}>Từ chối</Button>
                            </Space>
                          ) : <span style={{ fontSize: 11, color: '#64748B' }}>{r.approvedByName || '—'}</span>,
                      }]
                    : []),
                ]}
              />
            ),
          },
        ]}
      />
    </>
  );
}
