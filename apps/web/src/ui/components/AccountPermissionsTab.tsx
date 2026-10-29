'use client';

import { Button, Card, Checkbox, Empty, Flex, Form, Input, Space, Spin, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClearOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_LABELS,
  getAllowedExtraPermissionsForRole,
  type Permission,
  type Role,
} from '@umbm/shared';
import { api } from '@/lib/api';
import type { AccountRowItem } from './AccountDetailDrawer';

interface AccountAuditHistoryItem {
  id: string;
  action: string;
  actionLabel: string;
  actorUsername: string;
  actorDisplayName: string;
  actorRoleLabel: string;
  summary: string;
  created_at: string;
}

export function AccountPermissionsFormSection({ role }: { role: Role }) {
  const form = Form.useFormInstance();
  const selectedExtra: Permission[] = Form.useWatch('extra_permissions', form) ?? [];
  const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
  const allowedExtraSet = new Set<Permission>(getAllowedExtraPermissionsForRole(role));

  const toggleExtra = (perm: Permission, checked: boolean) => {
    const next = checked
      ? [...new Set([...selectedExtra, perm])]
      : selectedExtra.filter((p) => p !== perm);
    form.setFieldValue('extra_permissions', next);
  };

  return (
    <div>
      <Card size="small" title={`1. Quyền mặc định theo vai trò ${ROLE_LABELS[role]} (${defaultPerms.length} quyền cố định)`} style={{ marginBottom: 12 }}>
        <Space size={[6, 6]} wrap>
          {defaultPerms.map((p) => (
            <Tag key={p} color="blue" style={{ margin: 0, borderRadius: 2 }}>
              <CheckCircleOutlined /> {PERMISSION_LABELS[p] ?? p}
            </Tag>
          ))}
        </Space>
      </Card>

      <Card
        size="small"
        title={`2. Permission bổ sung được phê duyệt (Đang cấp thêm: ${selectedExtra.length} quyền)`}
        extra={
          selectedExtra.length > 0 && (
            <Button size="small" icon={<ClearOutlined />} onClick={() => form.setFieldValue('extra_permissions', [])}>
              Gỡ toàn bộ quyền bổ sung
            </Button>
          )
        }
        style={{ marginBottom: 12 }}
      >
        <Form.Item name="extra_permissions" hidden><Input /></Form.Item>
        {allowedExtraSet.size === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Vai trò này không có danh mục quyền bổ sung mở rộng ngoài bộ quyền chuẩn" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PERMISSION_GROUPS.map((grp) => {
              const items = grp.permissions.filter((p) => allowedExtraSet.has(p));
              if (items.length === 0) return null;
              return (
                <div key={grp.key} style={{ padding: '8px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#0F172A', marginBottom: 6 }}>{grp.label}</div>
                  <Flex wrap="wrap" gap={12}>
                    {items.map((p) => (
                      <Checkbox
                        key={p}
                        checked={selectedExtra.includes(p)}
                        onChange={(e) => toggleExtra(p, e.target.checked)}
                      >
                        <span style={{ fontSize: 12 }}>{PERMISSION_LABELS[p] ?? p}</span>
                      </Checkbox>
                    ))}
                  </Flex>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Form.Item name="reason" label="Ghi chú phân quyền" style={{ marginBottom: 0 }}>
        <Input placeholder="Ví dụ: Cấp bổ sung quyền theo phê duyệt của Quản lý vận hành..." />
      </Form.Item>
    </div>
  );
}

export function AccountPermissionsSummaryCard({ account }: { account: AccountRowItem }) {
  const defaultPerms = DEFAULT_ROLE_PERMISSIONS[account.role] ?? [];
  const extraPerms = account.extraPermissions ?? [];

  return (
    <Card size="small" title={<span><SafetyCertificateOutlined /> Chi tiết Quyền hạn</span>} style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
        Quyền mặc định của vai trò {account.roleLabel} ({defaultPerms.length}):
      </div>
      <Space size={[6, 6]} wrap style={{ marginBottom: 12 }}>
        {defaultPerms.map((p) => (
          <Tag key={p} color="blue" style={{ margin: 0, borderRadius: 2 }}>{PERMISSION_LABELS[p] ?? p}</Tag>
        ))}
      </Space>

      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
        Permission bổ sung đã phê duyệt ({extraPerms.length}):
      </div>
      {extraPerms.length > 0 ? (
        <Space size={[6, 6]} wrap>
          {extraPerms.map((p) => (
            <Tag key={p} color="purple" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}>
              + {PERMISSION_LABELS[p] ?? p}
            </Tag>
          ))}
        </Space>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Không có quyền bổ sung (Đang sử dụng bộ quyền chuẩn của vai trò {account.roleLabel})
        </Typography.Text>
      )}
    </Card>
  );
}

export function AccountAuditHistoryTab({ accountId }: { accountId: string }) {
  const historyQuery = useQuery({
    queryKey: ['account-audit-history', accountId],
    queryFn: () => api.get<AccountAuditHistoryItem[]>(`/admin/accounts/${accountId}/history`),
    enabled: !!accountId,
  });

  if (historyQuery.isLoading) {
    return <div style={{ padding: 32, textAlign: 'center' }}><Spin tip="Đang tải lịch sử thay đổi quyền..." /></div>;
  }

  const rows = historyQuery.data ?? [];
  return (
    <div>
      <Table<AccountAuditHistoryItem>
        size="small"
        rowKey="id"
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        dataSource={rows}
        locale={{ emptyText: 'Chưa có lịch sử thay đổi quyền cho tài khoản này' }}
        columns={[
          {
            title: 'Thời điểm',
            dataIndex: 'created_at',
            width: 150,
            render: (v: string) => <span className="num" style={{ fontSize: 12 }}>{dayjs(v).format('HH:mm:ss DD/MM/YYYY')}</span>,
          },
          {
            title: 'Hành động',
            dataIndex: 'actionLabel',
            width: 210,
            render: (v: string) => <Tag color="geekblue" style={{ margin: 0, borderRadius: 2, fontWeight: 600 }}>{v}</Tag>,
          },
          {
            title: 'Người thực hiện',
            key: 'actor',
            width: 190,
            render: (_, r) => (
              <div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{r.actorDisplayName}</div>
                <div style={{ fontSize: 11, color: '#64748B' }}>@{r.actorUsername} · {r.actorRoleLabel}</div>
              </div>
            ),
          },
          {
            title: 'Chi tiết thay đổi quyền & trạng thái',
            dataIndex: 'summary',
            render: (v: string) => <span style={{ fontSize: 12, color: '#0F172A' }}>{v}</span>,
          },
        ]}
      />
    </div>
  );
}
