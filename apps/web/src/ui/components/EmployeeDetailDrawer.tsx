'use client';

import { Alert, Button, Descriptions, Drawer, Space, Tabs, Tag } from 'antd';
import { CloseOutlined, ContactsOutlined, DollarOutlined, EditOutlined, ExpandAltOutlined, IdcardOutlined, RiseOutlined, ShrinkOutlined, UserOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { StatusTag } from '../StatusTag';
import { fmtEmployeeSalary, type EmployeeRowItem } from './employee-table-columns';
import { fmtVnd } from './payroll-types';

const fmtPhone = (p: string) => (p ? p.replace(/^\+?84/, '0') : 'Chưa cập nhật');

export function EmployeeDetailDrawer({
  employee, canManage, canPromote, canSeeSalary = true, promoting, onEdit, onPromoteOfficial, onClose,
}: {
  employee: EmployeeRowItem | null; canManage?: boolean; canPromote: boolean; canSeeSalary?: boolean;
  promoting: boolean; onEdit?: (row: EmployeeRowItem) => void; onPromoteOfficial: (row: EmployeeRowItem) => void; onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Drawer
      title={employee ? `Hồ sơ nhân sự: ${employee.fullName} (${employee.employeeCode})` : 'Chi tiết nhân sự'}
      open={!!employee}
      onClose={onClose}
      width={expanded ? '95vw' : '70vw'}
      destroyOnHidden
      extra={
        <Space size={8}>
          {employee && canManage && onEdit && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                onClose();
                onEdit(employee);
              }}
            >
              Sửa hồ sơ &amp; Liên kết TK
            </Button>
          )}
          {employee && canPromote && employee.stage === 'PROBATION' && (
            <Button
              size="small"
              type="primary"
              icon={<RiseOutlined />}
              loading={promoting}
              onClick={() => onPromoteOfficial(employee)}
            >
              Chuyển Chính thức
            </Button>
          )}
          <Button size="small" icon={expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Thu gọn' : 'Mở rộng'}
          </Button>
          <Button size="small" icon={<CloseOutlined />} onClick={onClose}>
            Đóng
          </Button>
        </Space>
      }
    >
      {employee && (
        <Tabs
          defaultActiveKey="work"
          items={[
            {
              key: 'work',
              label: <span><IdcardOutlined /> Công việc &amp; Phân công</span>,
              children: (
                <Descriptions column={expanded ? 2 : 1} bordered size="small">
                  <Descriptions.Item label="Mã nhân sự">
                    <Tag color="geekblue" style={{ borderRadius: 2, fontWeight: 600 }}>{employee.employeeCode}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Họ và tên">{employee.fullName}</Descriptions.Item>
                  <Descriptions.Item label="Số điện thoại">{fmtPhone(employee.phone)}</Descriptions.Item>
                  <Descriptions.Item label="Chi nhánh làm việc">{employee.branchName}</Descriptions.Item>
                  <Descriptions.Item label="Nhóm vị trí">{employee.staffGroupLabel}</Descriptions.Item>
                  <Descriptions.Item label="Chức danh">{employee.positionTitle}</Descriptions.Item>
                  <Descriptions.Item label="Giai đoạn hiện tại"><StatusTag value={employee.stage} /></Descriptions.Item>
                  <Descriptions.Item label="Trạng thái làm việc"><StatusTag value={employee.status} /></Descriptions.Item>
                  <Descriptions.Item label="Ca mặc định">{employee.defaultShiftLabel}</Descriptions.Item>
                  <Descriptions.Item label="Hình thức làm việc">{employee.employmentTypeLabel}</Descriptions.Item>
                  <Descriptions.Item label="Chu kỳ thử việc chuẩn" span={expanded ? 2 : 1}>
                    {employee.probationCycleDays} ngày ({employee.probationWorkDays} ngày làm / {employee.probationOffDays} ngày nghỉ)
                  </Descriptions.Item>
                  <Descriptions.Item label="Bắt đầu thử việc">{employee.probationStart || 'Chưa cập nhật'}</Descriptions.Item>
                  <Descriptions.Item label="Kết thúc thử việc">{employee.probationEnd || 'Chưa cập nhật'}</Descriptions.Item>
                  <Descriptions.Item label="Ngày chuyển Chính thức" span={expanded ? 2 : 1}>{employee.officialFrom || 'Chưa chuyển chính thức'}</Descriptions.Item>
                  {employee.resignedAt && <Descriptions.Item label="Ngày nghỉ việc">{employee.resignedAt}</Descriptions.Item>}
                  {employee.resignReason && <Descriptions.Item label="Lý do nghỉ việc">{employee.resignReason}</Descriptions.Item>}
                </Descriptions>
              ),
            },
            {
              key: 'personal',
              label: <span><ContactsOutlined /> Liên hệ &amp; Địa chỉ</span>,
              children: (
                <Descriptions column={expanded ? 2 : 1} bordered size="small">
                  <Descriptions.Item label="Email cá nhân">{employee.email || 'Chưa cập nhật'}</Descriptions.Item>
                  <Descriptions.Item label="Ngày sinh">{employee.dateOfBirth || 'Chưa cập nhật'}</Descriptions.Item>
                  <Descriptions.Item label="Giới tính">{employee.gender || 'Chưa cập nhật'}</Descriptions.Item>
                  {canSeeSalary && <Descriptions.Item label="Mã số thuế cá nhân">{employee.taxCode || 'Chưa cập nhật'}</Descriptions.Item>}
                  {canManage && <Descriptions.Item label="Số CCCD / CMND">{employee.citizenId || 'Chưa cập nhật'}</Descriptions.Item>}
                  {canManage && <Descriptions.Item label="Ngày cấp CCCD">{employee.citizenIssueDate || 'Chưa cập nhật'}</Descriptions.Item>}
                  <Descriptions.Item label="Địa chỉ thường trú" span={expanded ? 2 : 1}>{employee.permanentAddress || 'Chưa cập nhật'}</Descriptions.Item>
                  <Descriptions.Item label="Chỗ ở hiện tại / Tạm trú" span={expanded ? 2 : 1}>{employee.currentAddress || 'Chưa cập nhật'}</Descriptions.Item>
                  <Descriptions.Item label="Người liên hệ khẩn cấp">{employee.emergencyContactName || 'Chưa cập nhật'}</Descriptions.Item>
                  <Descriptions.Item label="SĐT liên hệ khẩn cấp">{fmtPhone(employee.emergencyContactPhone || '')}</Descriptions.Item>
                  <Descriptions.Item label="Ghi chú hồ sơ" span={expanded ? 2 : 1}>{employee.note || '—'}</Descriptions.Item>
                </Descriptions>
              ),
            },
            ...(canSeeSalary ? [{
              key: 'salary',
              label: <span><DollarOutlined /> Lương, Phụ cấp &amp; Ngân hàng</span>,
              children: (() => {
                const sp = employee.salaryProfile;
                const fixedTotal = (sp?.attendanceBonusVnd ?? 0) + (sp?.transportAllowanceVnd ?? 0) + (sp?.responsibilityAllowanceVnd ?? 0) + (sp?.otherAllowanceVnd ?? 0);
                return (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Descriptions title="Hồ sơ mức lương & Định mức công" column={{ xs: 1, sm: 2 }} bordered size="small">
                      <Descriptions.Item label="Trạng thái hồ sơ lương"><StatusTag value={employee.salaryStatus} label={employee.salaryStatusLabel} /></Descriptions.Item>
                      <Descriptions.Item label="Hình thức tính lương">{employee.salaryRateTypeLabel || 'Chưa thiết lập'}</Descriptions.Item>
                      <Descriptions.Item label="Lương cá nhân đang áp dụng" span={2}>
                        {employee.salaryRateType ? (
                          <span className="num" style={{ fontWeight: 600, color: '#2563EB' }}>
                            {fmtEmployeeSalary(employee)}
                            {employee.stage !== 'OFFICIAL' ? ` (Thử việc ${employee.salaryProbationPercent}% của ${fmtEmployeeSalary(employee, employee.salaryOfficialAmountVnd)})` : ''}
                          </span>
                        ) : (
                          <span style={{ color: '#B45309' }}>{employee.salaryStatusLabel} — thiết lập tại Kỳ lương &gt; Hồ sơ lương nhân sự</span>
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="Mức lương chính thức"><span className="num" style={{ fontWeight: 600 }}>{employee.salaryRateType ? fmtEmployeeSalary(employee, employee.salaryOfficialAmountVnd) : '—'}</span></Descriptions.Item>
                      <Descriptions.Item label={`Mức lương thử việc (${sp?.probationPercent ?? employee.salaryProbationPercent ?? 85}%)`}><span className="num">{sp ? `${fmtVnd(sp.probationAmountVnd)}/${sp.unitLabel}` : '—'}</span></Descriptions.Item>
                      <Descriptions.Item label="Ngày hiệu lực áp dụng"><span className="num">{sp?.effectiveFrom || '—'}</span></Descriptions.Item>
                      <Descriptions.Item label="Định mức quy đổi công">
                        <span className="num">
                          {!sp
                            ? '—'
                            : sp.rateType === 'MONTHLY'
                              ? `${sp.standardWorkDays} công/tháng · ${sp.standardHoursPerDay} giờ/ngày`
                              : sp.rateType === 'SHIFT'
                                ? `${sp.standardHoursPerDay} giờ/ca (quy đổi giờ OT)`
                                : 'Tính trực tiếp theo giờ thực tế'}
                        </span>
                      </Descriptions.Item>
                      <Descriptions.Item label="Hệ số tăng ca (OT)" span={2}><Tag color="blue" className="num">{sp ? `x${sp.otMultiplier} (${Math.round(sp.otMultiplier * 100)}% đơn giá)` : '—'}</Tag></Descriptions.Item>
                    </Descriptions>
                    <Descriptions title="Thưởng & Phụ cấp cố định theo hồ sơ" column={{ xs: 1, sm: 2 }} bordered size="small">
                      <Descriptions.Item label="Phụ cấp ăn ca"><span className="num" style={{ fontWeight: 600 }}>{fmtVnd(sp?.mealAllowancePerShiftVnd ?? 0)}/ca</span></Descriptions.Item>
                      <Descriptions.Item label="Thưởng chuyên cần (đủ ca)"><span className="num" style={{ fontWeight: 600, color: '#16A34A' }}>{fmtVnd(sp?.attendanceBonusVnd ?? 0)}/kỳ</span></Descriptions.Item>
                      <Descriptions.Item label="Phụ cấp đi lại (xăng xe)"><span className="num">{fmtVnd(sp?.transportAllowanceVnd ?? 0)}/kỳ</span></Descriptions.Item>
                      <Descriptions.Item label="Phụ cấp trách nhiệm"><span className="num">{fmtVnd(sp?.responsibilityAllowanceVnd ?? 0)}/kỳ</span></Descriptions.Item>
                      <Descriptions.Item label="Phụ cấp khác"><span className="num">{fmtVnd(sp?.otherAllowanceVnd ?? 0)}/kỳ</span></Descriptions.Item>
                      <Descriptions.Item label="Tổng thưởng & phụ cấp cố định">
                        <Tag color="green" className="num" style={{ fontWeight: 600 }}>{fmtVnd(fixedTotal)}/kỳ (+ {fmtVnd(sp?.mealAllowancePerShiftVnd ?? 0)}/ca)</Tag>
                      </Descriptions.Item>
                    </Descriptions>
                    <Descriptions title="Tài khoản Ngân hàng nhận lương" column={{ xs: 1, sm: 2 }} bordered size="small">
                      <Descriptions.Item label="Ngân hàng nhận lương">{employee.bankName || 'Chưa cập nhật'}</Descriptions.Item>
                      <Descriptions.Item label="Số tài khoản ngân hàng"><span className="num" style={{ fontWeight: 600 }}>{employee.bankAccountNumber || 'Chưa cập nhật'}</span></Descriptions.Item>
                      <Descriptions.Item label="Chủ tài khoản" span={2}>{employee.bankAccountHolder || employee.fullName.toUpperCase()}</Descriptions.Item>
                    </Descriptions>
                  </Space>
                );
              })(),
            }] : []),
            {
              key: 'account',
              label: <span><UserSwitchOutlined /> Tài khoản Liên kết</span>,
              children: (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {employee.username ? (
                    <Descriptions column={1} bordered size="small">
                      <Descriptions.Item label="Tên đăng nhập">
                        <Tag color="blue" style={{ borderRadius: 2, fontWeight: 600 }}>
                          <UserOutlined /> @{employee.username}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="Họ tên tài khoản">{employee.userDisplayName || employee.fullName}</Descriptions.Item>
                      <Descriptions.Item label="Vai trò hệ thống">{employee.userRoleLabel || 'Nhân viên'}</Descriptions.Item>
                      <Descriptions.Item label="Trạng thái kích hoạt">
                        {employee.accountStatus ? <StatusTag value={employee.accountStatus} /> : employee.accountStatusLabel}
                      </Descriptions.Item>
                      <Descriptions.Item label="Số điện thoại đăng nhập">{fmtPhone(employee.phone)}</Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      message="Hồ sơ nhân sự này chưa liên kết với tài khoản người dùng nào"
                      description="Nhấn nút Sửa hồ sơ & Liên kết TK để tự động khởi tạo tài khoản mới hoặc gắn với một tài khoản có sẵn."
                    />
                  )}
                </Space>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
