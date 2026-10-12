# PandaStudy

PandaStudy có hai phần: công cụ chuẩn bị liên kết Google Forms từ Excel/CSV và **Blog nghiên cứu** với những bài viết thực hành SPSS, Stata, Python. Giao diện tiếng Việt, dùng trên máy tính và điện thoại, không cần cài ứng dụng.

## Các trang

| Trang | Làm gì ở đây? |
| --- | --- |
| Trang chủ | Bắt đầu với công cụ và xem những bài blog mới |
| Thiết lập form | Đọc liên kết Google Forms điền trước; xác định `entry.<số>`, tên và kiểu câu hỏi |
| Nhập dữ liệu | Chọn `.xlsx`, `.csv`, `.tsv`; xem file và ghép cột với câu hỏi |
| Kiểm tra & xuất | Xem lỗi ở dòng/cột nào, cách sửa; xuất link điền sẵn và báo cáo lỗi |
| **Blog nghiên cứu** | Đọc 5 bài SPSS, Stata, Python, dữ liệu thiếu, chọn phép kiểm định; tìm kiếm/lọc theo chủ đề |
| Hướng dẫn | Ví dụ file mẫu, từng bước thao tác và những lỗi hay gặp |
| Về PandaStudy | Giới thiệu sản phẩm và cách xử lý file trên trình duyệt |

## 5 bài blog có sẵn

1. **Nhận file khảo sát rồi, mở SPSS kiểm tra gì trước?** — codebook, thống kê mô tả, thang đo, syntax.
2. **Stata: viết một do-file để không phải làm lại từ đầu** — nhập dữ liệu, kiểm tra biến, hồi quy, sai số chuẩn robust.
3. **Python & pandas: dọn bảng khảo sát mà không phải sửa tay** — kiểm tra ID trùng, giá trị tuổi bất thường, dữ liệu thiếu.
4. **Dữ liệu trống không có nghĩa là số 0** — phân biệt mã thiếu, missing patterns, lưu ý khi loại/bù dữ liệu.
5. **Chọn kiểm định từ câu hỏi nghiên cứu, đừng chọn theo tên phần mềm** — loại biến, t-test, Chi-square, tương quan, hồi quy và cách diễn giải.

Bài viết là nội dung gốc của PandaStudy, có ví dụ lệnh và liên kết đến tài liệu chính thức của IBM SPSS, Stata, pandas hoặc statsmodels. **Các ví dụ dùng để học, không thay thế việc xem thiết kế và dữ liệu thực của nghiên cứu.**

- Vào blog: `/#blog`
- Mỗi bài có đường dẫn chia sẻ: `/#blog/<slug>`
- Có tìm kiếm không phân biệt dấu tiếng Việt, lọc chủ đề, mục lục, thanh tiến độ đọc, sao chép mã và bài liên quan.
- Khi chuyển giữa Blog và công cụ, file nhập và cấu hình form trong phiên làm việc vẫn được giữ.
- Chuyển động nhẹ có hỗ trợ `prefers-reduced-motion` và các thành phần điều khiển có trạng thái focus bàn phím.

## Phạm vi công cụ Google Forms

- Đọc liên kết điền trước `docs.google.com/forms/d/.../viewform`, ưu tiên link có mã `entry.<số>`.
- Hỗ trợ văn bản, email, số, điện thoại, ngày `YYYY-MM-DD`, checkbox đa lựa chọn phân tách bằng `;`.
- Đọc `.xlsx` (sheet đầu tiên), CSV UTF-8 (dấu phẩy hoặc chấm phẩy) và TSV; giới hạn 5 MB, 2.000 dòng, 100 cột.
- Báo lỗi đuôi file không đúng/giả định dạng, ký tự UTF-8, CSV đóng ngoặc kép sai, cột thiếu hoặc trùng, độ dài dòng sai, chưa ghép cột, ô bắt buộc trống, email/điện thoại/số/ngày không hợp lệ. Mỗi lỗi có vị trí, giải thích và cách sửa.
- **Không tự gửi Google Forms.** Công cụ tạo liên kết điền sẵn để bạn mở, kiểm tra và tự bấm Gửi.
- File Excel/CSV được xử lý trong trình duyệt; không đưa file lên máy chủ của PandaStudy. Chỉ cấu hình form được lưu trên `localStorage` của trình duyệt.
- Mã nguồn Google Apps Script bản cũ chưa được tích hợp; cần đối chiếu `Code.gs` và các file HTML gốc trước khi chuyển chức năng phía máy chủ. Không có thay đổi đối với FinQuery.

## Chạy cục bộ

```bash
python3 -m http.server 8000
# Mở http://localhost:8000
```

## Kiểm thử

```bash
node --check app.js
node --check blog-data.js
python3 tests/smoke.py
```

`tests/smoke.py` dùng Chromium, Playwright và openpyxl. Workflow `.github/workflows/tests.yml` chạy kiểm thử sau mỗi lần push/pull request. Kiểm thử bao gồm 5 bài viết, deep link, tìm kiếm, điều hướng tab, import thật Excel/CSV, thông báo lỗi, xuất kết quả, trang blog và bài viết trên thiết bị di động.

## Triển khai

Đây là website tĩnh, có thể import repository lên Vercel (framework: **Other**, root: repository root). `vercel.json` cung cấp security headers và clean URLs. Website có thể chạy trên subdomain `.vercel.app`, không cần mua domain.
