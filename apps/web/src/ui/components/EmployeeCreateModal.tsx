'use client';

import { App, Button, Col, Form, Input, Modal, Row, Select, Space, Tabs } from 'antd';
import { CloseOutlined, ContactsOutlined, DollarOutlined, IdcardOutlined, PlusOutlined, SaveOutlined, SettingOutlined, ThunderboltOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { EMPLOYEE_STATUS_OPTIONS, EMPLOYMENT_TYPE_OPTIONS } from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { generateEmployeeCode, generatePin6 } from '@/lib/auto-generate';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { DateStringPicker } from './DateTimePickers';
import { EmployeeAccountLinkFields, type EmployeeAccountMode } from './EmployeeAccountLinkFields';
import { EmployeePersonalFields } from './EmployeePersonalFields';
import type { EmployeeRowItem } from './employee-table-columns';
import { JobPositionsManagerModal, useJobPositions } from './JobPositionsManagerModal';
import { SALARY_FIELD_DEFAULTS, SalaryProfileFields } from './SalaryProfileFields';

interface EmployeeFormValues {
  employee_code?: string; full_name: string; phone_number: string; email?: string;
  date_of_birth?: string; gender?: string; citizen_id?: string; citizen_issue_date?: string;
  permanent_address?: string; current_address?: string; emergency_contact_name?: string; emergency_contact_phone?: string;
  tax_code?: string; resigned_at?: string; resign_reason?: string;
  branch_id: string; staff_group: string; stage: 'PROBATION' | 'OFFICIAL'; status?: string;
  employment_type: string; default_shift_code: string; probation_start?: string; probation_end?: string;
  salary?: Record<string, unknown>; bank_name?: string; bank_account_number?: string; bank_account_holder?: string;
  note?: string; account_mode?: EmployeeAccountMode; link_user_id?: string; username?: string; initial_pin?: string;
}

export interface EmployeeCreateModalProps {
  open: boolean;
  editing?: EmployeeRowItem | null;
  existingCodes?: string[];
  branches: { label: string; value: string }[];
  onClose: () => void;
}

export function EmployeeCreateModal({ open, editing, existingCodes = [], branches, onClose }: EmployeeCreateModalProps) {
  const [form] = Form.useForm<EmployeeFormValues>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('basic');
  const [posManagerOpen, setPosManagerOpen] = useState(false);
  const { options: jobPositionOptions } = useJobPositions();
  const watchedBranchId = Form.useWatch('branch_id', form);
  const { options: shiftOptions } = useShiftTemplates(watchedBranchId, open);

  useEffect(() => {
    if (!open || shiftOptions.length === 0) return;
    const curShift = form.getFieldValue('default_shift_code');
    if (!curShift || !shiftOptions.some((o) => o.value === curShift)) {
      form.setFieldValue('default_shift_code', shiftOptions[0]!.value);
    }
  }, [open, watchedBranchId, shiftOptions, form]);

  useEffect(() => {
    if (!open) return;
    setActiveTab('basic');
    if (editing) {
      const sp = editing.salaryProfile;
      form.setFieldsValue({
        employee_code: editing.employeeCode, full_name: editing.fullName, phone_number: editing.phone,
        email: editing.email ?? '', date_of_birth: editing.dateOfBirth ?? '', gender: editing.gender || undefined,
        citizen_id: editing.citizenId ?? '', citizen_issue_date: editing.citizenIssueDate ?? '',
        permanent_address: editing.permanentAddress ?? '', current_address: editing.currentAddress ?? '',
        emergency_contact_name: editing.emergencyContactName ?? '', emergency_contact_phone: editing.emergencyContactPhone ?? '',
        tax_code: editing.taxCode ?? '', resigned_at: editing.resignedAt ?? '', resign_reason: editing.resignReason ?? '',
        branch_id: editing.branchId, staff_group: editing.staffGroup,
        stage: editing.stage === 'OFFICIAL' ? 'OFFICIAL' : 'PROBATION', status: editing.status,
        employment_type: editing.employmentType, default_shift_code: editing.defaultShiftCode,
        probation_start: editing.probationStart ?? '', probation_end: editing.probationEnd ?? '',
        salary: sp
          ? {
              rate_type: sp.rateType, amount_vnd: sp.amountVnd, probation_percent: sp.probationPercent,
              standard_work_days: sp.standardWorkDays, standard_hours_per_day: sp.standardHoursPerDay,
              ot_multiplier: sp.otMultiplier, attendance_bonus_vnd: sp.attendanceBonusVnd,
              meal_allowance_per_shift_vnd: sp.mealAllowancePerShiftVnd, transport_allowance_vnd: sp.transportAllowanceVnd,
              responsibility_allowance_vnd: sp.responsibilityAllowanceVnd, other_allowance_vnd: sp.otherAllowanceVnd,
            }
          : {
              ...SALARY_FIELD_DEFAULTS,
              rate_type: editing.salaryRateType ?? 'HOURLY',
              amount_vnd: editing.salaryOfficialAmountVnd || 28000,
              probation_percent: editing.salaryProbationPercent ?? SALARY_FIELD_DEFAULTS.probation_percent,
            },
        bank_name: editing.bankName, bank_account_number: editing.bankAccountNumber, bank_account_holder: editing.bankAccountHolder,
        note: editing.note ?? '', account_mode: editing.userId ? 'LINK_EXISTING' : 'AUTO_CREATE',
        link_user_id: editing.userId ?? undefined, initial_pin: '',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        employee_code: generateEmployeeCode(existingCodes), stage: 'PROBATION', staff_group: 'BARISTA',
        status: 'ACTIVE', employment_type: 'PROBATION', default_shift_code: 'CA_SANG',
        probation_start: new Date().toISOString().slice(0, 10),
        salary: SALARY_FIELD_DEFAULTS, branch_id: branches[0]?.value, account_mode: 'AUTO_CREATE', initial_pin: generatePin6(),
      });
    }
  }, [open, editing, existingCodes, branches, form]);

  const saveMutation = useMutation({
    mutationFn: (values: EmployeeFormValues) => {
      const mode = values.account_mode ?? 'AUTO_CREATE';
      const payload = {
        ...values,
        create_account: mode === 'AUTO_CREATE',
        link_user_id: mode === 'LINK_EXISTING' ? values.link_user_id || '' : mode === 'NONE' ? '' : undefined,
      };
      return editing ? api.put(`/admin/employees/${editing.id}`, { ...payload, version: editing.version }) : api.post('/admin/employees', payload);
    },
    onSuccess: () => {
      message.success(editing ? 'Đã cập nhật hồ sơ nhân sự và đồng bộ liên kết tài khoản thành công' : 'Đã tạo hồ sơ nhân sự và liên kết tài khoản thành công');
      ['employees', 'accounts', 'branches', 'schedules', 'salary-profiles', 'salary-history', 'job-positions', 'payroll-periods', 'payroll-periods-report', 'payroll-snapshots', 'payroll-reconcile'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        if (err.details.length > 0) {
          form.setFields(err.details.map((d) => ({ name: d.field.split('.') as never, errors: [d.message] })));
          const f = err.details[0]?.field ?? '';
          if (['email', 'citizen_id', 'tax_code'].includes(f)) setActiveTab('personal');
          else if (['bank_account_number', 'bank_name'].includes(f) || f.startsWith('salary')) setActiveTab('salary');
          else if (['username', 'link_user_id', 'initial_pin'].includes(f)) setActiveTab('account');
          else setActiveTab('basic');
        }
        message.error(err.message);
      } else {
        message.error('Không thể lưu hồ sơ nhân sự, vui lòng thử lại');
      }
    },
  });

  const handleGenerateCode = () => {
    form.setFieldsValue({ employee_code: generateEmployeeCode(existingCodes, form.getFieldValue('employee_code')) });
  };

  return (
    <>
      <Modal
        title={editing ? `Chỉnh sửa Hồ sơ Nhân sự — ${editing.fullName} (${editing.employeeCode})` : 'Tiếp nhận Hồ sơ Nhân sự mới'}
        open={open} onCancel={onClose}
        onOk={() => form.validateFields().then((v) => saveMutation.mutate(v)).catch((e: { errorFields?: { name: (string | number)[] }[] }) => {
          if (['initial_pin', 'username', 'link_user_id'].includes(String(e?.errorFields?.[0]?.name[0] ?? ''))) setActiveTab('account');
        })}
        okText={editing ? 'Lưu cập nhật' : 'Lưu hồ sơ & Liên kết TK'} cancelText="Hủy bỏ"
        okButtonProps={{ icon: editing ? <SaveOutlined /> : <PlusOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }}
        confirmLoading={saveMutation.isPending} width="70vw" forceRender
      >
        <Form<EmployeeFormValues> form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Tabs
            activeKey={activeTab} onChange={setActiveTab}
            items={[
              {
                key: 'basic', forceRender: true, label: <span><IdcardOutlined /> Thông tin &amp; Phân công</span>,
                children: (
                  <>
                    <Row gutter={12}>
                      <Col span={14}><Form.Item name="full_name" label="Họ và tên" rules={[{ required: true, message: 'Vui lòng nhập họ và tên' }]}><Input placeholder="Ví dụ: Nguyễn Thị Minh Anh" /></Form.Item></Col>
                      <Col span={10}>
                        <Form.Item label="Mã nhân sự">
                          <Space.Compact style={{ width: '100%' }}>
                            <Form.Item name="employee_code" noStyle><Input disabled={!!editing} placeholder="Ví dụ: NV0004" /></Form.Item>
                            {!editing && <Button icon={<ThunderboltOutlined />} onClick={handleGenerateCode}>Tự sinh</Button>}
                          </Space.Compact>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={12}><Form.Item name="phone_number" label="Số điện thoại" rules={[{ required: true, message: 'Vui lòng nhập số điện thoại' }]}><Input placeholder="Ví dụ: 0901000004" /></Form.Item></Col>
                      <Col span={12}><Form.Item name="branch_id" label="Chi nhánh" rules={[{ required: true, message: 'Vui lòng chọn chi nhánh' }]}><Select options={branches} placeholder="Chọn chi nhánh" /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item label="Vị trí công việc">
                          <Space.Compact style={{ width: '100%' }}>
                            <Form.Item name="staff_group" noStyle><Select style={{ width: '100%' }} options={jobPositionOptions} /></Form.Item>
                            <Button icon={<SettingOutlined />} title="Cấu hình danh mục vị trí công việc" onClick={() => setPosManagerOpen(true)}>Cấu hình</Button>
                          </Space.Compact>
                        </Form.Item>
                      </Col>
                      <Col span={8}><Form.Item name="stage" label="Giai đoạn"><Select disabled={!!editing} options={[{ value: 'PROBATION', label: 'Nhân viên thử việc' }, { value: 'OFFICIAL', label: 'Nhân viên chính thức' }]} /></Form.Item></Col>
                      <Col span={8}><Form.Item name="status" label="Trạng thái"><Select options={EMPLOYEE_STATUS_OPTIONS} /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                      <Col span={8}><Form.Item name="default_shift_code" label="Ca mặc định (theo chi nhánh)"><Select options={shiftOptions} /></Form.Item></Col>
                      <Col span={8}><Form.Item name="employment_type" label="Hình thức"><Select options={EMPLOYMENT_TYPE_OPTIONS} /></Form.Item></Col>
                      <Col span={8}><Form.Item name="probation_start" label="Ngày bắt đầu"><DateStringPicker placeholder="Chọn ngày bắt đầu" /></Form.Item></Col>
                    </Row>
                  </>
                ),
              },
              { key: 'personal', forceRender: true, label: <span><ContactsOutlined /> Cá nhân, Email &amp; CCCD</span>, children: <EmployeePersonalFields isEditing={!!editing} /> },
              {
                key: 'salary', forceRender: true, label: <span><DollarOutlined /> Hồ sơ Lương &amp; Ngân hàng</span>,
                children: (
                  <>
                    <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 12px 0', marginBottom: 12, background: '#F8FAFC' }}>
                      <SalaryProfileFields form={form} prefix="salary" showEffectiveFrom={false} />
                    </div>
                    <Row gutter={12}>
                      <Col span={8}><Form.Item name="bank_name" label="Ngân hàng"><Input placeholder="Ví dụ: Techcombank" /></Form.Item></Col>
                      <Col span={8}><Form.Item name="bank_account_number" label="Số tài khoản"><Input placeholder="Nhập số tài khoản" /></Form.Item></Col>
                      <Col span={8}><Form.Item name="bank_account_holder" label="Chủ tài khoản"><Input placeholder="Tự động lấy theo họ tên" /></Form.Item></Col>
                    </Row>
                  </>
                ),
              },
              { key: 'account', forceRender: true, label: <span><UserSwitchOutlined /> Tài khoản Liên kết</span>, children: <EmployeeAccountLinkFields form={form} editing={editing} branches={branches} modalOpen={open} /> },
            ]}
          />
        </Form>
      </Modal>
      <JobPositionsManagerModal open={posManagerOpen} onClose={() => setPosManagerOpen(false)} />
    </>
  );
}
