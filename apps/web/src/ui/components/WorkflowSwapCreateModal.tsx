'use client';

import { useEffect, useMemo } from 'react';
import { Alert, Col, Form, Input, Modal, Row, Segmented, Select } from 'antd';
import { CloseOutlined, SwapOutlined } from '@ant-design/icons';
import { SHIFT_SWAP_KIND_LABELS } from '@umbm/shared';
import dayjs from 'dayjs';
import { useShiftTemplates } from '../hooks/useShiftTemplates';
import { DateStringPicker } from './DateTimePickers';
import type { WorkflowAssignmentOption } from './ScheduleWorkflowModals';

interface Props {
  open: boolean;
  employees: { value: string; label: string; branchId?: string; canSwapShift?: boolean }[];
  assignments: WorkflowAssignmentOption[];
  branches?: { id: string; name: string; code?: string }[];
  /** Loại yêu cầu chọn sẵn khi mở popup (VD: mở từ nút Điều phối khẩn cấp). */
  presetKind?: 'SWAP' | 'GIVE' | 'HR_DISPATCH' | 'HR_SUPPORT';
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}

const fmtShift = (a: WorkflowAssignmentOption) => `${dayjs(a.workDate).format('DD/MM/YYYY')} — ${a.shiftLabel}${a.startAt ? ` (${a.startAt} – ${a.endAt})` : ''}`;
const isFree = (a: WorkflowAssignmentOption) => a.status === 'PUBLISHED' && !a.pendingSwapCode && !a.pendingLeaveCode;

