import { SYSTEM_CONFIG, type EmailTemplateCode } from '@umbm/shared';
import type { SendEmailInput } from './email.service.js';

export function buildEmailPreviewSamples(baseUrl = 'http://localhost:3100'): Record<EmailTemplateCode, SendEmailInput> {
  const domain = SYSTEM_CONFIG.companyDomain;
  const brand = SYSTEM_CONFIG.brandName;

  return {
    ACCOUNT_ACTIVATED: {
      to: `nhanvien@${domain}`,
      template: 'ACCOUNT_ACTIVATED',
      recipientName: 'Đặng Văn Chính Thức',
      referenceCode: 'ACC-2026-0018',
      summary: `Tài khoản truy cập Cổng Nhân Viên ${brand} của bạn đã được Quản trị viên phê duyệt và kích hoạt chính thức.`,
      metadata: [
        { label: 'Mã nhân sự', value: 'NV0002' },
        { label: 'Số điện thoại đăng nhập', value: '0901 000 002' },
        { label: 'Vai trò phân quyền', value: 'Nhân viên chính thức' },
        { label: 'Chi nhánh làm việc', value: 'Ụm Bò Milk Chi nhánh 1' },
        { label: 'Trạng thái hiệu lực', value: 'Đang hoạt động' },
      ],
      actionLabel: 'Truy cập Cổng Nhân Viên',
      actionUrl: `${baseUrl}/nv/login`,
      securityNote:
        'Tuyệt đối không chia sẻ mã PIN 6 số cho bất kỳ ai. Hệ thống tự động khóa tạm thời sau 5 lần nhập sai liên tiếp.',
    },
    ACCOUNT_REVOKED: {
      to: `nhanvien@${domain}`,
      template: 'ACCOUNT_REVOKED',
      recipientName: 'Bùi Thị Mới',
      referenceCode: 'REV-2026-0004',
      summary:
        'Quyền truy cập hệ thống của tài khoản dưới đây đã bị thu hồi theo quyết định của bộ phận Quản trị / Nhân sự.',
      metadata: [
        { label: 'Họ tên nhân sự', value: 'Bùi Thị Mới (Mã hồ sơ: NV0003)' },
        { label: 'Thời điểm thu hồi', value: '23/10/2026 22:30:00' },
        { label: 'Phiên đăng nhập hiện tại', value: 'Đã ngắt kết nối tức thì trên mọi thiết bị' },
        { label: 'Lý do ghi nhận', value: 'Kết thúc đợt thử việc tại chi nhánh' },
      ],
      securityNote: 'Nếu có thắc mắc về quyết định thu hồi, vui lòng liên hệ trực tiếp Phòng Nhân sự.',
    },
    INTERVIEW_INVITATION: {
      to: `ungvien@${domain}`,
      template: 'INTERVIEW_INVITATION',
      recipientName: 'Nguyễn Minh Anh',
      referenceCode: 'INT-2026-0105',
      summary: `Phòng Nhân sự ${brand} trân trọng mời bạn tham dự buổi phỏng vấn tuyển dụng theo lịch trình đã sắp xếp dưới đây.`,
      metadata: [
        { label: 'Vị trí ứng tuyển', value: 'Nhân viên Pha chế' },
        { label: 'Thời gian phỏng vấn', value: '09:30 - 10:00, Thứ Hai 26/10/2026' },
        { label: 'Hình thức', value: 'Trực tuyến qua Google Meet' },
        { label: 'Chi nhánh đăng ký', value: 'Ụm Bò Milk Chi nhánh 1' },
        { label: 'Người phụ trách', value: 'Nguyễn Thị Nhân Sự' },
      ],
      actionLabel: 'Xác nhận tham dự phỏng vấn',
      actionUrl: `${baseUrl}/login`,
      securityNote: 'Vui lòng truy cập phòng họp trước 05 phút để kiểm tra âm thanh và camera.',
    },
    EMERGENCY_LEAVE_ALERT: {
      to: `quanly.cn1@${domain}`,
      template: 'EMERGENCY_LEAVE_ALERT',
      recipientName: 'Trần Văn Cửa Hàng',
      referenceCode: 'EMG-2026-0012',
      summary:
        'Hệ thống vừa ghi nhận một báo nghỉ khẩn cấp sát giờ vào ca. Đề nghị Quản lý cửa hàng điều phối nhân sự thay thế ngay.',
      metadata: [
        { label: 'Nhân sự báo nghỉ', value: 'Võ Thị Thử Việc (Mã NV: NV0001)' },
        { label: 'Ca làm việc bị ảnh hưởng', value: 'Ca Sáng (07:00 - 15:00) ngày 24/10/2026' },
        { label: 'Chi nhánh', value: 'Ụm Bò Milk Chi nhánh 1' },
        { label: 'Định biên tối thiểu', value: 'Cần bổ sung 01 nhân sự thay thế' },
        { label: 'Lý do khẩn cấp', value: 'Sự cố sức khỏe đột xuất' },
      ],
      actionLabel: 'Mở bảng điều phối ca trực',
      actionUrl: `${baseUrl}/dashboard`,
      securityNote: 'Ca thiếu người dưới ngưỡng tối thiểu được đánh dấu cảnh báo ưu tiên cao trên Bảng điều khiển.',
    },
    PAYSLIP_PUBLISHED: {
      to: `nhanvien@${domain}`,
      template: 'PAYSLIP_PUBLISHED',
      recipientName: 'Đặng Văn Chính Thức',
      referenceCode: 'PAY-2026-10',
      summary:
        'Phiếu lương chính thức của kỳ lương Tháng 10/2026 đã được Phòng Kế toán chốt sổ và phát hành trên Cổng Nhân Viên.',
      metadata: [
        { label: 'Kỳ lương', value: 'Tháng 10/2026 (01/10/2026 - 31/10/2026)' },
        { label: 'Mã nhân sự', value: 'NV0002' },
        { label: 'Tổng giờ công hợp lệ', value: '192.0 giờ' },
        { label: 'Lần phát hành phiếu', value: 'Bản chính thức lần 1 (Đã đóng băng dữ liệu)' },
        { label: 'Trạng thái', value: 'Đã phát hành phiếu' },
      ],
      actionLabel: 'Xem chi tiết phiếu lương',
      actionUrl: `${baseUrl}/nv`,
      securityNote: 'Thông tin thu nhập là bảo mật cá nhân. Vui lòng đăng nhập bằng mã PIN để xem chi tiết từng khoản.',
    },
    SYSTEM_RECONCILIATION_REPORT: {
      to: `admin@${domain}`,
      template: 'SYSTEM_RECONCILIATION_REPORT',
      recipientName: 'Quản trị hệ thống',
      referenceCode: 'SYS-REC-20261023',
      summary:
        'Báo cáo kết quả rà soát đối soát toàn vẹn dữ liệu trên Google Sheets và sao lưu định kỳ sang Google Drive.',
      metadata: [
        { label: 'Số bảng đã quét', value: 'Toàn bộ các bảng cấu hình, nhân sự, lịch, công và lương' },
        { label: 'Trạng thái hàng đợi ghi', value: '0 thao tác tồn đọng (Ổn định)' },
        { label: 'Bản ghi cần đối soát lại', value: '0 bản ghi lỗi' },
        { label: 'Tự động sửa chữa bất biến', value: 'Đã đồng bộ 100% dấu thời gian' },
        { label: 'Bản sao lưu Google Drive', value: 'Hoàn tất tại thư mục lưu trữ sao lưu' },
      ],
      actionLabel: 'Mở trang Tích hợp & Đồng bộ',
      actionUrl: `${baseUrl}/admin/integrations`,
    },
  };
}
