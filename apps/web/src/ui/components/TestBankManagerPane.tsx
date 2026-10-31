'use client';

import { useMemo, useState } from 'react';
import { App, Button, Card, Col, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Tabs, Tag } from 'antd';
import { BookOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileDoneOutlined, HistoryOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, SendOutlined, SettingOutlined, ThunderboltOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, ApiClientError } from '@/lib/api';
import { exportToExcel } from '@/lib/export-excel';
import { useClientPagination } from '../hooks/useClientPagination';
import { useEmployeeSearchSelect } from '../hooks/useEmployeeSearchSelect';
import { StatusTag } from '../StatusTag';
import { SelectableTable } from './BulkActionBar';
import { AttemptHistoryTable, AttemptReviewModal } from './ExamTestCenter';
import { useJobPositions } from './JobPositionsManagerModal';
import { RowActionButtons } from './RowActionButtons';
import { DEFAULT_QUESTIONS, parseQuestions, TestAssignmentFormModal, TestDetailDrawer, type QuestionRow } from './TestBankModals';

export function TestBankManagerPane({ tests, assignments, attempts = [], employees, canManage = true }: { tests: Record<string, unknown>[]; assignments: Record<string, unknown>[]; attempts?: Record<string, unknown>[]; employees: { value: string; label: string }[]; canManage?: boolean }) {
  const qc = useQueryClient(), { message, modal } = App.useApp(), { options: jobPositionOptions } = useJobPositions();
  const [subTab, setSubTab] = useState<'bank' | 'assignments' | 'history'>('bank'), [modalTab, setModalTab] = useState<'config' | 'questions'>('config');
  const [bankModal, setBankModal] = useState(false), [asgModal, setAsgModal] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [editingTest, setEditingTest] = useState<Record<string, unknown> | null>(null), [viewingTest, setViewingTest] = useState<Record<string, unknown> | null>(null);
  const [viewingAssignment, setViewingAssignment] = useState<Record<string, unknown> | null>(null), [editingAssignment, setEditingAssignment] = useState<Record<string, unknown> | null>(null);
  const [reviewingAttempt, setReviewingAttempt] = useState<Record<string, unknown> | null>(null);
  const [historySearch, setHistorySearch] = useState(''), [historyEmpId, setHistoryEmpId] = useState('ALL'), [historyTestId, setHistoryTestId] = useState('ALL'), [historyResult, setHistoryResult] = useState('ALL');
  const [questions, setQuestions] = useState<QuestionRow[]>(DEFAULT_QUESTIONS);
  const [bankForm] = Form.useForm(), [asgForm] = Form.useForm();
  const empSelect = useEmployeeSearchSelect({ initialOptions: employees, enabled: subTab === 'history' || asgModal });
  const bankPag = useClientPagination(10, 'bộ đề'), asgPag = useClientPagination(10, 'đợt giao');
  const refresh = () => ['tests-bank', 'nv-tests'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const handleManualRefresh = async () => { setRefreshing(true); try { const fresh = await api.get('/admin/tests/bank?refresh=1'); qc.setQueryData(['tests-bank'], fresh); qc.invalidateQueries({ queryKey: ['nv-tests'], refetchType: 'none' }); message.success('Đã đồng bộ dữ liệu bộ đề, đợt giao bài & lịch sử thi mới nhất'); } finally { setRefreshing(false); } };

  const openCreateBank = () => {
    setEditingTest(null); setQuestions(DEFAULT_QUESTIONS); setModalTab('config'); bankForm.resetFields();
    bankForm.setFieldsValue({ code: `SOP-TEST-${String(tests.length + 1).padStart(2, '0')}`, staff_group: 'BARISTA', target_stage: 'PROBATION', duration_minutes: 15, pass_percent: 80, max_attempts: 3, status: 'APPROVED' });
    setBankModal(true);
  };
  const openEditBank = async (record: Record<string, unknown>, initialTab: 'config' | 'questions' = 'config') => {
    setEditingTest(record); setModalTab(initialTab);
    bankForm.setFieldsValue({ code: record.code, title: record.title, staff_group: record.staff_group || 'BARISTA', target_stage: record.target_stage || 'PROBATION', duration_minutes: record.duration_minutes ?? 15, pass_percent: record.pass_percent ?? 80, max_attempts: record.max_attempts ?? 3, status: record.status || 'APPROVED' });
    try {
      const fullRes = await api.get<{ tests: Record<string, unknown>[] }>('/admin/tests/bank?include_answers=1');
      const fullTest = (fullRes.tests ?? []).find((t) => String(t.id) === String(record.id));
      setQuestions(parseQuestions(fullTest?.questions_json ?? record.questions_json).map((q) => ({ ...q, answer: Number(q.answer ?? 0) })));
    } catch { setQuestions(parseQuestions(record.questions_json).map((q) => ({ ...q, answer: Number(q.answer ?? 0) }))); }
    setBankModal(true);
  };

  const openCreateAssignment = (defaultTestId?: string) => {
    setEditingAssignment(null); asgForm.resetFields();
    const matchedTest = tests.find((t) => String(t.id) === String(defaultTestId ?? tests[0]?.id));
    asgForm.setFieldsValue({ test_id: defaultTestId ?? (tests[0] ? String(tests[0].id) : undefined), max_attempts: Number(matchedTest?.max_attempts ?? 3), due_date: '2026-10-30', due_time: '17:00', note: '' });
    setAsgModal(true);
  };
  const openEditAssignment = (record: Record<string, unknown>) => {
    setEditingAssignment(record);
    const parsed = dayjs(String(record.close_at || '2026-10-30T17:00:00'));
    asgForm.setFieldsValue({ test_id: String(record.test_id || ''), employee_id: String(record.employee_id || ''), max_attempts: Number(record.max_attempts ?? 3), due_date: parsed.isValid() ? parsed.format('YYYY-MM-DD') : '2026-10-30', due_time: parsed.isValid() ? parsed.format('HH:mm') : '17:00', reset_attempts: false, note: String(record.note || '') });
    setAsgModal(true);
  };

  const saveBankMut = useMutation({
    mutationFn: async () => { const vals = await bankForm.validateFields(); const payload = { ...vals, questions_json: JSON.stringify(questions) }; return editingTest ? api.put(`/admin/tests/bank/${editingTest.id}`, { ...payload, version: editingTest.version }) : api.post('/admin/tests/bank', payload); },
    onSuccess: () => { message.success(editingTest ? 'Đã cập nhật bộ đề kiểm tra' : 'Đã tạo bộ đề kiểm tra mới'); setBankModal(false); refresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu bộ đề thất bại'),
  });
  const delBankMut = useMutation({ mutationFn: (r: Record<string, unknown>) => api.delete(`/admin/tests/bank/${r.id}`, { version: r.version }), onSuccess: () => { message.success('Đã xóa bộ đề kiểm tra'); refresh(); }, onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa bộ đề thất bại') });
  const assignMut = useMutation({
    mutationFn: (v: Record<string, unknown>) => { const closeAt = `${v.due_date}T${v.due_time}:00+07:00`; return editingAssignment ? api.put(`/admin/tests/assignments/${editingAssignment.id}`, { version: editingAssignment.version, test_id: v.test_id, employee_id: v.employee_id, max_attempts: Number(v.max_attempts ?? 3), close_at: closeAt, reset_attempts: Boolean(v.reset_attempts), note: v.note ?? '' }) : api.post('/admin/tests/assignments', { test_id: v.test_id, employee_ids: v.employee_ids, max_attempts: Number(v.max_attempts ?? 3), close_at: closeAt, note: v.note ?? '' }); },
    onSuccess: () => { message.success(editingAssignment ? 'Đã cập nhật đợt giao bài kiểm tra thành công' : 'Đã giao bài kiểm tra cho nhân sự'); setAsgModal(false); setEditingAssignment(null); setSubTab('assignments'); refresh(); },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Lưu đợt giao bài thất bại'),
  });
  const delAsgMut = useMutation({ mutationFn: (r: Record<string, unknown>) => api.delete(`/admin/tests/assignments/${r.id}`, { version: r.version }), onSuccess: () => { message.success('Đã thu hồi đợt giao bài'); refresh(); }, onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Thu hồi thất bại') });
  const delAttemptMut = useMutation({ mutationFn: (r: Record<string, unknown>) => api.delete(`/admin/tests/attempts/${r.id}`, { version: r.version }), onSuccess: () => { message.success('Đã xóa phiên làm bài và cập nhật lại số lượt thi'); refresh(); }, onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Xóa phiên làm bài thất bại') });
  const confirmDeleteAttempt = (att: Record<string, unknown>) => modal.confirm({ title: `Xóa phiên làm bài Lần #${att.attempt_no ?? 1} của "${att.employeeName || 'Nhân sự'}"?`, content: 'Phiên làm bài này sẽ bị xóa và số lượt đã thi của nhân sự sẽ được hoàn trả tương ứng.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delAttemptMut.mutateAsync(att) });

  const filteredAttempts = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return attempts.filter((att) => (historyEmpId === 'ALL' || String(att.employee_id) === historyEmpId) && (historyTestId === 'ALL' || String(att.test_id) === historyTestId) && (historyResult === 'ALL' || (historyResult === 'PASSED' ? Boolean(att.passed) : !att.passed)) && (!q || `${att.employeeName ?? ''} ${att.employeeCode ?? ''} ${att.testTitle ?? ''} ${att.testCode ?? ''}`.toLowerCase().includes(q)));
  }, [attempts, historySearch, historyEmpId, historyTestId, historyResult]);

  const bankTable = (
    <Card size="small" title="Ngân hàng Bộ đề Kiểm tra" extra={<Space><Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleManualRefresh()}>Làm mới</Button>{canManage && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreateBank}>Tạo bộ đề mới</Button>}</Space>}>
      <SelectableTable<Record<string, unknown>>
        size="small" rowKey="id" pagination={bankPag} dataSource={tests} onRowClick={setViewingTest}
        bulkActions={[
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportToExcel({ fileName: 'Ngan_hang_bo_de_TEST.xls', sheetTitle: 'Ngân hàng Bộ đề Kiểm tra Nghiệp vụ', rows, columns: [{ header: 'Mã bộ đề', key: 'code' }, { header: 'Tên bộ đề', key: 'title' }, { header: 'Nhóm vị trí', key: 'staffGroupLabel' }, { header: 'Thời gian (phút)', key: 'duration_minutes', align: 'right' }, { header: 'Điểm chuẩn (%)', key: 'pass_percent', align: 'right' }, { header: 'Trạng thái', key: 'status' }] }) },
          ...(canManage ? [{ key: 'del', label: 'Xóa bộ đề đã chọn', danger: true, icon: <DeleteOutlined />, confirm: 'Xác nhận xóa các bộ đề đã chọn?', onClick: async (rows: Record<string, unknown>[]) => { for (const r of rows) await api.delete(`/admin/tests/bank/${r.id}`, { version: r.version }); message.success('Đã xóa các bộ đề kiểm tra đã chọn'); refresh(); } }] : []),
        ]}
        columns={[
          { title: 'Mã bộ đề', dataIndex: 'code', width: 130, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Tên bộ đề kiểm tra', dataIndex: 'title', ellipsis: true },
          { title: 'Nhóm vị trí', dataIndex: 'staffGroupLabel', width: 130 },
          { title: 'Số câu hỏi', width: 95, render: (_, r) => `${r.questionsCount ?? r.total_questions ?? 2} câu` },
          { title: 'Thời gian thi', dataIndex: 'duration_minutes', width: 110, render: (v: number) => `${v} phút` },
          { title: 'Số lần tối đa', dataIndex: 'max_attempts', width: 105, render: (v: number) => `${v ?? 3} lần` },
          { title: 'Điểm chuẩn', dataIndex: 'pass_percent', width: 105, render: (v: number) => <Tag color="blue">{v}%</Tag> },
          { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v: string) => <StatusTag value={v} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết bộ đề & câu hỏi" onViewDetail={() => setViewingTest(r)}
                menuItems={canManage ? [
                  { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa cấu hình & câu hỏi', onClick: () => void openEditBank(r, 'config') },
                  { key: 'questions', icon: <UnorderedListOutlined />, label: 'Biên soạn danh sách câu hỏi', onClick: () => void openEditBank(r, 'questions') },
                  { key: 'assign', icon: <SendOutlined />, label: 'Giao bộ đề này cho nhân sự', onClick: () => openCreateAssignment(String(r.id)) },
                  { key: 'delete', icon: <DeleteOutlined />, danger: true, label: 'Xóa bộ đề kiểm tra', onClick: () => modal.confirm({ title: `Xóa bộ đề "${r.title}"?`, content: 'Bộ đề kiểm tra này sẽ bị xóa khỏi danh sách hiện hành.', okText: 'Xác nhận xóa', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delBankMut.mutateAsync(r) }) },
                ] : []}
              />
            ),
          },
        ]}
      />
    </Card>
  );

  const assignmentsTable = (
    <Card size="small" title="Đợt giao bài & Kết quả thi" extra={<Space><Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleManualRefresh()}>Làm mới</Button>{canManage && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openCreateAssignment()}>Giao bài kiểm tra</Button>}</Space>}>
      <SelectableTable<Record<string, unknown>>
        size="small" rowKey="id" pagination={asgPag} dataSource={assignments} onRowClick={setViewingAssignment}
        bulkActions={[
          { key: 'export', label: 'Xuất Excel đã chọn', icon: <DownloadOutlined />, onClick: (rows) => exportToExcel({ fileName: 'Dot_giao_bai_TEST.xls', sheetTitle: 'Danh sách Đợt Giao Bài Kiểm Tra & Kết Quả', rows, columns: [{ header: 'Mã đợt giao', key: 'assignment_code' }, { header: 'Nhân sự', key: 'employeeName' }, { header: 'Bộ đề', key: 'testTitle' }, { header: 'Lượt đã thi', key: 'attempts_used', align: 'right' }, { header: 'Hạn nộp', key: 'close_at' }, { header: 'Điểm cao nhất (%)', key: 'best_score_percent', align: 'right' }, { header: 'Trạng thái', key: 'status' }] }) },
          ...(canManage ? [{ key: 'revoke', label: 'Thu hồi đợt giao đã chọn', danger: true, icon: <DeleteOutlined />, confirm: 'Xác nhận thu hồi các đợt giao bài đã chọn?', onClick: async (rows: Record<string, unknown>[]) => { for (const r of rows) await api.delete(`/admin/tests/assignments/${r.id}`, { version: r.version }); message.success('Đã thu hồi các đợt giao bài đã chọn'); refresh(); } }] : []),
        ]}
        columns={[
          { title: 'Mã đợt giao', dataIndex: 'assignment_code', width: 115, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
          { title: 'Nhân sự nhận đề', dataIndex: 'employeeName', width: 165, ellipsis: true },
          { title: 'Bộ đề kiểm tra', dataIndex: 'testTitle', ellipsis: true },
          { title: 'Lượt đã thi', width: 100, render: (_, r) => <Tag color="blue" style={{ margin: 0 }}>{`${r.attempts_used ?? 0}/${r.max_attempts ?? 3} lần`}</Tag> },
          { title: 'Hạn nộp bài', dataIndex: 'close_at', width: 135, render: (v: string) => <span className="num" style={{ fontSize: 12 }}>{v ? dayjs(v).format('HH:mm DD/MM/YYYY') : '—'}</span> },
          { title: 'Điểm cao nhất', dataIndex: 'best_score_percent', width: 110, render: (v: number) => <Tag color={v >= 80 ? 'green' : 'default'}>{v}%</Tag> },
          { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v: string) => <StatusTag value={v} /> },
          {
            title: 'Thao tác', width: 88, fixed: 'right', align: 'right',
            render: (_, r) => (
              <RowActionButtons
                detailTooltip="Xem chi tiết đợt giao & lịch sử bài làm" onViewDetail={() => setViewingAssignment(r)}
                menuItems={[
                  { key: 'history', icon: <HistoryOutlined />, label: 'Xem lịch sử bài làm', onClick: () => { setHistoryEmpId(String(r.employee_id || 'ALL')); setHistoryTestId(String(r.test_id || 'ALL')); setSubTab('history'); } },
                  ...(canManage ? [
                    { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa hạn nộp & số lần thi', onClick: () => openEditAssignment(r) },
                    { key: 'revoke', icon: <DeleteOutlined />, danger: true, label: 'Thu hồi đợt giao bài', onClick: () => modal.confirm({ title: 'Thu hồi đợt giao bài kiểm tra này?', content: `Đợt giao bài "${r.assignment_code}" sẽ bị thu hồi.`, okText: 'Thu hồi', cancelText: 'Hủy bỏ', okButtonProps: { danger: true, icon: <DeleteOutlined /> }, cancelButtonProps: { icon: <CloseOutlined /> }, onOk: () => delAsgMut.mutateAsync(r) }) },
                  ] : []),
                ]}
              />
            ),
          },
        ]}
      />
    </Card>
  );

  const historyCard = (
    <Card size="small" title={`Lịch sử các phiên làm bài kiểm tra (${filteredAttempts.length}/${attempts.length})`} extra={<Space><Button size="small" icon={<CloseOutlined />} onClick={() => { setHistorySearch(''); setHistoryEmpId('ALL'); setHistoryTestId('ALL'); setHistoryResult('ALL'); }}>Xóa bộ lọc</Button><Button size="small" type="primary" ghost icon={<ReloadOutlined />} loading={refreshing} onClick={() => void handleManualRefresh()}>Làm mới</Button></Space>}>
      <Space wrap size={8} style={{ width: '100%', marginBottom: 12 }}>
        <Input allowClear prefix={<SearchOutlined style={{ color: '#94A3B8' }} />} placeholder="Tìm tên nhân sự, mã đề, tên đề..." value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} style={{ width: 240 }} />
        <Select showSearch value={historyEmpId} onChange={setHistoryEmpId} style={{ width: 230 }} options={[{ value: 'ALL', label: 'Tất cả nhân sự làm bài' }, ...empSelect.options]} loading={empSelect.loading} onSearch={empSelect.onSearch} filterOption={empSelect.filterOption} onDropdownVisibleChange={empSelect.onDropdownVisibleChange} />
        <Select showSearch optionFilterProp="label" value={historyTestId} onChange={setHistoryTestId} style={{ width: 260 }} options={[{ value: 'ALL', label: 'Tất cả kỳ thi / bộ đề' }, ...tests.map((t) => ({ value: String(t.id), label: `${t.code} — ${t.title}` }))]} />
        <Select value={historyResult} onChange={setHistoryResult} style={{ width: 165 }} options={[{ value: 'ALL', label: 'Tất cả kết quả' }, { value: 'PASSED', label: 'Đạt yêu cầu' }, { value: 'FAILED', label: 'Chưa đạt' }]} />
      </Space>
      <AttemptHistoryTable attempts={filteredAttempts} showEmployee canDelete={canManage} onViewAttempt={(att) => setReviewingAttempt(att)} onDeleteAttempt={confirmDeleteAttempt} />
    </Card>
  );

  return (
    <>
      <Tabs activeKey={subTab} onChange={(k) => setSubTab(k as 'bank' | 'assignments' | 'history')} items={[{ key: 'bank', label: <span><BookOutlined /> Ngân hàng Bộ đề kiểm tra ({tests.length})</span>, children: bankTable }, { key: 'assignments', label: <span><FileDoneOutlined /> Đợt giao bài &amp; Kết quả thi ({assignments.length})</span>, children: assignmentsTable }, { key: 'history', label: <span><HistoryOutlined /> Lịch sử bài làm ({attempts.length})</span>, children: historyCard }]} />

      <Modal open={bankModal} forceRender title={editingTest ? `Chỉnh sửa Bộ đề — ${editingTest.code}` : 'Tạo Bộ đề Kiểm tra Nghiệp vụ Mới'} width="90vw" style={{ top: 24, maxWidth: 1360 }} okText={editingTest ? 'Lưu cập nhật' : 'Tạo bộ đề'} cancelText="Hủy bỏ" okButtonProps={{ icon: editingTest ? <SaveOutlined /> : <PlusOutlined />, loading: saveBankMut.isPending }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={() => setBankModal(false)} onOk={() => saveBankMut.mutate()}>
        <Form form={bankForm} layout="vertical">
          <Tabs activeKey={modalTab} onChange={(k) => setModalTab(k as 'config' | 'questions')} items={[
            {
              key: 'config', forceRender: true, label: <span><SettingOutlined /> Cấu hình Kỳ thi &amp; Thông số Đề</span>,
              children: (
                <>
                  <Row gutter={12}><Col span={8}><Form.Item name="code" label="Mã bộ đề" rules={[{ required: true }]}><Input placeholder="SOP-BARISTA-01" suffix={<span style={{ cursor: 'pointer', userSelect: 'none', fontWeight: 600, fontSize: 12, color: '#2563EB', background: '#EFF6FF', padding: '1px 6px', borderRadius: 2 }} onClick={() => bankForm.setFieldValue('code', `SOP-${Math.floor(100 + Math.random() * 900)}`)}><ThunderboltOutlined /> Tự sinh</span>} /></Form.Item></Col><Col span={16}><Form.Item name="title" label="Tên bộ đề kiểm tra" rules={[{ required: true }]}><Input placeholder="Ví dụ: Quy chuẩn Pha chế & Vệ sinh An toàn Thực phẩm" /></Form.Item></Col></Row>
                  <Row gutter={12}><Col span={6}><Form.Item name="staff_group" label="Nhóm vị trí áp dụng"><Select options={jobPositionOptions} /></Form.Item></Col><Col span={6}><Form.Item name="duration_minutes" label="Thời gian làm bài (phút)" rules={[{ required: true }]}><InputNumber min={5} max={180} step={5} style={{ width: '100%' }} suffix="phút" /></Form.Item></Col><Col span={6}><Form.Item name="pass_percent" label="Điểm chuẩn đạt (%)" rules={[{ required: true }]}><InputNumber min={10} max={100} step={5} style={{ width: '100%' }} suffix="%" /></Form.Item></Col><Col span={6}><Form.Item name="max_attempts" label="Số lần thi tối đa"><InputNumber min={1} max={20} style={{ width: '100%' }} suffix="lần" /></Form.Item></Col></Row>
                </>
              ),
            },
            {
              key: 'questions', forceRender: true, label: <span><UnorderedListOutlined /> Danh sách Câu hỏi Trắc nghiệm ({questions.length} câu)</span>,
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 10 }}><Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setQuestions((prev) => [...prev, { id: `q${Date.now()}`, q: '', options: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'], answer: 0 }])}>Thêm câu hỏi mới</Button></div>
                  <Space direction="vertical" size={10} style={{ width: '100%', maxHeight: 420, overflowY: 'auto' }}>
                    {questions.map((item, idx) => (
                      <Card key={item.id} size="small" title={`Câu hỏi ${idx + 1}`} extra={questions.length > 1 && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== idx))} />}>
                        <Input style={{ marginBottom: 10 }} value={item.q} onChange={(e) => setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, q: e.target.value } : q)))} placeholder="Nhập nội dung câu hỏi..." />
                        <Radio.Group value={item.answer ?? 0} onChange={(e) => setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, answer: Number(e.target.value) } : q)))} style={{ width: '100%' }}>
                          <Row gutter={[12, 10]}>{item.options.map((opt, oIdx) => <Col span={12} key={oIdx}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Radio value={oIdx} style={{ margin: 0, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', fontWeight: item.answer === oIdx ? 600 : 400, color: item.answer === oIdx ? '#16A34A' : '#475569' }}>Đúng</Radio><Input style={{ flex: 1 }} value={opt} onChange={(e) => setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, options: q.options.map((o, j) => (j === oIdx ? e.target.value : o)) } : q)))} /></div></Col>)}</Row>
                        </Radio.Group>
                      </Card>
                    ))}
                  </Space>
                </>
              ),
            },
          ]} />
        </Form>
      </Modal>

      <TestAssignmentFormModal open={asgModal} editing={editingAssignment} form={asgForm} loading={assignMut.isPending} tests={tests} employees={empSelect.options} onClose={() => { setAsgModal(false); setEditingAssignment(null); }} onSubmit={(v) => assignMut.mutate(v)} />
      <TestDetailDrawer viewingTest={viewingTest} viewingAssignment={viewingAssignment} attempts={attempts} canManage={canManage} onCloseTest={() => setViewingTest(null)} onCloseAssignment={() => setViewingAssignment(null)} onEditTest={(t) => void openEditBank(t, 'questions')} onEditAssignment={(a) => openEditAssignment(a)} onViewAttempt={(att) => setReviewingAttempt(att)} onDeleteAttempt={confirmDeleteAttempt} />
      <AttemptReviewModal attempt={reviewingAttempt} onClose={() => setReviewingAttempt(null)} />
    </>
  );
}
