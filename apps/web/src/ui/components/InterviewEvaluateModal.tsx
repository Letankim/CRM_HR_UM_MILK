'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, Col, Divider, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Tag } from 'antd';
import { BankOutlined, CloseOutlined, FlagOutlined, SaveOutlined, ShopOutlined, SolutionOutlined, TrophyOutlined, UserOutlined } from '@ant-design/icons';
import {
  computeInterviewWeightedScore, evaluateInterviewRubric13, inferCandidateExperienceTrack,
  INTERVIEW_RED_FLAGS, INTERVIEW_RUBRIC_13_MAX, INTERVIEW_RUBRIC_13_PASS_THRESHOLD,
  INTERVIEW_RUBRIC_BLOCK_LABELS, INTERVIEW_RUBRICS, OFFICE_RUBRIC_CRITERIA_13, STORE_RUBRIC_CRITERIA_13,
  type InterviewExperienceTrack, type InterviewRubricBlock,
} from '@umbm/shared';
import { FireworksCanvasOverlay } from './FireworksCanvasOverlay';

interface InterviewEvaluateModalProps {
  target: Record<string, unknown> | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (id: string, body: Record<string, unknown>) => void;
}

const DEFAULT_COMMENTS = new Set([
  INTERVIEW_RUBRICS.INEXPERIENCED.defaultComment, INTERVIEW_RUBRICS.EXPERIENCED.defaultComment,
  'Thái độ tích cực, phù hợp khung ca đăng ký tại cửa hàng', '',
]);

function buildDefaultRubricScores(block: InterviewRubricBlock): Record<string, number> {
  const list = block === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  return Object.fromEntries(list.map((c) => [c.key, c.maxPoints]));
}

