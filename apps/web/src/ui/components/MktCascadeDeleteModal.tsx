'use client';

import { CloseOutlined, DeleteOutlined } from '@ant-design/icons';
import { Alert, App, Checkbox, Modal, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { parseRawMediaIds } from './MediaAttachmentCards';

export interface MktCascadeTarget {
  kind: 'campaign' | 'media';
  items: Record<string, unknown>[];
  onSuccess?: () => void;
}

interface Props {
  target: MktCascadeTarget | null;
  announcements: Record<string, unknown>[];
  onClose: () => void;
  onDeleted: () => void;
}

export function MktCascadeDeleteModal({ target, announcements, onClose, onDeleted }: Props) {
  const { message } = App.useApp();
  const [deleteRelated, setDeleteRelated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) setDeleteRelated(false);
  }, [target]);

  const affectedAnnouncements = useMemo(() => {
    if (!target || target.items.length === 0) return [];
    if (target.kind === 'campaign') {
      const cmpKeys = new Set(
        target.items.flatMap((c) => [String(c.id || ''), String(c.code || ''), String(c.campaign_code || '')]).filter(Boolean),
      );
      return announcements.filter((a) => cmpKeys.has(String(a.campaign_id || '')));
    }
    const mediaKeys = new Set(
      target.items.flatMap((m) => [String(m.id || ''), String(m.code || ''), String(m.file_name || '')]).filter(Boolean),
    );
    return announcements.filter((a) => {
      const rawRefs = parseRawMediaIds(a.media_ids);
      if (rawRefs.some((ref) => mediaKeys.has(ref))) return true;
      const atts = Array.isArray(a.mediaAttachments) ? (a.mediaAttachments as Record<string, unknown>[]) : [];
      return atts.some((att) => mediaKeys.has(String(att.id || '')) || mediaKeys.has(String(att.code || '')));
    });
  }, [target, announcements]);

  if (!target) return null;
  const isCampaign = target.kind === 'campaign';
  const count = target.items.length;
  const firstLabel = isCampaign
    ? String(target.items[0]?.name || target.items[0]?.campaign_code || '')
    : String(target.items[0]?.file_name || target.items[0]?.code || '');

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      let deletedAncTotal = 0;
      for (const item of target.items) {
        const url = isCampaign ? `/mkt/campaigns/${item.id}` : `/mkt/media/${item.id}`;
        const res = await api.delete<{ deletedAnnouncementsCount?: number }>(url, {
          version: item.version,
          delete_related: deleteRelated,
        });
        deletedAncTotal += Number(res?.deletedAnnouncementsCount || 0);
      }
      if (deleteRelated && deletedAncTotal > 0) {
        message.success(
          isCampaign
            ? `Đã xóa ${count} chiến dịch và ${deletedAncTotal} bản tin thuộc chiến dịch`
            : `Đã xóa ${count} tệp Media và ${deletedAncTotal} bản tin đang sử dụng tệp`,
        );
      } else {
        message.success(
          isCampaign
            ? `Đã xóa ${count} chiến dịch truyền thông (đã gỡ liên kết chiến dịch khỏi bản tin)`
            : `Đã xóa ${count} tệp Media và gỡ tệp khỏi các bản tin liên quan`,
        );
      }
      target.onSuccess?.();
      onDeleted();
      onClose();
    } catch (e) {
      message.error(e instanceof ApiClientError ? e.message : 'Xóa dữ liệu thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      width={560}
      destroyOnHidden
      title={
        isCampaign
          ? (count > 1 ? `Xác nhận xóa ${count} chiến dịch truyền thông` : `Xóa chiến dịch "${firstLabel}"?`)
          : (count > 1 ? `Xác nhận xóa ${count} tệp Media khỏi kho lưu trữ` : `Xóa tệp Media "${firstLabel}"?`)
      }
      okText="Xác nhận xóa"
      cancelText="Hủy bỏ"
      okButtonProps={{ danger: true, icon: <DeleteOutlined />, loading: submitting }}
      cancelButtonProps={{ icon: <CloseOutlined />, disabled: submitting }}
      onCancel={onClose}
      onOk={() => void handleConfirm()}
    >
      <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 4 }}>
        <Alert
          type={affectedAnnouncements.length > 0 ? 'warning' : 'info'}
          showIcon
          message={
            affectedAnnouncements.length > 0
              ? (isCampaign
                ? `Phát hiện ${affectedAnnouncements.length} bản tin truyền thông đang thuộc chiến dịch này.`
                : `Phát hiện ${affectedAnnouncements.length} bản tin truyền thông đang đính kèm tệp Media này.`)
              : (isCampaign
                ? 'Hiện chưa có bản tin truyền thông nào thuộc chiến dịch này.'
                : 'Hiện chưa có bản tin truyền thông nào đang đính kèm tệp Media này.')
          }
          description={
            affectedAnnouncements.length > 0 ? (
              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {affectedAnnouncements.slice(0, 4).map((a) => (
                  <Tag key={String(a.id)} color="geekblue" style={{ margin: 0 }}>
                    {String(a.announcement_code || 'ANC')} — {String(a.title || '').slice(0, 42)}
                  </Tag>
                ))}
                {affectedAnnouncements.length > 4 && <Tag style={{ margin: 0 }}>+{affectedAnnouncements.length - 4} bản tin khác</Tag>}
              </div>
            ) : undefined
          }
        />

        <div style={{ padding: '10px 12px', border: '1px solid #E5E7EB', borderRadius: 4, background: '#F8FAFC' }}>
          <Checkbox checked={deleteRelated} onChange={(e) => setDeleteRelated(e.target.checked)}>
            <Typography.Text strong style={{ color: '#0F172A' }}>
              {isCampaign
                ? `Xóa luôn tất cả các bản tin đang thuộc chiến dịch này (${affectedAnnouncements.length} bản tin)`
                : `Xóa luôn tất cả các bản tin đang sử dụng tệp Media này (${affectedAnnouncements.length} bản tin)`}
            </Typography.Text>
          </Checkbox>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 4, paddingLeft: 24 }}>
            {deleteRelated
              ? 'Hệ thống sẽ xóa đồng thời mục đã chọn và xóa toàn bộ các bản tin liên quan khỏi danh sách phát tin.'
              : (isCampaign
                ? 'Nếu không chọn: Hệ thống chỉ xóa chiến dịch và chuyển các bản tin liên quan về trạng thái Thông báo độc lập.'
                : 'Nếu không chọn: Hệ thống xóa tệp Media khỏi kho và tự động gỡ tệp đính kèm này khỏi các bản tin phát tin.')}
          </div>
        </div>
      </Space>
    </Modal>
  );
}
