'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Flex, Segmented, Space, Tabs } from 'antd';
import { AppstoreOutlined, CalendarOutlined, PlusOutlined, ReloadOutlined, SwapOutlined, TableOutlined } from '@ant-design/icons';
import { DEFAULT_OPERATION_SETTINGS } from '@umbm/shared';
import { EmployeeLeavesTable } from './EmployeeLeavesTable';
import { LeaveRequestModal, MyShiftRegisterModal, ShiftSwapRequestModal } from './EmployeePortalModals';
import { EmployeeShiftsTable } from './EmployeeShiftsTable';
import { EmployeeSwapsTable } from './EmployeeSwapsTable';
import type { ScheduleAssignmentItem } from './ScheduleFormModal';
import { ScheduleRequestDetailModal, type ScheduleDetailTarget } from './ScheduleRequestDetailModal';
import { ScheduleViewsPanel } from './ScheduleViewsPanel';
import { useMyAttendanceExtras, useOffWindow, type BranchPeerItem } from './self-attendance-shared';
import { ShiftAttendanceDetailModal } from './ShiftAttendanceDetailModal';

type ScheduleViewMode = 'WEEK_MATRIX' | 'CALENDAR' | 'TABLE';
type CenterTab = 'shifts' | 'leaves' | 'swaps';

export const OFFICIAL_SCHEDULE_INFO = 'Lịch làm việc được HR tự động sắp theo ca mặc định — bạn chỉ cần đăng ký nghỉ OFF trong thời gian mở cổng.';

export interface EmployeeScheduleAndLeaveCenterProps {
  todayDate: string; empId: string; empCode: string; stage?: string; mode?: 'all' | CenterTab; initialTab?: CenterTab;
  shifts: Record<string, unknown>[]; leaves: Record<string, unknown>[]; swaps: Record<string, unknown>[];
  branchPeers: BranchPeerItem[];
  /** Ghi đè quyền đăng ký làm thêm ca (mặc định lấy `canRegisterShift` từ `GET /my-attendance`). */
  canRegisterShift?: boolean;
  /** Ghi đè quyền đổi / nhường ca (chỉ Nhân viên Chính thức tại cửa hàng). */
  canSwapShift?: boolean;
  refreshing?: boolean; onRefresh: () => void;
}

