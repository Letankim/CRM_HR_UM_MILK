'use client';

import { Alert, App, Col, Form, Input, Modal, Row, Select } from 'antd';
import { CloseOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  TICKET_CATEGORY_OPTIONS, TICKET_DEPARTMENT_OPTIONS, TICKET_PRIORITY_OPTIONS,
  type TicketCategory, type TicketDepartment,
} from '@umbm/shared';
import { api, ApiClientError } from '@/lib/api';
import { DEFAULT_DEPT_BY_CATEGORY, type SupportTicketItem, type TicketAssigneeOption } from './ticket-types';

interface SimplePayslipOption {
  id: string;
  payslipCode: string;
  periodName: string;
}

export interface TicketCreateEditModalProps {
  open: boolean;
  editingTicket?: SupportTicketItem | null;
  defaultCategory?: TicketCategory;
  defaultDepartment?: TicketDepartment;
  onClose: () => void;
  onSaved?: (ticket: SupportTicketItem) => void;
}

export function TicketCreateEditModal({
  open, editingTicket, defaultCategory = 'PAYSLIP_INQUIRY', defaultDepartment, onClose, onSaved,
}: TicketCreateEditModalProps) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const selectedCategory = Form.useWatch('category', form) as TicketCategory | undefined;
  const selectedDept = Form.useWatch('target_department', form) as TicketDepartment | undefined;

  const canEditRouting = !editingTicket || Boolean(editingTicket.canForward);
  const isForwarding = Boolean(editingTicket && editingTicket.canForward);
  const assigneesQ = useQuery({
    queryKey: ['ticket-assignees'],
    queryFn: () => api.get<TicketAssigneeOption[]>('/tickets/assignees'),
    enabled: open && canEditRouting,
  });

  const payslipsQ = useQuery({
    queryKey: ['me', 'payslips'],
    queryFn: () => api.get<SimplePayslipOption[]>('/me/payslips'),
    enabled: open && !editingTicket && selectedCategory === 'PAYSLIP_INQUIRY',
  });

  useEffect(() => {
    if (!open) return;
    if (editingTicket) {
      form.setFieldsValue({
        category: editingTicket.category,
        priority: editingTicket.priority,
        target_department: editingTicket.target_department,
        assignee_user_id: editingTicket.assignee_user_id || '',
        subject: editingTicket.subject,
        description: editingTicket.description,
        related_entity_id: editingTicket.related_entity_id || '',
      });
    } else {
      const initCat = defaultCategory;
      form.resetFields();
      form.setFieldsValue({
        category: initCat,
        priority: initCat === 'PAYSLIP_INQUIRY' ? 'HIGH' : 'NORMAL',
        target_department: defaultDepartment ?? DEFAULT_DEPT_BY_CATEGORY[initCat],
        assignee_user_id: '',
        related_entity_id: '',
      });
    }
  }, [open, editingTicket, defaultCategory, defaultDepartment, form]);

  const deptAssignees = (assigneesQ.data ?? []).filter((a) => !selectedDept || a.department === selectedDept);
  const assigneeOptions = [
    { value: '', label: 'Toàn bộ phận tiếp nhận (Bất kỳ nhân sự phụ trách nào)' },
    ...deptAssignees.map((a) => ({
      value: a.id,
      label: `${a.displayName} — ${a.roleLabel}${a.branchName && a.branchName !== 'Toàn hệ thống' ? ` (${a.branchName})` : ''}`,
    })),
  ];

  const saveMut = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      if (editingTicket) {
        const updatePayload = isForwarding
          ? { priority: values.priority, target_department: values.target_department, assignee_user_id: values.assignee_user_id, version: editingTicket.version }
          : { category: values.category, priority: values.priority, subject: values.subject, description: values.description, version: editingTicket.version };
        return api.put<SupportTicketItem>(`/tickets/${editingTicket.id}`, updatePayload);
      }
      const slip = (payslipsQ.data ?? []).find((p) => p.id === values.related_entity_id);
      return api.post<SupportTicketItem>('/tickets', {
        ...values,
        related_entity_type: slip ? 'PAYSLIP' : '',
        related_label: slip ? `${slip.payslipCode} — ${slip.periodName}` : '',
      });
    },
    onSuccess: (saved) => {
      message.success(
        editingTicket
          ? (isForwarding ? `Đã điều phối phiếu ${saved.ticket_code} sang ${saved.departmentLabel}` : 'Đã cập nhật nội dung phiếu hỗ trợ thành công')
          : `Đã gửi phiếu hỗ trợ ${saved.ticket_code} tới ${saved.departmentLabel}`,
      );
      ['tickets', 'ticket-detail', 'notifications', 'payroll-snapshots'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
      void qc.invalidateQueries({ queryKey: ['me', 'payslips'] });
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => message.error(e instanceof ApiClientError ? e.message : 'Không thể lưu phiếu hỗ trợ, vui lòng kiểm tra lại'),
  });

  return (
    <Modal
      width="70vw"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      title={
        !editingTicket
          ? 'Tạo Phiếu Hỗ Trợ & Giải Đáp Thắc Mắc'
          : isForwarding
            ? `Điều phối Bộ phận Xử lý — ${editingTicket.ticket_code}`
            : `Chỉnh sửa Nội dung Phiếu — ${editingTicket.ticket_code}`
      }
      okText={!editingTicket ? 'Gửi phiếu hỗ trợ' : isForwarding ? 'Lưu điều phối & Chuyển xử lý' : 'Lưu cập nhật nội dung'}
      cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SendOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      confirmLoading={saveMut.isPending}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message={
          !editingTicket
            ? 'Chọn đúng bộ phận tiếp nhận và có thể chỉ định trực tiếp người phụ trách cụ thể. Hệ thống sẽ gửi thông báo chuông và Email tức thời tới người nhận.'
            : isForwarding
              ? 'Phiếu này được giao cho bạn xử lý — bạn có thể điều chỉnh bộ phận tiếp nhận hoặc chuyển tiếp tới người phụ trách cụ thể.'
              : 'Phiếu hỗ trợ do bạn tạo không thể thay đổi bộ phận xử lý sau khi gửi. Bạn chỉ có thể cập nhật tiêu đề hoặc nội dung mô tả.'
        }
      />
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        <Row gutter={12}>
          <Col xs={24} sm={14}>
            <Form.Item name="category" label="Phân loại vấn đề cần hỗ trợ" rules={[{ required: true, message: 'Vui lòng chọn phân loại' }]}>
              <Select
                disabled={isForwarding}
                options={TICKET_CATEGORY_OPTIONS}
                onChange={(val: TicketCategory) => {
                  if (!editingTicket) {
                    form.setFieldsValue({ target_department: DEFAULT_DEPT_BY_CATEGORY[val], assignee_user_id: '' });
                  }
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="priority" label="Mức độ ưu tiên" rules={[{ required: true, message: 'Vui lòng chọn mức ưu tiên' }]}>
              <Select options={TICKET_PRIORITY_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="target_department" label="Gửi tới Bộ phận tiếp nhận" rules={[{ required: true, message: 'Vui lòng chọn bộ phận tiếp nhận' }]}>
              <Select disabled={!canEditRouting} options={TICKET_DEPARTMENT_OPTIONS} onChange={() => form.setFieldValue('assignee_user_id', '')} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="assignee_user_id" label="Chọn cụ thể người xử lý (tùy chọn)">
              <Select disabled={!canEditRouting} showSearch optionFilterProp="label" loading={assigneesQ.isLoading} options={assigneeOptions} />
            </Form.Item>
          </Col>
        </Row>

        {!editingTicket && selectedCategory === 'PAYSLIP_INQUIRY' && (payslipsQ.data?.length ?? 0) > 0 && (
          <Form.Item name="related_entity_id" label="Đính kèm Phiếu lương cần đối chiếu (tùy chọn)">
            <Select
              allowClear
              placeholder="Chọn kỳ phiếu lương bạn muốn thắc mắc..."
              options={[
                { value: '', label: 'Không đính kèm phiếu lương cụ thể' },
                ...(payslipsQ.data ?? []).map((p) => ({ value: p.id, label: `${p.payslipCode} — ${p.periodName}` })),
              ]}
              onChange={(val) => {
                const slip = (payslipsQ.data ?? []).find((p) => p.id === val);
                if (slip && !form.getFieldValue('subject')) {
                  form.setFieldValue('subject', `Thắc mắc phiếu lương ${slip.payslipCode} (${slip.periodName})`);
                }
              }}
            />
          </Form.Item>
        )}

        <Form.Item name="subject" label="Tiêu đề phiếu hỗ trợ" rules={[{ required: true, min: 4, message: 'Tiêu đề tối thiểu 4 ký tự' }]}>
          <Input disabled={isForwarding} maxLength={200} placeholder="VD: Xin kiểm tra lại công ca tối ngày 18/10 và phụ cấp đổi ca..." />
        </Form.Item>

        <Form.Item name="description" label="Nội dung thắc mắc / yêu cầu chi tiết" rules={[{ required: true, min: 5, message: 'Nội dung chi tiết tối thiểu 5 ký tự' }]}>
          <Input.TextArea disabled={isForwarding} rows={4} maxLength={2500} placeholder="Mô tả rõ ngày ca, mã phiếu hoặc nội dung cần bộ phận phụ trách kiểm tra và phản hồi..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
