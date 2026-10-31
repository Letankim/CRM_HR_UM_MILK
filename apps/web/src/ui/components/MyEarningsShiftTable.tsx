'use client';

import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Tag } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, DownloadOutlined, DollarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useClientPagination } from '@/ui/hooks/useClientPagination';
import { SelectableTable } from '@/ui/components/BulkActionBar';
import {
  CATEGORY_TAG_COLOR,
  exportMyEarningsExcel,
  type MyEarningsShiftRow,
  type MyEarningsSummary,
} from '@/ui/components/my-earnings-types';
import { fmtVnd } from '@/ui/components/payroll-types';
import { RowActionButtons } from '@/ui/components/RowActionButtons';
import { BRAND } from '@/ui/theme';

interface Props {
  summary: MyEarningsSummary | undefined;
  rows: MyEarningsShiftRow[];
  loading?: boolean;
}

export function MyEarningsShiftTable({ summary, rows, loading }: Props) {
  const [selected, setSelected] = useState<MyEarningsShiftRow | null>(null);
  const pagination = useClientPagination(10, 'ca');

  return (
    <>
      <Card
        size="small"
        title={<span>Chi tiết từng ca làm việc &amp; số tiền tích lũy ({rows.length} ca)</span>}
        extra={<span style={{ fontSize: 12, color: BRAND.textSecondary }}>Bấm vào dòng bất kỳ để xem công thức tính tiền</span>}
        styles={{ body: { padding: 0 } }}
      >
        <SelectableTable<MyEarningsShiftRow>
          size="small"
          rowKey="key"
          loading={loading}
          pagination={pagination}
          dataSource={rows}
          onRowClick={setSelected}
          scroll={{ x: 860 }}
          locale={{ emptyText: 'Không có ca làm việc nào trong khoảng thời gian đang lọc.' }}
          bulkActions={
            summary
              ? [{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (picked) => exportMyEarningsExcel(summary, picked) }]
              : []
          }
          columns={[
            {
              title: 'Ngày làm việc',
              dataIndex: 'date',
              width: 145,
              sorter: (a, b) => a.date.localeCompare(b.date),
              render: (_, r) => (
                <div>
                  <strong className="num">{dayjs(r.date).format('DD/MM/YYYY')}</strong>
                  <div style={{ fontSize: 11.5, color: BRAND.textSecondary }}>{r.weekdayLabel}</div>
                </div>
              ),
            },
            {
              title: 'Khung ca & Điểm danh',
              width: 225,
              render: (_, r) => (
                <div>
                  <Space size={4} wrap>
                    <strong>{r.shiftLabel}</strong>
                    <Tag color="blue" style={{ margin: 0 }}>{r.shiftTime}</Tag>
                    {r.isSwapIn && <Tag color="purple" style={{ margin: 0 }}>Nhận đổi ca</Tag>}
                  </Space>
                  <div style={{ fontSize: 11.5, color: BRAND.textSecondary, marginTop: 2 }}>
                    {r.checkInHm || r.checkOutHm
                      ? `Vào: ${r.checkInHm || '—'} · Ra: ${r.checkOutHm || '—'}${r.lateMinutes > 0 ? ` (Trễ ${r.lateMinutes}p)` : ''}`
                      : r.branchName}
                  </div>
                </div>
              ),
            },
            {
              title: 'Giờ công',
              width: 115,
              align: 'center',
              render: (_, r) => (
                <div>
                  <strong className="num">{r.hours > 0 ? `${r.hours} giờ` : '0 giờ'}</strong>
                  {r.otHours > 0 && <div style={{ fontSize: 11.5, color: '#2563EB', fontWeight: 600 }}>+OT {r.otHours}h</div>}
                </div>
              ),
            },
            {
              title: 'Đơn giá áp dụng',
              width: 165,
              render: (_, r) =>
                r.unitRateVnd > 0 ? (
                  <div>
                    <div className="num" style={{ fontWeight: 600 }}>{fmtVnd(r.unitRateVnd)}/{r.unitLabel}</div>
                    <div style={{ fontSize: 11.5, color: BRAND.textSecondary }}>{r.stageLabel} ({r.percent}%)</div>
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: BRAND.textSecondary }}>—</span>
                ),
            },
            {
              title: 'Tiền ca này',
              width: 155,
              align: 'right',
              sorter: (a, b) => a.totalShiftPayVnd - b.totalShiftPayVnd,
              render: (_, r) =>
                r.isCountedInEarned ? (
                  <div>
                    <div className="num" style={{ fontWeight: 700, color: '#15803D', fontSize: 13.5 }}>+{fmtVnd(r.totalShiftPayVnd)}</div>
                    <div style={{ fontSize: 11, color: '#15803D' }}>Đã cộng tiền hiện tại</div>
                  </div>
                ) : r.totalShiftPayVnd > 0 ? (
                  <div>
                    <div className="num" style={{ fontWeight: 600, color: BRAND.textSecondary }}>{fmtVnd(r.totalShiftPayVnd)}</div>
                    <div style={{ fontSize: 11, color: BRAND.textSecondary }}>Dự kiến khi hoàn tất</div>
                  </div>
                ) : (
                  <span className="num" style={{ color: BRAND.textSecondary }}>0 ₫</span>
                ),
            },
            {
              title: 'Trạng thái ca',
              width: 195,
              render: (_, r) => (
                <div>
                  <Tag color={CATEGORY_TAG_COLOR[r.category]} style={{ margin: 0 }}>{r.categoryLabel}</Tag>
                  <div style={{ fontSize: 11, color: BRAND.textSecondary, marginTop: 2 }}>{r.statusLabel}</div>
                </div>
              ),
            },
            {
              title: 'Chi tiết',
              width: 78,
              fixed: 'right',
              align: 'right',
              render: (_, r) => <RowActionButtons detailTooltip="Xem bóc tách tiền ca này" onViewDetail={() => setSelected(r)} />,
            },
          ]}
        />
      </Card>

      {summary && (summary.payrollItems.length > 0 || summary.earned.fixedAllowanceAppliedVnd > 0) && (
        <Card size="small" title={<span><DollarOutlined /> Khoản Thưởng, Phụ cấp cố định &amp; Khấu trừ trong khoảng lọc</span>} style={{ marginTop: 12 }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {summary.earned.fixedAllowanceAppliedVnd > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Phụ cấp cố định tháng &amp; Chuyên cần theo hồ sơ lương</div>
                  <div style={{ fontSize: 12, color: BRAND.textSecondary }}>Áp dụng cho kỳ xem trọn tháng khi có ngày công thực tế</div>
                </div>
                <strong className="num" style={{ color: '#15803D' }}>+{fmtVnd(summary.earned.fixedAllowanceAppliedVnd)}</strong>
              </div>
            )}
            {summary.payrollItems.map((it) => (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#F8FAFC', border: `1px solid ${BRAND.border}`, borderRadius: 4 }}>
                <div>
                  <Space size={6} wrap>
                    <Tag color={it.direction === 'ADD' ? 'green' : 'volcano'} style={{ margin: 0 }}>{it.typeLabel}</Tag>
                    <strong>{it.title}</strong>
                  </Space>
                  <div style={{ fontSize: 12, color: BRAND.textSecondary }}>Ngày ghi nhận: {dayjs(it.date).format('DD/MM/YYYY')}{it.note ? ` · ${it.note}` : ''}</div>
                </div>
                <strong className="num" style={{ color: it.direction === 'ADD' ? '#15803D' : '#DC2626' }}>
                  {it.direction === 'ADD' ? '+' : '-'}{fmtVnd(it.amountVnd)}
                </strong>
              </div>
            ))}
          </Space>
        </Card>
      )}

      <Modal open={Boolean(selected)} onCancel={() => setSelected(null)} destroyOnHidden width={560} title={selected ? `Chi tiết tiền ca — ${selected.shiftLabel} (${dayjs(selected.date).format('DD/MM/YYYY')})` : ''} footer={<Button type="primary" icon={<CloseOutlined />} onClick={() => setSelected(null)}>Đóng</Button>}>
        {selected && (
          <>
            <Alert type={selected.isCountedInEarned ? 'success' : selected.category === 'ABSENT' ? 'error' : 'info'} showIcon icon={selected.isCountedInEarned ? <CheckCircleOutlined /> : <ClockCircleOutlined />} style={{ marginBottom: 12 }} message={
              selected.isCountedInEarned
                ? `Ca này đã hoàn thành và đã cộng +${fmtVnd(selected.totalShiftPayVnd)} vào Tiền hiện tại nhận được.`
                : selected.category === 'INCOMPLETE'
                  ? 'Ca này mới ghi nhận 1 đầu chấm công. Sau khi bạn chấm công Ra ca (hoặc được duyệt phiếu bù công), tiền ca sẽ tự động cộng vào Tiền hiện tại.'
                  : selected.category === 'UPCOMING'
                    ? 'Ca đã xếp lịch nhưng chưa diễn ra nên chưa cộng vào Tiền hiện tại nhận được (chỉ tính trong cột Dự kiến).'
                    : selected.statusLabel
            } />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Ngày & Khung ca">{selected.weekdayLabel}, {dayjs(selected.date).format('DD/MM/YYYY')} · {selected.shiftLabel} ({selected.shiftTime})</Descriptions.Item>
              <Descriptions.Item label="Chi nhánh">{selected.branchName}</Descriptions.Item>
              <Descriptions.Item label="Điểm danh Vào / Ra">{selected.checkInHm || selected.checkOutHm ? `Vào: ${selected.checkInHm || 'Chưa có'} · Ra: ${selected.checkOutHm || 'Chưa có'}${selected.lateMinutes > 0 ? ` (Trễ ${selected.lateMinutes} phút)` : ''}` : 'Chưa có lượt chấm công'}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">{selected.statusLabel}</Descriptions.Item>
              <Descriptions.Item label="Giai đoạn & Đơn giá">{selected.stageLabel} ({selected.percent}%) · {selected.rateTypeLabel}{selected.unitRateVnd > 0 ? ` (${fmtVnd(selected.unitRateVnd)}/${selected.unitLabel})` : ''}</Descriptions.Item>
              <Descriptions.Item label="Số giờ công">{selected.hours} giờ{selected.otHours > 0 ? ` · Tăng ca OT: ${selected.otHours} giờ` : ''}</Descriptions.Item>
              <Descriptions.Item label="Lương ca cơ bản"><span className="num">{fmtVnd(selected.basePayVnd)}</span></Descriptions.Item>
              {selected.otPayVnd > 0 && <Descriptions.Item label="Lương tăng ca (OT)"><span className="num">+{fmtVnd(selected.otPayVnd)}</span></Descriptions.Item>}
              {selected.mealAllowanceVnd > 0 && <Descriptions.Item label="Phụ cấp ăn ca"><span className="num">+{fmtVnd(selected.mealAllowanceVnd)}</span></Descriptions.Item>}
              {selected.swapAllowanceVnd > 0 && <Descriptions.Item label="Phụ cấp nhận đổi ca"><span className="num">+{fmtVnd(selected.swapAllowanceVnd)}</span></Descriptions.Item>}
              <Descriptions.Item label={selected.isCountedInEarned ? 'Thành tiền đã nhận' : 'Thành tiền dự kiến'}>
                <strong className="num" style={{ color: selected.isCountedInEarned ? '#15803D' : BRAND.text, fontSize: 15 }}>{fmtVnd(selected.totalShiftPayVnd)}</strong>
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Modal>
    </>
  );
}
