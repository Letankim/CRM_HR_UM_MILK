# TÀI LIỆU BÀN GIAO, CẤU HÌNH GOOGLE OAUTH2 & KHỞI TẠO DATABASE HỆ THỐNG HR V5.1

Tài liệu này hướng dẫn chi tiết từng bước từ A–Z để triển khai, cấu hình tài khoản Google, lấy `GOOGLE_OAUTH_REFRESH_TOKEN` (kể cả khi máy tính khách hàng **không cài đặt Node.js**), tự động sinh toàn bộ cây thư mục Google Drive + 7 bảng tính Google Sheets Database, cấu hình PostgreSQL và bàn giao hệ thống cho khách hàng.

---

## 1. Tổng Quan Kiến Trúc Khi Bàn Giao Khách Hàng

Hệ thống hoạt động theo kiến trúc **Hybrid Cloud (PostgreSQL Primary + Google Sheets & Google Drive Real-time Sync)**:
- **1 Tài khoản Gmail Hệ thống duy nhất của Khách hàng** (ví dụ: `hr.tencongty@gmail.com`):
  - Lưu trữ toàn bộ **7 file Google Spreadsheets gốc** và các **tệp dữ liệu theo từng tháng** (`07_MONTHLY_DATABASES`).
  - Lưu trữ ảnh chấm công GPS, ảnh minh chứng bù công, hợp đồng lao động, CV ứng viên và bản sao lưu hàng ngày trên **Google Drive**.
  - Gửi email thông báo tự động (kích hoạt tài khoản, duyệt đơn, phiếu lương) qua **Gmail API** chính chủ.
- **Cloud PostgreSQL (Aiven / Neon / Supabase)**: Đảm nhận đọc/ghi tốc độ cao (`< 50ms`) và tự động đồng bộ 2 chiều với Google Sheets.
- **Render (Backend API + Socket.IO)** & **Vercel (Frontend Next.js)**.

---

## 2. Bước 1: Thiết Lập Tài Khoản Google & Google Cloud Console

### 2.1. Chuẩn bị Gmail hệ thống
1. Tạo mới (hoặc sử dụng) **01 tài khoản Gmail riêng cho hệ thống nhân sự** (khuyến nghị không dùng Gmail cá nhân của lãnh đạo để tránh lẫn lộn file cá nhân).
2. Đăng nhập Gmail này vào trình duyệt và truy cập: https://console.cloud.google.com/

### 2.2. Tạo Project & Bật 3 API bắt buộc
1. Trên thanh trên cùng của Google Cloud Console, bấm **Select a project** -> **New Project** -> Đặt tên (ví dụ: `HR-System-Database`) -> Bấm **Create**.
2. Vào menu trái: **APIs & Services** -> **Library** (Thư viện). Tìm và bấm **Enable (Bật)** lần lượt **3 API** sau:
   - `Google Sheets API`
   - `Google Drive API`
   - `Gmail API`

### 2.3. Cấu hình OAuth Consent Screen (Quan trọng để Token không hết hạn sau 7 ngày)
1. Vào **APIs & Services** -> **OAuth consent screen**:
   - Chọn **User Type**: `External` -> Bấm **Create**.
   - **App name**: Nhập tên hệ thống (ví dụ: `Hệ Thống Quản Trị Nhân Sự`).
   - **User support email** & **Developer contact information**: Nhập địa chỉ Gmail hệ thống của khách hàng -> Bấm **Save and Continue** qua các bước.
2. **BƯỚC BẮT BUỘC ĐỂ TOKEN VĨNH VIỄN KHÔNG HẾT HẠN**:
   - Quay lại trang **OAuth consent screen**.
   - Tại mục **Publishing status** (đang hiển thị `Testing`), bấm nút **`PUBLISH APP`** -> Bấm **`Confirm`** để chuyển trạng thái sang **`In production`**.
   - *Lưu ý*: Nếu để ở trạng thái `Testing`, Google sẽ tự động thu hồi `Refresh Token` sau mỗi 7 ngày. Khi chuyển sang `In production`, `Refresh Token` sẽ sử dụng lâu dài không bị hết hạn. (Không cần gửi hồ sơ xác minh của Google vì chỉ có duy nhất tài khoản Gmail hệ thống của công ty đăng nhập một lần để lấy token).

