'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, Col, Form, Input, Modal, Radio, Row, Select, Space, Tag } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, ExclamationCircleOutlined,
  FlagOutlined, SaveOutlined, SolutionOutlined, TrophyOutlined, UserAddOutlined, UserOutlined,
} from '@ant-design/icons';
import {
  computeInterviewWeightedScore, evaluateInterviewRubric13, inferCandidateExperienceTrack,
  INTERVIEW_RED_FLAGS, INTERVIEW_RUBRIC_13_MAX, INTERVIEW_RUBRIC_13_PASS_THRESHOLD,
  INTERVIEW_RUBRICS, OFFICE_RUBRIC_CRITERIA_13, STORE_RUBRIC_CRITERIA_13,
  type InterviewExperienceTrack, type InterviewRubricBlock,
} from '@umbm/shared';
import { applyApiFormErrors, clearChangedFieldErrors } from '@/lib/form-error';
import { FireworksCanvasOverlay } from './FireworksCanvasOverlay';

interface InterviewEvaluateModalProps {
  target: Record<string, unknown> | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (id: string, body: Record<string, unknown>, onError?: (e: unknown) => void) => void;
}

const DEFAULT_COMMENTS = new Set([
  INTERVIEW_RUBRICS.INEXPERIENCED.defaultComment, INTERVIEW_RUBRICS.EXPERIENCED.defaultComment,
  'Thái độ tích cực, phù hợp khung ca đăng ký tại cửa hàng',
  'Loại trực tiếp do vi phạm tiêu chí bắt buộc trong buổi phỏng vấn', '',
]);

function buildDefaultRubricScores(block: InterviewRubricBlock): Record<string, number> {
  const list = block === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  return Object.fromEntries(list.map((c, idx) => [c.key, block === 'STORE' && idx === 4 ? 0 : c.maxPoints]));
}

function derivePillarScores100(block: InterviewRubricBlock, scores: Record<string, number>) {
  const list = block === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  const ratio = (cat: 'appearance' | 'attitude' | 'skill') => {
    const arr = list.filter((c) => c.category === cat);
    const max = arr.reduce((s, c) => s + c.maxPoints, 0) || 1;
    const cur = arr.reduce((s, c) => s + Math.min(c.maxPoints, Math.max(0, Number(scores[c.key] ?? 0))), 0);
    return Math.round((cur / max) * 100);
  };
  return { appearance: ratio('appearance'), attitude: ratio('attitude'), skill: ratio('skill') };
}

