'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Checkbox, Col, Form, Input, Modal, Radio, Row, Select, Space, Tag } from 'antd';
import {
  BankOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseOutlined,
  FlagOutlined, SaveOutlined, ShopOutlined, SolutionOutlined, TrophyOutlined, UserAddOutlined, UserOutlined,
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
  const [g1, g2, g3] = block === 'OFFICE' ? [list.slice(0, 3), list.slice(3, 5), list.slice(5, 7)] : [list.slice(0, 3), list.slice(3, 6), list.slice(6, 9)];
  return { appearance: ratio(g1), attitude: ratio(g2), skill: ratio(g3) };
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
    const initBlock: InterviewRubricBlock = target.rubric_block === 'OFFICE' ? 'OFFICE' : 'STORE';
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
      experience_track: inferredTrack,
      appearance_score: hasPrev ? Number(target.appearance_score ?? pillars.appearance) : pillars.appearance,
      attitude_score: hasPrev ? Number(target.attitude_score ?? pillars.attitude) : pillars.attitude,
      skill_score: hasPrev ? Number(target.skill_score ?? pillars.skill) : pillars.skill,
      decision: initEval.hasRedFlag ? 'FAIL' : (hasPrev && target.decision ? target.decision : initEval.autoDecision),
      comment: String(target.comment || '').trim() || INTERVIEW_RUBRICS[inferredTrack].defaultComment,
    });
  }, [target, form]);

  const applyRubricSync = (nextBlock: InterviewRubricBlock, nextScores: Record<string, number>, nextFlags: string[]) => {
    const res = evaluateInterviewRubric13(nextBlock, nextScores, nextFlags);
    const pillars = derivePillarScores100(nextBlock, nextScores);
    form.setFieldsValue({
      appearance_score: pillars.appearance, attitude_score: pillars.attitude, skill_score: pillars.skill,
      decision: res.hasRedFlag ? 'FAIL' : res.autoDecision,
      ...(res.hasRedFlag ? { comment: 'Loại trực tiếp do vi phạm tiêu chí bắt buộc trong buổi phỏng vấn' } : {}),
    });
  };

  const rawGroups = rubricBlock === 'OFFICE'
    ? [
        { title: '1. Tác phong & Giao tiếp', items: criteria13.slice(0, 3) },
        { title: '2. Trách nhiệm & Văn hóa', items: criteria13.slice(3, 5) },
        { title: '3. Chuyên môn & Công cụ số', items: criteria13.slice(5, 7) },
      ]
    : [
        { title: '1. Tác phong & Dịch vụ KH', items: criteria13.slice(0, 3) },
        { title: '2. Thái độ & Kỷ luật ca', items: criteria13.slice(3, 6) },
        { title: '3. Nghiệp vụ F&B & Vận hành', items: criteria13.slice(6, 9) },
      ];

  return (
    <>
      <FireworksCanvasOverlay active={showFireworks} />
      <Modal
        width={960} style={{ maxWidth: 'calc(100vw - 24px)', top: 20 }} open={Boolean(target)} forceRender destroyOnHidden
        title={<Space size={8} wrap><span>{isScored ? 'Cập nhật điểm phỏng vấn:' : 'Phiếu đánh giá phỏng vấn:'} <strong>{String(target?.candidateName ?? '')}</strong></span>{Boolean(target?.candidateCode) && <Tag color="geekblue" style={{ margin: 0 }}>{String(target?.candidateCode)}</Tag>}</Space>}
        okText={isScored ? (eval13.passed && !hasEmp ? 'Lưu & Khởi tạo Nhân sự' : 'Lưu điểm phỏng vấn') : (eval13.passed ? 'Duyệt ĐẠT & Khởi tạo Nhân sự' : 'Lưu kết quả phỏng vấn')} cancelText="Hủy bỏ"
        okButtonProps={{ icon: eval13.passed && !hasEmp ? <UserAddOutlined /> : <SaveOutlined />, loading }} cancelButtonProps={{ icon: <CloseOutlined /> }}
        onCancel={onClose} onOk={() => form.submit()}
      >
        <Form
          form={form} layout="vertical"
          onValuesChange={(changed, all) => {
            clearChangedFieldErrors(form, changed);
            const track = (all.experience_track as InterviewExperienceTrack) || 'INEXPERIENCED';
            if ('experience_track' in changed && DEFAULT_COMMENTS.has(String(all.comment || '').trim())) form.setFieldValue('comment', INTERVIEW_RUBRICS[track].defaultComment);
          }}
          onFinish={(v) => {
            if (!target) return;
            const track = (v.experience_track as InterviewExperienceTrack) || 'INEXPERIENCED';
            const pillars = derivePillarScores100(rubricBlock, rubricScores);
            const weighted = computeInterviewWeightedScore(track, pillars.appearance, pillars.attitude, pillars.skill);
            const finalDecision = eval13.hasRedFlag ? 'FAIL' : (!eval13.passed && v.decision === 'PASS' ? eval13.autoDecision : v.decision);
            onSubmit(String(target.id), {
              ...v, decision: finalDecision, experience_track: track, rubric_block: rubricBlock, rubric_scores: rubricScores,
              red_flags: redFlags, score_13: eval13.totalScore13, appearance_score: pillars.appearance,
              attitude_score: pillars.attitude, skill_score: pillars.skill, score: eval13.hasRedFlag ? 0 : weighted, version: target.version,
            }, (e) => { applyApiFormErrors(form, e); });
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>
            <Space size={8} wrap>
              <Radio.Group size="small" value={rubricBlock} buttonStyle="solid" onChange={(e) => { const nextBlock = e.target.value as InterviewRubricBlock, defaults = buildDefaultRubricScores(nextBlock); setRubricBlock(nextBlock); setRubricScores(defaults); applyRubricSync(nextBlock, defaults, redFlags); }}>
                <Radio.Button value="STORE"><ShopOutlined /> Khối Cửa hàng (9 tiêu chí)</Radio.Button>
                <Radio.Button value="OFFICE"><BankOutlined /> Khối Văn phòng (7 tiêu chí)</Radio.Button>
              </Radio.Group>
              <Form.Item name="experience_track" noStyle>
                <Radio.Group size="small" buttonStyle="solid">
                  <Radio.Button value="INEXPERIENCED"><UserOutlined /> Chưa có KN</Radio.Button>
                  <Radio.Button value="EXPERIENCED"><SolutionOutlined /> Đã có KN</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Space>
            <Space size={6} wrap>
              <Tag color={eval13.hasRedFlag ? 'error' : eval13.passed ? 'success' : 'warning'} icon={eval13.passed ? <CheckCircleOutlined /> : <CloseCircleOutlined />} style={{ margin: 0, fontWeight: 700, fontSize: 13, padding: '3px 10px' }}>
                Tổng điểm: {eval13.totalScore13}/{INTERVIEW_RUBRIC_13_MAX}đ (Chuẩn đạt: &gt;= {INTERVIEW_RUBRIC_13_PASS_THRESHOLD}/13đ)
              </Tag>
              {eval13.isPerfect13 && <Tag color="gold" icon={<TrophyOutlined />} onClick={triggerFireworks} style={{ margin: 0, fontWeight: 600, fontSize: 12, padding: '3px 8px', cursor: 'pointer' }}>Xuất sắc 13/13</Tag>}
            </Space>
          </div>

          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            {rawGroups.map((grp) => {
              const grpMax = grp.items.reduce((s, c) => s + c.maxPoints, 0), grpCur = grp.items.reduce((s, c) => s + Number(rubricScores[c.key] ?? c.maxPoints), 0);
              return (
                <Col xs={24} md={8} key={grp.title}>
                  <div style={{ border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFFFFF', height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '8px 12px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB', fontWeight: 600, fontSize: 12.5, color: '#0F172A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{grp.title}</span>
                      <Tag color={grpCur >= grpMax ? 'blue' : 'default'} className="num" style={{ margin: 0, fontWeight: 600 }}>{grpCur}/{grpMax}đ</Tag>
                    </div>
                    <div style={{ padding: '4px 12px', flex: 1 }}>
                      {grp.items.map((c, idx) => {
                        const curVal = Number(rubricScores[c.key] ?? c.maxPoints), steps = c.maxPoints === 1 ? [0, 0.5, 1] : [0, 0.5, 1, 1.5, 2];
                        return (
                          <div key={c.key} style={{ padding: '8px 0', borderBottom: idx < grp.items.length - 1 ? '1px dashed #E2E8F0' : 'none' }}>
                            <div style={{ fontSize: 12.5, color: '#1E293B', fontWeight: 500, lineHeight: 1.4, marginBottom: 6 }}>{c.label}</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: '#64748B' }}>Tối đa {c.maxPoints}đ</span>
                              <Space size={4}>
                                {steps.map((pt) => {
                                  const active = curVal === pt;
                                  return (
                                    <button key={pt} type="button" onClick={() => { const next = { ...rubricScores, [c.key]: pt }; setRubricScores(next); applyRubricSync(rubricBlock, next, redFlags); }} style={{ minWidth: 32, height: 24, padding: '0 6px', fontSize: 12, fontWeight: active ? 700 : 500, borderRadius: 4, cursor: 'pointer', border: active ? '1px solid #2563EB' : '1px solid #CBD5E1', background: active ? '#2563EB' : '#FFFFFF', color: active ? '#FFFFFF' : '#334155' }}>
                                      {pt}
                                    </button>
                                  );
                                })}
                              </Space>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>

          <div style={{ background: redFlags.length > 0 ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${redFlags.length > 0 ? '#FECACA' : '#FDE68A'}`, borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, color: '#DC2626', fontSize: 12, marginBottom: 6 }}><FlagOutlined /> Tiêu chuẩn loại trực tiếp (Tự động đánh giá Không đạt nếu vi phạm):</div>
            <Checkbox.Group value={redFlags} style={{ width: '100%' }} onChange={(vals) => { const nextFlags = vals.map(String); setRedFlags(nextFlags); applyRubricSync(rubricBlock, rubricScores, nextFlags); }}>
              <Row gutter={[12, 6]}>{INTERVIEW_RED_FLAGS.map((rf) => <Col xs={24} md={8} key={rf.key}><Checkbox value={rf.key} style={{ fontSize: 12, lineHeight: 1.35 }}>{rf.label}</Checkbox></Col>)}</Row>
            </Checkbox.Group>
          </div>

          <Alert style={{ marginBottom: 12, padding: '6px 12px' }} showIcon type={eval13.hasRedFlag ? 'error' : eval13.passed ? 'success' : 'warning'} message={eval13.hasRedFlag ? 'Ứng viên không đạt do vi phạm tiêu chuẩn loại trực tiếp.' : eval13.passed ? 'Đủ điều kiện ĐẠT: Khi xác nhận duyệt, hệ thống tự động tạo hồ sơ nhân sự, kích hoạt tài khoản và bắt đầu thử việc.' : `Tổng điểm hiện tại (${eval13.totalScore13}/13đ) chưa đạt ngưỡng yêu cầu (tối thiểu 12/13 điểm).`} />

          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="decision" label="Quyết định phê duyệt của HR" rules={[{ required: true }]} style={{ marginBottom: 0 }}><Select disabled={eval13.hasRedFlag} options={[{ value: 'PASS', label: eval13.passed ? 'Đạt phỏng vấn — Khởi tạo nhân sự' : 'Đạt phỏng vấn (Yêu cầu >= 12/13đ)', disabled: !eval13.passed }, { value: 'HOLD', label: 'Cân nhắc thêm' }, { value: 'FAIL', label: 'Không đạt / Từ chối' }]} /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="comment" label="Nhận xét đánh giá của HR" rules={[{ required: true, message: 'Vui lòng nhập nhận xét đánh giá phỏng vấn' }]} style={{ marginBottom: 0 }}><Input.TextArea rows={2} placeholder="Ghi nhận thái độ, kỹ năng thực hành và mức độ phù hợp khung ca..." /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