### 2.4. Tạo OAuth 2.0 Client ID & Client Secret
1. Vào **APIs & Services** -> **Credentials** -> Bấm **`+ CREATE CREDENTIALS`** -> Chọn **`OAuth client ID`**.
2. Chọn **Application type**:
   - **Trường hợp 1 (Khuyên dùng — Lấy token trực tiếp trên Web, máy khách KHÔNG cần cài Node.js)**:
     - Chọn **`Web application`**.
     - Đặt tên: `HR Web OAuth Client`.
     - Tại mục **Authorized redirect URIs**, bấm **`+ ADD URI`** và dán chính xác 2 đường dẫn sau:
       - `https://developers.google.com/oauthplayground`
       - `http://127.0.0.1:53682/oauth2callback`
   - **Trường hợp 2 (Chỉ lấy token bằng lệnh CLI trên máy Dev)**:
     - Có thể chọn **`Desktop app`** (hoặc dùng luôn `Web application` ở Trường hợp 1 vì đã bao gồm cả 2 URI).
3. Bấm **Create** -> Sao chép và lưu lại 2 thông số:
   - `GOOGLE_OAUTH_CLIENT_ID` (ví dụ: `123456789-abc...apps.googleusercontent.com`)
   - `GOOGLE_OAUTH_CLIENT_SECRET` (ví dụ: `GOCSPX-...`)

---

## 3. Bước 2: Cách Lấy `GOOGLE_OAUTH_REFRESH_TOKEN`

### Cách A: Lấy trực tiếp trên trình duyệt Web (Máy khách hàng KHÔNG có Node.js)

Đây là cách nhanh và thuận tiện nhất khi bàn giao cho khách hàng mà máy tính của họ không cài đặt Node.js hay mã nguồn:

1. Mở trình duyệt (đang đăng nhập Gmail hệ thống của khách hàng) và truy cập:
   https://developers.google.com/oauthplayground
2. Nhìn lên **góc trên cùng bên phải**, bấm vào biểu tượng **Bánh răng cài đặt (OAuth 2.0 Configuration)**:
   - Tích chọn vào ô **`Use your own OAuth credentials`**.
   - **OAuth Client ID**: Dán `GOOGLE_OAUTH_CLIENT_ID` đã tạo ở Bước 1.
   - **OAuth Client Secret**: Dán `GOOGLE_OAUTH_CLIENT_SECRET` đã tạo ở Bước 1.
   - Bấm **Close** để đóng khung cài đặt.
3. Nhìn sang cột bên trái (**Step 1: Select & authorize APIs**):
   - Kéo xuống ô **`Input your own scopes`** ở cuối danh sách.
   - Dán chính xác cụm 3 quyền (scopes) sau vào ô (cách nhau bởi dấu cách):
     ```text
     https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.send
     ```
   - Bấm nút màu xanh **`Authorize APIs`**.
4. Màn hình đăng nhập Google hiện ra:
   - Chọn đúng **Tài khoản Gmail hệ thống**.
   - Nếu xuất hiện cảnh báo *"Google hasn't verified this app"*, bấm vào chữ **`Advanced` (Nâng cao)** ở góc dưới bên trái -> Bấm **`Go to ... (unsafe)` (Đi tới ...)**.
   - Tích chọn **Select all (Chọn tất cả)** các quyền Google Drive, Google Sheets, Gmail -> Bấm **`Continue` (Tiếp tục)**.
5. Trình duyệt tự động quay về trang OAuth Playground và mở mục **Step 2: Exchange authorization code for tokens**:
   - Bấm vào nút **`Exchange authorization code for tokens`**.
   - Ở khung kết quả (hoặc mục `Refresh token`), sao chép chuỗi **`Refresh token`** (thường bắt đầu bằng `1//0...`).
   - Dán chuỗi này vào biến môi trường:
     ```env
     GOOGLE_OAUTH_REFRESH_TOKEN=1//0g...
     ```

---

### Cách B: Lấy bằng dòng lệnh trên máy Kỹ thuật viên (Có cài đặt Node.js)

Nếu thực hiện trên máy của kỹ thuật viên đã cài Node.js 22+ và `pnpm`:
1. Mở file `.env` ở thư mục gốc dự án và điền:
   ```env
   GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxx
   ```
2. Chạy lệnh:
   ```bash
   pnpm google:auth
   ```
3. Trình duyệt sẽ tự động mở đường dẫn cấp quyền của Google. Đăng nhập bằng Gmail hệ thống, bấm Cho phép, và cửa sổ Terminal sẽ in ra dòng `GOOGLE_OAUTH_REFRESH_TOKEN=...` để dán vào `.env`.

---

## 4. Bước 3: Tự Động Sinh Cây Thư Mục Drive & 7 Bảng Tính Database (`Bootstrap`)

