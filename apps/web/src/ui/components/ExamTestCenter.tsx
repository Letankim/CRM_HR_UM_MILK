'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Descriptions, Empty, Modal, Row, Select, Space, Tabs, Tag, Typography } from 'antd';
import { BookOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, HistoryOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useClientPagination } from '../hooks/useClientPagination';
import { StatusTag } from '../StatusTag';
import { BRAND } from '../theme';
import { SelectableTable } from './BulkActionBar';
import { ExamFullscreenModal } from './ExamFullscreenModal';
import { useQuickDetail } from './RecordQuickDetailModal';
import { RowActionButtons } from './RowActionButtons';

export interface AttemptReviewItem {
  id: string; q: string; options: string[]; selectedAnswer: string; isCorrect: boolean; correctAnswer?: string;
}

export function formatDurationSec(sec: unknown): string {
  const s = Math.max(1, Number(sec || 0)), m = Math.floor(s / 60), rem = s % 60;
  return m > 0 ? `${m} phút ${String(rem).padStart(2, '0')} giây` : `${rem} giây`;
}

export function AttemptReviewModal({ attempt, onClose }: { attempt: Record<string, unknown> | null; onClose: () => void }) {
  const items: AttemptReviewItem[] = Array.isArray(attempt?.reviewItems) ? (attempt.reviewItems as AttemptReviewItem[]) : [];
  const passed = Boolean(attempt?.passed);

  return (
    <Modal
      open={Boolean(attempt)} width="90vw" style={{ top: 24, maxWidth: 1440 }} onCancel={onClose} destroyOnHidden
      title={attempt ? `Chi tiết Bài làm Lần #${attempt.attempt_no ?? 1} — ${attempt.testTitle ?? 'Đề kiểm tra'}` : 'Chi tiết bài làm'}
      footer={<Button type="primary" icon={<CloseOutlined />} onClick={onClose}>Đóng kết quả</Button>}
    >
      {attempt && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }}>
            <Descriptions.Item label="Bộ đề kiểm tra"><strong>{String(attempt.testTitle ?? '')}</strong> {attempt.testCode ? <Tag color="geekblue" style={{ marginLeft: 6 }}>{String(attempt.testCode)}</Tag> : null}</Descriptions.Item>
            <Descriptions.Item label="Nhân sự làm bài">{String(attempt.employeeName || 'Nhân sự')} {attempt.employeeCode ? `(${attempt.employeeCode})` : ''}</Descriptions.Item>
            <Descriptions.Item label="Lượt làm bài"><Tag color="blue" style={{ margin: 0 }}>Lần thi #{String(attempt.attempt_no ?? 1)}</Tag></Descriptions.Item>
            <Descriptions.Item label="Thời gian nộp bài">{attempt.submitted_at ? dayjs(String(attempt.submitted_at)).format('HH:mm:ss DD/MM/YYYY') : '—'}</Descriptions.Item>
            <Descriptions.Item label="Thời lượng làm bài">{formatDurationSec(attempt.duration_seconds)}</Descriptions.Item>
            <Descriptions.Item label="Điểm số & Kết quả">
              <Space size={6}>
                <strong>{String(attempt.correct_count ?? 0)}/{String(attempt.total_questions ?? items.length)} câu đúng</strong>
                <Tag color={passed ? 'green' : 'red'} style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{String(attempt.score_percent ?? 0)}%</Tag>
                <Tag color={passed ? 'success' : 'error'} icon={passed ? <CheckCircleOutlined /> : <CloseCircleOutlined />} style={{ margin: 0, fontWeight: 600 }}>{passed ? 'ĐẠT YÊU CẦU' : 'CHƯA ĐẠT'}</Tag>
              </Space>
            </Descriptions.Item>
          </Descriptions>
          <div style={{ fontWeight: 600, fontSize: 13, color: BRAND.text }}>Chi tiết từng câu hỏi trong lượt làm bài ({items.length} câu):</div>
          <div style={{ maxHeight: '62vh', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
            <Row gutter={[14, 14]}>
              {items.map((item, idx) => (
                <Col xs={24} lg={items.length > 1 ? 12 : 24} key={item.id}>
                  <Card
                    size="small" style={{ borderColor: item.isCorrect ? '#BBF7D0' : '#FECACA', height: '100%' }}
                    title={<div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, whiteSpace: 'normal', padding: '2px 0' }}><Tag color={item.isCorrect ? 'green' : 'red'} style={{ margin: '2px 0 0 0', flexShrink: 0 }}>Câu {idx + 1}</Tag><span style={{ fontWeight: 600, lineHeight: 1.45, color: BRAND.text }}>{item.q}</span></div>}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      {item.options.map((opt, optIdx) => {
                        const isSelected = item.selectedAnswer === String(optIdx);
                        const isCorrectOpt = item.correctAnswer !== undefined && item.correctAnswer === String(optIdx);
                        return (
                          <div
                            key={optIdx}
                            style={{
                              padding: '7px 10px', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                              border: `1px solid ${isCorrectOpt ? '#16A34A' : isSelected ? '#DC2626' : '#E5E7EB'}`,
                              background: isCorrectOpt ? '#F0FDF4' : isSelected && !item.isCorrect ? '#FEF2F2' : '#FFFFFF',
                            }}
                          >
                            <span style={{ fontWeight: isSelected || isCorrectOpt ? 600 : 400 }}>{String.fromCharCode(65 + optIdx)}. {opt}</span>
                            <Space size={4} style={{ flexShrink: 0 }}>
                              {isSelected && <Tag color={item.isCorrect ? 'green' : 'volcano'} style={{ margin: 0 }}>Bạn đã chọn</Tag>}
                              {isCorrectOpt && <Tag color="green" style={{ margin: 0 }}>Đáp án đúng</Tag>}
                            </Space>
                          </div>
                        );
                      })}
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        </Space>
      )}
    </Modal>
  );
}

