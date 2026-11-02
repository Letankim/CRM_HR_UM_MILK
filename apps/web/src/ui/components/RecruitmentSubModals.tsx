'use client';

import { Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Row, Select, Space, Tag } from 'antd';
import type { FormInstance } from 'antd';
import {
  BellOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined,
  CloseOutlined, EditOutlined, MailOutlined, MessageOutlined, PhoneOutlined, PlusOutlined, SaveOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import { INTERVIEW_RUBRICS, type InterviewExperienceTrack } from '@umbm/shared';
import { StatusTag } from '../StatusTag';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { GuardButton } from './GuardButton';
import { MONEY_INPUT_PROPS } from './payroll-types';

export const CANDIDATE_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả giai đoạn' },
  { value: 'NEW', label: 'Mới tiếp nhận' },
  { value: 'CONTACTED', label: 'Đã liên hệ' },
  { value: 'INTERVIEW_SCHEDULED', label: 'Đã xếp lịch phỏng vấn' },
  { value: 'HIRED', label: 'Đạt phỏng vấn / Mời thử việc' },
  { value: 'REJECTED', label: 'Chưa phù hợp' },
];

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
      width={660} open={open} forceRender destroyOnHidden
      title={editingCand ? 'Chỉnh sửa Hồ sơ Ứng viên' : 'Tiếp nhận Hồ sơ Ứng viên mới'}
      okText={editingCand ? 'Lưu cập nhật' : 'Thêm ứng viên'} cancelText="Hủy bỏ"
      okButtonProps={{ icon: editingCand ? <SaveOutlined /> : <PlusOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="full_name" label="Họ và tên" rules={[{ required: true }]}><Input placeholder="Nguyễn Văn A" /></Form.Item></Col>
          <Col span={12}><Form.Item name="phone" label="Số điện thoại" rules={[{ required: true }]}><Input placeholder="0909888777" /></Form.Item></Col>
          <Col span={12}><Form.Item name="email" label="Email"><Input placeholder="ungvien@gmail.com" /></Form.Item></Col>
          <Col span={6}><Form.Item name="birth_year" label="Năm sinh"><Input placeholder="2004" /></Form.Item></Col>
          <Col span={6}><Form.Item name="gender" label="Giới tính"><Select options={[{ value: 'Nữ', label: 'Nữ' }, { value: 'Nam', label: 'Nam' }, { value: 'Khác', label: 'Khác' }]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="applied_branch_id" label="Chi nhánh nguyện vọng" rules={[{ required: true }]}><Select options={branches} placeholder="Chọn chi nhánh" /></Form.Item></Col>
          <Col span={12}><Form.Item name="applied_position" label="Vị trí ứng tuyển"><Select options={jobPositionOptions} /></Form.Item></Col>
          <Col span={8}><Form.Item name="shift_pref" label="Ca đăng ký (theo chi nhánh)"><Select options={shiftPrefOptions} /></Form.Item></Col>
          <Col span={8}><Form.Item name="expected_salary_vnd" label="Lương mong muốn"><InputNumber min={0} step={500000} style={{ width: '100%' }} suffix="đ" {...MONEY_INPUT_PROPS} /></Form.Item></Col>
          <Col span={8}><Form.Item name="status" label="Trạng thái xử lý"><Select options={CANDIDATE_STATUS_OPTIONS.filter((o) => o.value !== 'ALL')} /></Form.Item></Col>
          <Col span={24}><Form.Item name="experience_note" label="Kinh nghiệm làm việc"><Input placeholder="Ví dụ: 6 tháng pha chế / thu ngân..." /></Form.Item></Col>
          <Col span={24}>
            <Form.Item
              name="hr_note"
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

export function CandidateDetailDrawer({
  candidate, hasInterview, onClose, onScheduleInterview, onEdit, onMarkContacted, onReject, onOpenZaloNotify,
}: {
  candidate: Record<string, unknown> | null; hasInterview: boolean; onClose: () => void;
  onScheduleInterview: (candidateId: string) => void; onEdit: (cand: Record<string, unknown>) => void;
  onMarkContacted: (cand: Record<string, unknown>) => void; onReject: (cand: Record<string, unknown>) => void;
  onOpenZaloNotify?: (cand: Record<string, unknown>) => void;
}) {
  return (
    <BaseDetailDrawer
      open={Boolean(candidate)}
      title={candidate ? `Hồ sơ Ứng viên: ${candidate.full_name} (${candidate.candidate_code})` : 'Chi tiết ứng viên'}
      onClose={onClose}
      extra={
        candidate ? (
          <Space size={6} wrap>
            {onOpenZaloNotify && (
              <GuardButton size="small" type="primary" ghost icon={<MessageOutlined />} perms={['candidate.manage', 'interview.manage']} onClick={() => onOpenZaloNotify(candidate)}>
                Gửi Zalo / Tin nhắn mẫu
              </GuardButton>
            )}
            {candidate.status === 'NEW' && (
              <GuardButton size="small" icon={<CheckCircleOutlined />} perms={['candidate.manage']} onClick={() => onMarkContacted(candidate)}>
                Đã liên hệ
              </GuardButton>
            )}
            {candidate.status !== 'REJECTED' && candidate.status !== 'HIRED' && (
              <GuardButton size="small" danger icon={<CloseCircleOutlined />} perms={['candidate.manage']} onClick={() => onReject(candidate)}>
                Từ chối hồ sơ
              </GuardButton>
            )}
            <GuardButton size="small" type="primary" icon={<CalendarOutlined />} perms={['interview.manage']} onClick={() => { const id = String(candidate.id); onClose(); onScheduleInterview(id); }}>
              {hasInterview ? 'Chỉnh sửa lịch phỏng vấn' : 'Đặt lịch phỏng vấn'}
            </GuardButton>
            <GuardButton size="small" icon={<EditOutlined />} perms={['candidate.manage']} onClick={() => { onClose(); onEdit(candidate); }}>
              Chỉnh sửa
            </GuardButton>
          </Space>
        ) : null
      }
    >
      {candidate && (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Card size="small" title="Kênh liên hệ tích hợp & Tin nhắn mẫu Zalo">
            <Space wrap>
              {onOpenZaloNotify && (
                <Button type="primary" icon={<MessageOutlined />} onClick={() => onOpenZaloNotify(candidate)}>
                  Chọn TK Zalo &amp; Gửi / Copy tin nhắn mẫu
                </Button>
              )}
              <Button icon={<PhoneOutlined />} href={`tel:${candidate.phone}`}>Gọi điện thoại ({String(candidate.phone)})</Button>
              <Button icon={<MessageOutlined />} href={`https://zalo.me/${candidate.phone}`} target="_blank">Mở chat Zalo ({String(candidate.phone)})</Button>
              {Boolean(candidate.email) && <Button icon={<MailOutlined />} href={`mailto:${candidate.email}`}>Gửi Email ({String(candidate.email)})</Button>}
            </Space>
          </Card>
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Mã ứng viên"><Tag color="geekblue">{String(candidate.candidate_code)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Họ và tên">{String(candidate.full_name)}</Descriptions.Item>
            <Descriptions.Item label="Số điện thoại">{String(candidate.phone)}</Descriptions.Item>
            <Descriptions.Item label="ID / SĐT Zalo đã lưu"><Tag color="blue">{String(candidate.candidateZaloId || candidate.candidate_zalo_id || candidate.phone)}</Tag></Descriptions.Item>
            <Descriptions.Item label="TK Zalo HR phụ trách" span={2}>{String(candidate.zaloAccountName || 'Mặc định theo nhân sự HR')}</Descriptions.Item>
            <Descriptions.Item label="Email">{String(candidate.email || 'Chưa cập nhật')}</Descriptions.Item>
            <Descriptions.Item label="Năm sinh / Giới tính">{String(candidate.birth_year || '—')} / {String(candidate.gender || '—')}</Descriptions.Item>
            <Descriptions.Item label="Ca đăng ký">{String(candidate.shiftPrefLabel || candidate.shift_pref || '—')}</Descriptions.Item>
            <Descriptions.Item label="Vị trí ứng tuyển">{String(candidate.positionLabel)}</Descriptions.Item>
            <Descriptions.Item label="Chi nhánh nguyện vọng">{String(candidate.branchName)}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái sàng lọc"><StatusTag value={String(candidate.stage)} /></Descriptions.Item>
            <Descriptions.Item label="Kinh nghiệm ứng viên" span={2}>{String(candidate.experience_note || 'Chưa ghi nhận')}</Descriptions.Item>
            <Descriptions.Item label="Ghi chú HR" span={2}>{String(candidate.hr_note || '—')}</Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </BaseDetailDrawer>
  );
}

export function InterviewDetailDrawer({
  interview, canManage, onClose, onReschedule, onEvaluate, onOpenZaloNotify,
}: {
  interview: Record<string, unknown> | null; canManage: boolean; onClose: () => void;
  onReschedule: (iv: Record<string, unknown>) => void; onEvaluate: (iv: Record<string, unknown>) => void;
  onOpenZaloNotify?: (iv: Record<string, unknown>) => void;
}) {
  const track: InterviewExperienceTrack = interview?.experience_track === 'EXPERIENCED' ? 'EXPERIENCED' : 'INEXPERIENCED';
  const rubric = INTERVIEW_RUBRICS[track];
  return (
    <BaseDetailDrawer
      open={Boolean(interview)}
      title={interview ? `Chi tiết Phỏng vấn: ${interview.candidateName}` : 'Chi tiết phỏng vấn'}
      onClose={onClose}
      extra={
        interview ? (
          <Space size={6} wrap>
            {canManage && onOpenZaloNotify && (
              <Button size="small" type="primary" ghost icon={<MessageOutlined />} onClick={() => onOpenZaloNotify(interview)}>
                Gửi Zalo / Tin nhắn mẫu
              </Button>
            )}
            {Boolean(interview.meet_link) && <Button size="small" type="primary" icon={<VideoCameraOutlined />} href={String(interview.meet_link)} target="_blank">Mở Google Meet</Button>}
            {canManage && <Button size="small" icon={<ClockCircleOutlined />} onClick={() => { onClose(); onReschedule(interview); }}>Chỉnh sửa lịch</Button>}
            {canManage && <Button size="small" icon={<EditOutlined />} onClick={() => { onClose(); onEvaluate(interview); }}>Chấm điểm HR</Button>}
          </Space>
        ) : null
      }
    >
      {interview && (
        <Descriptions size="small" bordered column={2}>
          <Descriptions.Item label="Ứng viên">{String(interview.candidateName)} {interview.candidateCode ? <Tag color="geekblue">{String(interview.candidateCode)}</Tag> : null}</Descriptions.Item>
          <Descriptions.Item label="Số điện thoại">{String(interview.candidatePhone || '—')}</Descriptions.Item>
          <Descriptions.Item label="ID Zalo ứng viên"><Tag color="blue">{String(interview.candidate_zalo_id || interview.candidatePhone || '—')}</Tag></Descriptions.Item>
          <Descriptions.Item label="TK Zalo HR nhắc lịch">{String(interview.zaloAccountName || 'Mặc định HR')}</Descriptions.Item>
          <Descriptions.Item label="Nhắc lịch Zalo tự động" span={2}>
            {interview.zalo_reminder_sent_at ? (
              <Tag color="success" icon={<CheckCircleOutlined />}>Đã tự động gửi Zalo nhắc lịch lúc {String(interview.zalo_reminder_sent_at).slice(0, 16).replace('T', ' ')}</Tag>
            ) : interview.candidate_confirmed ? (
              <Tag color="processing" icon={<BellOutlined />}>Sẽ tự động gửi tin nhắn Zalo nhắc ứng viên trước 5–15 phút</Tag>
            ) : (
              <Tag color="default">Chờ ứng viên xác nhận để bật tự động nhắc Zalo</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Vị trí ứng tuyển">{String(interview.positionLabel || '—')}</Descriptions.Item>
          <Descriptions.Item label="Chi nhánh">{String(interview.branchName || '—')}</Descriptions.Item>
          <Descriptions.Item label="Phân loại chấm điểm" span={2}>
            <Space size={6} wrap>
              <Tag color={track === 'EXPERIENCED' ? 'purple' : 'cyan'} style={{ margin: 0 }}>{rubric.label}</Tag>
              {Boolean(interview.candidateExperienceNote) && <span style={{ color: '#64748B', fontSize: 12 }}>Hồ sơ UV: {String(interview.candidateExperienceNote)}</span>}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Thời gian phỏng vấn">{String(interview.scheduled_at || '').slice(0, 16).replace('T', ' ')} ({String(interview.duration_minutes ?? 30)} phút)</Descriptions.Item>
          <Descriptions.Item label="Phòng họp trực tuyến">{interview.meet_link ? <Button size="small" type="link" icon={<VideoCameraOutlined />} href={String(interview.meet_link)} target="_blank" style={{ padding: 0, height: 'auto' }}>{String(interview.meet_link)}</Button> : '—'}</Descriptions.Item>
          <Descriptions.Item label="Hội đồng phỏng vấn" span={2}>{String(interview.interviewerLabel || interview.interviewer_id || '—')}</Descriptions.Item>
          <Descriptions.Item label="Trạng thái xác nhận">{interview.reschedule_requested ? <Tag color="warning" icon={<ClockCircleOutlined />}>Cần đổi lịch</Tag> : interview.candidate_confirmed ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận</Tag> : <Tag>Chờ xác nhận</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Quyết định HR"><Space size={6}><StatusTag value={String(interview.decision)} />{interview.decision !== 'PENDING' && <Tag color="blue">{String(interview.score)} điểm</Tag>}</Space></Descriptions.Item>
          {Boolean(interview.reschedule_reason) && <Descriptions.Item label="Lý do xin đổi lịch" span={2}>{String(interview.reschedule_reason)}</Descriptions.Item>}
          <Descriptions.Item label="Điểm thành phần theo trọng số" span={2}>
            {rubric.criteria.appearance.label}: <b>{String(interview.appearance_score ?? 0)}</b> · {rubric.criteria.attitude.label}: <b>{String(interview.attitude_score ?? 0)}</b> · {rubric.criteria.skill.label}: <b>{String(interview.skill_score ?? 0)}</b>
          </Descriptions.Item>
          <Descriptions.Item label="Nhận xét của HR" span={2}>{String(interview.comment || 'Chưa có nhận xét đánh giá')}</Descriptions.Item>
        </Descriptions>
      )}
    </BaseDetailDrawer>
  );
}