> **Lưu ý quan trọng về bảo mật (`drive.file` scope)**:
> Hệ thống sử dụng quyền `https://www.googleapis.com/auth/drive.file` — nghĩa là ứng dụng **chỉ đọc/ghi được những thư mục và bảng tính do chính OAuth Client của hệ thống khởi tạo ra**. Tuyệt đối không tạo tay file Google Sheets trên trình duyệt, mà sử dụng công cụ khởi tạo tự động dưới đây để hệ thống tự sinh chuẩn 100% cột, định dạng và quyền sở hữu.

### 4.1. Trường hợp máy khách hàng không có Node.js thì khởi tạo Database như thế nào?
- **Kỹ thuật viên thực hiện từ xa trong 30 giây**:
  - Sau khi có 3 thông số `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` của khách hàng (lấy qua Cách A ở trên), kỹ thuật viên tạm điền 3 thông số này vào file `.env` trên máy của kỹ thuật viên (để trống các dòng `SHEET_ID_*` và `DRIVE_ROOT_FOLDER_ID`).
  - Kỹ thuật viên chạy lệnh `pnpm sheets:bootstrap` trên máy mình: lệnh này sẽ kết nối trực tiếp vào Google Drive của khách hàng và tự động tạo toàn bộ thư mục + 7 bảng tính trên tài khoản Google của khách hàng!

### 4.2. Quy trình chạy lệnh khởi tạo chuẩn (`sheets:bootstrap` & `seed:admin`)

1. **Kiểm tra kết nối tài khoản Google**:
   ```bash
   pnpm google:doctor
   ```
   Lệnh này kiểm tra OAuth token còn hiệu lực và in ra đúng địa chỉ email của hệ thống.

2. **Tự động sinh cấu trúc thư mục Google Drive và 7 Bảng tính Google Sheets**:
   ```bash
   pnpm sheets:bootstrap
   ```
   **Lệnh này sẽ tự động thực hiện**:
   - Tạo thư mục gốc `UMBM_HR_SYSTEM` trên Google Drive kèm **8 thư mục con tiêu chuẩn**:
     - `00_SYSTEM_DATABASE` (Chứa 7 file Google Spreadsheets cơ sở dữ liệu gốc)
     - `01_ATTENDANCE_PHOTOS` (Ảnh chụp điểm danh Vào ca / Ra ca phân theo tháng & ca)
     - `02_EVIDENCE_ADJUSTMENTS` (Ảnh minh chứng phiếu bổ sung công)
     - `03_RECRUITMENT_CVS` (Hồ sơ CV ứng viên)
     - `04_EMPLOYEE_DOCUMENTS` (Hợp đồng lao động thử việc & chính thức theo mã nhân viên)
     - `05_PAYSLIPS_EXPORT` (Phiếu lương xuất lưu trữ)
     - `06_DAILY_BACKUPS` (Bản sao lưu dữ liệu tự động hàng ngày)
     - `07_MONTHLY_DATABASES` (Thư mục chứa các file Google Spreadsheets phân vùng theo từng tháng `YYYY-MM`)
   - Tạo **7 file Google Spreadsheets** trong thư mục `00_SYSTEM_DATABASE` với đầy đủ các sheet (tab), dòng tiêu đề cột chuẩn Schema V5.1, khóa cố định dòng 1 (`frozenRowCount: 1`) và gắn cảnh báo bảo vệ header:
     1. `SHEET_ID_CORE` (`UMBM_CORE`: `USERS`, `ROLE_PERMISSIONS`, `BRANCHES`, `SHIFT_TEMPLATES`, `STAFFING_RULES`, `SYSTEM_SETTINGS`)
     2. `SHEET_ID_HR` (`UMBM_HR`: `EMPLOYEES`, `EMPLOYEE_STAGE_HISTORY`, `CANDIDATES`, `INTERVIEWS`, `TEST_BANKS`, `TEST_QUESTIONS`, `TEST_ASSIGNMENTS`, `TEST_ATTEMPTS`)
     3. `SHEET_ID_SCHEDULE` (`UMBM_SCHEDULE`: `SHIFT_ASSIGNMENTS`, `LEAVE_REQUESTS`, `SHIFT_SWAPS`, `WEEK_SCHEDULE_LOCKS`)
     4. `SHEET_ID_ATTENDANCE` (`UMBM_ATTENDANCE_YYYY`: `ATTENDANCE_SESSIONS`, `ATTENDANCE_EVENTS`, `ATTENDANCE_ADJUSTMENTS`)
     5. `SHEET_ID_PAYROLL` (`UMBM_PAYROLL`: `PAY_RATES`, `PAYROLL_PERIODS`, `PAYROLL_ITEMS`, `PAYROLL_PERIOD_SNAPSHOTS`, `PAYSLIPS`, `PAYSLIP_REVISIONS`)
     6. `SHEET_ID_COMMS` (`UMBM_COMMS`: `ANNOUNCEMENTS`, `ANNOUNCEMENT_READS`, `NOTIFICATIONS`, `SUPPORT_TICKETS`, `TICKET_MESSAGES`, `EMAIL_QUEUE`, `MKT_MEDIA_ASSETS`)
     7. `SHEET_ID_SYSTEM` (`UMBM_SYSTEM`: `OPERATION_JOURNAL`, `SYNC_DEAD_LETTER`, `SCHEMA_MIGRATIONS`, `AUDIT_LOG_YYYY_MM`)
   - Sau khi chạy xong, Terminal sẽ in ra đoạn cấu hình ID:
     ```env
     DRIVE_ROOT_FOLDER_ID=1abc...
     SHEET_ID_CORE=1def...
     SHEET_ID_HR=1ghi...
     SHEET_ID_SCHEDULE=1jkl...
     SHEET_ID_ATTENDANCE=1mno...
     SHEET_ID_PAYROLL=1pqr...
     SHEET_ID_COMMS=1stu...
     SHEET_ID_SYSTEM=1vwx...
     ```
   - Sao chép 8 dòng này dán vào file `.env` (và cấu hình Environment Variables trên Render).

