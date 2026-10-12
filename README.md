# PandaStudy — Form workspace

Website hỗ trợ chuẩn bị dữ liệu Excel/CSV để tạo liên kết Google Forms đã điền sẵn. Giao diện được chia thành sáu tab và có hướng dẫn riêng cho người mới sử dụng.

## Các tab trong ứng dụng

| Tab | Nội dung |
| --- | --- |
| Trang chủ | Giới thiệu PandaStudy, ba bước làm việc, tình huống thường gặp |
| Thiết lập form | Nhận liên kết điền trước, xác định các mã `entry`, đặt tên và kiểu dữ liệu |
| Nhập dữ liệu | Tải Excel/CSV/TSV, ghép cột, xem trước dữ liệu và lỗi ngay trên tab |
| Kiểm tra & xuất | Hiển thị nguyên nhân, dòng/cột lỗi, cách sửa; tải báo cáo và link CSV |
| Hướng dẫn | Hướng dẫn từng bước, tải file mẫu, câu hỏi thường gặp |
| Về PandaStudy | Giới thiệu sản phẩm, cách xử lý dữ liệu, liên kết Apps Script trước đây |

Việc chuyển tab không làm mất dữ liệu đang nhập. Giao diện tương thích máy tính và điện thoại; bàn phím có thể chuyển qua các tab. Cấu hình form được lưu ở `localStorage` trong trình duyệt, file dữ liệu không được tải lên server.

## Hỗ trợ dữ liệu

- Google Forms dạng `docs.google.com/forms/d/.../viewform`, ưu tiên đường liên kết điền trước có mã `entry.<số>`.
- Kiểu câu hỏi: văn bản, email, số, điện thoại, ngày `YYYY-MM-DD`, checkbox đa lựa chọn ngăn cách bằng dấu `;`.
- File CSV UTF-8 (phân cách bằng dấu phẩy hoặc chấm phẩy), TSV, Excel `.xlsx` (đọc sheet đầu tiên).
- Giới hạn 5 MB, 2.000 dòng dữ liệu, 100 cột.
- Phát hiện đuôi file sai hoặc giả định dạng, mã hóa không phải UTF-8, lỗi dấu ngoặc kép trong CSV, tiêu đề cột thiếu/trùng, số cột không đều, chưa ghép cột, ô bắt buộc trống, email/số/điện thoại/ngày không hợp lệ.
- Lỗi xuất hiện dưới dạng tiêu đề dễ hiểu bằng tiếng Việt. Phần chi tiết ghi vị trí, nguyên nhân và hướng sửa. Báo cáo tải về có cả mã lỗi kỹ thuật để đối chiếu khi cần.

## Phạm vi chức năng hiện tại

PandaStudy **tạo liên kết Google Forms đã điền sẵn**, không tự bấm Gửi hoặc bỏ qua quyền truy cập/đăng nhập/CAPTCHA. Hãy mở thử các link trước khi gửi cho người khác.

Bản Google Apps Script cũ vẫn chạy riêng. Link `/exec` công khai không trả về mã nguồn `Code.gs`; khi có mã nguồn, cần đối chiếu chức năng backend trước khi tích hợp. Không tự ý sao chép hay thay đổi FinQuery.

## Chạy cục bộ

```sh
python3 -m http.server 8000
# Mở http://localhost:8000
```

## Kiểm thử

Kiểm tra cú pháp JavaScript và chạy Chromium bằng Playwright:

```sh
node --check app.js
python3 tests/smoke.py
```

Bộ kiểm thử hiện có **28 tình huống**, từ các lỗi tệp và dữ liệu đến điều hướng tab, hướng dẫn, nhập Excel thật, xuất liên kết và giao diện mobile. GitHub Actions chạy tự động sau mỗi lần push lên `main`.

## Đưa lên Vercel

Import repository `NCKHtop1/auto-fill-form` vào một project mới mang tên `pandastudy`.

- Framework: Other.
- Root Directory: `/` (gốc repository).
- Build Command: để trống.
- Output Directory: mặc định cho website tĩnh.
- Không cần kết nối database hoặc khai báo token.
- Địa chỉ sẽ có dạng `https://pandastudy.vercel.app` nếu tên còn khả dụng. Không nên coi URL đó là đã hoạt động cho đến khi Vercel trả trạng thái **READY**.

Đi thẳng tới luồng import: https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNCKHtop1%2Fauto-fill-form&project-name=pandastudy
