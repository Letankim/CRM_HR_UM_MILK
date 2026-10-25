# QUY TẮC KIẾN TRÚC & PHÁT TRIỂN HỆ THỐNG ỤM BÒ MILK HR V5.1 (AUTO STACK)

Tài liệu này là bộ quy tắc bắt buộc (`ALWAYS_ON`) cho mọi AI Agent khi đọc, sửa đổi hoặc phát triển tính năng mới trong monorepo `CRM_HR_UM_MILK`.

---

## 1. Chuẩn Format API Response & Validation Error (100% Tiếng Việt)

Mọi API endpoint trong `apps/api` **BẮT BUỘC** trả về cấu trúc JSON thống nhất theo 2 mẫu dưới đây. Tuyệt đối không trả về object tự do.

### 1.1. Response Thành Công (Danh sách có Search / Sort / Filter / Pagination hoặc Đơn lẻ)
```json
{
  "success": true,
  "message": "Lấy danh sách tài khoản thành công",
  "data": [ ... ],
  "meta": {
    "pagination": {
      "page": 1,
      "per_page": 12,
      "total": 2,
      "last_page": 1,
      "has_next_page": false,
      "has_previous_page": false
    },
    "sort": {
      "sort_by": "created_at",
      "sort_order": "desc"
    },
    "filters": {
      "status": "ACTIVE"
    }
  },
  "errors": null,
  "request_id": "req_6ab3918cae0ee00a"
}
```
- Với endpoint trả về 1 bản ghi đơn lẻ (chi tiết, tạo mới, cập nhật): `data` là object kết quả, `meta` là `null` (hoặc object bổ sung nếu cần).
- Với endpoint danh sách (`GET` list): `data` luôn là mảng `T[]` và `meta` luôn có đầy đủ `{ pagination, sort, filters }`.
- `request_id` luôn có prefix `req_` + 16 ký tự hex (ví dụ: `req_6ab3918cae0ee00a`).

### 1.2. Response Khi Lỗi (Validation Error / Business Error)
```json
{
  "success": false,
  "message": "Dữ liệu gửi lên không hợp lệ",
  "data": null,
  "meta": null,
  "errors": {
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "field": "phone_number",
        "code": "INVALID_PHONE",
        "message": "Định dạng số điện thoại không hợp lệ",
        "rejected_value": "1865341745"
      }
    ]
  },
  "request_id": "req_c6c37e0e29c8847e"
}
```
- **Ngôn ngữ**: Toàn bộ `message` (cấp ngoài và trong từng phần tử `details`) **BẮT BUỘC bằng tiếng Việt** chuẩn xác, lịch sự, rõ ràng cho người dùng Việt Nam.
- **Validation chi tiết**: Khi lỗi đầu vào (Zod hoặc kiểm tra nghiệp vụ theo trường), luôn chỉ rõ `field`, `code` (thuộc enum `ValidationErrorCode` trong `@umbm/shared`), `message` (tiếng Việt), và `rejected_value` (giá trị người dùng gửi lên bị từ chối).

---

## 2. Quản Lý Enum, Cấu Hình Hệ Thống (`.env`) & Chuẩn Database V5.1 (`@umbm/shared`)

- **TUYỆT ĐỐI KHÔNG** khai báo lặp lại hoặc hardcode các chuỗi trạng thái (`status`), vai trò (`role`), loại ca, loại đơn, mã lỗi (`error code`), nhãn hiển thị tiếng Việt ở riêng lẻ từng file Backend hay Frontend.
- **Ẩn hoàn toàn mã key hệ thống khỏi giao diện**: Giao diện người dùng tuyệt đối không hiển thị các key nội bộ như `USER: NV.MOI`, `THU_VIEC`, `CHINH_THUC`, `STORE`, `CORE.USERS`, `ACCOUNT_ACTIVATED`, `[INVALID_PHONE]`, `v1`. Chỉ hệ thống làm việc với key nội bộ; giao diện bắt buộc hiển thị nhãn tiếng Việt (`ROLE_LABELS`, `TABLE_DISPLAY_LABELS`, `EMAIL_TEMPLATE_LABELS`).
- **Số điện thoại mặc định bắt đầu bằng số `0`**: Toàn bộ số điện thoại nhân sự/tài khoản chuẩn hóa về 10 chữ số bắt đầu bằng `0` (ví dụ `0901000001`), không dùng `+84`.
- **Cấu hình biến hệ thống qua `.env` (`SYSTEM_CONFIG`)**: Các chuỗi thương hiệu và tham số vận hành (`[Ụm Bò Milk HR]`, `ỤM BÒ MILK`, `HỆ THỐNG NHÂN SỰ`, `UB`, `v5.1.0`, chu kỳ thử việc 12 ngày, phụ cấp đổi ca 30.000đ) được cấu hình tập trung tại `.env` và `packages/shared/src/system-config.ts`.
- **Thiết kế đầy đủ 100% trường Database V5.1 ngay từ đầu**: Toàn bộ 7 Google Spreadsheets (`CORE`, `HR`, `SCHEDULE`, `ATTENDANCE`, `PAYROLL`, `COMMS`, `SYSTEM`) trong `packages/shared/src/sheets-schema.ts` và `domain-schemas.ts` bao phủ đầy đủ các trường Hồ sơ nhân sự, Lịch tuần, Điểm danh GPS, Kỳ lương, Snapshot lương (tách giờ/đơn giá thử việc & chính thức, tăng ca, phụ cấp đổi ca, thưởng/phạt) và Phiếu lương (`PAYSLIPS`).
- **Nội dung chính (`Layout.Content`) chiếm trọn 100% phần còn lại**: Không giới hạn `maxWidth` thu nhỏ khung nội dung trên màn hình lớn.

