'use client';

import { useEffect } from 'react';
import { Alert, Col, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Tag } from 'antd';
import { CloseOutlined, SaveOutlined, SolutionOutlined, UserOutlined } from '@ant-design/icons';
import {
  computeInterviewWeightedScore,
  inferCandidateExperienceTrack,
  INTERVIEW_RUBRICS,
  type InterviewExperienceTrack,
} from '@umbm/shared';

interface InterviewEvaluateModalProps {
  target: Record<string, unknown> | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (id: string, body: Record<string, unknown>) => void;
}

const DEFAULT_COMMENTS = new Set([
  INTERVIEW_RUBRICS.INEXPERIENCED.defaultComment,
  INTERVIEW_RUBRICS.EXPERIENCED.defaultComment,
  'Thái độ tích cực, phù hợp khung ca đăng ký tại cửa hàng',
  '',
]);

/**
 * Hộp thoại Chấm điểm & Quyết định Phỏng vấn hỗ trợ 2 chế độ tiêu chí:
 * 1. Ứng viên chưa có kinh nghiệm (trọng số ưu tiên Thái độ cầu tiến 45%, Tác phong 35%, Tiếp thu 20%).
 * 2. Ứng viên đã có kinh nghiệm (trọng số ưu tiên Nghiệp vụ thực chiến 45%, Kỷ luật ca 30%, Dịch vụ 25%).
 */
export function InterviewEvaluateModal({
  target,
  loading,
  onClose,
  onSubmit,
}: InterviewEvaluateModalProps) {
  const [form] = Form.useForm();
  const watchedTrack = (Form.useWatch('experience_track', form) as InterviewExperienceTrack | undefined) ?? 'INEXPERIENCED';
  const rubric = INTERVIEW_RUBRICS[watchedTrack] ?? INTERVIEW_RUBRICS.INEXPERIENCED;

  useEffect(() => {
    if (!target) return;
    const hasPrev = Boolean(target.decision && target.decision !== 'PENDING');
    const inferredTrack: InterviewExperienceTrack =
      target.experience_track === 'EXPERIENCED' || target.experience_track === 'INEXPERIENCED'
        ? target.experience_track
        : inferCandidateExperienceTrack(String(target.candidateExperienceNote || ''));
    const app = hasPrev ? Number(target.appearance_score ?? 90) : 90;
    const att = hasPrev ? Number(target.attitude_score ?? 90) : 90;
    const skl = hasPrev ? Number(target.skill_score ?? 85) : inferredTrack === 'EXPERIENCED' ? 88 : 85;
    const score = computeInterviewWeightedScore(inferredTrack, app, att, skl);
    const prevComment = String(target.comment || '').trim();
    form.setFieldsValue({
      experience_track: inferredTrack,
      appearance_score: app,
      attitude_score: att,
      skill_score: skl,
      score,
      decision: hasPrev ? target.decision : 'PASS',
      comment: prevComment || INTERVIEW_RUBRICS[inferredTrack].defaultComment,
    });
  }, [target, form]);

  const candidateExpNote = String(target?.candidateExperienceNote || '').trim();

  return (
    <Modal
      width={680}
      open={Boolean(target)}
      forceRender
      destroyOnHidden
      title={target ? `Chấm điểm & Quyết định Phỏng vấn: ${String(target.candidateName)}` : 'Đánh giá phỏng vấn'}
      okText="Lưu kết quả phỏng vấn"
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SaveOutlined />, loading }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(changed, all) => {
          const track = (all.experience_track as InterviewExperienceTrack) || 'INEXPERIENCED';
          if ('experience_track' in changed || 'appearance_score' in changed || 'attitude_score' in changed || 'skill_score' in changed) {
            const nextScore = computeInterviewWeightedScore(track, Number(all.appearance_score ?? 0), Number(all.attitude_score ?? 0), Number(all.skill_score ?? 0));
            form.setFieldValue('score', nextScore);
          }
          if ('experience_track' in changed && DEFAULT_COMMENTS.has(String(all.comment || '').trim())) {
            form.setFieldValue('comment', INTERVIEW_RUBRICS[track].defaultComment);
          }
        }}
        onFinish={(v) => {
          if (!target) return;
          const track = (v.experience_track as InterviewExperienceTrack) || 'INEXPERIENCED';
          const score = computeInterviewWeightedScore(track, Number(v.appearance_score), Number(v.attitude_score), Number(v.skill_score));
          onSubmit(String(target.id), { ...v, experience_track: track, score, version: target.version });
        }}
      >
        <Form.Item
          name="experience_track"
          label="Loại bảng chấm điểm theo kinh nghiệm ứng viên"
          rules={[{ required: true, message: 'Vui lòng chọn phân loại ứng viên' }]}
          style={{ marginBottom: 10 }}
        >
          <Radio.Group buttonStyle="solid" style={{ width: '100%', display: 'flex' }}>
            <Radio.Button value="INEXPERIENCED" style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>
              <UserOutlined /> Ứng viên chưa có kinh nghiệm
            </Radio.Button>
            <Radio.Button value="EXPERIENCED" style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>
              <SolutionOutlined /> Ứng viên đã có kinh nghiệm
            </Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message={
            <Space size={6} wrap>
              <strong>{rubric.label}</strong>
              {candidateExpNote && <Tag color="geekblue" style={{ margin: 0 }}>Hồ sơ UV: {candidateExpNote}</Tag>}
            </Space>
          }
          description={rubric.summary}
        />

        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="appearance_score" label={rubric.criteria.appearance.label} tooltip={rubric.criteria.appearance.hint} rules={[{ required: true, message: 'Nhập điểm 0–100' }]}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="attitude_score" label={rubric.criteria.attitude.label} tooltip={rubric.criteria.attitude.hint} rules={[{ required: true, message: 'Nhập điểm 0–100' }]}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="skill_score" label={rubric.criteria.skill.label} tooltip={rubric.criteria.skill.hint} rules={[{ required: true, message: 'Nhập điểm 0–100' }]}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="score" label="Điểm tổng kết theo trọng số (Tự động)">
              <InputNumber min={0} max={100} disabled style={{ width: '100%', fontWeight: 700 }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="decision" label="Quyết định của HR" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'PASS', label: 'Đạt phỏng vấn — Mời thử việc' },
                  { value: 'HOLD', label: 'Cân nhắc thêm' },
                  { value: 'FAIL', label: 'Không đạt / Chưa phù hợp' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="comment" label="Nhận xét chi tiết của HR" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá phỏng vấn' }]}>
              <Input.TextArea
                rows={3}
                placeholder={
                  watchedTrack === 'EXPERIENCED'
                    ? 'Ghi nhận kinh nghiệm làm việc thực tế, tốc độ thao tác quầy, khả năng đáp ứng ca...'
                    : 'Ghi nhận thái độ cầu tiến, khả năng giao tiếp, sự nhanh nhạy khi tiếp thu hướng dẫn...'
                }
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