export function InterviewEvaluateModal({ target, loading, onClose, onSubmit }: InterviewEvaluateModalProps) {
  const [form] = Form.useForm();
  const [rubricBlock, setRubricBlock] = useState<InterviewRubricBlock>('STORE');
  const [rubricScores, setRubricScores] = useState<Record<string, number>>(() => buildDefaultRubricScores('STORE'));
  const [redFlags, setRedFlags] = useState<string[]>([]);

  const watchedTrack = (Form.useWatch('experience_track', form) as InterviewExperienceTrack | undefined) ?? 'INEXPERIENCED';
  const rubric = INTERVIEW_RUBRICS[watchedTrack] ?? INTERVIEW_RUBRICS.INEXPERIENCED;
  const criteria13 = rubricBlock === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  const eval13 = useMemo(() => evaluateInterviewRubric13(rubricBlock, rubricScores, redFlags), [rubricBlock, rubricScores, redFlags]);

  useEffect(() => {
    if (!target) return;
    const hasPrev = Boolean(target.decision && target.decision !== 'PENDING');
    const inferredTrack: InterviewExperienceTrack =
      target.experience_track === 'EXPERIENCED' || target.experience_track === 'INEXPERIENCED'
        ? target.experience_track
        : inferCandidateExperienceTrack(String(target.candidateExperienceNote || ''));
    const initBlock: InterviewRubricBlock = target.rubric_block === 'OFFICE' ? 'OFFICE' : 'STORE';
    let parsedScores = buildDefaultRubricScores(initBlock);
    let parsedFlags: string[] = [];
    if (typeof target.rubric_details_json === 'string' && target.rubric_details_json.startsWith('{')) {
      try {
        const parsed = JSON.parse(target.rubric_details_json) as { scores?: Record<string, number>; redFlags?: string[] };
        if (parsed.scores && Object.keys(parsed.scores).length > 0) parsedScores = parsed.scores;
        if (Array.isArray(parsed.redFlags)) parsedFlags = parsed.redFlags;
      } catch { /* ignore */ }
    }
    setRubricBlock(initBlock);
    setRubricScores(parsedScores);
    setRedFlags(parsedFlags);

    const app = hasPrev ? Number(target.appearance_score ?? 90) : 90;
    const att = hasPrev ? Number(target.attitude_score ?? 90) : 90;
    const skl = hasPrev ? Number(target.skill_score ?? 85) : inferredTrack === 'EXPERIENCED' ? 88 : 85;
    const score = computeInterviewWeightedScore(inferredTrack, app, att, skl);
    const prevComment = String(target.comment || '').trim();
    form.setFieldsValue({
      experience_track: inferredTrack, appearance_score: app, attitude_score: att, skill_score: skl,
      score, decision: hasPrev ? target.decision : 'PASS',
      comment: prevComment || INTERVIEW_RUBRICS[inferredTrack].defaultComment,
    });
  }, [target, form]);

  const applyRubricSync = (nextBlock: InterviewRubricBlock, nextScores: Record<string, number>, nextFlags: string[]) => {
    const res = evaluateInterviewRubric13(nextBlock, nextScores, nextFlags);
    form.setFieldsValue({
      score: res.normalizedScore100,
      decision: res.hasRedFlag ? 'FAIL' : res.autoDecision,
      ...(res.hasRedFlag ? { comment: 'Loại trực tiếp do vi phạm tiêu chí Red Flag trong buổi phỏng vấn' } : {}),
    });
  };

  return (
    <>
      <FireworksCanvasOverlay active={Boolean(target) && eval13.isPerfect13} />
      <Modal
        width={1120} style={{ maxWidth: 'calc(100vw - 32px)' }} open={Boolean(target)} forceRender destroyOnHidden
        title={target ? `Chấm điểm & Quyết định Phỏng vấn: ${String(target.candidateName)}` : 'Đánh giá phỏng vấn'}
        okText="Lưu kết quả phỏng vấn" cancelText="Hủy bỏ"
        okButtonProps={{ icon: <SaveOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
        onCancel={onClose} onOk={() => form.submit()}
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
            onSubmit(String(target.id), {
              ...v, decision: eval13.hasRedFlag ? 'FAIL' : v.decision, experience_track: track,
              rubric_block: rubricBlock, rubric_scores: rubricScores, red_flags: redFlags,
              score_13: eval13.totalScore13, score: Number(v.score ?? eval13.normalizedScore100), version: target.version,
            });
          }}
        >
          <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: 12, marginBottom: 16 }}>
            <Row gutter={[12, 12]} align="middle" justify="space-between" style={{ marginBottom: 10 }}>
              <Col xs={24} md={14}>
                <Radio.Group
                  value={rubricBlock}
                  buttonStyle="solid"
                  onChange={(e) => {
                    const nextBlock = e.target.value as InterviewRubricBlock;
                    const defaults = buildDefaultRubricScores(nextBlock);
                    setRubricBlock(nextBlock);
                    setRubricScores(defaults);
                    applyRubricSync(nextBlock, defaults, redFlags);
                  }}
                >
                  <Radio.Button value="STORE"><ShopOutlined /> {INTERVIEW_RUBRIC_BLOCK_LABELS.STORE}</Radio.Button>
                  <Radio.Button value="OFFICE"><BankOutlined /> {INTERVIEW_RUBRIC_BLOCK_LABELS.OFFICE}</Radio.Button>
                </Radio.Group>
              </Col>
              <Col xs={24} md={10} style={{ textAlign: 'right' }}>
                <Space wrap>
                  <Tag color={eval13.passed ? 'success' : 'error'} style={{ fontWeight: 700, fontSize: 13, padding: '2px 8px' }}>
                    Điểm Rubric: {eval13.totalScore13}/{INTERVIEW_RUBRIC_13_MAX} (Chuẩn đạt: {INTERVIEW_RUBRIC_13_PASS_THRESHOLD}/13)
                  </Tag>
                  {eval13.isPerfect13 && <Tag color="gold" icon={<TrophyOutlined />}>Tuyệt đối 13/13</Tag>}
                </Space>
              </Col>
            </Row>

            <Row gutter={[12, 8]}>
              {criteria13.map((c) => (
                <Col xs={24} md={8} key={c.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 4, padding: '6px 10px' }}>
                    <span style={{ fontSize: 12, color: '#0F172A', paddingRight: 8 }}>{c.label} (tối đa {c.maxPoints}đ)</span>
                    <InputNumber
                      size="small"
                      min={0}
                      max={c.maxPoints}
                      step={0.5}
                      value={rubricScores[c.key] ?? c.maxPoints}
                      onChange={(val) => {
                        const next = { ...rubricScores, [c.key]: Number(val ?? 0) };
                        setRubricScores(next);
                        applyRubricSync(rubricBlock, next, redFlags);
                      }}
                      style={{ width: 68 }}
                    />
                  </div>
                </Col>
              ))}
            </Row>

            <Divider style={{ margin: '10px 0' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 600, color: '#DC2626', fontSize: 12 }}><FlagOutlined /> Cờ Loại trực tiếp (Red Flag):</span>
              <Checkbox.Group
                value={redFlags}
                options={INTERVIEW_RED_FLAGS.map((rf) => ({ label: rf.label, value: rf.key }))}
                onChange={(vals) => {
                  const nextFlags = vals.map(String);
                  setRedFlags(nextFlags);
                  applyRubricSync(rubricBlock, rubricScores, nextFlags);
                }}
              />
            </div>
            {eval13.hasRedFlag && (
              <Alert style={{ marginTop: 8 }} type="error" showIcon message="Ứng viên vi phạm cờ Loại trực tiếp (Red Flag) — Hệ thống tự động chuyển quyết định sang Từ chối (REJECTED)." />
            )}
          </div>

          <Form.Item name="experience_track" label="Phân loại kinh nghiệm ứng viên (Thang 100 quy đổi)" rules={[{ required: true }]}>
            <Radio.Group buttonStyle="solid" style={{ width: '100%', display: 'flex' }}>
              <Radio.Button value="INEXPERIENCED" style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}><UserOutlined /> Ứng viên chưa có kinh nghiệm</Radio.Button>
              <Radio.Button value="EXPERIENCED" style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}><SolutionOutlined /> Ứng viên đã có kinh nghiệm</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} md={6}><Form.Item name="appearance_score" label={rubric.criteria.appearance.label}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="attitude_score" label={rubric.criteria.attitude.label}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="skill_score" label={rubric.criteria.skill.label}><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={6}><Form.Item name="score" label="Điểm quy đổi (Thang 100)"><InputNumber min={0} max={100} disabled style={{ width: '100%', fontWeight: 700 }} /></Form.Item></Col>
            <Col xs={24} md={8}>
              <Form.Item name="decision" label="Quyết định của HR" rules={[{ required: true }]}>
                <Select disabled={eval13.hasRedFlag} options={[{ value: 'PASS', label: 'Đạt phỏng vấn — Mời thử việc' }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Không đạt / Chưa phù hợp' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="comment" label="Nhận xét chi tiết của HR" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá phỏng vấn' }]}>
                <Input.TextArea rows={2} placeholder="Ghi nhận thái độ, kỹ năng và mức độ đáp ứng ca..." />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