/** HR tạo hộ yêu cầu Nhường ca / Đổi ca 2 chiều, Phát lệnh điều phối khẩn cấp (+30k), hoặc Điều động hỗ trợ liên chi nhánh (HR Support). */
export function WorkflowSwapCreateModal({ open, employees, assignments, branches = [], presetKind, submitting = false, onClose, onSubmit }: Props) {
  const [form] = Form.useForm();
  const storeBranches = useMemo(() => {
    const nonOffice = branches.filter((b) => b.code !== 'VAN_PHONG');
    return (nonOffice.length > 0 ? nonOffice : branches).map((b) => ({ value: b.id, label: b.name }));
  }, [branches]);
  const branchNameMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  useEffect(() => {
    if (open) {
      const defaultDate = dayjs().format('YYYY-MM-DD');
      const firstBranch = storeBranches[0]?.value;
      form.setFieldsValue({
        kind: presetKind ?? form.getFieldValue('kind') ?? 'GIVE',
        work_date: form.getFieldValue('work_date') || defaultDate,
        shift_code: form.getFieldValue('shift_code') || 'CA_SANG',
        branch_id: form.getFieldValue('branch_id') || firstBranch,
        target_branch_id: form.getFieldValue('target_branch_id') || firstBranch,
        peer_id: undefined,
        to_assignment_id: undefined,
      });
    }
  }, [open, presetKind, storeBranches, form]);

  const kind = (Form.useWatch('kind', form) as 'SWAP' | 'GIVE' | 'HR_DISPATCH' | 'HR_SUPPORT' | undefined) ?? 'GIVE';
  const isDispatch = kind === 'HR_DISPATCH', isSupport = kind === 'HR_SUPPORT';
  const fromId = Form.useWatch('from_assignment_id', form), peerId = Form.useWatch('peer_id', form);
  const watchedBranchId = Form.useWatch('branch_id', form), watchedTargetBranchId = Form.useWatch('target_branch_id', form);
  const watchedWorkDate = Form.useWatch('work_date', form) || dayjs().format('YYYY-MM-DD');
  const watchedShiftCode = Form.useWatch('shift_code', form) || 'CA_SANG';
  const activeBranchForTpl = isSupport ? watchedTargetBranchId : isDispatch ? watchedBranchId : undefined;
  const { options: shiftOptions } = useShiftTemplates(activeBranchForTpl);
  const fromAssign = assignments.find((a) => a.id === fromId);

  const officialEmployees = useMemo(() => employees.filter((e) => e.canSwapShift !== false), [employees]);
  const officialEmpMap = useMemo(() => new Map(officialEmployees.map((e) => [e.value, e])), [officialEmployees]);

  const fromOptions = useMemo(() => assignments
    .filter((a) => a.status === 'PUBLISHED' && (!a.employeeStage || a.employeeStage === 'OFFICIAL') && officialEmpMap.has(a.employeeId) && (!isDispatch || !watchedBranchId || a.branchId === watchedBranchId))
    .map((a) => {
      const pCode = a.pendingSwapCode || a.pendingLeaveCode;
      return { value: a.id, disabled: Boolean(pCode), label: `${fmtShift(a)} · ${a.employeeName}${pCode ? ` [Đang chờ xử lý ${pCode}]` : ''}` };
    }), [assignments, officialEmpMap, isDispatch, watchedBranchId]);

  const supportEmpOptions = useMemo(() => {
    const candidates = officialEmployees.filter((e) => !watchedTargetBranchId || !e.branchId || e.branchId !== watchedTargetBranchId);
    const items = candidates.map((e) => {
      const bName = e.branchId ? branchNameMap.get(e.branchId) : '';
      const busy = assignments.find((a) => a.employeeId === e.value && a.workDate === watchedWorkDate && a.status !== 'ABSENT' && (a.shiftCode === watchedShiftCode || Boolean(a.shiftCode)));
      const sameShiftBusy = assignments.find((a) => a.employeeId === e.value && a.workDate === watchedWorkDate && a.status !== 'ABSENT' && a.shiftCode === watchedShiftCode);
      if (sameShiftBusy) {
        return { value: e.value, disabled: true, free: false, label: `${e.label}${bName ? ` (${bName})` : ''} — [Bận: Đã có ${sameShiftBusy.shiftLabel} ngày này]` };
      }
      if (busy) {
        return { value: e.value, disabled: false, free: true, label: `${e.label}${bName ? ` (${bName})` : ''} — [Rảnh khung ca này · Có ${busy.shiftLabel} khác giờ]` };
      }
      return { value: e.value, disabled: false, free: true, label: `${e.label}${bName ? ` (${bName})` : ''} — [Đang rảnh cả ngày]` };
    });
    return items.sort((a, b) => Number(b.free) - Number(a.free));
  }, [officialEmployees, watchedTargetBranchId, watchedWorkDate, watchedShiftCode, assignments, branchNameMap]);
  const freeSupportCount = useMemo(() => supportEmpOptions.filter((o) => !o.disabled).length, [supportEmpOptions]);

  const fromBranchId = fromAssign?.branchId || (fromAssign ? officialEmpMap.get(fromAssign.employeeId)?.branchId : undefined);
  const peerOptions = officialEmployees
    .filter((e) => !fromAssign || (e.value !== fromAssign.employeeId && (!fromBranchId || !e.branchId || e.branchId === fromBranchId)))
    .map((e) => {
      const busy = fromAssign && assignments.find((a) => a.employeeId === e.value && a.workDate === fromAssign.workDate && a.status === 'PUBLISHED');
      return { value: e.value, label: busy && kind === 'GIVE' ? `${e.label} — Đã có ${busy.shiftLabel} ngày này (có thể cần HR duyệt)` : e.label };
    });
  const toOptions = useMemo(() => assignments.filter((a) => a.employeeId === peerId && isFree(a)).map((a) => ({ value: a.id, label: fmtShift(a) })), [assignments, peerId]);

  return (
    <Modal
      width="min(760px, 94vw)" open={open} forceRender
      title={isSupport ? 'Điều phối hỗ trợ liên chi nhánh (HR Support)' : isDispatch ? 'Phát lệnh điều phối khẩn cấp (HR Dispatch)' : 'Tạo yêu cầu đổi ca / nhường ca'}
      okText={isSupport ? 'Tạo phiếu điều động' : isDispatch ? 'Phát lệnh điều phối (+30k)' : 'Gửi yêu cầu'}
      cancelText="Hủy bỏ" confirmLoading={submitting}
      okButtonProps={{ icon: <SwapOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onClose} onOk={() => !submitting && form.submit()}
    >
      <Form
        form={form} layout="vertical" initialValues={{ kind: 'GIVE', shift_code: 'CA_SANG', work_date: dayjs().format('YYYY-MM-DD') }}
        onFinish={(v) => {
          if (submitting) return;
          onSubmit({
            ...v,
            from_assignment_id: v.kind === 'HR_SUPPORT' ? '' : (v.from_assignment_id || ''),
            to_assignment_id: v.kind === 'SWAP' ? v.to_assignment_id : '',
            peer_id: (v.kind === 'HR_DISPATCH' || v.kind === 'HR_SUPPORT') ? '' : v.peer_id,
            target_branch_id: v.kind === 'HR_SUPPORT' ? v.target_branch_id : (v.kind === 'HR_DISPATCH' ? v.branch_id : ''),
          });
          form.resetFields();
          onClose();
        }}
        onValuesChange={(changed) => {
          if (changed.from_assignment_id) {
            const found = assignments.find((a) => a.id === changed.from_assignment_id);
            if (found) form.setFieldsValue({ requester_id: found.employeeId, branch_id: found.branchId || form.getFieldValue('branch_id'), work_date: found.workDate, shift_code: found.shiftCode, peer_id: undefined, to_assignment_id: undefined });
          }
          if (changed.target_branch_id || changed.work_date || changed.shift_code) {
            if (isSupport) form.setFieldValue('requester_id', undefined);
          }
          if (changed.peer_id || changed.kind) form.setFieldValue('to_assignment_id', undefined);
        }}
      >
        <Form.Item name="kind" label="Loại yêu cầu">
          <Segmented options={[{ value: 'GIVE', label: SHIFT_SWAP_KIND_LABELS.GIVE }, { value: 'SWAP', label: SHIFT_SWAP_KIND_LABELS.SWAP }, { value: 'HR_DISPATCH', label: SHIFT_SWAP_KIND_LABELS.HR_DISPATCH }, { value: 'HR_SUPPORT', label: SHIFT_SWAP_KIND_LABELS.HR_SUPPORT }]} />
        </Form.Item>
        <Alert
          type={isSupport ? 'success' : isDispatch ? 'warning' : 'info'} showIcon style={{ marginBottom: 12 }}
          message={isSupport
            ? 'Hỗ trợ liên chi nhánh (HR Support): Chọn Chi nhánh cần hỗ trợ + Ngày + Khung ca bên đó, sau đó chọn nhân sự đang rảnh từ các chi nhánh khác để điều động sang thêm vào lịch.'
            : isDispatch
            ? 'Điều phối khẩn cấp (HR Dispatch): Chọn Chi nhánh + Ngày + Khung ca cần bổ sung người để phát lệnh lên Bảng tin chi nhánh (+30.000đ/ca). Khi nhân viên nhận ca, hệ thống kiểm tra không trùng ca và tự tạo ca mới trên lịch.'
            : kind === 'SWAP'
            ? 'Đổi ca 2 chiều: chỉ giữa 2 Nhân viên Chính thức cùng chi nhánh. Khi đồng nghiệp đồng ý, lịch được đổi ngay, không cần HR duyệt.'
            : 'Nhường ca: chỉ áp dụng giữa các Nhân viên Chính thức cùng chi nhánh. Nếu người nhận vượt 2 ca/ngày, yêu cầu sẽ chờ HR duyệt.'}
        />

        {isSupport && (
          <>
            <Form.Item name="target_branch_id" label="1. Chi nhánh cần hỗ trợ (Chi nhánh tiếp nhận)" rules={[{ required: true, message: 'Vui lòng chọn chi nhánh cần hỗ trợ' }]}>
              <Select showSearch optionFilterProp="label" placeholder="Chọn chi nhánh đang thiếu người cần hỗ trợ" options={storeBranches} />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="work_date" label="2. Ngày làm việc bên chi nhánh đích" rules={[{ required: true, message: 'Vui lòng chọn ngày' }]}><DateStringPicker /></Form.Item></Col>
              <Col span={12}><Form.Item name="shift_code" label="3. Khung ca cần thêm người" rules={[{ required: true, message: 'Vui lòng chọn khung ca' }]}><Select options={shiftOptions} placeholder="Chọn khung ca" /></Form.Item></Col>
            </Row>
            <Form.Item name="requester_id" label={`4. Nhân sự rảnh từ các chi nhánh khác điều động sang (${freeSupportCount} người đang rảnh)`} rules={[{ required: true, message: 'Vui lòng chọn nhân sự rảnh để điều động sang' }]}>
              <Select showSearch optionFilterProp="label" placeholder="Chọn nhân sự đang rảnh ở chi nhánh khác để điều động sang" options={supportEmpOptions} notFoundContent="Không có nhân sự rảnh ở chi nhánh khác" />
            </Form.Item>
          </>
        )}

        {isDispatch && (
          <>
            <Form.Item name="branch_id" label="1. Chi nhánh cần điều phối khẩn cấp" rules={[{ required: true, message: 'Vui lòng chọn chi nhánh phát lệnh' }]}>
              <Select showSearch optionFilterProp="label" placeholder="Chọn chi nhánh cần thêm nhân sự khẩn cấp" options={storeBranches} />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}><Form.Item name="work_date" label="2. Ngày làm việc cần điều phối" rules={[{ required: true, message: 'Vui lòng chọn ngày' }]}><DateStringPicker /></Form.Item></Col>
              <Col span={12}><Form.Item name="shift_code" label="3. Khung ca cần bổ sung (+30.000đ)" rules={[{ required: true, message: 'Vui lòng chọn khung ca' }]}><Select options={shiftOptions} placeholder="Chọn khung ca" /></Form.Item></Col>
            </Row>
            <Form.Item name="from_assignment_id" label="4. Gắn với ca đã xếp trên lịch (Không bắt buộc — để trống nếu muốn tuyển thêm người làm ca này)">
              <Select allowClear showSearch optionFilterProp="label" placeholder="Để trống nếu cần thêm người mới, hoặc chọn ca cụ thể cần người hỗ trợ" options={fromOptions} />
            </Form.Item>
          </>
        )}

        {!isSupport && !isDispatch && (
          <>
            <Form.Item name="from_assignment_id" label="Ca làm việc của người gửi (Nhân viên Chính thức)" rules={[{ required: true, message: 'Vui lòng chọn ca làm việc' }]}>
              <Select showSearch optionFilterProp="label" placeholder="Chọn ca đã phát hành của Nhân viên Chính thức" options={fromOptions} notFoundContent="Chưa có ca chính thức phù hợp" />
            </Form.Item>
            <Form.Item name="requester_id" label="Người gửi yêu cầu" rules={[{ required: true, message: 'Vui lòng chọn ca để xác định người gửi' }]}>
              <Select options={officialEmployees} disabled placeholder="Tự động theo ca đã chọn" />
            </Form.Item>
            <Form.Item name="peer_id" label={kind === 'SWAP' ? 'Đồng nghiệp đổi ca (Nhân viên Chính thức cùng chi nhánh)' : 'Đồng nghiệp nhận ca (Nhân viên Chính thức cùng chi nhánh)'} rules={[{ required: true, message: 'Vui lòng chọn đồng nghiệp là Nhân viên Chính thức' }]}>
              <Select showSearch optionFilterProp="label" placeholder="Chọn Nhân viên Chính thức cùng chi nhánh" options={peerOptions} disabled={!fromAssign} notFoundContent="Không có Nhân viên Chính thức cùng chi nhánh phù hợp" />
            </Form.Item>
            {kind === 'SWAP' && (
              <Form.Item name="to_assignment_id" label="Ca của đồng nghiệp đổi lại" rules={[{ required: true, message: 'Vui lòng chọn ca của đồng nghiệp để đổi lại' }]}>
                <Select showSearch optionFilterProp="label" options={toOptions} disabled={!peerId} placeholder={!peerId ? 'Vui lòng chọn đồng nghiệp trước' : toOptions.length ? 'Chọn ca của đồng nghiệp' : 'Đồng nghiệp chưa có ca chính thức nào có thể đổi'} />
              </Form.Item>
            )}
          </>
        )}

        <Form.Item name="reason" label="Lý do" rules={[{ required: true, message: 'Vui lòng nhập lý do' }, { min: 2, message: 'Lý do tối thiểu 2 ký tự' }]}>
          <Input.TextArea rows={2} maxLength={300} placeholder={isSupport ? 'VD: Chi nhánh đích thiếu nhân sự khung ca này, điều động nhân sự rảnh sang tăng cường...' : isDispatch ? 'VD: Cửa hàng đông khách cần thêm người làm ca này, hoặc nhân viên báo ốm đột xuất...' : 'Nhập lý do đổi hoặc nhường ca...'} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
