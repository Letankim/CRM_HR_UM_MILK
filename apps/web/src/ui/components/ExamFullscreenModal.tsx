'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, App, Button, Card, Col, Progress, Radio, Row, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, CloseOutlined, ExpandOutlined, LockOutlined, SendOutlined, WarningOutlined } from '@ant-design/icons';
import { api, ApiClientError } from '@/lib/api';
import { BRAND } from '../theme';

export interface SafeExamQuestion { id: string; q?: string; question?: string; options?: string[] }

interface Props {
  attempt: Record<string, unknown> | null;
  testRecord: Record<string, unknown> | null;
  onClose: () => void;
  onSubmitted: (result: Record<string, unknown>) => void;
}

export function ExamFullscreenModal({ attempt, testRecord, onClose, onSubmitted }: Props) {
  const { message, modal } = App.useApp();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [remSec, setRemSec] = useState(900);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const autoSubmittedRef = useRef(false);

  const questions: SafeExamQuestion[] = (() => {
    if (Array.isArray(attempt?.questions) && attempt.questions.length > 0) return attempt.questions as SafeExamQuestion[];
    try { const parsed = JSON.parse(String(testRecord?.questions_json || '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  })();

  const requestBrowserFullscreen = useCallback(async () => {
    try {
      if (typeof document !== 'undefined' && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      setIsFullscreen(true);
    } catch {
      setIsFullscreen(Boolean(typeof document !== 'undefined' && document.fullscreenElement));
    }
  }, []);

  const exitBrowserFullscreen = useCallback(async () => {
    try {
      if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    } catch { /* ignore */ }
  }, []);

  const doSubmit = useCallback(async (isAuto = false) => {
    if (!attempt || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.post<Record<string, unknown>>(`/tests/attempts/${attempt.id}/submit`, { answers, version: Number(attempt.version ?? 1) });
      await exitBrowserFullscreen();
      message.success(isAuto ? `Hết giờ làm bài! Hệ thống tự động thu bài — Điểm: ${res.score_percent ?? 0}%` : `Nộp bài thành công! Điểm số: ${res.score_percent ?? 0}% (${res.passed ? 'ĐẠT' : 'CHƯA ĐẠT'})`);
      onClose();
      onSubmitted(res);
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Không thể nộp bài kiểm tra');
    } finally {
      setSubmitting(false);
    }
  }, [attempt, answers, submitting, exitBrowserFullscreen, message, onClose, onSubmitted]);

  useEffect(() => {
    if (!attempt) return;
    setAnswers({});
    autoSubmittedRef.current = false;
    void requestBrowserFullscreen();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12' || e.key === 'Escape' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) || (e.ctrlKey && ['U', 'P', 'S'].includes(e.key.toUpperCase()))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = 'Bạn đang trong thời gian làm bài kiểm tra!'; };

    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [attempt, requestBrowserFullscreen]);

  useEffect(() => {
    if (!attempt) return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(String(attempt.expires_at)).getTime() - Date.now()) / 1000));
      setRemSec(left);
      if (left <= 0 && !autoSubmittedRef.current) { autoSubmittedRef.current = true; void doSubmit(true); }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [attempt, doSubmit]);

  if (!attempt || typeof document === 'undefined') return null;

  const answeredCount = Object.keys(answers).length;
  const totalQ = questions.length;
  const progressPercent = totalQ > 0 ? Math.round((answeredCount / totalQ) * 100) : 100;
  const passPercent = Number(attempt.passPercent ?? testRecord?.pass_percent ?? 80);

  const handleConfirmSubmit = () => {
    const unanswered = totalQ - answeredCount;
    if (unanswered > 0) {
      modal.confirm({
        title: `Bạn còn ${unanswered}/${totalQ} câu hỏi chưa chọn đáp án`,
        content: 'Bạn có chắc chắn muốn nộp bài và kết thúc lượt thi ngay bây giờ không?',
        okText: 'Xác nhận nộp bài', cancelText: 'Tiếp tục làm bài', okButtonProps: { icon: <SendOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> },
        onOk: () => doSubmit(false),
      });
      return;
    }
    void doSubmit(false);
  };

  return createPortal(
    <div onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 9999, background: '#F8FAFC', display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none' }}>
      <div style={{ background: '#0F172A', color: '#FFFFFF', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid #1E293B' }}>
        <Space size={10} wrap>
          <Tag color="blue" icon={<LockOutlined />} style={{ margin: 0, fontWeight: 700, padding: '2px 8px' }}>PHÒNG THI TOÀN MÀN HÌNH</Tag>
          <Typography.Text style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 16 }}>{String(attempt.testTitle ?? testRecord?.title ?? 'Đề kiểm tra nghiệp vụ')}</Typography.Text>
          <Tag color="geekblue" style={{ margin: 0 }}>Lượt thi #{String(attempt.attempt_no ?? 1)}</Tag>
        </Space>
        <Space size={12} wrap>
          {!isFullscreen && <Button size="small" type="dashed" ghost icon={<ExpandOutlined />} onClick={() => void requestBrowserFullscreen()}>Bật lại Toàn màn hình</Button>}
          <div style={{ background: remSec < 60 ? '#7F1D1D' : '#1E293B', border: `1px solid ${remSec < 60 ? '#EF4444' : '#334155'}`, borderRadius: 4, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClockCircleOutlined style={{ color: remSec < 60 ? '#FCA5A5' : '#60A5FA' }} />
            <span className="num" style={{ fontWeight: 700, fontSize: 16, color: remSec < 60 ? '#FECACA' : '#FFFFFF' }}>{String(Math.floor(remSec / 60)).padStart(2, '0')}:{String(remSec % 60).padStart(2, '0')}</span>
          </div>
          <Button type="primary" size="middle" icon={<SendOutlined />} loading={submitting} onClick={handleConfirmSubmit}>Nộp bài &amp; Chấm điểm</Button>
        </Space>
      </div>

      {!isFullscreen && (
        <Alert type="warning" banner showIcon icon={<WarningOutlined />} message="Chế độ bảo vệ bài thi đang hoạt động: Mọi thao tác bên ngoài đã bị khóa cho đến khi bạn nộp bài." action={<Button size="small" type="primary" icon={<ExpandOutlined />} onClick={() => void requestBrowserFullscreen()}>Phóng to Fullscreen</Button>} />
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <Row gutter={[20, 20]} style={{ maxWidth: 1360, margin: '0 auto' }}>
          <Col xs={24} lg={17}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              {questions.map((q, idx) => {
                const selectedVal = answers[q.id];
                return (
                  <Card key={q.id} id={`exam-q-${idx}`} size="small" title={<div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, whiteSpace: 'normal', padding: '2px 0' }}><Tag color={selectedVal !== undefined ? 'blue' : 'default'} style={{ margin: '2px 0 0 0', flexShrink: 0 }}>Câu {idx + 1}/{totalQ}</Tag><span style={{ fontWeight: 600, lineHeight: 1.45, color: BRAND.text }}>{q.q ?? q.question ?? 'Câu hỏi nghiệp vụ'}</span></div>} style={{ borderColor: selectedVal !== undefined ? '#93C5FD' : BRAND.border }}>
                    <Radio.Group value={selectedVal} onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: String(e.target.value) }))} style={{ width: '100%' }}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        {(q.options ?? []).map((opt, optIdx) => {
                          const active = selectedVal === String(optIdx);
                          return (
                            <div key={optIdx} onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: String(optIdx) }))} style={{ padding: '10px 12px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${active ? BRAND.primary : '#E5E7EB'}`, background: active ? '#EFF6FF' : '#FFFFFF' }}>
                              <Radio value={String(optIdx)} style={{ fontWeight: active ? 600 : 400 }}>{String.fromCharCode(65 + optIdx)}. {opt}</Radio>
                            </div>
                          );
                        })}
                      </Space>
                    </Radio.Group>
                  </Card>
                );
              })}
            </Space>
          </Col>
          <Col xs={24} lg={7}>
            <Card size="small" title="Tiến độ & Danh sách câu hỏi" style={{ position: 'sticky', top: 0 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}><span>Đã trả lời: <strong>{answeredCount}/{totalQ} câu</strong></span><span>Điểm chuẩn đạt: <strong>{passPercent}%</strong></span></div>
                <Progress percent={progressPercent} size="small" strokeColor={BRAND.primary} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
                {questions.map((q, idx) => <Button key={q.id} size="small" type={answers[q.id] !== undefined ? 'primary' : 'default'} onClick={() => document.getElementById(`exam-q-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} style={{ fontWeight: 600 }}>{idx + 1}</Button>)}
              </div>
              <Alert type="info" showIcon style={{ marginBottom: 12, fontSize: 12 }} message="Chế độ thi nghiêm túc: Không thể chuyển sang trang khác hoặc đóng bài thi khi chưa nộp bài. Hệ thống tự động thu bài khi hết giờ." />
              <Button type="primary" block size="large" icon={<SendOutlined />} loading={submitting} onClick={handleConfirmSubmit}>Nộp bài &amp; Kết thúc thi ({answeredCount}/{totalQ})</Button>
            </Card>
          </Col>
        </Row>
      </div>
    </div>,
    document.body,
  );
}
