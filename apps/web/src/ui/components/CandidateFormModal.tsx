'use client';

import { useEffect, useState } from 'react';
import { Col, Form, Input, InputNumber, Modal, Row, Select, Tabs, Tag } from 'antd';
import type { FormInstance } from 'antd';
import { CalendarOutlined, CloseOutlined, PlusOutlined, SaveOutlined, SolutionOutlined, TrophyOutlined, UserOutlined } from '@ant-design/icons';
import { evaluatePreScreenScores14, PRE_SCREEN_CRITERIA_14 } from '@umbm/shared';
import { clearChangedFieldErrors } from '@/lib/form-error';
import { CandidatePreScreenPane, computeAutoPreScreenScoresFromValues } from './CandidatePreScreenPane';
import { MONEY_INPUT_PROPS } from './payroll-types';

export const CANDIDATE_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả giai đoạn' },
  { value: 'NEW', label: 'Mới tiếp nhận' },
  { value: 'CONTACTED', label: 'Đã liên hệ' },
  { value: 'INTERVIEW_SCHEDULED', label: 'Đã xếp lịch phỏng vấn' },
  { value: 'HIRED', label: 'Đạt phỏng vấn / Mời thử việc' },
  { value: 'REJECTED', label: 'Chưa phù hợp' },
];

const EDUCATION_OPTIONS = [
  { value: 'Đại học / Cao đẳng', label: 'Đại học / Cao đẳng (1 điểm)' },
  { value: 'Không đi học chỉ đi làm', label: 'Không đi học chỉ đi làm (2 điểm)' },
  { value: 'THPT', label: 'Tốt nghiệp THPT (12/12)' },
];
const EMPLOYMENT_PREF_OPTIONS = [{ value: 'PART_TIME', label: 'Part-time (Xoay ca linh hoạt)' }, { value: 'FULL_TIME', label: 'Full-time (Toàn thời gian 8h)' }, { value: 'CA_CO_DINH', label: 'Ca cố định (Sáng / Chiều / Tối)' }];
const ROTATE_BRANCH_OPTIONS = [{ value: 'Sẵn sàng hỗ trợ xoay ca chi nhánh khác khi cần', label: 'Sẵn sàng hỗ trợ xoay ca chi nhánh khác' }, { value: 'Chỉ làm cố định tại 1 chi nhánh đăng ký', label: 'Chỉ làm cố định tại 1 chi nhánh đăng ký' }];
const COMMITMENT_OPTIONS = [{ value: 'Trên 6 tháng - 1 năm lâu dài', label: 'Từ 6 tháng – 1 năm trở lên' }, { value: 'Từ 3 - 6 tháng', label: 'Từ 3 – 6 tháng' }, { value: 'Dưới 3 tháng (Thời vụ)', label: 'Dưới 3 tháng (Ngắn hạn)' }];
const UNIFORM_CONSENT_OPTIONS = [{ value: 'Đồng ý mặc đồng phục áo hồng và điểm danh GPS trên Web', label: 'Đồng ý mặc đồng phục & điểm danh GPS' }, { value: 'Cần trao đổi thêm khi phỏng vấn', label: 'Cần trao đổi thêm khi phỏng vấn' }];
const SOURCE_CHANNEL_OPTIONS = [
  { value: 'Facebook/Instagram/Tiktok', label: 'Facebook / Instagram / Tiktok (1 điểm)' },
  { value: 'GOOGLE_FORM', label: 'Biểu mẫu ứng tuyển trực tuyến (1 điểm)' },
  { value: 'Bạn bè người quen giới thiệu', label: 'Bạn bè người quen giới thiệu (LOẠI)' },
  { value: 'Nộp trực tiếp tại cửa hàng', label: 'Nộp trực tiếp tại cửa hàng' },
];

