---
trigger: always_on
description: Quy tắc đảm bảo toàn vẹn dữ liệu trên Google Sheets (Saga & Reconciliation), mẫu Email doanh nghiệp và quy trình đánh dấu Checklist kiểm thử.
---

# Quy Chuẩn Toàn Vẹn Dữ Liệu Google Sheets, Email & Checklist

## 1. Bảo toàn dữ liệu khi không có Database Transaction
Vì toàn bộ dữ liệu lưu trên Google Sheets của 1 tài khoản Google cá nhân duy nhất (không có ACID transaction đa bảng):
1. **Ghi tuần tự & Khóa lạc quan (`version`)**:
   - Mọi thao tác thêm/sửa/xóa phải đi qua `TableStore` + `WriteQueue`.
   - Khi cập nhật (`update`), bắt buộc truyền `version` hiện tại và xác thực lại dòng trực tiếp trên Google Sheets trước khi ghi đè.
2. **Saga & Đối soát tự động (`ReconciliationService`)**:
   - Bất kỳ thao tác nào tác động từ 2 bảng trở lên (hoặc cập nhật bảng + gửi thông báo/email quan trọng) phải chạy qua `ctx.reconciliation.executeSaga()` để lưu vết vào bảng `OPERATION_JOURNAL` (hoặc `SYNC_DEAD_LETTER` khi lỗi).
   - Hệ thống cung cấp API `/api/admin/integrations/reconcile` để quét toàn bộ dữ liệu (kiểm tra khóa ngoại mồ côi, trùng mã duy nhất, bản ghi kẹt trạng thái, lệch phiên bản) và tự động sửa chữa an toàn.

## 2. Quy chuẩn Template Email Doanh Nghiệp
- Gửi email qua cùng tài khoản Gmail cá nhân bằng OAuth2 (`packages/google` / `apps/api/src/services/email.service.ts`).
- Thiết kế HTML email nghiêm túc: dùng bố cục `<table>`, viền mảnh `1px solid #E5E7EB`, **bo góc `0px` hoặc tối đa `2px`**, bảng thông số rõ ràng, không dùng emoji, không bo góc tròn trịa hay màu sắc sặc sỡ kiểu AI tự sinh.

## 3. Quy trình Checklist & Kiểm thử bắt buộc
- Danh sách 102 hạng mục tổng thể nằm tại `docs/AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md`.
- Mỗi khi hoàn thành một hạng mục (`AI-INFRA-*`, `AI-TAB-*`, `FLOW-*`, `IT-CHK-*`):
  1. Viết đầy đủ unit/integration test cho cả trường hợp thành công, phân trang/lọc/sắp xếp, lỗi validation từng trường và phân quyền RBAC.
  2. Chạy `pnpm --filter @umbm/api test` và `pnpm typecheck` đảm bảo pass 100%.
  3. Cập nhật ngay trạng thái từ `- [ ]` sang `- [x]` trong `docs/AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md`.
