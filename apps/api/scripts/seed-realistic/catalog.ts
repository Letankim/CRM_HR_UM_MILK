/**
 * Danh mục dữ liệu nền tiếng Việt để sinh hồ sơ sát thực tế vận hành chuỗi cửa hàng:
 * họ tên theo giới tính, địa chỉ TP.HCM, ngân hàng, đầu số di động, lý do nghỉ / đổi ca / bổ sung công.
 */

export const LAST_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Trương', 'Đinh', 'Lâm', 'Mai', 'Tô', 'Châu'] as const;

export const FEMALE = {
  middle: ['Thị', 'Ngọc', 'Thanh', 'Thu', 'Bảo', 'Mỹ', 'Khánh', 'Minh', 'Phương', 'Hoài', 'Kim', 'Diễm'],
  given: ['Anh', 'Trang', 'Linh', 'Hương', 'Ngân', 'Vy', 'Thảo', 'Hà', 'Nhi', 'Quỳnh', 'Uyên', 'My', 'Trâm', 'Hạnh', 'Như', 'Tiên', 'Yến', 'Giang', 'Phương', 'Châu', 'Hân', 'Thư'],
} as const;

export const MALE = {
  middle: ['Văn', 'Minh', 'Quốc', 'Hoàng', 'Gia', 'Thanh', 'Đức', 'Tuấn', 'Hữu', 'Công', 'Nhật', 'Trọng'],
  given: ['Huy', 'Khang', 'Phúc', 'Bảo', 'Long', 'Nam', 'Tùng', 'Dũng', 'Khoa', 'Hiếu', 'Thịnh', 'Tài', 'Kiệt', 'Duy', 'Sơn', 'Quân', 'Vinh', 'Lộc', 'Tín', 'Trung', 'Phát', 'Đạt'],
} as const;

export const PARENT_FIRST = ['Hùng', 'Lan', 'Dũng', 'Hoa', 'Thành', 'Mai', 'Sơn', 'Hằng', 'Bình', 'Tuyết', 'Cường', 'Loan'] as const;

export const HCM_WARDS = [
  { street: ['Nguyễn Trãi', 'Trần Hưng Đạo', 'Võ Văn Kiệt'], ward: 'Phường Bến Thành', district: 'Quận 1' },
  { street: ['Cách Mạng Tháng 8', 'Lê Văn Sỹ', 'Nam Kỳ Khởi Nghĩa'], ward: 'Phường Võ Thị Sáu', district: 'Quận 3' },
  { street: ['Điện Biên Phủ', 'Xô Viết Nghệ Tĩnh', 'Bạch Đằng'], ward: 'Phường 25', district: 'Quận Bình Thạnh' },
  { street: ['Phan Xích Long', 'Hoàng Văn Thụ', 'Nguyễn Văn Trỗi'], ward: 'Phường 7', district: 'Quận Phú Nhuận' },
  { street: ['Quang Trung', 'Nguyễn Oanh', 'Phan Văn Trị'], ward: 'Phường 10', district: 'Quận Gò Vấp' },
  { street: ['Cộng Hòa', 'Trường Chinh', 'Âu Cơ'], ward: 'Phường 13', district: 'Quận Tân Bình' },
  { street: ['Lũy Bán Bích', 'Tân Kỳ Tân Quý', 'Độc Lập'], ward: 'Phường Tân Thành', district: 'Quận Tân Phú' },
  { street: ['Võ Văn Ngân', 'Kha Vạn Cân', 'Lê Văn Việt'], ward: 'Phường Linh Chiểu', district: 'TP. Thủ Đức' },
  { street: ['Nguyễn Thị Thập', 'Huỳnh Tấn Phát', 'Lê Văn Lương'], ward: 'Phường Tân Phú', district: 'Quận 7' },
  { street: ['Hậu Giang', 'Kinh Dương Vương', 'Hồng Bàng'], ward: 'Phường 11', district: 'Quận 6' },
] as const;