export const CANDIDATE_26_EXCEL_COLUMNS = [
  { header: 'Mã UV', key: 'candidate_code' }, { header: 'Ngày tiếp nhận', key: 'timestamp' }, { header: 'Họ và tên', key: 'full_name' },
  { header: 'Giới tính', key: 'gender' }, { header: 'Năm sinh', key: 'birth_year' }, { header: 'Số điện thoại', key: 'phone' },
  { header: 'Email', key: 'email' }, { header: 'Số CCCD', key: 'citizen_id' }, { header: 'Trình độ học vấn', key: 'education' },
  { header: 'Trường / Chuyên ngành', key: 'school_or_major' }, { header: 'Quê quán', key: 'hometown' }, { header: 'Nơi ở hiện tại', key: 'current_address' },
  { header: 'Vị trí ứng tuyển', key: 'positionLabel' }, { header: 'Hình thức làm việc', key: 'employment_type' }, { header: 'Ca đăng ký', key: 'shiftPrefLabel' },
  { header: 'Chi nhánh nguyện vọng', key: 'branchName' }, { header: 'Hỗ trợ xoay CN', key: 'can_rotate_branch' }, { header: 'Kinh nghiệm làm việc', key: 'experience_note' },
  { header: 'Kỹ năng chuyên môn', key: 'fnb_skills' }, { header: 'Xử lý việc đột xuất', key: 'incident_answer' }, { header: 'Cam kết gắn bó', key: 'commitment_months' },
  { header: 'Lương mong muốn', key: 'expected_salary' }, { header: 'Ngày bắt đầu', key: 'start_date_available' }, { header: 'Link Facebook', key: 'facebook_link' },
  { header: 'Nguồn tuyển dụng', key: 'source_channel' }, { header: 'Cam kết đồng phục & GPS', key: 'uniform_gps_consent' },
  { header: 'Điểm sàng lọc (14đ)', key: 'ai_score_14' }, { header: 'Cảnh báo sàng lọc', key: 'red_flag_reason' }, { header: 'Giai đoạn', key: 'stage' }, { header: 'Ghi chú HR', key: 'hr_note' },
];

export function buildCandidateFormInitials(r?: Record<string, unknown> | null, defaultBranchId?: string) {
  if (!r) {
    return {
      applied_position: 'BARISTA', applied_branch_id: defaultBranchId, shift_pref: 'CA_SANG',
      employment_type: 'PART_TIME', expected_salary_vnd: 6500000, birth_year: '2004', gender: 'Nữ',
      education: 'Đại học / Cao đẳng', can_rotate_branch: 'Sẵn sàng hỗ trợ xoay ca chi nhánh khác khi cần',
      commitment_months: 'Trên 6 tháng - 1 năm lâu dài', uniform_gps_consent: 'Đồng ý mặc đồng phục áo hồng và điểm danh GPS trên Web',
      source_channel: 'Facebook/Instagram/Tiktok', status: 'NEW',
    };
  }
  const fp = (r.form_payload ?? r) as Record<string, unknown>;
  return {
    full_name: r.full_name, phone: r.phone, email: r.email || fp.email || '', citizen_id: fp.citizen_id || r.citizen_id || '',
    applied_branch_id: r.branch_pref, applied_position: r.staff_group, shift_pref: r.shift_pref || 'CA_SANG',
    employment_type: fp.employment_type || r.employment_type || 'PART_TIME',
    birth_year: r.birth_year || fp.birth_year || '2004', gender: r.gender || fp.gender || '',
    education: fp.education || r.education || '', school_or_major: fp.school_or_major || r.school_or_major || '',
    hometown: fp.hometown || r.hometown || '', current_address: fp.current_address || r.current_address || '',
    facebook_link: fp.facebook_link || r.facebook_link || '', can_rotate_branch: fp.can_rotate_branch || r.can_rotate_branch || '',
    commitment_months: fp.commitment_months || r.commitment_months || '', start_date_available: fp.start_date_available || r.start_date_available || '',
    expected_salary_vnd: Number(String(fp.expected_salary || '0').replace(/\D/g, '')) || 6500000,
    experience_note: r.experience_note || fp.experience_note || '', fnb_skills: fp.fnb_skills || r.fnb_skills || '',
    incident_answer: fp.incident_answer || r.incident_answer || '', uniform_gps_consent: fp.uniform_gps_consent || r.uniform_gps_consent || '',
    source_channel: r.source_channel || fp.source_channel || 'Facebook/Instagram/Tiktok', self_intro: fp.self_intro || r.self_intro || '',
    status: r.status, hr_note: r.hr_note,
  };
}

