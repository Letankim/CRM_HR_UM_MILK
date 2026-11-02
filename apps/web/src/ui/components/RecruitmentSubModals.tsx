'use client';

import { Alert, Button, Card, Descriptions, Space, Tag } from 'antd';
import {
  BankOutlined, BellOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined,
  EditOutlined, FlagOutlined, LinkOutlined, MailOutlined, MessageOutlined, PhoneOutlined, ShopOutlined, TrophyOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import {
  INTERVIEW_RED_FLAGS, INTERVIEW_RUBRIC_13_MAX, INTERVIEW_RUBRIC_13_PASS_THRESHOLD,
  INTERVIEW_RUBRIC_BLOCK_LABELS, INTERVIEW_RUBRICS, OFFICE_RUBRIC_CRITERIA_13, STORE_RUBRIC_CRITERIA_13,
  type InterviewExperienceTrack, type InterviewRubricBlock,
} from '@umbm/shared';
import { StatusTag } from '../StatusTag';
import { BaseDetailDrawer } from './BaseDetailDrawer';
import { CANDIDATE_STATUS_OPTIONS, CandidateFormModal } from './CandidateFormModal';
import { GuardButton } from './GuardButton';

export { CANDIDATE_STATUS_OPTIONS, CandidateFormModal };

const AI_CRITERIA_LABELS: { key: string; label: string; max: number }[] = [
  { key: 'age_valid', label: 'Độ tuổi (18–45)', max: 2 },
  { key: 'zalo_phone', label: 'SĐT Zalo hợp lệ', max: 1 },
  { key: 'shift_flexibility', label: 'Đáp ứng khung ca', max: 2 },
  { key: 'fixed_branch', label: 'Chi nhánh cố định', max: 1 },
  { key: 'fnb_experience', label: 'Kinh nghiệm F&B', max: 2 },
  { key: 'incident_handling', label: 'Xử lý việc đột xuất', max: 2 },
  { key: 'education_commitment', label: 'Học vấn & Cam kết', max: 2 },
  { key: 'facebook_link', label: 'Link Facebook', max: 1 },
  { key: 'hometown_cccd', label: 'Quê quán / CCCD', max: 1 },
];

export function CandidateDetailDrawer({
  candidate, hasInterview, onClose, onScheduleInterview, onEdit, onMarkContacted, onReject, onOpenZaloNotify,
}: {
  candidate: Record<string, unknown> | null; hasInterview: boolean; onClose: () => void;
  onScheduleInterview: (candidateId: string) => void; onEdit: (cand: Record<string, unknown>) => void;
  onMarkContacted: (cand: Record<string, unknown>) => void; onReject: (cand: Record<string, unknown>) => void;
  onOpenZaloNotify?: (cand: Record<string, unknown>) => void;
}) {
  const fp = (candidate?.form_payload ?? candidate ?? {}) as Record<string, unknown>;
  const criteriaScores = (fp.criteria_scores ?? {}) as Record<string, number>;
  const aiScore = Number(candidate?.ai_score_14 ?? fp.ai_score_14 ?? 0);
  const redFlag = String(candidate?.red_flag_reason ?? fp.red_flag_reason ?? '');

  return (
    <BaseDetailDrawer
      open={Boolean(candidate)}
      title={candidate ? `Hồ sơ Ứng viên (26 trường Google Form): ${candidate.full_name} (${candidate.candidate_code})` : 'Chi tiết ứng viên'}
      onClose={onClose}
      extra={
        candidate ? (
          <Space size={6} wrap>
            {onOpenZaloNotify && <GuardButton size="small" type="primary" ghost icon={<MessageOutlined />} perms={['candidate.manage', 'interview.manage']} onClick={() => onOpenZaloNotify(candidate)}>Nhắn Zalo</GuardButton>}
            {candidate.status === 'NEW' && <GuardButton size="small" icon={<CheckCircleOutlined />} perms={['candidate.manage']} onClick={() => onMarkContacted(candidate)}>Đã liên hệ</GuardButton>}
            {candidate.status !== 'REJECTED' && candidate.status !== 'HIRED' && <GuardButton size="small" danger icon={<CloseCircleOutlined />} perms={['candidate.manage']} onClick={() => onReject(candidate)}>Từ chối hồ sơ</GuardButton>}
            <GuardButton size="small" type="primary" icon={<CalendarOutlined />} perms={['interview.manage']} onClick={() => { const id = String(candidate.id); onClose(); onScheduleInterview(id); }}>{hasInterview ? 'Chỉnh sửa lịch phỏng vấn' : 'Đặt lịch phỏng vấn'}</GuardButton>
            <GuardButton size="small" icon={<EditOutlined />} perms={['candidate.manage']} onClick={() => { onClose(); onEdit(candidate); }}>Chỉnh sửa (26 trường)</GuardButton>
          </Space>
        ) : null
      }
    >
      {candidate && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {redFlag && <Alert type="error" showIcon message={`Cờ loại trực tiếp (Red Flag): ${redFlag}`} />}
          <Card size="small" title="Kênh liên hệ tích hợp & Điểm sàng lọc AI tự động (Thang 14 điểm)">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space wrap>
                {onOpenZaloNotify && <Button type="primary" size="small" icon={<MessageOutlined />} onClick={() => onOpenZaloNotify(candidate)}>Nhắn Zalo</Button>}
                <Button size="small" icon={<PhoneOutlined />} href={`tel:${candidate.phone}`}>Gọi ({String(candidate.phone)})</Button>
                <Button size="small" icon={<MessageOutlined />} href={`https://zalo.me/${candidate.phone}`} target="_blank">Mở Zalo ({String(candidate.phone)})</Button>
                {Boolean(candidate.email) && <Button size="small" icon={<MailOutlined />} href={`mailto:${candidate.email}`}>Email ({String(candidate.email)})</Button>}
                {Boolean(fp.facebook_link) && <Button size="small" icon={<LinkOutlined />} href={String(fp.facebook_link)} target="_blank">Facebook cá nhân</Button>}
                <Tag color={redFlag ? 'error' : aiScore >= 8 ? 'success' : 'warning'} style={{ fontWeight: 700, margin: 0 }}>
                  Điểm AI Google Form: {aiScore}/14đ ({redFlag ? 'Loại trực tiếp' : aiScore >= 8 ? 'Đạt sơ loại >= 8đ' : 'Cần cân nhắc'})
                </Tag>
                {Boolean(candidate.onboardedEmployeeCode) && <Tag color="geekblue" style={{ fontWeight: 700, margin: 0 }}>Đã khởi tạo NV: {String(candidate.onboardedEmployeeCode)}</Tag>}
              </Space>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {AI_CRITERIA_LABELS.map((c) => (
                  <Tag key={c.key} color={(criteriaScores[c.key] ?? 0) > 0 ? 'blue' : 'default'} style={{ margin: 0 }}>
                    {c.label}: <b>{criteriaScores[c.key] ?? 0}/{c.max}đ</b>
                  </Tag>
                ))}
              </div>
            </Space>
          </Card>

          <Descriptions size="small" bordered column={2} title="1. Thông tin Cá nhân, CCCD, Học vấn & Nguồn tuyển dụng (Google Form)">
            <Descriptions.Item label="Mã ứng viên"><Tag color="geekblue">{String(candidate.candidate_code)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Dấu thời gian gửi Form">{String(fp.timestamp || candidate.created_at || '—')}</Descriptions.Item>
            <Descriptions.Item label="Họ và tên">{String(candidate.full_name)}</Descriptions.Item>
            <Descriptions.Item label="Năm sinh / Giới tính">{String(candidate.birth_year || fp.birth_year || '—')} / {String(candidate.gender || fp.gender || '—')}</Descriptions.Item>
            <Descriptions.Item label="Số điện thoại (Zalo)">{String(candidate.phone)} <Tag color="blue" style={{ marginLeft: 4 }}>ID Zalo: {String(candidate.candidateZaloId || candidate.phone)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Số CCCD">{String(fp.citizen_id || candidate.citizen_id || 'Chưa cung cấp')}</Descriptions.Item>
            <Descriptions.Item label="Email">{String(candidate.email || fp.email || 'Chưa cập nhật')}</Descriptions.Item>
            <Descriptions.Item label="TK Zalo HR phụ trách">{String(candidate.zaloAccountName || 'Mặc định theo nhân sự HR')}</Descriptions.Item>
            <Descriptions.Item label="Trình độ học vấn">{String(fp.education || candidate.education || '—')}</Descriptions.Item>
            <Descriptions.Item label="Trường / Chuyên ngành">{String(fp.school_or_major || candidate.school_or_major || '—')}</Descriptions.Item>
            <Descriptions.Item label="Quê quán theo CCCD">{String(fp.hometown || candidate.hometown || '—')}</Descriptions.Item>
            <Descriptions.Item label="Nơi ở hiện tại">{String(fp.current_address || candidate.current_address || '—')}</Descriptions.Item>
            <Descriptions.Item label="Link Facebook cá nhân">{fp.facebook_link ? <a href={String(fp.facebook_link)} target="_blank" rel="noreferrer">{String(fp.facebook_link)}</a> : '—'}</Descriptions.Item>
            <Descriptions.Item label="Nguồn biết tin ứng tuyển">{String(fp.source_channel || candidate.source_channel || '—')}</Descriptions.Item>
          </Descriptions>

          <Descriptions size="small" bordered column={2} title="2. Nguyện vọng Công việc, Ca trực, Kinh nghiệm F&B & Cam kết vận hành">
            <Descriptions.Item label="Chi nhánh ứng tuyển (Cố định)"><b>{String(candidate.branchName)}</b> {fp.raw_branch ? <span style={{ color: '#64748B', fontSize: 12 }}>({String(fp.raw_branch)})</span> : null}</Descriptions.Item>
            <Descriptions.Item label="Vị trí & Hình thức">{String(candidate.positionLabel)} · <Tag style={{ margin: 0 }}>{String(fp.employment_type || 'PART_TIME')}</Tag></Descriptions.Item>
            <Descriptions.Item label="Ca đăng ký">{String(candidate.shiftPrefLabel || candidate.shift_pref || '—')} {fp.raw_shift ? <span style={{ color: '#64748B', fontSize: 12 }}>({String(fp.raw_shift)})</span> : null}</Descriptions.Item>
            <Descriptions.Item label="Hỗ trợ xoay ca CN khác">{String(fp.can_rotate_branch || 'Trao đổi khi phỏng vấn')}</Descriptions.Item>
            <Descriptions.Item label="Cam kết gắn bó tối thiểu">{String(fp.commitment_months || '—')}</Descriptions.Item>
            <Descriptions.Item label="Lương mong muốn & Ngày bắt đầu">{String(fp.expected_salary || 'Theo quy định')} · Bắt đầu: {String(fp.start_date_available || 'Ngay khi đạt')}</Descriptions.Item>
            <Descriptions.Item label="Kinh nghiệm làm việc" span={2}>{String(candidate.experience_note || fp.experience_note || 'Chưa ghi nhận')}</Descriptions.Item>
            <Descriptions.Item label="Kỹ năng pha chế / F&B" span={2}>{String(fp.fnb_skills || '—')}</Descriptions.Item>
            <Descriptions.Item label="Xử lý việc đột xuất trùng lịch ca trực" span={2}><b>{String(fp.incident_answer || '—')}</b></Descriptions.Item>
            <Descriptions.Item label="Cam kết đồng phục áo hồng & GPS">{String(fp.uniform_gps_consent || 'Đồng ý theo quy định Ụm Bò Milk')}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái sàng lọc"><StatusTag value={String(candidate.stage || candidate.status)} /></Descriptions.Item>
            <Descriptions.Item label="Giới thiệu bản thân" span={2}>{String(fp.self_intro || '—')}</Descriptions.Item>
            <Descriptions.Item label="Ghi chú sàng lọc HR" span={2}>{String(candidate.hr_note || '—')}</Descriptions.Item>
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
  const block: InterviewRubricBlock = interview?.rubric_block === 'OFFICE' ? 'OFFICE' : 'STORE';
  const criteriaList = block === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  let parsedRubric: { scores?: Record<string, number>; redFlags?: string[]; totalScore13?: number; isPerfect13?: boolean } = {};
  if (typeof interview?.rubric_details_json === 'string' && interview.rubric_details_json.startsWith('{')) {
    try { parsedRubric = JSON.parse(interview.rubric_details_json); } catch { parsedRubric = {}; }
  }
  const score13 = Number(interview?.score_13 ?? parsedRubric.totalScore13 ?? 0);
  const redFlagKeys = Array.isArray(parsedRubric.redFlags) ? parsedRubric.redFlags : [];

  return (
    <BaseDetailDrawer
      open={Boolean(interview)}
      title={interview ? `Chi tiết Phỏng vấn & Rubric 13 điểm: ${interview.candidateName}` : 'Chi tiết phỏng vấn'}
      onClose={onClose}
      extra={
        interview ? (
          <Space size={6} wrap>
            {canManage && onOpenZaloNotify && <Button size="small" type="primary" ghost icon={<MessageOutlined />} onClick={() => onOpenZaloNotify(interview)}>Nhắn Zalo</Button>}
            {Boolean(interview.meet_link) && <Button size="small" type="primary" icon={<VideoCameraOutlined />} href={String(interview.meet_link)} target="_blank">Mở Google Meet</Button>}
            {canManage && <Button size="small" icon={<ClockCircleOutlined />} onClick={() => { onClose(); onReschedule(interview); }}>Chỉnh sửa lịch</Button>}
            {canManage && <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => { onClose(); onEvaluate(interview); }}>Chấm điểm Rubric (13đ)</Button>}
          </Space>
        ) : null
      }
    >
      {interview && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {redFlagKeys.length > 0 && (
            <Alert type="error" showIcon message={`Ứng viên vi phạm tiêu chí Loại trực tiếp (Red Flag): ${redFlagKeys.map((k) => INTERVIEW_RED_FLAGS.find((r) => r.key === k)?.label ?? k).join(', ')} — Tự động chuyển sang REJECTED`} />
          )}
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label="Ứng viên">{String(interview.candidateName)} {interview.candidateCode ? <Tag color="geekblue">{String(interview.candidateCode)}</Tag> : null}</Descriptions.Item>
            <Descriptions.Item label="Số điện thoại / ID Zalo">{String(interview.candidatePhone || '—')} · <Tag color="blue">{String(interview.candidate_zalo_id || interview.candidatePhone || '—')}</Tag></Descriptions.Item>
            <Descriptions.Item label="TK Zalo HR nhắc lịch">{String(interview.zaloAccountName || 'Mặc định HR')}</Descriptions.Item>
            <Descriptions.Item label="Nhắc lịch Zalo tự động">
              {interview.zalo_reminder_sent_at ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã nhắc lúc {String(interview.zalo_reminder_sent_at).slice(0, 16).replace('T', ' ')}</Tag> : interview.candidate_confirmed ? <Tag color="processing" icon={<BellOutlined />}>Tự nhắc trước 5–15p</Tag> : <Tag>Chờ xác nhận</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Vị trí & Chi nhánh">{String(interview.positionLabel || '—')} · <b>{String(interview.branchName || '—')}</b></Descriptions.Item>
            <Descriptions.Item label="Thời gian phỏng vấn">{String(interview.scheduled_at || '').slice(0, 16).replace('T', ' ')} ({String(interview.duration_minutes ?? 30)} phút)</Descriptions.Item>
            <Descriptions.Item label="Hội đồng phỏng vấn">{String(interview.interviewerLabel || interview.interviewer_id || '—')}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái xác nhận">{interview.reschedule_requested ? <Tag color="warning" icon={<ClockCircleOutlined />}>Cần đổi lịch</Tag> : interview.candidate_confirmed ? <Tag color="success" icon={<CheckCircleOutlined />}>Đã xác nhận lịch</Tag> : <Tag>Chờ xác nhận</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Khối Rubric & Kinh nghiệm" span={2}>
              <Space size={6} wrap>
                <Tag color="blue" icon={block === 'OFFICE' ? <BankOutlined /> : <ShopOutlined />} style={{ margin: 0, fontWeight: 600 }}>{INTERVIEW_RUBRIC_BLOCK_LABELS[block]}</Tag>
                <Tag color={track === 'EXPERIENCED' ? 'purple' : 'cyan'} style={{ margin: 0 }}>{rubric.label}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Kết quả Rubric 13 điểm & Quyết định HR" span={2}>
              <Space size={8} wrap>
                <StatusTag value={String(interview.decision)} />
                {interview.decision !== 'PENDING' && (
                  <>
                    <Tag color={score13 >= INTERVIEW_RUBRIC_13_PASS_THRESHOLD ? 'success' : 'error'} icon={score13 === INTERVIEW_RUBRIC_13_MAX ? <TrophyOutlined /> : undefined} style={{ fontWeight: 700, margin: 0 }}>
                      Điểm Rubric: {score13 > 0 ? `${score13}/${INTERVIEW_RUBRIC_13_MAX} điểm` : `${interview.score}/100đ`} (Chuẩn ĐẠT: &gt;= {INTERVIEW_RUBRIC_13_PASS_THRESHOLD}/13đ)
                    </Tag>
                    <Tag color="blue" style={{ margin: 0 }}>Quy đổi: {String(interview.score)}/100đ</Tag>
                  </>
                )}
                {Boolean(interview.onboardedEmployeeCode) && <Tag color="geekblue" style={{ fontWeight: 700, margin: 0 }}>Mã NV khởi tạo (Mục 2.5): {String(interview.onboardedEmployeeCode)}</Tag>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={`Chi tiết ${criteriaList.length} tiêu chí Rubric (${block === 'OFFICE' ? 'Khối Văn phòng' : 'Khối Cửa hàng'})`} span={2}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {criteriaList.map((c) => {
                  const val = parsedRubric.scores?.[c.key];
                  return (
                    <Tag key={c.key} color={val !== undefined ? (val >= c.maxPoints ? 'success' : val > 0 ? 'blue' : 'error') : 'default'} style={{ margin: 0 }}>
                      {c.label}: <b>{val !== undefined ? val : c.maxPoints}/{c.maxPoints}đ</b>
                    </Tag>
                  );
                })}
                {redFlagKeys.map((rf) => (
                  <Tag key={rf} color="error" icon={<FlagOutlined />} style={{ margin: 0 }}>Red Flag: {INTERVIEW_RED_FLAGS.find((x) => x.key === rf)?.label ?? rf}</Tag>
                ))}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="Nhận xét của HR" span={2}>{String(interview.comment || 'Chưa có nhận xét đánh giá')}</Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </BaseDetailDrawer>
  );
}