export function EmployeeScheduleAndLeaveCenter({
  todayDate, empId, empCode, stage, mode = 'all', initialTab = 'shifts', shifts, leaves, swaps, branchPeers, canRegisterShift, canSwapShift, refreshing = false, onRefresh,
}: EmployeeScheduleAndLeaveCenterProps) {
  const [activeTab, setActiveTab] = useState<CenterTab>(initialTab);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('WEEK_MATRIX');
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  const [addShiftOpen, setAddShiftOpen] = useState(false), [leaveOpen, setLeaveOpen] = useState(false), [swapOpen, setSwapOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<ScheduleDetailTarget | null>(null), [attShiftId, setAttShiftId] = useState<string | null>(null);
  const extras = useMyAttendanceExtras().data;

  const isProbation = stage === 'PROBATION';
  const offWin = useOffWindow(!isProbation && (mode === 'all' || mode === 'leaves')).data;
  const canRegister = canRegisterShift ?? extras?.canRegisterShift ?? isProbation;
  const canSwap = canSwapShift ?? extras?.canSwapShift ?? (stage === 'OFFICIAL');
  const cycle = extras?.probationCycle;
  const quotaText = isProbation
    ? (cycle ? `Đã đăng ký ${cycle.offCount}/${cycle.offLimit} ngày OFF trong chu kỳ thử việc` : undefined)
    : `Tối đa ${offWin?.officialWeeklyOffLimit ?? DEFAULT_OPERATION_SETTINGS.officialWeeklyOffLimit} ngày OFF / tuần${offWin?.message ? ` · ${offWin.message}` : ''}`;
  const effectiveTab = mode === 'all' ? (!canSwap && activeTab === 'swaps' ? 'shifts' : activeTab) : mode;
  const showShiftsActions = mode === 'all' || mode === 'shifts';

  return (
    <>
      <Tabs
        activeKey={effectiveTab}
        onChange={(k) => setActiveTab(k as CenterTab)}
        tabBarExtraContent={
          <Space size={6} wrap>
            <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>Làm mới</Button>
            {showShiftsActions && canRegister && <Button size="small" type={mode === 'shifts' ? 'primary' : 'default'} icon={<PlusOutlined />} onClick={() => setAddShiftOpen(true)}>Đăng ký làm thêm ca</Button>}
            {canSwap && (mode === 'all' || mode === 'swaps') && <Button size="small" type={mode === 'swaps' ? 'primary' : 'default'} icon={<SwapOutlined />} onClick={() => setSwapOpen(true)}>Nhường / Đổi ca</Button>}
            {(mode === 'all' || mode === 'leaves') && <Button size="small" type="primary" icon={<CalendarOutlined />} onClick={() => setLeaveOpen(true)}>Đăng ký nghỉ OFF</Button>}
          </Space>
        }
        items={[
          {
            key: 'shifts',
            label: <span><CalendarOutlined /> Lịch làm việc ({shifts.length})</span>,
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {!canRegister && <Alert type="info" showIcon message={OFFICIAL_SCHEDULE_INFO} />}
                {shifts.some((s) => s.status === 'DRAFT') && (
                  <Alert type="warning" showIcon message={canSwap ? 'Bạn có ca đang chờ HR duyệt. Chỉ những ca đã được phê duyệt sang Đã phân ca chính thức mới được phép chấm công Vào/Ra ca và Nhường / Đổi ca.' : 'Bạn có ca đăng ký làm thêm đang chờ HR duyệt. Chỉ những ca đã được phê duyệt sang Đã phân ca chính thức mới được phép chấm công Vào/Ra ca.'} />
                )}
                {shifts.some((s) => s.status === 'ABSENT' || Boolean(s.isAbsentShift)) && (
                  <Alert type="error" showIcon message="Bạn có ca làm việc ở trạng thái Vắng mặt (quá giờ kết thúc ca chưa điểm danh). Để bù công, vui lòng gửi phiếu bổ sung công kèm ảnh minh chứng." />
                )}
                <Flex justify="flex-end" align="center" wrap gap={8}>
                  <Segmented value={viewMode} onChange={(v) => setViewMode(v as ScheduleViewMode)} options={[{ value: 'WEEK_MATRIX', icon: <AppstoreOutlined />, label: 'Lưới Lịch Tuần' }, { value: 'CALENDAR', icon: <CalendarOutlined />, label: 'Lịch Tháng' }, { value: 'TABLE', icon: <TableOutlined />, label: 'Bảng Danh Sách' }]} />
                </Flex>
                {viewMode !== 'TABLE' ? (
                  <ScheduleViewsPanel mode={viewMode} todayDate={todayDate} assignments={shifts as unknown as ScheduleAssignmentItem[]} canEdit={false} loading={refreshing} hideStaffingBadge onAddAtCell={() => { if (canRegister) setAddShiftOpen(true); }} onEditItem={(item) => setDetailTarget({ kind: 'shift', record: item as unknown as Record<string, unknown> })} />
                ) : (
                  <EmployeeShiftsTable shifts={shifts} empId={empId} refreshing={refreshing} onViewDetail={(record) => setDetailTarget({ kind: 'shift', record })} onViewAttendance={setAttShiftId} onRefresh={onRefresh} />
                )}
              </Space>
            ),
          },
          {
            key: 'leaves',
            label: <span><CalendarOutlined /> Đơn nghỉ OFF ({leaves.length})</span>,
            children: <EmployeeLeavesTable leaves={leaves} quotaText={quotaText} refreshing={refreshing} onViewDetail={(record) => setDetailTarget({ kind: 'leave', record })} onRefresh={onRefresh} />,
          },
          {
            key: 'swaps',
            label: <span><SwapOutlined /> Nhường / Đổi ca ({swaps.length})</span>,
            children: canSwap ? (
              <EmployeeSwapsTable swaps={swaps} empId={empId} empCode={empCode} refreshing={refreshing} onViewDetail={(record) => setDetailTarget({ kind: 'swap', record })} onRefresh={onRefresh} />
            ) : (
              <Alert
                type="info" showIcon
                message="Chức năng Nhường ca và Đổi ca chỉ áp dụng cho Nhân viên Chính thức tại cửa hàng."
                description={isProbation ? 'Nhân viên trong giai đoạn Thử việc chưa được đổi hoặc nhường ca; vui lòng sử dụng chức năng Đăng ký nghỉ OFF và Đăng ký làm thêm ca trong chu kỳ 12 ngày.' : 'Tài khoản quản trị / văn phòng không tham gia đổi hoặc nhường ca cửa hàng.'}
              />
            ),
          },
        ].filter((it) => (mode === 'all' ? (it.key !== 'swaps' || canSwap) : it.key === mode))}
      />

      <ScheduleRequestDetailModal target={detailTarget} onClose={() => setDetailTarget(null)} />
      <ShiftAttendanceDetailModal assignmentId={attShiftId} onClose={() => setAttShiftId(null)} />
      {canRegister && <MyShiftRegisterModal open={addShiftOpen} todayDate={todayDate} onClose={() => setAddShiftOpen(false)} onCreated={onRefresh} />}
      <LeaveRequestModal open={leaveOpen} employeeId={empId} stage={stage} onClose={() => setLeaveOpen(false)} onSuccess={onRefresh} />
      {canSwap && <ShiftSwapRequestModal open={swapOpen} employeeId={empId} stage={stage} canSwapShift={canSwap} shifts={shifts} peers={branchPeers} onClose={() => setSwapOpen(false)} onSuccess={onRefresh} />}
    </>
  );
}
