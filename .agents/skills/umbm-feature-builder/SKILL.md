---
name: umbm-feature-builder
description: >-
  Quy trình chuẩn từng bước để phát triển, chuẩn hóa API, dựng giao diện Ant Design
  theo mẫu 3DO ADMIN, kiểm thử tự động và đánh dấu hoàn thành cho bất kỳ màn hình
  (AI-TAB-01..75) hoặc luồng nghiệp vụ (FLOW-01..05) nào trong hệ thống Ụm Bò Milk HR V5.1.
---

# Quy Trình Phát Triển Màn Hình & Nghiệp Vụ Chuẩn Ụm Bò Milk HR V5.1

Sử dụng skill này mỗi khi triển khai một tab mới (`AI-TAB-01` đến `AI-TAB-75`) hoặc luồng nghiệp vụ (`FLOW-01` đến `FLOW-05`) từ [AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md](../../../docs/AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md).

## Bước 1: Khai báo Enum & Schema tại `@umbm/shared`
1. Kiểm tra `packages/shared/src/enums.ts`:
   - Đảm bảo mọi trạng thái, phân loại, mã lỗi validation (`ValidationErrorCode`) và nhãn tiếng Việt (`*_LABELS`, `*_OPTIONS`) đã được định nghĩa tập trung.
2. Kiểm tra `packages/shared/src/schemas.ts`:
   - Khai báo Zod schema cho bản ghi lưu trên Google Sheets và schema cho request body / query params với thông báo lỗi 100% bằng tiếng Việt.

## Bước 2: Đăng ký Bảng & Viết Route API tại `apps/api`
1. Nếu tab cần bảng mới trên Google Sheets, kiểm tra định nghĩa cột trong `packages/shared/src/sheets-schema.ts` và đăng ký `TableStore` trong `apps/api/src/data/database.ts`.
2. Trong file route (`apps/api/src/routes/*.routes.ts`):
   - Hỗ trợ tham số `?refresh=1` trên API danh sách để nạp mới trực tiếp từ Google Sheets (`refreshIfIdle()`) khi người dùng bấm nút **Làm mới**.
   - Dùng `paginateAndSort(items, options)` từ `apps/api/src/lib/list-query.ts` cho mọi API danh sách.
   - Dùng `sendSuccess(request, message, data, meta)` hoặc `sendPaginated(request, message, result)` từ `apps/api/src/lib/response.ts`.
   - Hỗ trợ endpoint thao tác hàng loạt (`/bulk-action`) cho các danh sách có chọn nhiều dòng.
   - Nếu thao tác ghi vào nhiều bảng hoặc kèm gửi email/thông báo quan trọng, bọc trong `ctx.reconciliation.executeSaga(...)`.
   - Luôn ghi nhật ký `await ctx.audit.record(...)` cho mọi thao tác thêm/sửa/xóa/duyệt.

## Bước 3: Xây dựng Giao diện tại `apps/web` (Chuẩn `3DO ADMIN`)
1. Tuyệt đối không viết dồn vào 1 file quá 220 dòng. Không dùng prop đã deprecated của Ant Design v5 (`destroyOnClose` -> dùng `destroyOnHidden`, `valueStyle` -> dùng `styles`).
2. Tái sử dụng các component chuẩn trong `apps/web/src/ui/components/`:
   - `FilterToolbar`: Thanh tìm kiếm + các bộ lọc `Select` + nút `Làm mới` (có `loading` gọi `?refresh=1`) + nút hành động chính `+ Thêm mới ...` màu `#2563EB`.
   - `DataTableCard` + `BulkActionBar`: Bảng dữ liệu chuẩn có cột `NO`, `StatusTag`, cột `Thao tác` (`RowActionButtons` có `loading` theo từng dòng), hiển thị `BulkActionBar` khi tích chọn nhiều dòng (`bulkActions`), và hiển thị `loading` khi `isLoading || isFetching`.
   - `TopHeaderBar`: Các nút công cụ, chuông thông báo và khối Profile Login có viền mảnh `1px solid #CBD5E1` và bo nhẹ `6px–8px` tinh tế.

## Bước 4: Viết Test Tự Động & Cập Nhật Checklist
1. Viết test trong `apps/api/src/routes/*.test.ts` kiểm tra đủ:
   - Cấu trúc trả về `{ success, message, data, meta, errors, request_id }`.
   - Tìm kiếm (`q`), lọc (`filters`), sắp xếp (`sort_by`, `sort_order`), phân trang (`page`, `per_page`), và thao tác hàng loạt (`bulk-action`).
   - Lỗi validation trả về đúng `errors.details[]` với `field`, `code`, `message` (tiếng Việt), `rejected_value`.
   - Phân quyền RBAC (`401` khi chưa đăng nhập, `403` khi sai vai trò) và khóa lạc quan (`409` khi lệch `version`).
2. Chạy lệnh kiểm tra:
   ```bash
   pnpm typecheck
   pnpm --filter @umbm/api test
   ```
3. Sau khi toàn bộ test xanh, mở `docs/AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md` và đánh dấu `- [x]` cho hạng mục vừa hoàn thành.
