'use client';

import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  BoldOutlined,
  ClearOutlined,
  CodeOutlined,
  EyeOutlined,
  FontSizeOutlined,
  InfoCircleOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  TableOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Button, Input, Space, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';

interface RichHtmlEditorProps {
  value?: string;
  onChange?: (nextHtml: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function RichHtmlEditor({
  value = '',
  onChange,
  placeholder = 'Nhập nội dung quy định, hướng dẫn chi tiết hoặc định dạng văn bản HTML...',
  minHeight = 200,
}: RichHtmlEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const lastEmittedRef = useRef<string>(value);

  useEffect(() => {
    if (!sourceMode && editorRef.current && value !== lastEmittedRef.current) {
      editorRef.current.innerHTML = value || '';
      lastEmittedRef.current = value || '';
    }
  }, [value, sourceMode]);

  const emitChange = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastEmittedRef.current = html;
    onChange?.(html);
  };

  const exec = (cmd: string, arg?: string) => {
    if (sourceMode || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  const insertHtmlSnippet = (snippet: string) => {
    if (sourceMode) {
      const next = `${value}\n${snippet}`;
      lastEmittedRef.current = next;
      onChange?.(next);
      return;
    }
    exec('insertHTML', snippet);
  };

  return (
    <div style={{ border: '1px solid #CBD5E1', borderRadius: 4, background: '#FFFFFF', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          padding: '6px 10px',
          background: '#F8FAFC',
          borderBottom: '1px solid #E5E7EB',
        }}
      >
        <Space size={4} wrap>
          <Tooltip title="In đậm (Ctrl+B)"><Button size="small" type="text" icon={<BoldOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} /></Tooltip>
          <Tooltip title="In nghiêng (Ctrl+I)"><Button size="small" type="text" icon={<ItalicOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} /></Tooltip>
          <Tooltip title="Gạch chân (Ctrl+U)"><Button size="small" type="text" icon={<UnderlineOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} /></Tooltip>
          <Tooltip title="Tiêu đề mục"><Button size="small" type="text" icon={<FontSizeOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('formatBlock', 'H3'); }} /></Tooltip>
          <Tooltip title="Danh sách gạch đầu dòng"><Button size="small" type="text" icon={<UnorderedListOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} /></Tooltip>
          <Tooltip title="Danh sách đánh số"><Button size="small" type="text" icon={<OrderedListOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }} /></Tooltip>
          <Tooltip title="Căn trái"><Button size="small" type="text" icon={<AlignLeftOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('justifyLeft'); }} /></Tooltip>
          <Tooltip title="Căn giữa"><Button size="small" type="text" icon={<AlignCenterOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('justifyCenter'); }} /></Tooltip>
          <Tooltip title="Chèn bảng biểu quy định">
            <Button
              size="small"
              type="text"
              icon={<TableOutlined />}
              onMouseDown={(e) => {
                e.preventDefault();
                insertHtmlSnippet(
                  '<table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:13px;"><thead><tr style="background:#F1F5F9;"><th style="border:1px solid #CBD5E1;padding:6px 10px;text-align:left;">Hạng mục áp dụng</th><th style="border:1px solid #CBD5E1;padding:6px 10px;text-align:left;">Định mức / Quy định</th></tr></thead><tbody><tr><td style="border:1px solid #CBD5E1;padding:6px 10px;">Đối tượng áp dụng</td><td style="border:1px solid #CBD5E1;padding:6px 10px;">Toàn bộ nhân sự cửa hàng</td></tr></tbody></table><p><br/></p>',
                );
              }}
            >
              Chèn bảng
            </Button>
          </Tooltip>
          <Tooltip title="Chèn khung lưu ý nổi bật">
            <Button
              size="small"
              type="text"
              icon={<InfoCircleOutlined />}
              onMouseDown={(e) => {
                e.preventDefault();
                insertHtmlSnippet(
                  '<div style="padding:10px 12px;background:#EFF6FF;border-left:3px solid #2563EB;margin:8px 0;color:#1E3A8A;"><strong>Lưu ý vận hành:</strong> Nhập nội dung quy định bắt buộc tại đây...</div><p><br/></p>',
                );
              }}
            >
              Khung lưu ý
            </Button>
          </Tooltip>
          <Tooltip title="Xóa định dạng"><Button size="small" type="text" icon={<ClearOutlined />} disabled={sourceMode} onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} /></Tooltip>
        </Space>

        <Button
          size="small"
          icon={sourceMode ? <EyeOutlined /> : <CodeOutlined />}
          onClick={() => setSourceMode((s) => !s)}
        >
          {sourceMode ? 'Chế độ Trực quan' : 'Mã HTML'}
        </Button>
      </div>

      {sourceMode ? (
        <Input.TextArea
          value={value}
          onChange={(e) => {
            lastEmittedRef.current = e.target.value;
            onChange?.(e.target.value);
          }}
          rows={8}
          placeholder={placeholder}
          style={{ border: 'none', borderRadius: 0, fontFamily: 'Consolas, monospace', fontSize: 12.5, minHeight }}
        />
      ) : (
        <div style={{ position: 'relative' }}>
          {!value && (
            <div style={{ position: 'absolute', top: 10, left: 12, color: '#94A3B8', pointerEvents: 'none', fontSize: 13 }}>
              {placeholder}
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={emitChange}
            onBlur={emitChange}
            style={{
              minHeight,
              maxHeight: 360,
              overflowY: 'auto',
              padding: '10px 12px',
              outline: 'none',
              fontSize: 13.5,
              lineHeight: 1.65,
              color: '#0F172A',
            }}
          />
        </div>
      )}
    </div>
  );
}