export const HOMETOWNS = ['Long An', 'Tiền Giang', 'Bến Tre', 'Đồng Nai', 'Bình Dương', 'Tây Ninh', 'Cần Thơ', 'Vĩnh Long', 'Đồng Tháp', 'Bình Định', 'Quảng Ngãi', 'Đắk Lắk', 'Lâm Đồng', 'Nghệ An', 'Thanh Hóa'] as const;

export const BANKS = [
  { name: 'Vietcombank', len: 13 }, { name: 'Techcombank', len: 14 }, { name: 'MB Bank', len: 12 },
  { name: 'ACB', len: 9 }, { name: 'BIDV', len: 14 }, { name: 'VPBank', len: 10 }, { name: 'TPBank', len: 11 }, { name: 'Sacombank', len: 12 },
] as const;

/** Đầu số di động Việt Nam hợp lệ (Viettel, Vinaphone, Mobifone). */
export const MOBILE_PREFIXES = ['090', '093', '089', '070', '079', '077', '076', '078', '091', '094', '088', '083', '084', '085', '081', '082', '086', '096', '097', '098', '032', '033', '034', '035', '036', '037', '038', '039'] as const;

export const DEVICES = [
  'iPhone 13 · Safari iOS 17', 'iPhone 14 Pro · Safari iOS 18', 'iPhone 11 · Safari iOS 16', 'Samsung Galaxy A54 · Chrome Android 14',
  'Samsung Galaxy S23 · Chrome Android 14', 'OPPO Reno10 · Chrome Android 13', 'Xiaomi Redmi Note 12 · Chrome Android 13', 'Vivo Y36 · Chrome Android 13',
] as const;

export const EMAIL_DOMAINS = ['gmail.com', 'gmail.com', 'gmail.com', 'yahoo.com', 'outlook.com'] as const;

export const LEAVE_REASONS = [
  'Về quê dự đám cưới người thân', 'Lịch thi giữa kỳ tại trường', 'Đi khám sức khỏe định kỳ', 'Gia đình có việc riêng cần giải quyết',
  'Làm thủ tục giấy tờ tại phường', 'Đưa người nhà đi khám bệnh', 'Tham gia buổi bảo vệ đồ án', 'Nghỉ bù sau chuỗi ca liên tục',
] as const;

export const SWAP_REASONS = [
  'Trùng lịch học bù trên trường', 'Có việc gia đình đột xuất buổi chiều', 'Lịch thi chứng chỉ tiếng Anh', 'Đi phỏng vấn thực tập',
  'Hẹn khám răng đã đặt trước', 'Tham gia hoạt động tình nguyện của trường',
] as const;

export const EMERGENCY_REASONS = [
  'Sốt cao từ tối qua, có giấy khám bệnh', 'Xe hư giữa đường, không kịp đến ca', 'Người nhà nhập viện cấp cứu', 'Ngộ độc thực phẩm, đang truyền dịch', 'Mưa ngập nặng khu vực nhà ở',
] as const;

export const ADJ_REASONS = {
  FORGOT_CHECK_OUT: ['Cuối ca đông khách, quên bấm ra ca', 'Điện thoại hết pin lúc kết ca', 'Bàn giao kiểm kê xong quên chấm ra'],
  GPS_ERROR: ['Định vị GPS báo sai vị trí dù đang ở cửa hàng', 'Mạng di động chập chờn không xác định được vị trí'],
  CAMERA_ERROR: ['Camera điện thoại lỗi không chụp được ảnh', 'Ứng dụng báo lỗi quyền truy cập camera'],
} as const;

export const EXPERIENCE_NOTES = [
  'Đã làm pha chế 6 tháng tại quán trà sữa', 'Sinh viên năm 2, chưa có kinh nghiệm nhưng nhanh nhẹn', 'Từng làm thu ngân siêu thị 1 năm',
  'Có kinh nghiệm phục vụ nhà hàng 8 tháng', 'Đã có chứng chỉ pha chế cơ bản', 'Làm part-time tại chuỗi cà phê 1 năm',
] as const;

export const SOURCE_CHANNELS = ['GOOGLE_FORM', 'FACEBOOK', 'WALK_IN', 'REFERRAL', 'TOPCV'] as const;