export function resolveCandidateFieldTab(field: string): string {
  if (['applied_branch_id', 'branch_pref', 'applied_position', 'staff_group', 'shift_pref', 'employment_type', 'can_rotate_branch', 'commitment_months', 'expected_salary_vnd', 'start_date_available', 'source_channel'].includes(field)) return 'job';
  if (['experience_note', 'fnb_skills', 'incident_answer', 'uniform_gps_consent', 'self_intro', 'status', 'hr_note'].includes(field)) return 'experience';
  return 'personal';
}

export function CandidateFormModal({
  open, editingCand, form, branches, jobPositionOptions, shiftPrefOptions, loading, activeTab: controlledTab, onTabChange, onClose, onFinish,
}: {
  open: boolean; editingCand: Record<string, unknown> | null; form: FormInstance;
  branches: { value: string; label: string }[]; jobPositionOptions: { value: string; label: string }[];
  shiftPrefOptions: { value: string; label: string }[]; loading: boolean;
  activeTab?: string; onTabChange?: (tab: string) => void;
  onClose: () => void; onFinish: (values: Record<string, unknown>) => void;
}) {
  const [innerTab, setInnerTab] = useState('personal');
  const [preScreenScores, setPreScreenScores] = useState<Record<string, number>>({});
  const [manualKeys, setManualKeys] = useState<Set<string>>(new Set());
  const activeTab = controlledTab ?? innerTab;
  const setActiveTab = (tab: string) => { setInnerTab(tab); onTabChange?.(tab); };
  const watchedStatus = Form.useWatch('status', form);
  const eval14 = evaluatePreScreenScores14(preScreenScores);

  useEffect(() => {
    if (!open) return;
    if (!controlledTab) setInnerTab('personal');
    const fp = (editingCand?.form_payload ?? editingCand ?? {}) as Record<string, unknown>;
    const savedScores = (fp.criteria_scores ?? {}) as Record<string, number>;
    const autoScores = computeAutoPreScreenScoresFromValues(form.getFieldsValue(true));
    const merged: Record<string, number> = { ...autoScores };
    const initManual = new Set<string>();
    for (const c of PRE_SCREEN_CRITERIA_14) {
      if (savedScores[c.key] !== undefined && !Number.isNaN(Number(savedScores[c.key]))) {
        merged[c.key] = Number(savedScores[c.key]);
        if (merged[c.key] < 0) initManual.add(c.key);
      }
    }
    setPreScreenScores(merged);
    setManualKeys(initManual);
  }, [open, editingCand]);

  return (
    <Modal
      width={1140} style={{ maxWidth: 'calc(100vw - 32px)', top: 16 }} open={open} forceRender destroyOnHidden
      title={editingCand ? `Chỉnh sửa Hồ sơ & Chấm điểm Sơ loại: ${String(editingCand.full_name)}` : 'Tiếp nhận Hồ sơ & Chấm điểm Sơ loại Ứng viên'}
      okText={editingCand ? 'Lưu cập nhật' : 'Thêm ứng viên'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editingCand ? <SaveOutlined /> : <PlusOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form
        form={form} layout="vertical"
        onFinish={(values) => onFinish({ ...values, criteria_scores: preScreenScores })}
        onValuesChange={(changed, all) => {
          clearChangedFieldErrors(form, changed);
          const auto = computeAutoPreScreenScoresFromValues(all);
          setPreScreenScores((prev) => {
            const next = { ...prev };
            for (const c of PRE_SCREEN_CRITERIA_14) { if (!manualKeys.has(c.key)) next[c.key] = auto[c.key] ?? 0; }
            return next;
          });
        }}
        onFinishFailed={({ errorFields }) => setActiveTab(resolveCandidateFieldTab(String(errorFields[0]?.name?.[0] ?? '')))}
      >
        <Tabs
          activeKey={activeTab} onChange={setActiveTab}
          items={[
            {
              key: 'personal', forceRender: true, label: <span><UserOutlined /> Thông tin cá nhân & Liên hệ</span>,
              children: (
                <Row gutter={12}>
                  <Col xs={24} md={10}><Form.Item name="full_name" label="1. Tên Bạn là? (Họ và tên đầy đủ)" rules={[{ required: true, message: 'Vui lòng nhập họ tên ứng viên' }]}><Input placeholder="Nguyễn Thị Ngọc Hân" /></Form.Item></Col>
                  <Col xs={12} md={7}><Form.Item name="phone" label="4. Số điện thoại (Zalo liên hệ)" rules={[{ required: true, message: 'Vui lòng nhập số điện thoại' }]}><Input placeholder="0909888777" /></Form.Item></Col>
                  <Col xs={12} md={7}><Form.Item name="citizen_id" label="Số CCCD"><Input placeholder="079204001234" /></Form.Item></Col>
                  <Col xs={12} md={5}><Form.Item name="birth_year" label="2. Năm sinh"><Input placeholder="2004" /></Form.Item></Col>
                  <Col xs={12} md={5}><Form.Item name="gender" label="Giới tính"><Select options={[{ value: 'Nữ', label: 'Nữ' }, { value: 'Nam', label: 'Nam' }, { value: 'Khác', label: 'Khác' }]} /></Form.Item></Col>
                  <Col xs={24} md={14}><Form.Item name="email" label="Địa chỉ Email"><Input placeholder="ungvien@gmail.com" /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="education" label="5. Trình độ học vấn"><Select allowClear options={EDUCATION_OPTIONS} placeholder="Chọn trình độ học vấn" /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="school_or_major" label="Trường theo học / Chuyên ngành"><Input placeholder="Ví dụ: ĐH Công Thương — Quản trị nhà hàng" /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="hometown" label="3. Quê quán theo CCCD"><Input placeholder="Ví dụ: TP.HCM / Bến Tre / Tiền Giang" /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="current_address" label="Địa chỉ nơi ở hiện tại"><Input placeholder="Số nhà, đường, phường/xã, quận/huyện..." /></Form.Item></Col>
                  <Col xs={24}><Form.Item name="facebook_link" label="9. Link Facebook cá nhân" style={{ marginBottom: 0 }}><Input placeholder="https://www.facebook.com/..." /></Form.Item></Col>
                </Row>
              ),
            },
            {
              key: 'job', forceRender: true, label: <span><CalendarOutlined /> Nguyện vọng & Ca làm việc</span>,
              children: (
                <Row gutter={12}>
                  <Col xs={24} md={12}><Form.Item name="applied_branch_id" label="Chi nhánh nguyện vọng" rules={[{ required: true, message: 'Vui lòng chọn chi nhánh' }]}><Select options={branches} placeholder="Chọn chi nhánh" /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="applied_position" label="Vị trí ứng tuyển"><Select options={jobPositionOptions} /></Form.Item></Col>
                  <Col xs={12} md={6}><Form.Item name="shift_pref" label="Ca đăng ký"><Select options={shiftPrefOptions} /></Form.Item></Col>
                  <Col xs={24} md={8}><Form.Item name="employment_type" label="Hình thức làm việc"><Select options={EMPLOYMENT_PREF_OPTIONS} /></Form.Item></Col>
                  <Col xs={24} md={8}><Form.Item name="can_rotate_branch" label="Hỗ trợ xoay ca chi nhánh khác"><Select allowClear options={ROTATE_BRANCH_OPTIONS} /></Form.Item></Col>
                  <Col xs={24} md={8}><Form.Item name="commitment_months" label="Cam kết thời gian gắn bó"><Select allowClear options={COMMITMENT_OPTIONS} /></Form.Item></Col>
                  <Col xs={12} md={8}><Form.Item name="expected_salary_vnd" label="Mức lương mong muốn"><InputNumber min={0} step={500000} style={{ width: '100%' }} suffix="đ" {...MONEY_INPUT_PROPS} /></Form.Item></Col>
                  <Col xs={12} md={8}><Form.Item name="start_date_available" label="Ngày có thể bắt đầu"><Input placeholder="Ví dụ: Đi làm ngay / 05/11" /></Form.Item></Col>
                  <Col xs={24} md={8}><Form.Item name="source_channel" label="7. Biết tin ứng tuyển qua hình thức nào?" style={{ marginBottom: 0 }}><Select options={SOURCE_CHANNEL_OPTIONS} /></Form.Item></Col>
                </Row>
              ),
            },
            {
              key: 'experience', forceRender: true, label: <span><SolutionOutlined /> Kinh nghiệm & Đánh giá HR</span>,
              children: (
                <Row gutter={12}>
                  <Col xs={24} md={12}><Form.Item name="experience_note" label="6. Kinh nghiệm làm việc"><Input placeholder="Ví dụ: 1 năm pha chế trà sữa / thu ngân F&B..." /></Form.Item></Col>
                  <Col xs={24} md={12}><Form.Item name="fnb_skills" label="Kỹ năng chuyên môn / F&B"><Input placeholder="Ví dụ: Pha chế, đứng máy POS, kiểm kho..." /></Form.Item></Col>
                  <Col xs={24} md={14}><Form.Item name="incident_answer" label="8. Hướng xử lý khi có việc đột xuất trùng lịch ca trực"><Input placeholder="Ví dụ: Báo trước cho quản lý và nhờ đồng nghiệp đổi ca hỗ trợ..." /></Form.Item></Col>
                  <Col xs={24} md={10}><Form.Item name="uniform_gps_consent" label="Cam kết đồng phục & chấm công GPS"><Select allowClear options={UNIFORM_CONSENT_OPTIONS} /></Form.Item></Col>
                  <Col xs={24} md={16}><Form.Item name="self_intro" label="Giới thiệu ngắn gọn bản thân"><Input placeholder="Tính cách hòa đồng, trung thực, chủ động học hỏi..." /></Form.Item></Col>
                  <Col xs={24} md={8}><Form.Item name="status" label="Trạng thái xử lý hồ sơ"><Select options={CANDIDATE_STATUS_OPTIONS.filter((o) => o.value !== 'ALL')} /></Form.Item></Col>
                  <Col xs={24}><Form.Item name="hr_note" style={{ marginBottom: 0 }} label={watchedStatus === 'REJECTED' ? 'Lý do từ chối hồ sơ ứng viên' : 'Nhận xét sơ loại của HR'} rules={watchedStatus === 'REJECTED' ? [{ required: true, min: 3, message: 'Vui lòng nhập lý do từ chối hồ sơ ứng viên (tối thiểu 3 ký tự)' }] : undefined}><Input.TextArea rows={2} placeholder={watchedStatus === 'REJECTED' ? 'Nhập lý do từ chối hồ sơ ứng viên...' : 'Nhập nhận xét sơ loại HR...'} /></Form.Item></Col>
                </Row>
              ),
            },
            {
              key: 'prescreen', forceRender: true,
              label: <span><TrophyOutlined /> Chấm điểm sơ loại <Tag color={eval14.redFlagReason ? 'error' : eval14.qualified ? 'success' : 'warning'} style={{ margin: '0 0 0 4px', fontWeight: 700 }}>{eval14.redFlagReason ? 'LOẠI' : `${eval14.totalScore14}/14đ`}</Tag></span>,
              children: (
                <CandidatePreScreenPane
                  scores={preScreenScores}
                  onChangeScore={(key, points, rejectReason) => {
                    setManualKeys((prev) => new Set(prev).add(key));
                    const next = { ...preScreenScores, [key]: points };
                    setPreScreenScores(next);
                    if (points < 0 && rejectReason) {
                      form.setFieldValue('status', 'REJECTED');
                      if (!form.getFieldValue('hr_note')) form.setFieldValue('hr_note', rejectReason);
                    }
                  }}
                />
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
