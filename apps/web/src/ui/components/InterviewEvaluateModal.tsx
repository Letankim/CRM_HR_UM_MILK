'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, Col, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Tag } from 'antd';
import { BankOutlined, CheckCircleOutlined, CloseOutlined, FlagOutlined, SaveOutlined, ShopOutlined, SolutionOutlined, UserOutlined } from '@ant-design/icons';
import {
  computeInterviewWeightedScore, evaluateInterviewRubric13, inferCandidateExperienceTrack,
  INTERVIEW_RED_FLAGS, INTERVIEW_RUBRIC_13_MAX, INTERVIEW_RUBRIC_13_PASS_THRESHOLD,
  INTERVIEW_RUBRIC_BLOCK_LABELS, INTERVIEW_RUBRICS, OFFICE_RUBRIC_CRITERIA_13, STORE_RUBRIC_CRITERIA_13,
  type InterviewExperienceTrack, type InterviewRubricBlock,
} from '@umbm/shared';

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

function derivePillarScores100(block: InterviewRubricBlock, scores: Record<string, number>) {
  const list = block === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  const ratio = (arr: typeof list) => {
    const max = arr.reduce((s, c) => s + c.maxPoints, 0) || 1;
    const cur = arr.reduce((s, c) => s + Math.min(c.maxPoints, Math.max(0, Number(scores[c.key] ?? 0))), 0);
    return Math.round((cur / max) * 100);
  };
  return { appearance: ratio(list.slice(0, 3)), attitude: ratio(list.slice(3, 6)), skill: ratio(list.slice(6, 9)) };
}