export function InterviewEvaluateModal({ target, loading, onClose, onSubmit }: InterviewEvaluateModalProps) {
  const [form] = Form.useForm();
  const [rubricBlock, setRubricBlock] = useState<InterviewRubricBlock>('STORE');
  const [rubricScores, setRubricScores] = useState<Record<string, number>>(() => buildDefaultRubricScores('STORE'));
  const [redFlags, setRedFlags] = useState<string[]>([]);
  const [showFireworks, setShowFireworks] = useState(false);

  const criteria13 = rubricBlock === 'OFFICE' ? OFFICE_RUBRIC_CRITERIA_13 : STORE_RUBRIC_CRITERIA_13;
  const eval13 = useMemo(() => evaluateInterviewRubric13(rubricBlock, rubricScores, redFlags), [rubricBlock, rubricScores, redFlags]);
  const isScored = Boolean(target?.decision && target.decision !== 'PENDING'), hasEmp = Boolean(target?.onboardedEmployeeCode);
  const triggerFireworks = () => { setShowFireworks(true); window.setTimeout(() => setShowFireworks(false), 2500); };

  useEffect(() => {
    if (!target) { setShowFireworks(false); return; }
    const hasPrev = Boolean(target.decision && target.decision !== 'PENDING');
    const inferredTrack: InterviewExperienceTrack = target.experience_track === 'EXPERIENCED' || target.experience_track === 'INEXPERIENCED'
      ? target.experience_track : inferCandidateExperienceTrack(String(target.candidateExperienceNote || ''));
    const initBlock: InterviewRubricBlock = hasPrev && (target.rubric_block === 'OFFICE' || target.rubric_block === 'STORE')
      ? target.rubric_block : (inferredTrack === 'INEXPERIENCED' ? 'OFFICE' : 'STORE');
    let parsedScores = buildDefaultRubricScores(initBlock), parsedFlags: string[] = [];
    if (typeof target.rubric_details_json === 'string' && target.rubric_details_json.startsWith('{')) {
      try {
        const parsed = JSON.parse(target.rubric_details_json) as { scores?: Record<string, number>; redFlags?: string[] };
        if (parsed.scores && Object.keys(parsed.scores).length > 0) parsedScores = parsed.scores;
        if (Array.isArray(parsed.redFlags)) parsedFlags = parsed.redFlags;
      } catch { /* ignore */ }
    }
    setRubricBlock(initBlock); setRubricScores(parsedScores); setRedFlags(parsedFlags);
    const initEval = evaluateInterviewRubric13(initBlock, parsedScores, parsedFlags);
    const pillars = derivePillarScores100(initBlock, parsedScores);
    form.setFieldsValue({
      experience_track: initBlock === 'OFFICE' ? 'INEXPERIENCED' : 'EXPERIENCED',
      appearance_score: hasPrev ? Number(target.appearance_score ?? pillars.appearance) : pillars.appearance,
      attitude_score: hasPrev ? Number(target.attitude_score ?? pillars.attitude) : pillars.attitude,
      skill_score: hasPrev ? Number(target.skill_score ?? pillars.skill) : pillars.skill,
      decision: initEval.hasRedFlag ? 'FAIL' : (hasPrev && target.decision ? target.decision : initEval.recommendedDecision),
      comment: String(target.comment || '').trim() || INTERVIEW_RUBRICS[initBlock === 'OFFICE' ? 'INEXPERIENCED' : 'EXPERIENCED'].defaultComment,
    });
  }, [target, form]);

  const applyRubricSync = (nextBlock: InterviewRubricBlock, nextScores: Record<string, number>, nextFlags: string[]) => {
    const res = evaluateInterviewRubric13(nextBlock, nextScores, nextFlags);
    const pillars = derivePillarScores100(nextBlock, nextScores);
    const nextTrack: InterviewExperienceTrack = nextBlock === 'OFFICE' ? 'INEXPERIENCED' : 'EXPERIENCED';
    const curComment = String(form.getFieldValue('comment') || '').trim();
    form.setFieldsValue({
      experience_track: nextTrack, appearance_score: pillars.appearance, attitude_score: pillars.attitude, skill_score: pillars.skill,
      decision: res.recommendedDecision,
      ...(res.hasRedFlag ? { comment: 'Loại trực tiếp do vi phạm tiêu chí bắt buộc trong buổi phỏng vấn' }
        : DEFAULT_COMMENTS.has(curComment) ? { comment: INTERVIEW_RUBRICS[nextTrack].defaultComment } : {}),
    });
  };

  return (
    <>
      <FireworksCanvasOverlay active={showFireworks} />
      <Modal
        width={980} style={{ maxWidth: 'calc(100vw - 24px)', top: 16 }} open={Boolean(target)} forceRender destroyOnHidden
        title={<Space size={8} wrap><span>{isScored ? 'Cập nhật điểm phỏng vấn:' : 'Phiếu chấm điểm phỏng vấn:'} <strong>{String(target?.candidateName ?? '')}</strong></span>{Boolean(target?.candidateCode) && <Tag color="geekblue" style={{ margin: 0 }}>{String(target?.candidateCode)}</Tag>}</Space>}
        okText={isScored ? (eval13.passed && !hasEmp ? 'Lưu & Khởi tạo Nhân sự' : 'Lưu điểm phỏng vấn') : (eval13.passed ? 'Duyệt ĐẠT & Khởi tạo Nhân sự' : 'Lưu kết quả phỏng vấn')} cancelText="Hủy bỏ"
        okButtonProps={{ icon: eval13.passed && !hasEmp ? <UserAddOutlined /> : <SaveOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
        onCancel={onClose} onOk={() => form.submit()}
      >
        <Form
          form={form} layout="vertical"
          onValuesChange={(changed) => clearChangedFieldErrors(form, changed)}
          onFinish={(v) => {
            if (!target) return;
            const track: InterviewExperienceTrack = rubricBlock === 'OFFICE' ? 'INEXPERIENCED' : 'EXPERIENCED';
            const pillars = derivePillarScores100(rubricBlock, rubricScores);
            const weighted = computeInterviewWeightedScore(track, pillars.appearance, pillars.attitude, pillars.skill);
            const finalDecision = eval13.hasRedFlag ? 'FAIL' : (!eval13.passed && v.decision === 'PASS' ? eval13.recommendedDecision : v.decision);
            onSubmit(String(target.id), {
              ...v, decision: finalDecision, experience_track: track, rubric_block: rubricBlock, rubric_scores: rubricScores,
              red_flags: redFlags, score_13: eval13.totalScore13, appearance_score: pillars.appearance,
              attitude_score: pillars.attitude, skill_score: pillars.skill, score: eval13.hasRedFlag ? 0 : weighted, version: target.version,
            }, (e) => applyApiFormErrors(form, e));
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px', marginBottom: 10 }}>
            <Radio.Group
              size="small" value={rubricBlock} buttonStyle="solid"
              onChange={(e) => {
                const nextBlock = e.target.value as InterviewRubricBlock, defaults = buildDefaultRubricScores(nextBlock);
                setRubricBlock(nextBlock); setRubricScores(defaults); applyRubricSync(nextBlock, defaults, redFlags);
              }}
            >
              <Radio.Button value="STORE"><SolutionOutlined /> Đã có kinh nghiệm (9 câu hỏi — Thang 13 điểm)</Radio.Button>
              <Radio.Button value="OFFICE"><UserOutlined /> Chưa có kinh nghiệm (7 câu hỏi — Thang 13 điểm)</Radio.Button>
            </Radio.Group>
            <Space size={6} wrap>
              <Tag color={eval13.hasRedFlag ? 'error' : eval13.passed ? 'success' : eval13.isConsider ? 'warning' : 'error'} icon={eval13.passed ? <CheckCircleOutlined /> : eval13.isConsider ? <ExclamationCircleOutlined /> : <CloseCircleOutlined />} style={{ margin: 0, fontWeight: 700, fontSize: 13, padding: '3px 10px' }}>
                Tổng điểm: {eval13.totalScore13}/{INTERVIEW_RUBRIC_13_MAX}đ · {eval13.hasRedFlag ? 'LOẠI TRỰC TIẾP' : eval13.passed ? `PASS (>= ${INTERVIEW_RUBRIC_13_PASS_THRESHOLD}đ)` : eval13.isConsider ? 'CÂN NHẮC ĐẬU (10, 11đ)' : 'FAIL (Dưới 10đ)'}
              </Tag>
              {eval13.isPerfect13 && <Tag color="gold" icon={<TrophyOutlined />} onClick={triggerFireworks} style={{ margin: 0, fontWeight: 600, fontSize: 12, padding: '3px 8px', cursor: 'pointer' }}>Xuất sắc 13/13</Tag>}
            </Space>
          </div>

          <div style={{ border: '1px solid #CBD5E1', borderRadius: 4, maxHeight: 420, overflowY: 'auto', marginBottom: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#FDE68A', color: '#0F172A', fontWeight: 700, textAlign: 'center', position: 'sticky', top: 0, zIndex: 2 }}>
                  <th style={{ width: 42, padding: '7px 6px', borderRight: '1px solid #CBD5E1', borderBottom: '1px solid #CBD5E1' }}>STT</th>
                  <th style={{ width: '36%', padding: '7px 10px', borderRight: '1px solid #CBD5E1', borderBottom: '1px solid #CBD5E1', textAlign: 'left' }}>Câu hỏi</th>
                  <th style={{ padding: '7px 10px', borderRight: '1px solid #CBD5E1', borderBottom: '1px solid #CBD5E1', textAlign: 'left' }}>Hướng trả lời (Tích chọn)</th>
                  <th style={{ width: 92, padding: '7px 6px', borderRight: '1px solid #CBD5E1', borderBottom: '1px solid #CBD5E1' }}>Thang điểm</th>
                  <th style={{ width: 78, padding: '7px 6px', borderBottom: '1px solid #CBD5E1' }}>Điểm đạt</th>
                </tr>
              </thead>
              <tbody>
                {criteria13.map((c) => {
                  const curVal = Number(rubricScores[c.key] ?? 0);
                  return c.options.map((opt, idx) => {
                    const active = curVal === opt.points;
                    return (
                      <tr
                        key={`${c.key}_${idx}`}
                        onClick={() => { const next = { ...rubricScores, [c.key]: opt.points }; setRubricScores(next); applyRubricSync(rubricBlock, next, redFlags); }}
                        style={{ borderTop: idx === 0 ? '1px solid #CBD5E1' : '1px dashed #E2E8F0', background: active ? (opt.isReject ? '#FEF08A' : '#EFF6FF') : (opt.isReject ? '#FEFCE8' : '#FFFFFF'), cursor: 'pointer' }}
                      >
                        {idx === 0 && <td rowSpan={c.options.length} style={{ textAlign: 'center', fontWeight: 700, borderRight: '1px solid #CBD5E1', padding: '6px', background: '#F8FAFC' }}>{c.stt}</td>}
                        {idx === 0 && (
                          <td rowSpan={c.options.length} style={{ padding: '7px 10px', borderRight: '1px solid #CBD5E1', fontWeight: 600, color: '#0F172A', background: '#FFFFFF' }}>
                            <div>{c.question}</div>
                            {c.conditionNote && <div style={{ color: '#DC2626', fontWeight: 700, fontSize: 11.5, marginTop: 4 }}>{c.conditionNote}</div>}
                          </td>
                        )}
                        <td style={{ padding: '5px 10px', borderRight: '1px solid #CBD5E1', fontWeight: active ? 700 : 400, color: opt.isReject ? '#B91C1C' : '#1E293B' }}>
                          <Space size={6}><input type="radio" checked={active} readOnly style={{ accentColor: opt.isReject ? '#DC2626' : '#2563EB', cursor: 'pointer' }} /><span>{opt.label}</span></Space>
                        </td>
                        <td style={{ textAlign: 'center', padding: '5px 6px', borderRight: '1px solid #CBD5E1', fontWeight: 700, color: opt.isReject ? '#B91C1C' : '#0F172A', background: opt.isReject ? '#FDE047' : 'transparent' }}>
                          {opt.isReject ? (opt.rejectLabel || 'LOẠI') : opt.points}
                        </td>
                        {idx === 0 && (
                          <td rowSpan={c.options.length} style={{ textAlign: 'center', fontWeight: 700, padding: '6px', background: curVal < 0 ? '#FEE2E2' : '#F8FAFC', color: curVal < 0 ? '#DC2626' : '#2563EB', fontSize: 13 }}>
                            {curVal < 0 ? 'LOẠI' : `${curVal}đ`}
                          </td>
                        )}
                      </tr>
                    );
                  });
                })}
                <tr style={{ borderTop: '2px solid #94A3B8', background: '#FED7AA', fontWeight: 700 }}><td colSpan={3} style={{ padding: '5px 12px', textAlign: 'center', borderRight: '1px solid #CBD5E1' }}>MAXIMUM</td><td style={{ textAlign: 'center', borderRight: '1px solid #CBD5E1' }}>13</td><td rowSpan={4} style={{ textAlign: 'center', fontSize: 14, background: '#FFFFFF', color: eval13.hasRedFlag ? '#DC2626' : eval13.passed ? '#16A34A' : eval13.isConsider ? '#D97706' : '#DC2626' }}>{eval13.hasRedFlag ? 'LOẠI' : `${eval13.totalScore13}/13đ`}</td></tr>
                <tr style={{ borderTop: '1px solid #CBD5E1', background: '#F8FAFC', fontWeight: 700 }}><td colSpan={3} style={{ padding: '4px 12px', textAlign: 'center', borderRight: '1px solid #CBD5E1', color: '#15803D' }}>PASS (ĐẠT)</td><td style={{ textAlign: 'center', borderRight: '1px solid #CBD5E1', color: '#15803D' }}>12</td></tr>
                <tr style={{ borderTop: '1px solid #CBD5E1', background: '#FEF08A', fontWeight: 700 }}><td colSpan={3} style={{ padding: '4px 12px', textAlign: 'center', borderRight: '1px solid #CBD5E1', color: '#B45309' }}>CÂN NHẮC ĐẬU</td><td style={{ textAlign: 'center', borderRight: '1px solid #CBD5E1', color: '#B45309' }}>10 , 11</td></tr>
                <tr style={{ borderTop: '1px solid #CBD5E1', background: '#F8FAFC', fontWeight: 700 }}><td colSpan={3} style={{ padding: '4px 12px', textAlign: 'center', borderRight: '1px solid #CBD5E1', color: '#DC2626' }}>FAIL (LOẠI)</td><td style={{ textAlign: 'center', borderRight: '1px solid #CBD5E1', color: '#DC2626' }}>Dưới 10</td></tr>
              </tbody>
            </table>
          </div>

          <div style={{ background: redFlags.length > 0 ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${redFlags.length > 0 ? '#FECACA' : '#FDE68A'}`, borderRadius: 4, padding: '6px 12px', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, color: '#DC2626', fontSize: 12, marginBottom: 4 }}><FlagOutlined /> Cảnh báo Loại trực tiếp bổ sung (Nếu phát sinh ngoài bảng câu hỏi):</div>
            <Checkbox.Group value={redFlags} style={{ width: '100%' }} onChange={(vals) => { const nextFlags = vals.map(String); setRedFlags(nextFlags); applyRubricSync(rubricBlock, rubricScores, nextFlags); }}>
              <Row gutter={[12, 4]}>{INTERVIEW_RED_FLAGS.map((rf) => <Col xs={24} md={8} key={rf.key}><Checkbox value={rf.key} style={{ fontSize: 11.5 }}>{rf.label}</Checkbox></Col>)}</Row>
            </Checkbox.Group>
          </div>

          <Alert style={{ marginBottom: 10, padding: '6px 12px' }} showIcon type={eval13.hasRedFlag ? 'error' : eval13.passed ? 'success' : eval13.isConsider ? 'warning' : 'error'} message={eval13.hasRedFlag ? 'Ứng viên bị LOẠI TRỰC TIẾP do rơi vào phương án LOẠI / LOẠI THẲNG trong bảng câu hỏi phỏng vấn.' : eval13.passed ? 'Đủ điều kiện PASS (>= 12/13 điểm): Khi xác nhận duyệt, hệ thống tự động tạo hồ sơ nhân sự, kích hoạt tài khoản và bắt đầu thử việc 12 ngày.' : eval13.isConsider ? `Điểm hiện tại (${eval13.totalScore13}/13đ) thuộc diện CÂN NHẮC ĐẬU (10, 11 điểm).` : `Điểm hiện tại (${eval13.totalScore13}/13đ) dưới 10 điểm — thuộc diện FAIL (Không đạt).`} />

          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="decision" label="Quyết định phê duyệt của HR" rules={[{ required: true }]} style={{ marginBottom: 0 }}><Select disabled={eval13.hasRedFlag} options={[{ value: 'PASS', label: eval13.passed ? 'PASS (Đạt >= 12/13đ) — Khởi tạo NV' : 'PASS (Yêu cầu >= 12/13đ)', disabled: !eval13.passed }, { value: 'HOLD', label: 'Cân nhắc đậu (10, 11 điểm)' }, { value: 'FAIL', label: 'FAIL — Không đạt (Dưới 10đ / Loại)' }]} /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="comment" label="NHẬN XÉT CỦA HR" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá phỏng vấn' }]} style={{ marginBottom: 0 }}><Input.TextArea rows={2} placeholder="Ghi nhận thái độ, câu trả lời thực tế và mức độ phù hợp..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
