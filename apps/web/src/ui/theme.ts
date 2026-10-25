import type { ThemeConfig } from 'antd';

/**
 * Design tokens theo chuẩn quản trị doanh nghiệp (3DO ADMIN Enterprise Reference).
 * Nguyên tắc:
 * - Màu chủ đạo Royal Blue (#2563EB), nền chọn xanh nhạt (#EFF6FF).
 * - Khung bảng/form bo góc 4px, nhãn Tag bo 2px; riêng các cụm nút điều khiển & Profile trên Header
 *   được phép viền mảnh kèm bo nhẹ 6px-8px để cân đối thẩm mỹ.
 * - Viền mảnh 1px solid #E5E7EB, không dùng gradient lòe loẹt.
 */
export const BRAND = {
  primary: '#2563EB',
  primaryBg: '#EFF6FF',
  primaryBorder: '#BFDBFE',
  text: '#0F172A',
  textSecondary: '#64748B',
  border: '#E5E7EB',
  headerControlBorder: '#CBD5E1',
  layout: '#F8FAFC',
};

export const theme: ThemeConfig = {
  cssVar: true,
  hashed: false,
  token: {
    colorPrimary: BRAND.primary,
    colorInfo: BRAND.primary,
    colorSuccess: '#16A34A',
    colorWarning: '#D97706',
    colorError: '#DC2626',
    colorTextBase: BRAND.text,
    colorTextSecondary: BRAND.textSecondary,
    colorBorder: BRAND.border,
    colorBorderSecondary: '#E5E7EB',
    colorBgLayout: BRAND.layout,
    borderRadius: 4,
    borderRadiusSM: 2,
    borderRadiusLG: 4,
    fontFamily: 'var(--font-sans), system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 13,
    controlHeight: 34,
    boxShadow: 'none',
    boxShadowSecondary: '0 2px 6px rgba(15, 23, 42, 0.06)',
  },
  components: {
    Layout: {
      siderBg: '#FFFFFF',
      headerBg: '#FFFFFF',
      headerHeight: 56,
      headerPadding: '0 20px',
    },
    Menu: {
      itemSelectedBg: BRAND.primaryBg,
      itemSelectedColor: BRAND.primary,
      itemBorderRadius: 4,
      itemHeight: 36,
      itemMarginInline: 4,
      itemPaddingInline: 10,
      iconMarginInlineEnd: 8,
      subMenuItemBg: '#FFFFFF',
    },
    Table: {
      headerBg: '#F8FAFC',
      headerColor: '#334155',
      cellPaddingBlock: 12,
      cellPaddingInline: 14,
      headerSplitColor: 'transparent',
      borderColor: '#E5E7EB',
    },
    Card: {
      headerFontSize: 14,
      borderRadiusLG: 4,
    },
    Button: {
      primaryShadow: 'none',
      defaultShadow: 'none',
      borderRadius: 4,
      fontWeight: 500,
    },
    Input: {
      borderRadius: 4,
    },
    Select: {
      borderRadius: 4,
    },
    Tag: {
      borderRadiusSM: 2,
      defaultBg: '#F8FAFC',
    },
    Modal: {
      borderRadiusLG: 4,
    },
    Segmented: {
      itemSelectedBg: BRAND.primaryBg,
      itemSelectedColor: BRAND.primary,
      trackBg: '#F1F5F9',
      trackPadding: 3,
    },
    Tabs: {
      itemSelectedColor: BRAND.primary,
      itemHoverColor: BRAND.primary,
      inkBarColor: BRAND.primary,
    },
  },
};
