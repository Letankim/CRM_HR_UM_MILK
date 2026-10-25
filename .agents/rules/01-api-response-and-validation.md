---
trigger: always_on
description: Quy chuẩn bắt buộc về cấu trúc JSON API Response, phân trang, tìm kiếm, sắp xếp, Validation Error chi tiết và sử dụng Enum dùng chung bằng tiếng Việt.
---

# Quy Chuẩn API Response, Validation Error & Shared Enums

## 1. Cấu trúc JSON trả về bắt buộc cho MỌI API

Tất cả các route trong `apps/api/src/routes/*.ts` phải sử dụng helper trong `apps/api/src/lib/response.ts` (`sendSuccess`, `sendPaginated`, `sendError`) để trả về đúng cấu trúc sau:

### 1.1. Thành công (Danh sách có phân trang / tìm kiếm / sắp xếp)
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

### 1.2. Khi xảy ra lỗi Validation hoặc lỗi Nghiệp vụ
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

## 2. Quy tắc bắt buộc
1. **100% Tiếng Việt & Ẩn Mã Hệ Thống Khỏi Giao Diện**: Mọi trường `message` (cả ở gốc lẫn trong `errors.details[].message`) phải viết bằng tiếng Việt chuẩn mực, dễ hiểu. Tuyệt đối không hiển thị các key hệ thống thô (`THU_VIEC`, `CHINH_THUC`, `USER: NV.MOI`, `ACCOUNT_ACTIVATED`, `CORE.USERS`, `[INVALID_PHONE]`, `v1`) ra giao diện người dùng; chỉ hệ thống mới làm việc với key nội bộ, giao diện luôn hiển thị nhãn tiếng Việt (`ROLE_LABELS`, `TABLE_DISPLAY_LABELS`, `EMAIL_TEMPLATE_LABELS`).
2. **Định dạng Số Điện Thoại Việt Nam (`0...`)**: Mặc định số điện thoại lưu trữ và hiển thị là 10 chữ số bắt đầu bằng số `0` (ví dụ: `0901000001`), tuyệt đối không lưu hoặc hiển thị `+84`. Hàm `normalizePhone()` tự động chuẩn hóa mọi đầu vào về `0xxxxxxxxx`.
3. **Cấu hình Biến Hệ Thống Tập Trung (`SYSTEM_CONFIG` & `.env`)**: Các chuỗi thương hiệu và thông số hệ thống (`[Ụm Bò Milk HR]`, `ỤM BÒ MILK`, `HỆ THỐNG NHÂN SỰ`, `UB`, `v5.1.0`, chu kỳ thử việc 12 ngày, phụ cấp đổi ca 30.000đ, bán kính GPS) phải đọc từ `packages/shared/src/system-config.ts` và cho phép cấu hình qua `.env`.
4. **Truy vết trường lỗi**: Khi validate thất bại, phải trả về đúng `field` (tên trường bị lỗi), `code` (mã lỗi chuẩn hóa từ `ValidationErrorCode` trong `@umbm/shared`), `message` (thông báo tiếng Việt), và `rejected_value` (giá trị thực tế mà client đã gửi lên).
5. **Đồng bộ Enum & Schema V5.1 tại `@umbm/shared`**: Không bao giờ khai báo enum rời rạc ở từng file BE hoặc FE. Tất cả các enum (`Role`, `AccountStatus`, `EmployeeStage`, `ShiftAssignmentStatus`, `LeaveRequestStatus`, `SwapStatus`, `PayrollStatus`, `ValidationErrorCode`, `ApiErrorCode`), nhãn tiếng Việt (`*_LABELS`, `*_OPTIONS`) và cấu trúc 7 bảng tính (`sheets-schema.ts`, `domain-schemas.ts`) phải đặt trong `packages/shared/src/`.