export function AttemptHistoryTable({
  attempts, showEmployee = false, canDelete = false, onViewAttempt, onDeleteAttempt,
}: {
  attempts: Record<string, unknown>[]; showEmployee?: boolean; canDelete?: boolean;
  onViewAttempt: (att: Record<string, unknown>) => void; onDeleteAttempt?: (att: Record<string, unknown>) => void;
}) {
  const attPag = useClientPagination(10, 'lượt thi');
  return (
    <SelectableTable<Record<string, unknown>>
      size="small" rowKey="id" pagination={attPag} dataSource={attempts} onRowClick={onViewAttempt}
      bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportToExcel({ fileName: 'Lich_su_lam_bai_TEST.xls', sheetTitle: 'Lịch sử các lượt làm bài kiểm tra (TEST)', rows, columns: [{ header: 'Lượt thi', key: 'attempt_no', align: 'right' }, { header: 'Nhân sự', key: 'employeeName' }, { header: 'Bộ đề', key: 'testTitle' }, { header: 'Thời gian nộp', key: 'submitted_at' }, { header: 'Điểm (%)', key: 'score_percent', align: 'right' }] }) }]}
      locale={{ emptyText: 'Chưa có lịch sử lượt làm bài nào được ghi nhận.' }}
      columns={[
        { title: 'Lượt thi', dataIndex: 'attempt_no', width: 95, render: (v: number) => <Tag color="blue" style={{ margin: 0 }}>Lần #{v ?? 1}</Tag> },
        ...(showEmployee ? [{ title: 'Nhân sự làm bài', dataIndex: 'employeeName', width: 165, ellipsis: true }] : []),
        { title: 'Bộ đề kiểm tra', dataIndex: 'testTitle', ellipsis: true },
        { title: 'Thời gian nộp bài', dataIndex: 'submitted_at', width: 148, render: (v: string) => <span className="num" style={{ fontSize: 12 }}>{v ? dayjs(v).format('HH:mm:ss DD/MM/YYYY') : '—'}</span> },
        { title: 'Thời lượng', dataIndex: 'duration_seconds', width: 115, render: (v: number) => <span style={{ fontSize: 12 }}>{formatDurationSec(v)}</span> },
        { title: 'Số câu đúng', width: 105, render: (_, r) => <strong>{`${r.correct_count ?? 0}/${r.total_questions ?? 0} câu`}</strong> },
        { title: 'Điểm & Kết quả', width: 155, render: (_, r) => <Space size={4}><Tag color={r.passed ? 'green' : 'red'} style={{ margin: 0, fontWeight: 700 }}>{`${r.score_percent ?? 0}%`}</Tag><Tag color={r.passed ? 'success' : 'default'} style={{ margin: 0 }}>{r.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}</Tag></Space> },
        {
          title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
          render: (_, r) => (
            <RowActionButtons
              detailTooltip="Xem chi tiết bài làm" onViewDetail={() => onViewAttempt(r)}
              menuItems={canDelete && onDeleteAttempt ? [{ key: 'view', icon: <EyeOutlined />, label: 'Xem chi tiết bài làm', onClick: () => onViewAttempt(r) }, { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa phiên làm bài này', onClick: () => onDeleteAttempt(r) }] : []}
            />
          ),
        },
      ]}
    />
  );
}

export function EmployeeTestCenterView({
  assignments, attempts, tests, onRefresh,
}: { assignments: Record<string, unknown>[]; attempts: Record<string, unknown>[]; tests: Record<string, unknown>[]; onRefresh: () => void }) {
  const { message } = App.useApp(), qc = useQueryClient(), showDetail = useQuickDetail();
  const [subTab, setSubTab] = useState<'assignments' | 'history'>('assignments'), [filterTestId, setFilterTestId] = useState<string>('ALL');
  const [activeAttempt, setActiveAttempt] = useState<Record<string, unknown> | null>(null), [activeTestRec, setActiveTestRec] = useState<Record<string, unknown> | null>(null);
  const [reviewingAttempt, setReviewingAttempt] = useState<Record<string, unknown> | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null), [refreshing, setRefreshing] = useState(false);
  const asgPag = useClientPagination(10, 'bài kiểm tra');

  const handleRefresh = async () => {
    setRefreshing(true);
    try { const fresh = await api.get('/admin/tests/bank?refresh=1'); qc.setQueryData(['nv-tests'], fresh); qc.invalidateQueries({ queryKey: ['tests-bank'], refetchType: 'none' }); message.success('Đã làm mới danh sách bài kiểm tra & lịch sử làm bài'); } finally { setRefreshing(false); }
  };

  const handleStartExam = async (assignment: Record<string, unknown>) => {
    setStartingId(String(assignment.id));
    try {
      if (typeof document !== 'undefined' && !document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen().catch(() => {});
      const attempt = await api.post<Record<string, unknown>>(`/tests/assignments/${assignment.id}/start`, {});
      setActiveTestRec(tests.find((t) => t.id === assignment.test_id) ?? null);
      setActiveAttempt(attempt);
    } catch (e) {
      if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
      message.error(e instanceof ApiClientError ? e.message : 'Không thể bắt đầu bài kiểm tra');
    } finally { setStartingId(null); }
  };

  const visibleAttempts = filterTestId === 'ALL' ? attempts : attempts.filter((a) => String(a.test_id) === filterTestId);

  const assignmentsPane = (
    <SelectableTable<Record<string, unknown>>
      size="small" rowKey="id" pagination={asgPag} dataSource={assignments} onRowClick={(r) => showDetail('employeeTestAssignment', r)}
      bulkActions={[{ key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportToExcel({ fileName: 'Bai_kiem_tra_cua_ban.xls', sheetTitle: 'Danh sách Bài kiểm tra Nghiệp vụ của bạn', rows, columns: [{ header: 'Mã đợt giao', key: 'assignment_code' }, { header: 'Đề thi', key: 'testTitle' }, { header: 'Hạn nộp', key: 'close_at' }, { header: 'Điểm cao nhất (%)', key: 'best_score_percent', align: 'right' }] }) }]}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Hiện chưa có bài kiểm tra nghiệp vụ nào được giao cho bạn." /> }}
      columns={[
        { title: 'Mã đợt giao', dataIndex: 'assignment_code', width: 115, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
        { title: 'Đề thi nghiệp vụ', dataIndex: 'testTitle', ellipsis: true },
        { title: 'Thời lượng', dataIndex: 'durationMinutes', width: 95, render: (v: number) => `${v ?? 15} phút` },
        { title: 'Lượt đã thi', width: 105, render: (_, r) => <Tag color="blue" style={{ margin: 0 }}>{`${r.attempts_used ?? 0}/${r.max_attempts ?? 3} lần`}</Tag> },
        { title: 'Thời gian mở / Hạn nộp', width: 175, render: (_, r) => <div className="num" style={{ fontSize: 12 }}><div>Mở: {r.open_at ? dayjs(String(r.open_at)).format('HH:mm DD/MM') : 'Mở ngay'}</div><div style={{ color: '#64748B' }}>Hạn: {r.close_at ? dayjs(String(r.close_at)).format('HH:mm DD/MM/YYYY') : '—'}</div></div> },
        { title: 'Điểm cao nhất', dataIndex: 'best_score_percent', width: 115, render: (v: number) => <Tag color={v >= 80 ? 'green' : 'default'}>{v ?? 0}%</Tag> },
        { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v: string) => <StatusTag value={v} /> },
        {
          title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
          render: (_, r) => {
            const exhausted = Number(r.attempts_used ?? 0) >= Number(r.max_attempts ?? 3);
            const expired = Boolean(r.close_at && Date.now() > new Date(String(r.close_at)).getTime());
            return (
              <RowActionButtons
                detailTooltip="Xem lịch sử làm bài" onViewDetail={() => { setFilterTestId(String(r.test_id)); setSubTab('history'); }} loading={startingId === String(r.id)}
                menuItems={[
                  { key: 'start', icon: <PlayCircleOutlined style={{ color: '#2563EB' }} />, disabled: exhausted || expired, label: exhausted ? 'Đã hết lượt thi' : expired ? 'Đã quá hạn nộp bài' : 'Bắt đầu làm bài kiểm tra', onClick: () => void handleStartExam(r) },
                  { key: 'history', icon: <HistoryOutlined />, label: 'Xem lịch sử các lượt thi', onClick: () => { setFilterTestId(String(r.test_id)); setSubTab('history'); } },
                ]}
              />
            );
          },
        },
      ]}
    />
  );

  const historyPane = (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Select showSearch optionFilterProp="label" value={filterTestId} onChange={setFilterTestId} style={{ width: 320 }} options={[{ value: 'ALL', label: 'Tất cả bài kiểm tra của bạn' }, ...assignments.map((a) => ({ value: String(a.test_id), label: `${a.assignment_code} — ${a.testTitle}` }))]} />
        {filterTestId !== 'ALL' && <Button size="small" icon={<EyeOutlined />} onClick={() => setFilterTestId('ALL')}>Xem tất cả lượt thi</Button>}
      </div>
      <AttemptHistoryTable attempts={visibleAttempts} onViewAttempt={(att) => setReviewingAttempt(att)} />
    </Space>
  );

  return (
    <>
      <Tabs
        activeKey={subTab} onChange={(k) => setSubTab(k as 'assignments' | 'history')}
        tabBarExtraContent={<Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleRefresh()}>Làm mới</Button>}
        items={[
          { key: 'assignments', label: <span><BookOutlined /> Bài kiểm tra được giao ({assignments.length})</span>, children: assignmentsPane },
          { key: 'history', label: <span><HistoryOutlined /> Lịch sử các lượt làm bài ({attempts.length})</span>, children: historyPane },
        ]}
      />
      <ExamFullscreenModal attempt={activeAttempt} testRecord={activeTestRec} onClose={() => setActiveAttempt(null)} onSubmitted={(result) => { onRefresh(); setSubTab('history'); setReviewingAttempt(result); }} />
      <AttemptReviewModal attempt={reviewingAttempt} onClose={() => setReviewingAttempt(null)} />
    </>
  );
}
