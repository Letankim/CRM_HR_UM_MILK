'use client';

import { Button, Flex, Input, Select, Space } from 'antd';
import { FileExcelOutlined, LoadingOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BRAND } from '../theme';

export interface FilterSelectConfig {
  key: string;
  value: string;
  placeholder?: string;
  width?: number;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

export interface FilterToolbarProps {
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  debounceMs?: number;
  selects?: FilterSelectConfig[];
  onRefresh?: () => void;
  refreshing?: boolean;
  onExportExcel?: () => void;
  exportLabel?: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  extraRight?: ReactNode;
}

/**
 * Thanh công cụ tìm kiếm (tích hợp sẵn Debounce 400ms), bộ lọc, Xuất Excel và nút hành động chính.
 */
export function FilterToolbar({
  searchPlaceholder = 'Tìm kiếm theo tên, mã định danh...',
  searchValue,
  onSearchChange,
  debounceMs = 400,
  selects = [],
  onRefresh,
  refreshing,
  onExportExcel,
  exportLabel = 'Xuất Excel',
  primaryActionLabel,
  onPrimaryAction,
  extraRight,
}: FilterToolbarProps) {
  const [draft, setDraft] = useState(searchValue);
  const onSearchRef = useRef(onSearchChange);
  onSearchRef.current = onSearchChange;

  useEffect(() => {
    setDraft(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (draft === searchValue) return;
    const timer = setTimeout(() => {
      onSearchRef.current(draft);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [draft, searchValue, debounceMs]);

  const isTyping = draft !== searchValue;

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${BRAND.border}`,
        borderRadius: 4,
        padding: '12px 16px',
        marginBottom: 12,
      }}
    >
      <Flex justify="space-between" align="center" wrap gap={10}>
        <Space wrap size={10}>
          <Input
            prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
            suffix={isTyping ? <LoadingOutlined style={{ color: BRAND.primary, fontSize: 12 }} /> : null}
            placeholder={searchPlaceholder}
            value={draft}
            allowClear
            onChange={(e) => {
              const nextVal = e.target.value;
              setDraft(nextVal);
              if (nextVal === '') onSearchRef.current('');
            }}
            onPressEnter={() => onSearchRef.current(draft)}
            style={{ width: 280, maxWidth: '100%' }}
          />
          {selects.map((sel) => (
            <Select
              key={sel.key}
              value={sel.value}
              placeholder={sel.placeholder}
              options={sel.options}
              onChange={sel.onChange}
              style={{ width: sel.width ?? 180, maxWidth: '100%' }}
            />
          ))}
        </Space>

        <Space wrap size={8}>
          {extraRight}
          {onExportExcel && (
            <Button icon={<FileExcelOutlined style={{ color: '#15803D' }} />} onClick={onExportExcel}>
              {exportLabel}
            </Button>
          )}
          {onRefresh && (
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={refreshing}>
              Làm mới
            </Button>
          )}
          {primaryActionLabel && onPrimaryAction && (
            <Button type="primary" icon={<PlusOutlined />} onClick={onPrimaryAction}>
              {primaryActionLabel}
            </Button>
          )}
        </Space>
      </Flex>
    </div>
  );
}
