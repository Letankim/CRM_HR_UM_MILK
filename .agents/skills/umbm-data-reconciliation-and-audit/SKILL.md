---
name: umbm-data-reconciliation-and-audit
description: >-
  Quy trình rà soát toàn vẹn dữ liệu trên Google Sheets (khi không có transaction),
  chạy đối soát tự động (Reconciliation), kiểm tra hàng đợi Dead-Letter, mẫu Email
  doanh nghiệp và kiểm tra sẵn sàng triển khai Render Free Tier + Vercel.
---

# Quy Trình Đối Soát Toàn Vẹn Dữ Liệu & Kiểm Tra Hạ Tầng Render + Vercel

Sử dụng skill này khi cần kiểm tra tính nhất quán dữ liệu giữa các bảng Google Sheets, xử lý bản ghi lỗi (`SYNC_DEAD_LETTER`), kiểm tra mẫu email hoặc xác nhận cấu hình triển khai Render + Vercel.

## 1. Kiểm tra & Chạy Đối Soát Dữ Liệu (`ReconciliationService`)
Vì Google Sheets không có transaction đa bảng, hệ thống sử dụng `ReconciliationService` (`apps/api/src/services/reconciliation.service.ts`) để kiểm tra 5 nhóm toàn vẹn dữ liệu:
1. **Duplicate Unique Keys**: Kiểm tra trùng `username`, `phone` trong `USERS`, trùng mã `code` trong `BRANCHES`.
2. **Orphan Foreign Keys**: Kiểm tra tham chiếu chi nhánh (`branch_scope`), nhân sự (`employee_id`), người kích hoạt (`activated_by`).
3. **State Invariants**:
   - Tài khoản `ACTIVE` bắt buộc phải có `activated_at`.
   - Tài khoản `REVOKED` bắt buộc phải có `revoked_at`.
   - Tài khoản `LOCKED` đã hết hạn `locked_until` có thể được mở khóa tự động khi đối soát.
4. **Unresolved Dead Letters (`SYNC_DEAD_LETTER`)**: Thử ghi lại (replay) hoặc đánh dấu đối soát các thao tác bị ngắt giữa chừng.
5. **Sheet Row / Cache Drift**: Làm mới bộ nhớ đệm (`refreshIfIdle`) và kiểm tra các dòng sai định dạng schema (`invalidRows`).

## 2. Kiểm tra Email Doanh Nghiệp (`EmailService`)
- Kiểm tra các mẫu email trong `apps/api/src/services/email.service.ts`:
  - `ACCOUNT_ACTIVATED`: Thông báo kích hoạt tài khoản.
  - `ACCOUNT_REVOKED`: Thông báo thu hồi quyền truy cập.
  - `INTERVIEW_INVITE`: Thư mời phỏng vấn ứng viên.
  - `EMERGENCY_LEAVE_ALERT`: Cảnh báo nghỉ khẩn cấp tại cửa hàng.
  - `PAYSLIP_PUBLISHED`: Thông báo phát hành phiếu lương.
  - `SYSTEM_RECONCILIATION_ALERT`: Báo cáo đối soát & sao lưu hệ thống.
- Đảm bảo HTML email không dùng bo góc lớn (`border-radius <= 2px`), không dùng emoji, bố cục bảng chuẩn doanh nghiệp.

## 3. Danh mục kiểm tra triển khai Render (Free Tier) + Vercel + 1 Google Cá Nhân
1. **Google OAuth2 (1 tài khoản Gmail cá nhân duy nhất)**:
   - Chạy `pnpm google:doctor` để xác nhận `GOOGLE_OAUTH_REFRESH_TOKEN` hoạt động tốt với cả Google Sheets, Google Drive và Gmail.
2. **Render Free Tier (Backend `apps/api`)**:
   - Biến môi trường `API_PUBLIC_ORIGIN` trỏ về domain Vercel (ví dụ `https://umbm-hr.vercel.app`).
   - Đặt cron ping bên ngoài (GitHub Actions hoặc cron-job.org) gọi:
     - `GET /api/health` mỗi 10 phút (giữ ấm Render Free Tier không bị ngủ sau 15 phút).
     - `POST /api/internal/cron/reconcile` và `POST /api/internal/cron/backup` (kèm header `x-internal-token`) để tự động đối soát và backup hàng ngày lên Google Drive.
3. **Vercel (Frontend `apps/web`)**:
   - Biến môi trường `API_INTERNAL_URL` trỏ tới URL Render (`https://umbm-api.onrender.com`) để Next.js rewrite `/api/*` cùng tên miền (giữ nguyên cookie `SameSite=Lax`).
   - Biến môi trường `NEXT_PUBLIC_WS_URL` trỏ tới URL Render để Socket.IO kết nối trực tiếp kèm token xác thực.
