# PandaStudy — Auto Fill Form

Ứng dụng web độc lập (HTML/CSS/JavaScript thuần) cho danh sách học sinh/học viên điền sẵn Google Forms. Không liên quan FinQuery. Deploy thẳng GitHub → Vercel; không cần build, database hoặc server.

## Hỗ trợ

- Nhận link `docs.google.com/forms/d/.../viewform` hoặc link điền trước có `entry.<số>`.
- Tự nhận dạng entry ID, thêm/sửa tên câu hỏi; bắt buộc/không bắt buộc; kiểu văn bản, email, số, số điện thoại, ngày, checkbox nhiều lựa chọn (phân cách `;`).
- Nhập UTF-8 CSV (`,` hoặc `;`), TSV, `.xlsx` (Excel OpenXML, đọc sheet đầu tiên bằng ZIP/DecompressionStream built-in), tối đa 5 MB, 2.000 dòng và 100 cột.
- Kiểm tra lỗi chi tiết: đuôi tệp, dữ liệu nhị phân giả CSV, Excel sai định dạng/giải nén lỗi, mã hóa, dấu ngoặc kép CSV, thiếu/trùng tiêu đề, số cột không đều, mapping thiếu, trường bắt buộc, email/số/điện thoại/ngày.
- Báo lỗi gồm mã, vị trí dòng/cột, nguyên nhân và cách sửa; có thể tải CSV báo cáo lỗi.
- Xem trước 8 dòng, xem 10 liên kết và xuất toàn bộ liên kết đã điền sẵn ra CSV.
- Nhập file và xử lý hoàn toàn trên trình duyệt, không upload server. Chỉ cấu hình biểu mẫu được lưu localStorage.

## Giới hạn đã biết

- **Không tự gửi form**. Người dùng mở link để kiểm tra và nhấn Gửi trên Google Forms. Không vượt captcha/đăng nhập; các trường upload file phải xử lý trên Google Forms.
- Link Apps Script `/exec` không chứa `Code.gs` và không phải link Google Form. Cần mã nguồn Apps Script gốc để port 1:1 nghiệp vụ backend.
- Với Excel cũ `.xls` hãy Save As `.xlsx`; CSV lưu mã hóa UTF-8.
- `.xlsx` dùng native `DecompressionStream('deflate-raw')`, cần Chrome/Edge hiện đại. Nếu không hỗ trợ, lưu dưới CSV UTF-8.
- Cột ngày phải dạng ISO `YYYY-MM-DD`. Checkbox nhiều đáp án dùng dấu `;`.
- Lần triển khai đầu nên thử với 2-3 dòng và một form test do bạn sở hữu, tránh nhập dữ liệu nhạy cảm không cần thiết.

## Chạy ở máy tính

```sh
python3 -m http.server 8000
# http://localhost:8000
```

## Triển khai Vercel

- Import repo riêng `NCKHtop1/auto-fill-form` hoặc deploy folder này.
- Framework preset: Other. Root: repo root. Build command: none. Output Directory: `.`.
- Domain mặc định `<project>.vercel.app`. Không tạo, thay đổi cấu hình bất kỳ dự án FinQuery nào.

## Kiểm thử

`tests/smoke.py` dùng Chromium qua Playwright và tạo CSV/XLSX fixtures. Nó kiểm tra 21 ca: input hợp lệ, file sai định dạng, Excel UTF-8, hàng/cột sai, ngày không tồn tại và xuất liên kết. Chạy: `python3 tests/smoke.py`.

## Tạo dự án Vercel bằng một lần bấm

Nếu tài khoản công cụ tự động không được cấp quyền tạo Vercel project (403), chủ tài khoản có thể import repo tại:

https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FNCKHtop1%2Fauto-fill-form&project-name=pandastudy

Chọn team `ngochailuong`, giữ build framework Other / no build; Vercel dùng `pandastudy.vercel.app` nếu tên còn trống.
