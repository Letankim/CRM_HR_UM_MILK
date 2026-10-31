'use client';

import { useMemo } from 'react';
import { Alert, Form, Input, Modal, Segmented, Select } from 'antd';
import { CloseOutlined, SwapOutlined } from '@ant-design/icons';
import { SHIFT_SWAP_KIND_LABELS } from '@umbm/shared';
import dayjs from 'dayjs';
import type { WorkflowAssignmentOption } from './ScheduleWorkflowModals';

interface Props {
  open: boolean;
  employees: { value: string; label: string; branchId?: string; canSwapShift?: boolean }[];
  assignments: WorkflowAssignmentOption[];
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}

const fmtShift = (a: WorkflowAssignmentOption) => `${dayjs(a.workDate).format('DD/MM/YYYY')} — ${a.shiftLabel}${a.startAt ? ` (${a.startAt} – ${a.endAt})` : ''}`;
const isFree = (a: WorkflowAssignmentOption) => a.status === 'PUBLISHED' && !a.pendingSwapCode && !a.pendingLeaveCode;

/** HR tạo hộ yêu cầu Nhường ca / Đổi ca 2 chiều giữa các Nhân viên Chính thức cùng chi nhánh (đồng nghiệp vẫn phải xác nhận). */
export function WorkflowSwapCreateModal({ open, employees, assignments, submitting = false, onClose, onSubmit }: Props) {
  const [form] = Form.useForm();
  const kind = (Form.useWatch('kind', form) as 'SWAP' | 'GIVE' | undefined) ?? 'GIVE';
  const fromId = Form.useWatch('from_assignment_id', form), peerId = Form.useWatch('peer_id', form);
  const fromAssign = assignments.find((a) => a.id === fromId);

  const officialEmployees = useMemo(() => employees.filter((e) => e.canSwapShift !== false), [employees]);
  const officialEmpMap = useMemo(() => new Map(officialEmployees.map((e) => [e.value, e])), [officialEmployees]);

  const fromOptions = useMemo(() => assignments
    .filter((a) => a.status === 'PUBLISHED' && (!a.employeeStage || a.employeeStage === 'OFFICIAL') && officialEmpMap.has(a.employeeId))
    .map((a) => {
      const pCode = a.pendingSwapCode || a.pendingLeaveCode;
      return { value: a.id, disabled: Boolean(pCode), label: `${fmtShift(a)} · ${a.employeeName}${pCode ? ` [Đang chờ xử lý ${pCode}]` : ''}` };
    }), [assignments, officialEmpMap]);

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
      width="min(760px, 94vw)" open={open} forceRender title="Tạo yêu cầu đổi ca / nhường ca" okText="Gửi yêu cầu" cancelText="Hủy bỏ" confirmLoading={submitting}
      okButtonProps={{ icon: <SwapOutlined /> }} cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onClose} onOk={() => !submitting && form.submit()}
    >
      <Form
        form={form} layout="vertical" initialValues={{ kind: 'GIVE' }}
        onFinish={(v) => { if (submitting) return; onSubmit({ ...v, to_assignment_id: v.kind === 'SWAP' ? v.to_assignment_id : '' }); form.resetFields(); onClose(); }}
        onValuesChange={(changed) => {
          if (changed.from_assignment_id) { const found = assignments.find((a) => a.id === changed.from_assignment_id); form.setFieldsValue({ requester_id: found?.employeeId, peer_id: undefined, to_assignment_id: undefined }); }
          if (changed.peer_id || changed.kind) form.setFieldValue('to_assignment_id', undefined);
        }}
      >
        <Form.Item name="kind" label="Loại yêu cầu">
          <Segmented options={(Object.keys(SHIFT_SWAP_KIND_LABELS) as (keyof typeof SHIFT_SWAP_KIND_LABELS)[]).map((k) => ({ value: k, label: SHIFT_SWAP_KIND_LABELS[k] }))} />
        </Form.Item>
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message={kind === 'SWAP'
            ? 'Đổi ca 2 chiều: chỉ giữa 2 Nhân viên Chính thức cùng chi nhánh (nhân viên thử việc chưa được đổi ca). Khi đồng nghiệp đồng ý, lịch được đổi ngay, không cần HR duyệt.'
            : 'Nhường ca: chỉ áp dụng giữa các Nhân viên Chính thức cùng chi nhánh (nhân viên thử việc chưa được nhường hoặc nhận ca). Nếu người nhận vượt 2 ca/ngày, yêu cầu sẽ chờ HR duyệt.'}
        />
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
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, message: 'Vui lòng nhập lý do' }, { min: 2, message: 'Lý do tối thiểu 2 ký tự' }]}>
          <Input.TextArea rows={2} maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
