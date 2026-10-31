'use client';

import { useEffect } from 'react';
import { Alert, Checkbox, Descriptions, Form, Input, InputNumber, Modal, Space, Tag } from 'antd';
import { CheckCircleOutlined, CloseOutlined, DollarOutlined, SaveOutlined } from '@ant-design/icons';
import { SYSTEM_CONFIG } from '@umbm/shared';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { fmtVnd, MONEY_INPUT_PROPS } from './payroll-types';
import { isShiftNonOfficialPublished } from './workflow-shift-warning';

export async function submitShiftSwapApproval(target: ShiftSwapApproveTarget, payload: ShiftSwapApprovePayload) {
  if (target.mode === 'edit-allowance' && target.rows[0]) {
    const r = target.rows[0];
    return api.put(`/admin/shift-swaps/${r.id}/allowance`, { version: r.version, ...payload });
  }
  await Promise.all(target.rows.map((r) => api.post(`/admin/shift-swaps/${r.id}/decide`, { version: r.version, decision: 'APPROVED', ...payload })));
  return null;
}

export interface ShiftSwapApproveTarget {
  mode: 'approve' | 'edit-allowance';
  rows: Record<string, unknown>[];
}

export interface ShiftSwapApprovePayload {
  allowance_eligible: boolean;
  allowance_amount_vnd: number;
  decision_reason: string;
}

const DEFAULT_ALLOWANCE = SYSTEM_CONFIG.defaults.shiftSwapAllowanceVnd;
const cleanShiftName = (raw: unknown) => String(raw || 'Ca làm việc').replace(/\s*\([^)]*\)\s*/g, '').trim();

export function renderSwapAllowanceTag(r: Record<string, unknown>, compact = false) {
  const st = String(r.status || '');
  if (st === 'APPROVED') {
    const eligible = Boolean(r.allowance_eligible ?? r.allowanceEligible);
    const amt = eligible ? Math.max(0, Number(r.allowance_amount_vnd ?? r.allowanceAmountVnd ?? 0)) : 0;
    if (eligible && amt > 0) {
      return <Tag color="purple" style={{ margin: 0 }}>{compact ? `PC: +${fmtVnd(amt)}` : `+${fmtVnd(amt)}`}</Tag>;
    }
    return <Tag style={{ margin: 0 }}>{compact ? 'Không PC (0 đ)' : 'Không phụ cấp (0 đ)'}</Tag>;
  }
  if (st === 'REJECTED' || st === 'PEER_DECLINED' || st === 'CANCELLED' || r.kind === 'SWAP') {
    return compact ? null : <Tag style={{ margin: 0 }}>Không áp dụng</Tag>;
  }
  return compact ? null : <Tag color="geekblue" style={{ margin: 0 }}>MĐ +{fmtVnd(DEFAULT_ALLOWANCE)}</Tag>;
}