3. **Khởi tạo dữ liệu Quản trị viên gốc (`seed:admin`) hoặc dữ liệu mẫu**:
   - Đổi `DATA_BACKEND=google` trong `.env`.
   - Để tạo tài khoản Admin gốc, các chi nhánh và khung ca mặc định:
     ```bash
     pnpm seed:admin
     ```
   - *(Tùy chọn)* Nếu khách hàng muốn nạp sẵn bộ dữ liệu mẫu đầy đủ để chạy thử nghiệm قبل khi xóa đi vận hành thật:
     ```bash
     pnpm --filter @umbm/api seed:realistic
     ```

4. **Đồng bộ sang Cloud PostgreSQL (Nếu dùng PostgreSQL Primary)**:
   - Điền chuỗi kết nối `DATABASE_URL` (từ Aiven / Neon / Supabase) vào `.env`.
   - Chạy lệnh đồng bộ 2 chiều lần đầu:
     ```bash
     pnpm --filter @umbm/api postgres:sync
     ```
   - Khi Backend khởi động (`pnpm --filter @umbm/api start`), hệ thống cũng tự động tạo bảng PostgreSQL nếu chưa có và tự động đồng bộ ngầm với Google Sheets.

### 4.3. Cách tạo Tệp Dữ Liệu Tháng Mới (`Monthly Database`) trong quá trình vận hành
- Khách hàng **không cần chạy bất kỳ câu lệnh nào**:
  - Hàng tháng, Quản trị viên hoặc HR chỉ cần đăng nhập vào giao diện Web -> Mở mục **Tệp dữ liệu theo tháng** trên thanh công cụ (hoặc trong trang **Tích hợp & Đồng bộ**) -> Bấm **`Tạo tệp dữ liệu tháng mới`**.
  - Hệ thống sẽ tự động tạo thư mục tháng (ví dụ `07_MONTHLY_DATABASES/2026-12`), tự sinh file Google Spreadsheet mới với đầy đủ các tab chuẩn và tự động chuyển tiếp (`carry-forward`) các ca làm việc, đơn nghỉ phép, đổi ca đã xếp trước cho tháng mới sang tệp mới.

---

## 5. Bước 4: Cấu Hình Triển Khai Lên Render (Backend) & Vercel (Frontend)

