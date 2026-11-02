'use client';

import { Alert, Col, Divider, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import type { FormInstance } from 'antd';
import { CloseOutlined, FileDoneOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
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
  { value: 'Đại học', label: 'Đại học / Sinh viên Đại học' },
  { value: 'Cao đẳng', label: 'Cao đẳng / Trung cấp' },
  { value: 'THPT', label: 'Tốt nghiệp THPT (12/12)' },
  { value: 'Đã nghỉ học chỉ đi làm', label: 'Đã nghỉ học — Chỉ đi làm tập trung' },
];

const EMPLOYMENT_PREF_OPTIONS = [
  { value: 'PART_TIME', label: 'Part-time (Xoay ca linh hoạt)' },
  { value: 'FULL_TIME', label: 'Full-time (Toàn thời gian 8h)' },
  { value: 'CA_CO_DINH', label: 'Ca cố định (Sáng / Chiều / Tối)' },
];

const ROTATE_BRANCH_OPTIONS = [
  { value: 'Sẵn sàng hỗ trợ xoay ca chi nhánh khác khi cần', label: 'Sẵn sàng hỗ trợ xoay ca chi nhánh khác' },
  { value: 'Chỉ làm cố định tại 1 chi nhánh đăng ký', label: 'Chỉ làm cố định tại 1 chi nhánh đăng ký' },
];

const COMMITMENT_OPTIONS = [
  { value: 'Trên 6 tháng - 1 năm lâu dài', label: 'Cam kết gắn bó từ 6 tháng – 1 năm trở lên' },
  { value: 'Từ 3 - 6 tháng', label: 'Từ 3 – 6 tháng' },
  { value: 'Dưới 3 tháng (Thời vụ)', label: 'Dưới 3 tháng (Ngắn hạn)' },
];

const UNIFORM_CONSENT_OPTIONS = [
  { value: 'Đồng ý mặc đồng phục áo hồng và điểm danh GPS trên Web', label: 'Đồng ý mặc đồng phục áo hồng & điểm danh GPS' },
  { value: 'Cần trao đổi thêm khi phỏng vấn', label: 'Cần trao đổi thêm khi phỏng vấn' },
];

const SOURCE_CHANNEL_OPTIONS = [
  { value: 'GOOGLE_FORM', label: 'Google Form Tuyển dụng (FROM_NHAN_VIEN)' },
  { value: 'Quảng cáo FB, Tiktok, Instagram...', label: 'Quảng cáo Facebook, TikTok, Instagram' },
  { value: 'Bạn bè / Nhân viên giới thiệu', label: 'Bạn bè / Nhân viên nội bộ giới thiệu' },
  { value: 'Nộp trực tiếp tại cửa hàng', label: 'Nộp trực tiếp tại cửa hàng' },
];

export const CANDIDATE_26_EXCEL_COLUMNS = [
  { header: 'Mã UV', key: 'candidate_code' }, { header: 'Dấu thời gian', key: 'timestamp' }, { header: 'Họ và tên', key: 'full_name' },
  { header: 'Giới tính', key: 'gender' }, { header: 'Năm sinh', key: 'birth_year' }, { header: 'Số điện thoại (Zalo)', key: 'phone' },
  { header: 'Email', key: 'email' }, { header: 'Số CCCD', key: 'citizen_id' }, { header: 'Trình độ học vấn', key: 'education' },
  { header: 'Trường / Chuyên ngành', key: 'school_or_major' }, { header: 'Quê quán CCCD', key: 'hometown' }, { header: 'Nơi ở hiện tại', key: 'current_address' },
  { header: 'Vị trí ứng tuyển', key: 'positionLabel' }, { header: 'Hình thức làm việc', key: 'employment_type' }, { header: 'Ca đăng ký', key: 'shiftPrefLabel' },
  { header: 'Chi nhánh cố định', key: 'branchName' }, { header: 'Xoay ca CN khác', key: 'can_rotate_branch' }, { header: 'Kinh nghiệm làm việc', key: 'experience_note' },
  { header: 'Kỹ năng F&B', key: 'fnb_skills' }, { header: 'Xử lý việc đột xuất', key: 'incident_answer' }, { header: 'Cam kết gắn bó', key: 'commitment_months' },
  { header: 'Lương mong muốn', key: 'expected_salary' }, { header: 'Ngày bắt đầu', key: 'start_date_available' }, { header: 'Link Facebook', key: 'facebook_link' },
  { header: 'Nguồn tuyển dụng', key: 'source_channel' }, { header: 'Cam kết đồng phục & GPS', key: 'uniform_gps_consent' },
  { header: 'Điểm AI (14đ)', key: 'ai_score_14' }, { header: 'Cờ loại trực tiếp', key: 'red_flag_reason' }, { header: 'Giai đoạn', key: 'stage' }, { header: 'Ghi chú HR', key: 'hr_note' },
];

export function buildCandidateFormInitials(r?: Record<string, unknown> | null, defaultBranchId?: string) {
  if (!r) {
    return {
      applied_position: 'BARISTA', applied_branch_id: defaultBranchId, shift_pref: 'CA_SANG',
      employment_type: 'PART_TIME', expected_salary_vnd: 6500000, birth_year: '2004', gender: 'Nữ',
      education: 'Đại học', can_rotate_branch: 'Sẵn sàng hỗ trợ xoay ca chi nhánh khác khi cần',
      commitment_months: 'Trên 6 tháng - 1 năm lâu dài', uniform_gps_consent: 'Đồng ý mặc đồng phục áo hồng và điểm danh GPS trên Web',
      source_channel: 'GOOGLE_FORM', status: 'NEW',
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
    source_channel: r.source_channel || fp.source_channel || 'GOOGLE_FORM', self_intro: fp.self_intro || r.self_intro || '',
    status: r.status, hr_note: r.hr_note,
  };
}

export function CandidateFormModal({
  open, editingCand, form, branches, jobPositionOptions, shiftPrefOptions, loading, onClose, onFinish,
}: {
  open: boolean; editingCand: Record<string, unknown> | null; form: FormInstance;
  branches: { value: string; label: string }[]; jobPositionOptions: { value: string; label: string }[];
  shiftPrefOptions: { value: string; label: string }[]; loading: boolean; onClose: () => void;
  onFinish: (values: Record<string, unknown>) => void;
}) {
  const watchedStatus = Form.useWatch('status', form);
  return (
    <Modal
      width={920} style={{ maxWidth: 'calc(100vw - 24px)', top: 20 }} open={open} forceRender destroyOnHidden
      title={
        <Space size={8}>
          <FileDoneOutlined style={{ color: '#2563EB' }} />
          <span>{editingCand ? `Chỉnh sửa Hồ sơ Ứng viên (Chuẩn 26 trường Google Form): ${String(editingCand.full_name)}` : 'Tiếp nhận Hồ sơ Ứng viên mới (Đầy đủ 26 trường Google Form)'}</span>
        </Space>
      }
      okText={editingCand ? 'Lưu cập nhật & Chấm lại AI 14đ' : 'Thêm ứng viên & Chấm điểm AI 14đ'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editingCand ? <SaveOutlined /> : <PlusOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="Đồng bộ 100% cấu trúc 26 cột từ Google Sheet Form (FROM_NHAN_VIEN) — Tự động chấm điểm AI 9 tiêu chí (14 điểm) & kiểm tra cờ loại trực tiếp"
        />
        <Divider orientation="left" orientationMargin={0} style={{ margin: '4px 0 10px', fontSize: 13 }}>
          <Tag color="blue">1</Tag> Thông tin Cá nhân, CCCD, Học vấn & Liên hệ Zalo/Facebook
        </Divider>
        <Row gutter={12}>
          <Col xs={24} md={8}><Form.Item name="full_name" label="Họ và tên ứng viên" rules={[{ required: true }]}><Input placeholder="Nguyễn Thị Ngọc Hân" /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="phone" label="Số điện thoại (Zalo)" rules={[{ required: true }]}><Input placeholder="0346635827" /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="citizen_id" label="Số CCCD (12 số)"><Input placeholder="079204001234" /></Form.Item></Col>
          <Col xs={12} md={3}><Form.Item name="birth_year" label="Năm sinh"><Input placeholder="2004" /></Form.Item></Col>
          <Col xs={12} md={3}><Form.Item name="gender" label="Giới tính"><Select options={[{ value: 'Nữ', label: 'Nữ' }, { value: 'Nam', label: 'Nam' }, { value: 'Khác', label: 'Khác' }]} /></Form.Item></Col>

          <Col xs={24} md={8}><Form.Item name="email" label="Địa chỉ Email"><Input placeholder="ungvien@gmail.com" /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="education" label="Trình độ học vấn"><Select allowClear showSearch options={EDUCATION_OPTIONS} placeholder="Chọn trình độ học vấn" /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="school_or_major" label="Trường đang học / Chuyên ngành"><Input placeholder="Ví dụ: ĐH Công Thương — Quản trị nhà hàng" /></Form.Item></Col>

          <Col xs={24} md={8}><Form.Item name="hometown" label="Quê quán theo CCCD"><Input placeholder="Ví dụ: Quảng Ngãi / Bến Tre / TP.HCM" /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="current_address" label="Nơi ở hiện tại"><Input placeholder="Số nhà, đường, phường/xã, quận/huyện..." /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="facebook_link" label="Link Facebook cá nhân"><Input placeholder="https://www.facebook.com/..." /></Form.Item></Col>
        </Row>

        <Divider orientation="left" orientationMargin={0} style={{ margin: '4px 0 10px', fontSize: 13 }}>
          <Tag color="geekblue">2</Tag> Nguyện vọng Vị trí, Chi nhánh cố định, Ca làm việc & Cam kết gắn bó
        </Divider>
        <Row gutter={12}>
          <Col xs={24} md={8}><Form.Item name="applied_branch_id" label="Chi nhánh ứng tuyển (Cố định)" rules={[{ required: true }]}><Select options={branches} placeholder="Chọn chi nhánh" /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="applied_position" label="Vị trí ứng tuyển"><Select options={jobPositionOptions} /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="shift_pref" label="Ca đăng ký làm việc"><Select options={shiftPrefOptions} /></Form.Item></Col>
          <Col xs={24} md={6}><Form.Item name="employment_type" label="Hình thức làm việc"><Select options={EMPLOYMENT_PREF_OPTIONS} /></Form.Item></Col>

          <Col xs={24} md={8}><Form.Item name="can_rotate_branch" label="Hỗ trợ xoay ca chi nhánh khác"><Select allowClear options={ROTATE_BRANCH_OPTIONS} placeholder="Chọn mức độ hỗ trợ xoay CN" /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="commitment_months" label="Cam kết gắn bó tối thiểu"><Select allowClear options={COMMITMENT_OPTIONS} placeholder="Thời gian gắn bó" /></Form.Item></Col>
          <Col xs={12} md={5}><Form.Item name="expected_salary_vnd" label="Mức lương mong muốn"><InputNumber min={0} step={500000} style={{ width: '100%' }} suffix="đ" {...MONEY_INPUT_PROPS} /></Form.Item></Col>
          <Col xs={24} md={5}><Form.Item name="start_date_available" label="Ngày có thể bắt đầu"><Input placeholder="Ví dụ: Đi làm ngay / 05/11" /></Form.Item></Col>
        </Row>

        <Divider orientation="left" orientationMargin={0} style={{ margin: '4px 0 10px', fontSize: 13 }}>
          <Tag color="purple">3</Tag> Kinh nghiệm F&B, Tình huống Kỷ luật ca, Đồng phục GPS & Đánh giá HR
        </Divider>
        <Row gutter={12}>
          <Col xs={24} md={12}><Form.Item name="experience_note" label="Kinh nghiệm làm việc (F&B / Khác)"><Input placeholder="Ví dụ: Đã từng làm F&B pha chế trà sữa 1 năm..." /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="fnb_skills" label="Kỹ năng pha chế / Thu ngân chi tiết"><Input placeholder="Ví dụ: Biết nấu trân châu, định lượng syrup, đứng máy POS..." /></Form.Item></Col>
          <Col xs={24} md={16}>
            <Form.Item name="incident_answer" label="Câu hỏi tình huống: Nếu ngày mai có việc đột xuất trùng lịch ca trực, bạn xử lý thế nào?">
              <Input placeholder="Ví dụ: Báo ngay cho quản lý trước và nhờ đồng nghiệp trong đội đổi ca hỗ trợ..." />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}><Form.Item name="uniform_gps_consent" label="Cam kết đồng phục áo hồng & GPS"><Select allowClear options={UNIFORM_CONSENT_OPTIONS} /></Form.Item></Col>

          <Col xs={12} md={6}><Form.Item name="source_channel" label="Nguồn biết tin ứng tuyển"><Select options={SOURCE_CHANNEL_OPTIONS} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="status" label="Trạng thái xử lý hồ sơ"><Select options={CANDIDATE_STATUS_OPTIONS.filter((o) => o.value !== 'ALL')} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="self_intro" label="Giới thiệu ngắn gọn bản thân"><Input placeholder="Tính cách hòa đồng, trung thực, chịu khó học hỏi SOP..." /></Form.Item></Col>

          <Col xs={24}>
            <Form.Item
              name="hr_note" style={{ marginBottom: 0 }}
              label={watchedStatus === 'REJECTED' ? 'Lý do từ chối hồ sơ ứng viên' : 'Ghi chú sàng lọc HR'}
              rules={watchedStatus === 'REJECTED' ? [{ required: true, min: 3, message: 'Vui lòng nhập lý do từ chối hồ sơ ứng viên (tối thiểu 3 ký tự)' }] : undefined}
            >
              <Input.TextArea rows={2} placeholder={watchedStatus === 'REJECTED' ? 'Nhập lý do từ chối hồ sơ ứng viên...' : 'Nhập ghi chú sàng lọc HR...'} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