---

## 3. Quy Chuẩn Giao Diện (`3DO ADMIN` Enterprise Style) & Tách Component

Giao diện Web (`apps/web`) lấy cảm hứng từ chuẩn quản trị doanh nghiệp hiện đại (tham chiếu mẫu `3DO ADMIN`):
1. **Sử dụng tối đa thư viện Ant Design v5 (`antd`) & `@ant-design/icons`**:
   - Không tự viết CSS thủ công dài dòng. Sử dụng `ConfigProvider`, `Layout`, `Menu`, `Table`, `Card`, `Flex`, `Space`, `Select`, `Input`, `Tag`, `Modal`, `Drawer`, `Descriptions`, `Badge`.
   - Tuyệt đối không dùng prop đã deprecated của Ant Design v5 (bắt buộc dùng `destroyOnHidden` thay cho `destroyOnClose`, dùng `styles` thay cho `valueStyle`/`bodyStyle`).
   - **Không dùng Emoji** ở bất kỳ đâu trong giao diện, thông báo hay tài liệu. Chỉ dùng icon từ `@ant-design/icons`.
2. **Hình học phẳng, sắc nét & Viền Header tinh tế**:
   - `borderRadius` toàn cục `4px` cho khung bảng/form (`borderRadius: 4`, `borderRadiusSM: 2`, `borderRadiusLG: 4`), viền `1px solid #E5E7EB`.
   - **Riêng các phần tử tương tác trên Header (`TopHeaderBar`)**: Nút đóng/mở menu, nút tiện ích nhanh, chuông `Thông báo` và **khối Profile Login** có viền mảnh `1px solid #CBD5E1` và bo nhẹ `6px–8px` (Avatar tròn `50%`) để tạo điểm nhấn cân đối, chuyên nghiệp.
   - Màu chủ đạo: Royal Blue `#2563EB` (nền chọn `#EFF6FF`), nền trang `#F8FAFC`, chữ chính `#0F172A`, chữ phụ `#64748B`.