export function ShiftSwapApproveModal({
  target,
  loading = false,
  onClose,
  onConfirm,
}: {
  target: ShiftSwapApproveTarget | null;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (payload: ShiftSwapApprovePayload) => void;
}) {
  const [form] = Form.useForm();
  const ticked = Boolean(Form.useWatch('allowance_eligible', form));
  const watchedAmt = Number(Form.useWatch('allowance_amount_vnd', form) ?? 0);

  useEffect(() => {
    if (!target) return;
    if (target.mode === 'edit-allowance' && target.rows[0]) {
      const r = target.rows[0];
      const curEligible = Boolean(r.allowance_eligible ?? r.allowanceEligible) && Number(r.allowance_amount_vnd ?? 0) > 0;
      const curAmt = curEligible ? Math.max(0, Number(r.allowance_amount_vnd ?? DEFAULT_ALLOWANCE)) : DEFAULT_ALLOWANCE;
      form.setFieldsValue({
        allowance_eligible: curEligible,
        allowance_amount_vnd: curAmt,
        decision_reason: String(r.decision_reason || 'Cập nhật phụ cấp nhận đổi ca'),
      });
    } else {
      form.setFieldsValue({
        allowance_eligible: true,
        allowance_amount_vnd: DEFAULT_ALLOWANCE,
        decision_reason: target.rows.length > 1 ? 'Duyệt đổi ca hàng loạt' : 'Hợp lệ, duyệt đổi ca',
      });
    }
  }, [target, form]);

  const rows = target?.rows ?? [];
  const first = rows[0];
  const isEdit = target?.mode === 'edit-allowance';
  const warnRows = !isEdit ? rows.filter((r) => isShiftNonOfficialPublished(r)) : [];
  const effectivePerShift = ticked ? Math.max(0, Math.round(watchedAmt || 0)) : 0;

  return (
    <Modal
      width="min(640px, 94vw)"
      open={Boolean(target)}
      title={isEdit ? 'Điều Chỉnh Phụ Cấp Nhận Ca' : rows.length > 1 ? `HR Phê Duyệt Yêu Cầu Nhường Ca (${rows.length} đơn)` : 'HR Phê Duyệt Yêu Cầu Nhường Ca'}
      okText={isEdit ? 'Lưu phụ cấp' : rows.length > 1 ? `Phê duyệt (${rows.length} đơn)` : 'Phê duyệt & cập nhật lịch'}
      cancelText="Hủy bỏ"
      confirmLoading={loading}
      okButtonProps={{ icon: isEdit ? <SaveOutlined /> : <CheckCircleOutlined /> }}
      cancelButtonProps={{ icon: <CloseOutlined /> }}
      onCancel={onClose}
      onOk={() => !loading && form.submit()}
      destroyOnHidden
    >
      {first && rows.length === 1 && (
        <Descriptions bordered size="small" column={1} style={{ marginBottom: 12 }} styles={{ label: { width: 175, fontWeight: 600, background: '#F8FAFC' } }}>
          <Descriptions.Item label="Mã đơn & Ngày ca">
            <Space size={6} wrap>
              <Tag color="purple" style={{ margin: 0 }}>{String(first.swap_code || first.id)}</Tag>
              {Boolean(first.kindLabel) && <Tag color={first.kind === 'SWAP' ? 'geekblue' : 'cyan'} style={{ margin: 0 }}>{String(first.kindLabel)}</Tag>}
              <strong className="num">{first.from_work_date ? dayjs(String(first.from_work_date)).format('DD/MM/YYYY') : '—'}</strong>
              <span>· {cleanShiftName(first.shiftLabel || first.from_shift_code)}</span>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Người gửi yêu cầu">{String(first.requesterName || first.requester_id || '—')}</Descriptions.Item>
          <Descriptions.Item label="Người nhận ca">
            <Space size={6} wrap>
              <strong>{String(first.peerName || first.peer_id || '—')}</strong>
              {Boolean(first.requiresHrApproval) && <Tag color="volcano" style={{ margin: 0 }}>Vượt 2 ca/ngày — cần HR duyệt</Tag>}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      )}
      {rows.length > 1 && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Đang phê duyệt ${rows.length} yêu cầu nhường ca đã được đồng nghiệp đồng ý nhận (người nhận vượt 2 ca/ngày nên cần HR duyệt).`} />
      )}
      {!isEdit && rows.length === 1 && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Đồng nghiệp đã đồng ý nhận ca. Khi HR phê duyệt, lịch làm việc sẽ được cập nhật ngay sang người nhận ca." />
      )}
      {warnRows.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={`Lưu ý: Có ${warnRows.length} ca làm việc hiện không ở trạng thái "Đã phân ca chính thức". Khi duyệt đổi ca, lịch ca sẽ được cập nhật chính thức sang người nhận ca thay.`}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          const allow = Boolean(v.allowance_eligible) && Number(v.allowance_amount_vnd ?? 0) > 0;
          const amt = allow ? Math.max(0, Math.round(Number(v.allowance_amount_vnd ?? 0))) : 0;
          onConfirm({ allowance_eligible: allow, allowance_amount_vnd: amt, decision_reason: String(v.decision_reason || '').trim() });
        }}
      >
        <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 4, padding: '12px 14px', marginBottom: 12 }}>
          <Form.Item name="allowance_eligible" valuePropName="checked" style={{ marginBottom: 10 }}>
            <Checkbox
              onChange={(e) => {
                if (e.target.checked && Number(form.getFieldValue('allowance_amount_vnd') ?? 0) <= 0) {
                  form.setFieldValue('allowance_amount_vnd', DEFAULT_ALLOWANCE);
                }
              }}
            >
              <strong>Cộng phụ cấp nhận đổi ca cho nhân sự nhận ca thay</strong> (mặc định {fmtVnd(DEFAULT_ALLOWANCE)})
            </Checkbox>
          </Form.Item>

          <Form.Item
            name="allowance_amount_vnd"
            label={<span><DollarOutlined /> Mức phụ cấp đổi ca cộng cho người nhận ca thay</span>}
            style={{ marginBottom: 8 }}
            rules={[
              {
                validator: async (_, val) => {
                  if (!form.getFieldValue('allowance_eligible')) return;
                  if (val === undefined || val === null || val === '' || Number(val) < 0) throw new Error('Vui lòng nhập số tiền phụ cấp hợp lệ (>= 0)');
                },
              },
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              max={5_000_000}
              step={5000}
              disabled={!ticked}
              suffix="VNĐ"
              placeholder="30.000"
              {...MONEY_INPUT_PROPS}
            />
          </Form.Item>

          {ticked && effectivePerShift > 0 ? (
            <Alert
              type="success" showIcon
              message={rows.length > 1 ? `Mỗi đơn đổi ca được cộng +${fmtVnd(effectivePerShift)} cho người nhận ca thay (Tổng ${rows.length} đơn: +${fmtVnd(effectivePerShift * rows.length)}).` : `Nhân sự nhận ca thay sẽ được cộng +${fmtVnd(effectivePerShift)} phụ cấp nhận đổi ca vào bảng lương.`}
            />
          ) : (
            <Alert
              type="warning" showIcon
              message="Không cộng tiền phụ cấp đổi ca (0 đ): Nhân sự nhận ca thay chỉ được tính giờ công làm việc của ca này, không được cộng thêm phụ cấp đổi ca."
            />
          )}
        </div>

        <Form.Item name="decision_reason" label="Ghi chú phê duyệt" style={{ marginBottom: 0 }}>
          <Input.TextArea rows={2} maxLength={300} placeholder="Nhập ghi chú phê duyệt đổi ca (nếu có)..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
