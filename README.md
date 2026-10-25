# Ụm Bò Milk HR System V5.1

Hệ thống quản trị nhân sự, lịch ca, chấm công GPS + camera, kỳ lương cho Ụm Bò Milk. Auto Stack phát triển.

Tài liệu nghiệp vụ nằm trong `docs/`:
- `UM_BO_MILK_HR_V5_1_HOAN_CHINH_BAN_GIAO_IT.pdf`: tài liệu gốc
- `AUTO_STACK_UM_BO_MILK_HR_V5_1_TOAN_BO_TINH_NANG_HE_THONG.pdf`: đặc tả 75 tab
- `AI_MASTER_IMPLEMENTATION_AND_TEST_CHECKLIST.md`: checklist triển khai và kiểm thử (mã `AI-INFRA`, `AI-TAB`, `FLOW`, `IT-CHK`)

## Kiến trúc

```
apps/
  web/      Next.js 15 + Ant Design 5: giao diện quản trị (/) và app nhân viên (/nv)
  api/      Node.js + Fastify: REST API, xác thực, phân quyền, Socket.IO,
            cache + hàng đợi ghi. Đây là nơi DUY NHẤT đọc/ghi Google Sheets.
  worker/   Node.js: backup hằng ngày, dọn bản cũ, cảnh báo dung lượng
packages/
  shared/   Zod schema, vai trò, permission, định nghĩa 7 spreadsheet (dùng chung)
  google/   Xác thực Google OAuth, retry, tiện ích Drive
deploy/     Caddyfile (HTTPS + reverse proxy)
```

Trình duyệt chỉ nói chuyện với một tên miền. `/api/*` và `/socket.io/*` được chuyển sang `api`; khi dev do Next.js rewrites đảm nhận, còn production do Caddy. Nhờ đó cookie đăng nhập hoạt động bình thường và không cần CORS.

> **Quan trọng:** `api` phải chạy **đúng 1 instance**. Cache và hàng đợi ghi Google Sheets nằm trong process này. Nếu chạy 2 instance, dữ liệu có thể bị ghi đè lên nhau.

## Chạy thử ngay (không cần Google)

```bash
pnpm install
cp .env.example .env          # mặc định DATA_BACKEND=memory
pnpm --filter @umbm/shared build && pnpm --filter @umbm/google build
pnpm dev:api                  # http://localhost:4000
pnpm dev:web                  # http://localhost:3000
```

Tài khoản mẫu (chỉ có ở chế độ `memory`):

| App | Đăng nhập | Mật khẩu / PIN |
| :--- | :--- | :--- |
| Quản trị `http://localhost:3000/login` | `admin`, `hr`, `store1`, `finance`, `mkt` | `Umbm@2026` |
| Nhân viên `http://localhost:3000/nv/login` | `0901000001` (thử việc), `0901000002` (chính thức) | `246810` |

Tài khoản `0901000003` đang ở trạng thái chờ kích hoạt, dùng để thử luồng kích hoạt và thu hồi.

## Nối Google Sheets + Drive bằng Gmail cá nhân

**Toàn bộ dữ liệu nằm trong MỘT tài khoản Google cá nhân**: dữ liệu trên 7 Google Sheets, ảnh và tài liệu trên Google Drive, các bản backup cũng trên Drive. Không cần Google Workspace, không cần tên miền, không lưu ở dịch vụ nào khác. Máy chủ chạy code không lưu dữ liệu lâu dài.