3. **Bố cục trang danh sách chuẩn (`3DO ADMIN` Pattern), Bulk Actions & Loading**:
   - **Header trên cùng (`TopHeaderBar.tsx`)**: Nút thu gọn menu + Breadcrumb phân cấp bên trái; bên phải gồm nút `Trợ lý đối soát`, chuông thông báo (có Popover xem nhanh & làm mới), nút `Cổng NV`, và khối Profile Login kèm tag vai trò.
   - **Sidebar trái (`width={260}`)**: Chia theo từng nhóm chức năng có thể thu/mở. **Mục con chỉ lùi nhẹ `8px` so với tiêu đề nhóm (`inlineIndent={10}` + `.umbm-sider-menu`)**, không lùi sâu 48px gây hẹp hoặc cắt chữ (`...`). Chân sidebar cố định dòng `Phiên bản hệ thống` + badge `v5.1.0`.
   - **Khối nội dung**:
     - Thanh công cụ lọc (`FilterToolbar`): Nằm trong khung trắng viền mảnh, bên trái là ô tìm kiếm và các `Select` lọc; bên phải là nút `Làm mới` (gọi `?refresh=1` đồng bộ trực tiếp Google Sheets kèm hiệu ứng `loading`), nút **`Xuất Excel`** và nút hành động chính (`+ Thêm mới ...`).
     - Bảng dữ liệu (`DataTableCard` + `BulkActionBar`): Có cột chọn checkbox, cột `NO`, các cột trạng thái dùng `StatusTag`, cột `Thao tác` dùng `RowActionButtons` (có `loading` theo từng dòng). **Khi chọn từ 1 bản ghi trở lên, bắt buộc hiển thị `BulkActionBar` ngay đầu bảng** để thực hiện thao tác hàng loạt (Kích hoạt, Mở khóa, Thu hồi, Xóa đã chọn, Xuất Excel đã chọn).
     - **Đầy đủ Thêm / Sửa / Xóa (CRUD) & Xuất Excel Toàn Hệ Thống**:
       - Mọi danh mục nghiệp vụ (Hồ sơ nhân sự, Tài khoản, Chi nhánh, Khung ca, Lịch phân ca, Bậc lương, Khoản thưởng/điều chỉnh, Kỳ lương nháp) **bắt buộc có đầy đủ Thêm mới (`POST`), Sửa (`PUT`), Xóa (`DELETE` mềm `is_deleted=true`)** kèm xác nhận an toàn; chỉ các bảng hệ thống bất biến (`AUDIT_LOG`, sự kiện chấm công gốc, kỳ lương đã `PUBLISHED`/`PAID`) mới khóa sửa/xóa theo quy tắc bảo mật.
       - Mọi màn hình danh sách & bảng lương bắt buộc hỗ trợ **Xuất Excel chuẩn doanh nghiệp** (`exportToExcel` tại `apps/web/src/lib/export-excel.ts`).
     - **Lương linh hoạt (`Theo giờ` / `Theo tháng` + Thưởng/Phụ cấp) & Lịch làm việc đa chế độ**:
       - Cấu hình lương hỗ trợ cả trả lương **Theo giờ (`HOURLY`)** và **Theo tháng (`MONTHLY`)**, tính đầy đủ công thử việc, công chính thức, tăng ca (`OT`), phụ cấp đổi ca (`30.000đ`), **Thưởng (`Bonus`)**, phụ cấp, điều chỉnh cộng/trừ và xuất Bảng lương / Phiếu lương Excel.
       - **Lương là Hồ sơ lương CÁ NHÂN theo từng nhân sự (bảng `PAY_RATES`, `employee_id` bắt buộc), TUYỆT ĐỐI KHÔNG cấu hình lương theo vai trò/khối**: mỗi nhân sự có hình thức (`Theo giờ` / `Theo tháng` / `Theo ca`), mức lương chính thức riêng, **% lương thử việc** riêng (mặc định `APP_PROBATION_SALARY_PERCENT`), công chuẩn, hệ số OT và phụ cấp cố định. Điều chỉnh lương = tạo mức mới có `effective_from` và đóng mức cũ (`effective_to`), không ghi đè lịch sử; mức đã dùng chốt kỳ lương bị khóa sửa/xóa.
       - Tính lương theo từng ngày công: tra mức lương hiệu lực tại ngày đó + giai đoạn tại ngày đó (`official_from`) — thử việc nhân `% thử việc`, lương tháng chia `công chuẩn`. Logic tính nằm ở hàm thuần `apps/api/src/services/payroll-calculator.ts` (bắt buộc có unit test). Kỳ lương chỉ đi đúng thứ tự `DRAFT -> RECONCILE -> APPROVED -> PUBLISHED -> PAID`; khi `PUBLISHED` sinh `PAYSLIPS`; sai lệch sau phát hành chỉ xử lý bằng phiếu điều chỉnh (`PAYSLIP_REVISIONS`).
       - Màn hình Lịch làm việc (`/admin/schedules`) bắt buộc hỗ trợ 3 chế độ xem: **Lưới Tuần (`Ca × Ngày`)**, **Lịch Tháng có đánh dấu (`Calendar`)** và **Bảng chi tiết (`Table`)**.
     - **Đảm bảo dữ liệu luôn mới nhất, có Debounce & Loading thông minh**:
       - Mọi ô tìm kiếm (`FilterToolbar`, `useDebouncedValue`) **bắt buộc có Debounce `400ms`**, không gọi API trên từng ký tự gõ.
       - Tuyệt đối không dùng `refetchInterval` hoặc `refetchOnWindowFocus` làm bật `<Spin>` liên tục gây khó chịu khi người dùng đang đứng ở trang. Chỉ hiện `loading` khi tải lần đầu, khi lọc/phân trang, hoặc khi bấm nút `Làm mới`.
       - Khi gặp lỗi `401 UNAUTHORIZED` (`Phiên đăng nhập không hợp lệ hoặc đã hết hạn`), tự động xóa phiên cũ và chuyển hướng ngay ra trang `/login` (hoặc `/nv/login`). Sau khi đăng nhập, tự động điều hướng về đúng trang phù hợp với quyền (`resolveLandingRoute`).
