---
trigger: always_on
description: Quy chuẩn thiết kế giao diện theo phong cách quản trị doanh nghiệp 3DO ADMIN, sử dụng Ant Design v5, bo góc hợp lý, thanh thao tác hàng loạt, trạng thái loading và tách component tái sử dụng.
---

# Quy Chuẩn Giao Diện (`3DO ADMIN` Style) & Kiến Trúc Component

## 1. Ngôn ngữ thiết kế bắt buộc
- **Thư viện chuẩn**: Sử dụng **Ant Design v5 (`antd`)** và `@ant-design/icons`. Không dùng các prop đã deprecated của Ant Design v5 (ví dụ: bắt buộc dùng `destroyOnHidden` thay cho `destroyOnClose` trên `Modal`/`Drawer`, dùng `styles` thay cho `valueStyle`/`bodyStyle`).
- **Quy tắc bo góc & viền đồng bộ**:
  - Khung bảng, Card, Input, Select, Modal: `borderRadius: 4`, viền `1px solid #E5E7EB`; Tag/Badge trạng thái: `borderRadius: 2`.
  - **Các cụm nút trên Header (`TopHeaderBar`)**: Nút đóng/mở menu, nút tiện ích (`Trợ lý đối soát`, `Cổng NV`), nút chuông `Thông báo` và **khối Profile Login** được phép có viền mảnh `1px solid #CBD5E1` và bo nhẹ `6px–8px` (Avatar tròn `50%`) kèm hiệu ứng hover nhẹ nhàng để tạo điểm nhấn chuyên nghiệp trên thanh Header.
- **Không Emoji, không màu mè AI**: Cấm tuyệt đối dùng ký tự emoji trong giao diện hoặc thông báo. Không dùng màu chuyển sắc (gradient), không dùng bóng đổ dày.
- **Bảng màu đồng bộ**:
  - Primary: `#2563EB` (Royal Blue), nền mục đang chọn `#EFF6FF`.
  - Text chính: `#0F172A`, Text phụ: `#64748B`.
  - Viền mảnh: `#E5E7EB`, nền khung trang: `#F8FAFC`, nền bề mặt: `#FFFFFF`.

## 2. Bố cục chuẩn của màn hình quản trị (`3DO ADMIN` Pattern)
1. **Sidebar trái (`width={260}`)**:
   - Đầu sidebar: Logo vuông gọn + Tên hệ thống (`ỤM BÒ MILK`) + Phụ đề (`OFFICIAL HR SYSTEM`).
   - Giữa sidebar: Các nhóm menu có thể đóng/mở. **Lưu ý thụt lề (`inlineIndent`)**: Mục con trong nhóm chỉ lùi vào nhẹ (`8px` so với tiêu đề nhóm, sử dụng `inlineIndent={10}` + class `.umbm-sider-menu`), tuyệt đối không lùi sâu 48px gây hẹp chữ hoặc cắt chữ (`...`).
   - Cuối sidebar: Khung cố định `Phiên bản hệ thống` kèm nhãn `v5.1.0`.
2. **Header trên (`TopHeaderBar.tsx`) & Nội dung chính Full-Width**:
   - Trái: Nút đóng/mở sidebar (viền mảnh, bo `6px`) + Breadcrumb phân cấp (`Quản trị / Nhóm / Tên trang hiện tại`).
   - Phải: Các nút tiện ích (`Trợ lý đối soát`, Chuông thông báo có Popover danh sách & nút làm mới, nút `Cổng NV`) + Khối Profile Login (viền `1px solid #CBD5E1`, bo `8px`, nền `#F8FAFC`, Avatar chữ cái, tên tài khoản, nhãn vai trò và trạng thái loading khi đăng xuất).
   - **Khối nội dung chính (`Layout.Content`)**: Chiếm trọn 100% chiều ngang phần còn lại của màn hình (`width: '100%'`, không giới hạn `maxWidth` gây thu nhỏ trên màn hình lớn).
   - **Không hiển thị mã hệ thống nội bộ**: Tuyệt đối không hiển thị mã enum/key kỹ thuật (`THU_VIEC`, `USER: NV.MOI`, `CORE.USERS`, `ACCOUNT_ACTIVATED`, `[INVALID_PHONE]`, `v1`) ra giao diện; luôn hiển thị nhãn tiếng Việt thân thiện.