### 5.1. Cấu hình Backend trên Render (`apps/api`)
- **Build Command**: `pnpm install --frozen-lockfile && pnpm --filter @umbm/shared build && pnpm --filter @umbm/google build && pnpm --filter @umbm/api build`
- **Start Command**: `pnpm --filter @umbm/api start`
- **Các biến môi trường (`.env`) bắt buộc trên Render**:
  ```env
  NODE_ENV=production
  TZ=Asia/Ho_Chi_Minh
  DATA_BACKEND=google
  DATABASE_URL=postgres://... (URI PostgreSQL từ Aiven/Neon có ?sslmode=require)
  POSTGRES_POOL_MAX=5
  POSTGRES_SYNC_INTERVAL_MS=1200

  JWT_ACCESS_SECRET=<chuỗi-bí-mật-ngẫu-nhiên-tối-thiểu-32-ký-tự>
  JWT_REFRESH_SECRET=<chuỗi-bí-mật-ngẫu-nhiên-tối-thiểu-32-ký-tự>
  INTERNAL_API_TOKEN=<chuỗi-token-cron-tối-thiểu-32-ký-tự>
  COOKIE_SECURE=true
  API_PUBLIC_ORIGIN=https://<ten-mien-vercel-cua-khach-hang>.vercel.app

  GOOGLE_OAUTH_CLIENT_ID=<Client-ID-của-khách-hàng>
  GOOGLE_OAUTH_CLIENT_SECRET=<Client-Secret-của-khách-hàng>
  GOOGLE_OAUTH_REFRESH_TOKEN=<Refresh-Token-của-khách-hàng>

  DRIVE_ROOT_FOLDER_ID=<ID-thư-mục-gốc>
  SHEET_ID_CORE=<ID-sheet-core>
  SHEET_ID_HR=<ID-sheet-hr>
  SHEET_ID_SCHEDULE=<ID-sheet-schedule>
  SHEET_ID_ATTENDANCE=<ID-sheet-attendance>
  SHEET_ID_PAYROLL=<ID-sheet-payroll>
  SHEET_ID_COMMS=<ID-sheet-comms>
  SHEET_ID_SYSTEM=<ID-sheet-system>

  EMAIL_ENABLED=true
  EMAIL_FROM_NAME="Tên Thương Hiệu HR"
  EMAIL_FROM_ADDRESS="gmail.hethong.khachhang@gmail.com"
  ```

### 5.2. Cấu hình Frontend trên Vercel (`apps/web`)
- **Root Directory**: `apps/web`
- **Build Command**: `cd ../.. && pnpm --filter @umbm/shared build && pnpm --filter @umbm/web build`
- **Các biến môi trường trên Vercel**:
  ```env
  NEXT_PUBLIC_API_BASE=/api
  API_INTERNAL_URL=https://<ten-service-backend-tren-render>.onrender.com
  NEXT_PUBLIC_SOCKET_URL=https://<ten-service-backend-tren-render>.onrender.com
  NEXT_PUBLIC_APP_PRODUCT_NAME="AHr"
  NEXT_PUBLIC_APP_BRAND_NAME="ỤM BÒ MILK"
  NEXT_PUBLIC_APP_SYSTEM_TITLE="Hệ thống Quản trị Nhân sự"
  NEXT_PUBLIC_APP_BRAND_SUBTITLE="HỆ THỐNG NHÂN SỰ"
  NEXT_PUBLIC_APP_SHORT_CODE="UB"
  NEXT_PUBLIC_APP_VERSION="v5.1.0"
  ```

---

## 6. Danh Mục Kiểm Tra Nghiệm Thu Khi Bàn Giao (Handover Checklist)

- [ ] **1. Kiểm tra Google OAuth2**: Đã chuyển OAuth Consent Screen sang trạng thái **`In production`** (đảm bảo Refresh Token không bị hết hạn sau 7 ngày).
- [ ] **2. Kiểm tra 3 API Google**: Đã bật đủ `Google Sheets API`, `Google Drive API`, `Gmail API` trong Google Cloud Project của khách hàng.
- [ ] **3. Kiểm tra Cấu trúc Drive & 7 Bảng tính**: Trong Google Drive của Gmail hệ thống đã có thư mục `UMBM_HR_SYSTEM`, 8 thư mục con (`00_SYSTEM_DATABASE` .. `07_MONTHLY_DATABASES`) và đủ 7 file Google Spreadsheets.
- [ ] **4. Kiểm tra Đồng bộ & Đối soát**: Đăng nhập tài khoản Admin trên Web -> Vào **Quản trị Hệ thống > Tích hợp & Đồng bộ** -> Bấm **Chạy đối soát toàn vẹn dữ liệu** và kiểm tra trạng thái kết nối Google Sheets / Google Drive / Gmail báo **Hoạt động tốt**.
- [ ] **5. Kiểm tra Gửi Email & Tải tệp**: Thử tạo 1 tài khoản hoặc tải lên 1 Hợp đồng lao động -> Kiểm tra file xuất hiện trong thư mục `04_EMPLOYEE_DOCUMENTS` trên Google Drive và email thông báo gửi thành công từ địa chỉ Gmail hệ thống.
- [ ] **6. Đổi mật khẩu & Mã PIN Admin gốc**: Hướng dẫn khách hàng đăng nhập tài khoản Quản trị viên (`admin`) và đổi mật khẩu + mã PIN 6 chữ số bảo mật ngay khi nhận bàn giao.