export function InterviewEvaluateModal({ target, loading, onClose, onSubmit }: InterviewEvaluateModalProps) {
  const [form] = Form.useForm();
  const [rubricBlock, setRubricBlock] = useState<InterviewRubricBlock>('STORE');
  const [rubricScores, setRubricScores] = useState<Record<string, number>>(() => buildDefaultRubricScores('STORE'));
  const [redFlags, setRedFlags] = useState<string[]>([]);

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

    const pillars = derivePillarScores100(initBlock, parsedScores);
    const prevComment = String(target.comment || '').trim();
    form.setFieldsValue({
      experience_track: inferredTrack,
      appearance_score: hasPrev ? Number(target.appearance_score ?? pillars.appearance) : pillars.appearance,
      attitude_score: hasPrev ? Number(target.attitude_score ?? pillars.attitude) : pillars.attitude,
      skill_score: hasPrev ? Number(target.skill_score ?? pillars.skill) : pillars.skill,
      decision: hasPrev ? target.decision : 'PASS',
      comment: prevComment || INTERVIEW_RUBRICS[inferredTrack].defaultComment,
    });
  }, [target, form]);

  const applyRubricSync = (nextBlock: InterviewRubricBlock, nextScores: Record<string, number>, nextFlags: string[]) => {
    const res = evaluateInterviewRubric13(nextBlock, nextScores, nextFlags);
    const pillars = derivePillarScores100(nextBlock, nextScores);
    form.setFieldsValue({
      appearance_score: pillars.appearance, attitude_score: pillars.attitude, skill_score: pillars.skill,
      decision: res.hasRedFlag ? 'FAIL' : res.autoDecision,
      ...(res.hasRedFlag ? { comment: 'Loại trực tiếp do vi phạm tiêu chí Red Flag trong buổi phỏng vấn' } : {}),
    });
  };

  const groups = [
    { title: '1. Tác phong & Dịch vụ (Tối đa 5đ)', items: criteria13.slice(0, 3) },
    { title: '2. Thái độ & Kỷ luật ca (Tối đa 5đ)', items: criteria13.slice(3, 6) },
    { title: '3. Nghiệp vụ & Vận hành (Tối đa 3đ)', items: criteria13.slice(6, 9) },
  ];

  return (
    <Modal
      width={920} style={{ maxWidth: 'calc(100vw - 24px)' }} open={Boolean(target)} forceRender destroyOnHidden
      title={target ? `Phiếu Chấm điểm Phỏng vấn HR: ${String(target.candidateName)}` : 'Đánh giá phỏng vấn'}
      okText="Lưu kết quả phỏng vấn" cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SaveOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose} onOk={() => form.submit()}
    >
      <Form
        form={form} layout="vertical"
        onValuesChange={(changed, all) => {
          const track = (all.experience_track as InterviewExperienceTrack) || 'INEXPERIENCED';
          if ('experience_track' in changed && DEFAULT_COMMENTS.has(String(all.comment || '').trim())) {
            form.setFieldValue('comment', INTERVIEW_RUBRICS[track].defaultComment);
          }
        }}
        onFinish={(v) => {
          if (!target) return;
          const track = (v.experience_track as InterviewExperienceTrack) || 'INEXPERIENCED';
          const pillars = derivePillarScores100(rubricBlock, rubricScores);
          const weighted = computeInterviewWeightedScore(track, pillars.appearance, pillars.attitude, pillars.skill);
          onSubmit(String(target.id), {
            ...v, decision: eval13.hasRedFlag ? 'FAIL' : v.decision, experience_track: track,
            rubric_block: rubricBlock, rubric_scores: rubricScores, red_flags: redFlags, score_13: eval13.totalScore13,
            appearance_score: pillars.appearance, attitude_score: pillars.attitude, skill_score: pillars.skill,
            score: eval13.hasRedFlag ? 0 : weighted, version: target.version,
          });
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '10px 12px', marginBottom: 12 }}>
          <Space size={8} wrap>
            <Radio.Group
              size="small" value={rubricBlock} buttonStyle="solid"
              onChange={(e) => {
                const nextBlock = e.target.value as InterviewRubricBlock, defaults = buildDefaultRubricScores(nextBlock);
                setRubricBlock(nextBlock); setRubricScores(defaults); applyRubricSync(nextBlock, defaults, redFlags);
              }}
            >
              <Radio.Button value="STORE"><ShopOutlined /> {INTERVIEW_RUBRIC_BLOCK_LABELS.STORE}</Radio.Button>
              <Radio.Button value="OFFICE"><BankOutlined /> {INTERVIEW_RUBRIC_BLOCK_LABELS.OFFICE}</Radio.Button>
            </Radio.Group>
            <Form.Item name="experience_track" noStyle>
              <Radio.Group size="small" buttonStyle="solid">
                <Radio.Button value="INEXPERIENCED"><UserOutlined /> Chưa có kinh nghiệm</Radio.Button>
                <Radio.Button value="EXPERIENCED"><SolutionOutlined /> Đã có kinh nghiệm</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Space>
          <Space size={6} wrap>
            <Tag color={eval13.passed ? 'success' : 'error'} icon={<CheckCircleOutlined />} style={{ margin: 0, fontWeight: 700, fontSize: 13, padding: '2px 10px' }}>
              Tổng điểm: {eval13.totalScore13}/{INTERVIEW_RUBRIC_13_MAX}đ (Chuẩn đạt: {INTERVIEW_RUBRIC_13_PASS_THRESHOLD}/13đ)
            </Tag>
            <Tag color="blue" style={{ margin: 0, fontWeight: 600 }}>Quy đổi: {eval13.normalizedScore100}/100đ</Tag>
          </Space>
        </div>

        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          {groups.map((grp) => (
            <Col xs={24} md={8} key={grp.title}>
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF', height: '100%' }}>
                <div style={{ padding: '8px 12px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: 12, color: '#0F172A' }}>{grp.title}</div>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {grp.items.map((c) => (
                    <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#334155', lineHeight: 1.35 }}>{c.label} <span style={{ color: '#94A3B8' }}>(/{c.maxPoints}đ)</span></span>
                      <InputNumber
                        size="small" min={0} max={c.maxPoints} step={0.5} value={rubricScores[c.key] ?? c.maxPoints}
                        onChange={(val) => {
                          const next = { ...rubricScores, [c.key]: Number(val ?? 0) };
                          setRubricScores(next); applyRubricSync(rubricBlock, next, redFlags);
                        }}
                        style={{ width: 64, flexShrink: 0 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </Col>
          ))}
        </Row>

        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, padding: '8px 12px', marginBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600, color: '#DC2626', fontSize: 12 }}><FlagOutlined /> Loại trực tiếp (nếu vi phạm):</span>
          <Checkbox.Group
            value={redFlags} options={INTERVIEW_RED_FLAGS.map((rf) => ({ label: rf.label, value: rf.key }))}
            onChange={(vals) => { const nextFlags = vals.map(String); setRedFlags(nextFlags); applyRubricSync(rubricBlock, rubricScores, nextFlags); }}
          />
        </div>
        {eval13.hasRedFlag && <Alert style={{ marginBottom: 12 }} type="error" showIcon message="Ứng viên vi phạm tiêu chí Loại trực tiếp — Kết quả tự động chuyển sang Không đạt (Từ chối)." />}

        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="decision" label="Quyết định tuyển dụng của HR" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
              <Select disabled={eval13.hasRedFlag} options={[{ value: 'PASS', label: 'Đạt phỏng vấn — Mời thử việc' }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Không đạt / Chưa phù hợp' }]} />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="comment" label="Nhận xét đánh giá của HR" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá phỏng vấn' }]} style={{ marginBottom: 0 }}>
              <Input.TextArea rows={2} placeholder="Ghi nhận thái độ, kỹ năng thực hành và mức độ phù hợp khung ca..." />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