3. **Khối danh sách dữ liệu, Thao tác hàng loạt & Trạng thái Loading**:
   - Sử dụng `FilterToolbar` (ô tìm kiếm + các bộ lọc `Select` bên trái; nút `Làm mới` đồng bộ trực tiếp Google Sheets `?refresh=1` có hiệu ứng `loading` + nút **`Xuất Excel`** + nút `+ Thêm mới` màu xanh `#2563EB` bên phải).
   - Sử dụng `DataTableCard`:
     - Cột `NO` gồm số thứ tự + mã phụ chữ in hoa nhỏ bên dưới; cột trạng thái dùng `StatusTag`; cột `Thao tác` dùng `RowActionButtons` (hiển thị `loading` trên đúng dòng đang xử lý).
     - **Bắt buộc có `BulkActionBar` khi tích chọn nhiều dòng (`rowSelection`)**: Khi người dùng chọn từ 1 bản ghi trở lên, thanh hành động hàng loạt phải xuất hiện ngay đầu bảng (hiển thị số bản ghi đã chọn, nút `Bỏ chọn tất cả`, và các nút thao tác hàng loạt như `Kích hoạt đã chọn`, `Mở khóa`, `Thu hồi đã chọn`, `Xóa đã chọn`, `Xuất Excel đã chọn` kèm trạng thái `loading`).
   - **Đầy đủ Thêm / Sửa / Xóa (CRUD), Cấu hình Lương (Theo giờ/Theo tháng + Thưởng) & Lịch làm việc đa chế độ**:
     - Mọi bảng nghiệp vụ (trừ bảng hệ thống bất biến như `AUDIT_LOG`, sự kiện chấm công gốc, kỳ lương đã `PUBLISHED`) bắt buộc có đủ **Thêm mới, Chỉnh sửa, Xóa (có xác nhận)** và **Xuất Excel**.
     - Phân hệ Lương hỗ trợ cấu hình **Theo giờ (`HOURLY`)** và **Theo tháng (`MONTHLY`)**, quản lý Thưởng/Phụ cấp/Điều chỉnh và xuất Bảng lương Excel chuẩn kế toán.
     - **Lương cấu hình riêng cho TỪNG NHÂN SỰ** (tab `Hồ sơ lương nhân sự` tại `/admin/payroll` và khối `Hồ sơ lương cá nhân ban đầu` khi tiếp nhận nhân sự): hình thức lương, mức chính thức, `% lương thử việc`, ngày hiệu lực, phụ cấp cố định; có `Lịch sử lương`. Không bao giờ dựng bảng "bậc lương theo khối/vai trò".
     - Phân hệ Lịch làm việc hỗ trợ chuyển đổi 3 chế độ xem: **Lưới Tuần (`Ca × Ngày`)**, **Lịch Tháng có đánh dấu (`Calendar`)** và **Bảng chi tiết (`Table`)**.
   - **Đảm bảo dữ liệu luôn mới nhất, có Debounce & Loading thông minh**:
     - Mọi ô tìm kiếm (`FilterToolbar`, `useDebouncedValue`) **bắt buộc có Debounce `400ms`** (chỉ gọi API sau khi ngừng gõ hoặc nhấn `Enter` / xóa trắng), tuyệt đối không gọi API trên từng ký tự gõ phím.
     - Không dùng `refetchInterval` hoặc `refetchOnWindowFocus` gây hiện hiệu ứng `Spin` (loading) lặp đi lặp lại làm gián đoạn người dùng đang xem trang. Chỉ hiện `loading` khi tải lần đầu (`isLoading`), khi đổi bộ lọc/trang, hoặc khi người dùng chủ động bấm nút `Làm mới`.
     - Khi bất kỳ API nào trả về `401 UNAUTHORIZED` (`Phiên đăng nhập không hợp lệ hoặc đã hết hạn`) và làm mới token thất bại, phải tự động xóa cookie phiên và chuyển hướng ngay lập tức về trang `/login` (hoặc `/nv/login`). Khi đăng nhập thành công (hoặc đã có phiên hợp lệ), tự động chuyển hướng về đúng trang phù hợp với vai trò & quyền hạn (`resolveLandingRoute`).

## 3. Quy tắc tách Component & Độ dài File
- Mọi thành phần giao diện lặp lại từ 2 nơi trở lên phải đặt tại `apps/web/src/ui/components/`.
- **Giới hạn độ dài file**: Mỗi file `.tsx` hoặc `.ts` không được vượt quá **220 dòng**. Nếu một trang có cả bảng danh sách, bộ lọc, cột bảng, modal tạo/sửa và drawer chi tiết, bắt buộc tách ra các file riêng.
