'use client';

import { useEffect, useMemo } from 'react';
import { Col, Form, Input, InputNumber, Modal, Row, Select } from 'antd';
import type { FormInstance } from 'antd';
import { CalendarOutlined, CloseOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { DateStringPicker, TimeSelect } from './DateTimePickers';
import { detectClientInterviewOverlaps, InterviewOverlapAlert } from './interview-overlap-utils';

interface InterviewCreateModalProps {
  open: boolean;
  form: FormInstance;
  candidates: Record<string, unknown>[];
  scheduledCandidateIds: Set<string>;
  interviewerOptions: { value: string; label: string }[];
  existingInterviews: Record<string, unknown>[];
  loading: boolean;
  onCancel: () => void;
  onSubmit: (payload: { candidate_id: string; interviewer_ids: string[]; scheduled_at: string; duration_minutes: number; meet_link?: string }) => void;
}

export function InterviewCreateModal({
  open, form, candidates, scheduledCandidateIds, interviewerOptions, existingInterviews, loading, onCancel, onSubmit,
}: InterviewCreateModalProps) {
  const selectedDate = Form.useWatch('interview_date', form) as string | undefined;
  const selectedSlot = Form.useWatch('interview_slot', form) as string | undefined;
  const selectedDuration = Form.useWatch('duration_minutes', form) as number | undefined;
  const selectedInterviewers = Form.useWatch('interviewer_ids', form) as string[] | undefined;
  const todayStr = dayjs().format('YYYY-MM-DD');
  const nowTimeStr = dayjs().format('HH:mm');

  const overlap = useMemo(() => (open ? detectClientInterviewOverlaps({
    existingInterviews, dateStr: selectedDate, slotHm: selectedSlot, durationMinutes: selectedDuration ?? 30,
    interviewerIds: selectedInterviewers ?? [], interviewerOptions,
  }) : { interviewerConflicts: [], slotOverlaps: [], rangeLabel: '' }),
  [open, existingInterviews, selectedDate, selectedSlot, selectedDuration, selectedInterviewers, interviewerOptions]);

  return (
    <Modal width={680} open={open} forceRender destroyOnHidden title="Đặt lịch phỏng vấn & Google Meet"
      okText="Đặt lịch phỏng vấn" cancelText="Hủy bỏ"
      okButtonProps={{ icon: <CalendarOutlined />, loading, disabled: overlap.interviewerConflicts.length > 0 }}
      cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onCancel} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={(v) => onSubmit({
        candidate_id: v.candidate_id, interviewer_ids: v.interviewer_ids,
        scheduled_at: `${v.interview_date}T${v.interview_slot}:00+07:00`,
        duration_minutes: Number(v.duration_minutes || 30), meet_link: v.meet_link,
      })}>
        <InterviewOverlapAlert interviewerConflicts={overlap.interviewerConflicts} slotOverlaps={overlap.slotOverlaps}
          rangeLabel={overlap.rangeLabel} dateStr={selectedDate} />
        <Form.Item name="candidate_id" label="Ứng viên phỏng vấn" rules={[{ required: true, message: 'Vui lòng chọn ứng viên' }]}>
          <Select showSearch optionFilterProp="label" placeholder="Chọn ứng viên phỏng vấn" options={candidates.map((c) => {
            const hasIv = scheduledCandidateIds.has(String(c.id)) || scheduledCandidateIds.has(String(c.candidate_code));
            return { value: String(c.id), disabled: hasIv, label: `${c.candidate_code} — ${c.full_name} (${c.phone})${hasIv ? ' — Đã có lịch phỏng vấn' : ''}` };
          })} />
        </Form.Item>
        <Form.Item name="interviewer_ids" label="Người tham gia phỏng vấn" rules={[{ required: true, message: 'Chọn ít nhất 1 người phỏng vấn' }]}>
          <Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Chọn người tham gia phỏng vấn" options={interviewerOptions} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="interview_date" label="Ngày phỏng vấn" rules={[
              { required: true, message: 'Vui lòng chọn ngày phỏng vấn' },
              { validator: async (_, val) => { if (val && String(val) < dayjs().format('YYYY-MM-DD')) throw new Error('Không được chọn ngày trong quá khứ'); } },
            ]}>
              <DateStringPicker minDate={todayStr} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="interview_slot" label="Giờ bắt đầu" dependencies={['interview_date']} rules={[
              { required: true, message: 'Vui lòng chọn giờ bắt đầu' },
              ({ getFieldValue }) => ({ validator: async (_, val) => {
                const d = getFieldValue('interview_date');
                if (d && val && `${d} ${val}` < dayjs().format('YYYY-MM-DD HH:mm')) throw new Error('Không được chọn thời gian trong quá khứ');
              } }),
            ]}>
              <TimeSelect placeholder="Chọn giờ bắt đầu" minTime={selectedDate === todayStr ? nowTimeStr : undefined} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="duration_minutes" label="Thời lượng" rules={[{ required: true }]}>
              <InputNumber min={5} max={240} step={5} style={{ width: '100%' }} suffix="phút" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="meet_link" label="Link Google Meet / Calendar">
          <Input placeholder="https://meet.google.com/umb-milk-hr" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface InterviewRescheduleModalProps {
  target: Record<string, unknown> | null;
  interviewerOptions: { value: string; label: string }[];
  existingInterviews: Record<string, unknown>[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (id: string, body: Record<string, unknown>) => void;
}

export function InterviewRescheduleModal({
  target, interviewerOptions, existingInterviews, loading, onClose, onSubmit,
}: InterviewRescheduleModalProps) {
  const [form] = Form.useForm();
  const reschedDate = Form.useWatch('interview_date', form) as string | undefined;
  const reschedSlot = Form.useWatch('interview_slot', form) as string | undefined;
  const reschedDuration = Form.useWatch('duration_minutes', form) as number | undefined;
  const reschedInterviewers = Form.useWatch('interviewer_ids', form) as string[] | undefined;
  const todayStr = dayjs().format('YYYY-MM-DD');
  const nowTimeStr = dayjs().format('HH:mm');

  useEffect(() => {
    if (!target) return;
    const startParsed = dayjs(String(target.scheduled_at || target.start_at || `${todayStr}T09:30:00`));
    const rawIds = String(target.interviewer_id || '').split(',').map((s) => s.trim()).filter(Boolean);
    const mappedIds = rawIds.map((raw) => interviewerOptions.find((o) => o.value === raw || o.label.includes(`(@${raw})`))?.value ?? raw);
    form.setFieldsValue({
      interviewer_ids: mappedIds,
      candidate_confirmed: Boolean(target.candidate_confirmed),
      reschedule_requested: Boolean(target.reschedule_requested),
      reschedule_reason: String(target.reschedule_reason || ''),
      interview_date: startParsed.isValid() ? startParsed.format('YYYY-MM-DD') : todayStr,
      interview_slot: startParsed.isValid() ? startParsed.format('HH:mm') : '09:30',
      duration_minutes: Number(target.duration_minutes || 30),
      meet_link: String(target.meet_link || 'https://meet.google.com/umb-milk-hr'),
    });
  }, [target, interviewerOptions, todayStr, form]);

  const overlap = useMemo(() => (target ? detectClientInterviewOverlaps({
    existingInterviews, dateStr: reschedDate, slotHm: reschedSlot, durationMinutes: reschedDuration ?? 30,
    interviewerIds: reschedInterviewers ?? [], interviewerOptions, excludeInterviewId: String(target.id),
  }) : { interviewerConflicts: [], slotOverlaps: [], rangeLabel: '' }),
  [target, existingInterviews, reschedDate, reschedSlot, reschedDuration, reschedInterviewers, interviewerOptions]);

  return (
    <Modal width={660} open={Boolean(target)} forceRender destroyOnHidden
      title={target ? `Chỉnh sửa / Đổi lịch Phỏng vấn: ${String(target.candidateName)}` : 'Chỉnh sửa lịch phỏng vấn'}
      okText="Lưu cập nhật" cancelText="Hủy bỏ"
      okButtonProps={{ icon: <SaveOutlined />, loading, disabled: overlap.interviewerConflicts.length > 0 }}
      cancelButtonProps={{ icon: <CloseOutlined /> }} onCancel={onClose} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={(v) => {
        if (!target) return;
        onSubmit(String(target.id), {
          version: target.version, interviewer_ids: v.interviewer_ids, duration_minutes: Number(v.duration_minutes || 30),
          meet_link: v.meet_link, candidate_confirmed: Boolean(v.candidate_confirmed),
          reschedule_requested: Boolean(v.reschedule_requested), reschedule_reason: v.reschedule_reason,
          scheduled_at: `${v.interview_date}T${v.interview_slot}:00+07:00`,
        });
      }}>
        <InterviewOverlapAlert interviewerConflicts={overlap.interviewerConflicts} slotOverlaps={overlap.slotOverlaps}
          rangeLabel={overlap.rangeLabel} dateStr={reschedDate} />
        <Row gutter={12}>
          <Col span={24}><Form.Item name="interviewer_ids" label="Người tham gia phỏng vấn" rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 người phỏng vấn' }]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="Chọn người tham gia phỏng vấn" options={interviewerOptions} /></Form.Item></Col>
          <Col span={8}><Form.Item name="interview_date" label="Ngày phỏng vấn" rules={[{ required: true }]}><DateStringPicker minDate={todayStr} /></Form.Item></Col>
          <Col span={8}><Form.Item name="interview_slot" label="Giờ bắt đầu" rules={[{ required: true }]}><TimeSelect minTime={reschedDate === todayStr ? nowTimeStr : undefined} /></Form.Item></Col>
          <Col span={8}><Form.Item name="duration_minutes" label="Thời lượng" rules={[{ required: true }]}><InputNumber min={5} max={240} step={5} style={{ width: '100%' }} suffix="phút" /></Form.Item></Col>
          <Col span={24}><Form.Item name="meet_link" label="Link Google Meet / Calendar"><Input placeholder="https://meet.google.com/umb-milk-hr" /></Form.Item></Col>
          <Col span={12}><Form.Item name="candidate_confirmed" label="Trạng thái xác nhận"><Select options={[{ value: true, label: 'Ứng viên đã xác nhận tham gia' }, { value: false, label: 'Chưa xác nhận' }]} /></Form.Item></Col>
          <Col span={12}><Form.Item name="reschedule_requested" label="Yêu cầu đổi lịch"><Select options={[{ value: false, label: 'Giữ lịch bình thường' }, { value: true, label: 'Ứng viên xin đổi lịch phỏng vấn' }]} /></Form.Item></Col>
          <Col span={24}><Form.Item name="reschedule_reason" label="Lý do đổi lịch / Ghi chú chỉnh sửa"><Input.TextArea rows={2} placeholder="Ví dụ: Ứng viên bận lịch thi ở trường buổi sáng, xin dời sang 14:30..." /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}