4. **Bắt buộc tách Component tái sử dụng & Giới hạn độ dài file**:
   - Mọi phần tử dùng chung phải tách vào `apps/web/src/ui/components/` (`TopHeaderBar.tsx`, `FilterToolbar.tsx`, `DataTableCard.tsx`, `BulkActionBar.tsx`, `RowActionButtons.tsx`, `AccountCreateModal.tsx`, `AccountRevokeModal.tsx`, `AccountDetailDrawer.tsx`).
   - Không gộp toàn bộ logic, modal, form, bảng vào 1 file dài. **Mỗi file `.tsx` / `.ts` không vượt quá 220 dòng**. Nếu dài hơn, bắt buộc tách nhỏ thành sub-components hoặc custom hooks.

---

## 4. Rà Soát Dữ Liệu & Đối Soát Tự Động (Vì Google Sheets Không Có Transaction)

Google Sheets không có `BEGIN / COMMIT / ROLLBACK` như RDBMS. Để đảm bảo dữ liệu chính xác tuyệt đối:
1. **Single-Writer Queue + Optimistic Locking (`version`)**:
   - Mọi thao tác ghi phải đi qua `WriteQueue` tuần tự theo từng spreadsheet và kiểm tra `version` + đọc lại dòng trực tiếp từ Google Sheets trước khi ghi đè.
2. **Saga / Nhật Ký Thao Tác Đa Bảng (`OPERATION_JOURNAL` & `ReconciliationService`)**:
   - Mọi nghiệp vụ ghi vào từ 2 bảng trở lên (ví dụ: Kích hoạt/Thu hồi tài khoản, Duyệt đổi ca, Chốt kỳ lương, Xử lý nghỉ khẩn cấp) phải được bọc qua `ReconciliationService.executeSaga()` để ghi nhận trạng thái từng bước (`PENDING` -> `COMMITTED` / `COMPENSATED` / `NEEDS_RECONCILIATION`).
3. **Bộ Quét Toàn Vẹn Dữ Liệu (`ReconciliationService.scanAndRepair()`)**:
   - Kiểm tra khóa ngoại (orphan records), trùng lặp khóa duy nhất (`username`, `phone`, `employee_code`, `idempotency_key`), trạng thái mâu thuẫn, và tự động sửa chữa hoặc đưa vào danh sách cảnh báo tại tab `ADM-08 (Tích hợp & Đồng bộ)`.

---

## 5. Chuẩn Email Doanh Nghiệp (Transactional Email Templates)

- Sử dụng chính tài khoản Gmail cá nhân của hệ thống (qua Gmail API / Nodemailer OAuth2) để gửi email thông báo.
- Template email (`apps/api/src/services/email.service.ts`) phải thiết kế theo phong cách văn bản doanh nghiệp nghiêm túc:
  - Bố cục bảng (`<table>`), nền ngoài `#F8FAFC`, khung nội dung trắng `#FFFFFF`, viền `1px solid #E5E7EB`, **bo góc tối đa `2px` (hoặc `0px`)**, header thanh ngang màu `#0F172A` hoặc `#2563EB`.
  - Tuyệt đối không dùng emoji, không bo tròn nhiều, không màu mè giống email quảng cáo tự động của AI.

---

## 6. Triển Khai Render (Free Tier) + Vercel & Quy Trình Checklist

1. **Tương thích Vercel (FE) + Render Free Tier (BE) + 1 Google Cá Nhân**:
   - Hỗ trợ CORS đầy đủ cho domain Vercel và truyền token quaทั้ง Cookie (`SameSite=Lax` qua Vercel Rewrite proxy `/api/*`) lẫn Header `Authorization: Bearer` / Socket handshake `auth.token` cho kết nối WebSocket trực tiếp tới Render.
   - Có endpoint `/api/internal/cron/:job` bảo vệ bằng `INTERNAL_API_TOKEN` để kích hoạt backup hàng ngày, đối soát dữ liệu và giữ ấm (keep-alive) cho Render Free Tier.
2. **Cập nhật Checklist Bắt Buộc (`docs/AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md`)**:
   - Khi hoàn thành bất kỳ hạng mục hạ tầng (`AI-INFRA-*`), màn hình (`AI-TAB-*`), luồng (`FLOW-*`), hoặc kiểm thử (`IT-CHK-*`), AI **BẮT BUỘC** viết test tự động, chạy pass 100%, và đánh dấu `[x]` vào file `docs/AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md`.