1. **Tạo Gmail mới cho hệ thống**, ví dụ `umbomilk.hrsystem@gmail.com`. Không dùng Gmail cá nhân đang dùng hằng ngày. Bật xác minh 2 bước và lưu mật khẩu ở nơi an toàn.
2. Đăng nhập Gmail đó vào [Google Cloud Console](https://console.cloud.google.com/) và **tạo project** `umbm-hr`.
3. **APIs & Services → Library**: bật **Google Sheets API** và **Google Drive API**.
4. **OAuth consent screen**:
   - User type: **External**. Điền tên app, email hỗ trợ.
   - Scopes: không cần thêm (script sẽ xin `drive.file` và `spreadsheets`).
   - Bấm **Publish app** để chuyển sang **In production**. Nếu để ở chế độ *Testing*, refresh token sẽ **hết hạn sau 7 ngày** và hệ thống ngừng ghi dữ liệu.
5. **Credentials → Create credentials → OAuth client ID**, loại **Desktop app**. Chép Client ID và Client secret vào `.env`.
6. Lấy refresh token:
   ```bash
   pnpm google:auth
   ```
   Đăng nhập bằng **Gmail hệ thống**. Google sẽ cảnh báo "ứng dụng chưa được xác minh": bấm *Nâng cao → Tiếp tục* (đây là app của chính bạn). Chép `GOOGLE_OAUTH_REFRESH_TOKEN=...` vào `.env`.
7. Tạo cấu trúc Drive và 7 spreadsheet:
   ```bash
   pnpm sheets:bootstrap
   ```
   Chép các dòng `DRIVE_ROOT_FOLDER_ID` và `SHEET_ID_*` vào `.env`, đổi `DATA_BACKEND=google`.
8. Tạo tài khoản admin đầu tiên:
   ```bash
   pnpm seed:admin -- --username admin --name "Quản trị hệ thống"
   ```
9. **Kiểm tra toàn bộ kết nối Google thật:**
   ```bash
   pnpm google:doctor
   ```
   Lệnh này kiểm tra token, dung lượng, thư mục, 7 spreadsheet cùng header từng tab, ghi rồi đọc lại một dòng thử, tải lên rồi xóa một file thử. Phải đạt hết trước khi chạy thật.
10. Chạy `pnpm dev:api`, `pnpm dev:web`, `pnpm dev:worker`. Thử backup ngay: `pnpm --filter @umbm/worker backup:now -- DAILY`.

### Giới hạn khi dùng một Gmail cá nhân và cách hệ thống xử lý

| Giới hạn của Google | Ảnh hưởng | Hệ thống xử lý thế nào |
| :--- | :--- | :--- |
| Quota Sheets API tính theo **người dùng**: khoảng 60 lượt đọc + 60 lượt ghi mỗi phút | Mọi request đều đi bằng một Gmail nên dùng chung quota này | Đọc phục vụ từ cache trong RAM. Nhiều thao tác thêm dòng cùng lúc được **gộp thành một request** (30 người chấm công cùng lúc chỉ tốn 1–2 request). Gặp lỗi 429 thì tự thử lại, chờ tối đa hơn 60 giây. Có thể xin tăng quota miễn phí trong Google Cloud Console |
| 10 triệu ô mỗi spreadsheet | File phình to theo thời gian | Chấm công tách mỗi năm một file. Audit log tách mỗi tháng một tab (`AUDIT_LOG_YYYY_MM`), tự tạo khi sang tháng mới |
| 50.000 ký tự mỗi ô | Ghi ô quá dài làm hỏng cả request | Từ chối trước khi gửi. Audit log tự cắt bớt nội dung |
| 15GB miễn phí, dùng chung với Gmail và Photos | Ảnh điểm danh chiếm dung lượng nhiều nhất | Ảnh nén khoảng 150KB. Worker cảnh báo khi vượt 80%. Nên nâng Google One 100GB (vẫn cùng một tài khoản Google) |
| Refresh token mất hiệu lực khi đổi mật khẩu, gỡ quyền app, hoặc app còn ở chế độ Testing | Hệ thống ngừng ghi dữ liệu | Publish app sang *In production*. Worker cảnh báo ngay khi token hỏng. `pnpm google:doctor` kiểm tra lại |
| Scope `drive.file` chỉ thấy file do app tạo | Không truy cập được file tạo tay | Mọi file do `pnpm sheets:bootstrap` và API tạo ra |
| Sửa tay trên Sheets (đổi cột, xóa dòng, chèn dòng) | Cache lệch so với Sheets | Header sai thì API từ chối khởi động. Trước khi cập nhật luôn đọc lại đúng dòng đó, lệch thì nạp lại và báo 409. Dòng sai định dạng hiện ở trang *Tích hợp & Đồng bộ* |

> **Rủi ro cần biết:** dữ liệu chính và bản backup **cùng nằm trong một tài khoản Google**. Nếu tài khoản bị mất (bị hack, bị khóa) thì mất cả hai. Bắt buộc:
> - Bật xác minh 2 bước.
> - Đặt số điện thoại và email khôi phục.
> - Lưu mã dự phòng (backup codes) ở nơi an toàn.
> - Mỗi tháng tải bộ backup mới nhất từ thư mục `90_BACKUPS/monthly` về máy tính của công ty.

### Máy chủ chạy code khi không có tên miền

Code phải chạy trên một máy luôn bật. Máy này chỉ chạy chương trình, **không lưu dữ liệu lâu dài**. Điện thoại bắt buộc dùng HTTPS mới bật được camera và GPS; không cần mua tên miền để có HTTPS:

1. Máy chủ có **IP tĩnh**. Gợi ý **Google Compute Engine e2-micro**: có trong gói miễn phí vĩnh viễn ở các vùng `us-west1`/`us-central1`/`us-east1`, cần thêm thẻ để kích hoạt billing, và đều nằm trong chính tài khoản Google đó.
2. Đặt `PUBLIC_HOST=<IP-nối-bằng-gạch>.sslip.io` trong `.env`, ví dụ IP `34.123.45.67` thì `PUBLIC_HOST=34-123-45-67.sslip.io`. sslip.io là DNS miễn phí, chỉ chuyển tên thành IP, không lưu dữ liệu.
3. `docker compose up -d --build`. Caddy tự cấp chứng chỉ HTTPS.
4. Truy cập `https://34-123-45-67.sslip.io` (quản trị) và `https://34-123-45-67.sslip.io/nv` (nhân viên).

Lưu ý: e2-micro chỉ có 1GB RAM. Nên bật thêm 2GB swap trên máy chủ để chạy được cả 4 container.

**Lưu ý vận hành với Gmail cá nhân:**
- **Không đổi mật khẩu** Gmail hệ thống và **không gỡ quyền app** trong tài khoản Google, nếu không refresh token mất hiệu lực. Worker sẽ cảnh báo qua Telegram nếu token chết; khi đó chạy lại `pnpm google:auth`.
- Gmail miễn phí có **15GB** dùng chung với Gmail/Photos. Ảnh điểm danh khoảng 200KB/ảnh, 100 nhân viên × 2 ảnh/ngày ≈ 1,2GB/tháng. Nên mua **Google One 100GB** từ đầu. Worker cảnh báo khi dung lượng vượt 80%.
- Scope `drive.file` chỉ cho app truy cập file **do chính app tạo**. Vì vậy mọi spreadsheet phải được tạo bằng `pnpm sheets:bootstrap`, không tạo tay.
- Được phép mở và xem Sheets trực tiếp. **Không** đổi tên tab, thứ tự cột hay header: API sẽ từ chối khởi động nếu header sai. Khi sửa tay dữ liệu, dòng sai định dạng sẽ bị loại và hiện ở trang *Tích hợp & Đồng bộ*.

## Backup

| Job | Lịch | Nội dung | Giữ lại |
| :--- | :--- | :--- | :--- |
| Daily | 01:00 hằng ngày | Bản sao 7 spreadsheet + file `.xlsx` | 30 bản |
| Critical | 06, 10, 14, 18, 22h | Tài khoản, chấm công, lương | 7 ngày |
| Weekly | Chủ nhật 02:00 | Toàn bộ | 12 bản |
| Monthly | Ngày 1, 03:00 | Toàn bộ | 12 bản |

Bản backup nằm ở `UMBM_HR_SYSTEM/90_BACKUPS/` trên Drive. Mỗi lần chạy ghi số dòng từng tab vào `UMBM_SYSTEM/BACKUP_LOG` để phát hiện mất dữ liệu bất thường. Bản cũ được đưa vào thùng rác (khôi phục được trong 30 ngày), không xóa vĩnh viễn.

## Kiểm thử

```bash
pnpm --filter @umbm/shared build && pnpm --filter @umbm/google build
pnpm --filter @umbm/api test
```

Bao gồm: hàng đợi ghi tuần tự, gộp nhiều insert thành một request, optimistic lock, phát hiện sửa tay trên Sheets, từ chối header sai, giới hạn 50.000 ký tự mỗi ô, không cập nhật cache khi ghi Google thất bại, audit log tách tab theo tháng và ẩn dữ liệu nhạy cảm, phân quyền chéo vai trò (403), kích hoạt → thu hồi → token cũ mất hiệu lực.

## Triển khai production

```bash
# .env: NODE_ENV=production, DATA_BACKEND=google, COOKIE_SECURE=true,
#       PUBLIC_HOST=<ip>.sslip.io, secret mạnh (openssl rand -base64 48)
docker compose up -d --build
```

Xem mục "Máy chủ chạy code khi không có tên miền" ở trên.
