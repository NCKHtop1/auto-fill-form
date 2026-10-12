# PandaStudy — Bản Vercel (không dùng Apps Script)

Trang PandaStudy được chuyển từ HTML cũ sang Vercel. Phần quản lý file, ghép cột, tạo dữ liệu mẫu, lập kế hoạch, xem lỗi và tải báo cáo CSV vẫn chạy trên trình duyệt. Backend là các Vercel Functions Node.js.

## Chạy và kiểm thử

- `npm test`: kiểm tra ghép cột, câu hỏi lựa chọn, lưới và kế hoạch 50/100/500 dòng.
- `npm run check`: kiểm tra cú pháp backend.
- Đưa thư mục này lên Vercel với `Root Directory` là `native` nếu nằm trong kho GitHub `auto-fill-form`; không cần lệnh build.

## Đăng nhập Google

Tạo OAuth 2.0 Web Application tại Google Cloud Console, bật **Google Forms API** và thêm redirect URI:

`https://TEN-TRANG.vercel.app/api/auth/callback`

Đặt trong Vercel → Project → Settings → Environment Variables:

- `GOOGLE_CLIENT_ID`: OAuth Client ID
- `GOOGLE_CLIENT_SECRET`: OAuth Client Secret
- `APP_SESSION_SECRET`: chuỗi ngẫu nhiên từ 32 ký tự trở lên
- `PUBLIC_SITE_URL`: địa chỉ website Vercel chính thức, không có dấu `/` cuối
- `ENABLE_QA_SUBMISSIONS`: mặc định `false`; chỉ bật `true` sau khi thử bằng **biểu mẫu kiểm thử do bạn quản lý**

Đăng nhập có yêu cầu quyền đọc cấu trúc và đọc phản hồi Google Forms. Ứng dụng kiểm tra quyền truy cập bằng Google API, chỉ nhận link dạng `docs.google.com/forms/d/.../edit`.

## Gửi phản hồi và giới hạn

Google Forms API **không có endpoint chính thức tạo phản hồi**. Do đó chức năng “Gửi trực tiếp” trong bản Vercel dùng đường xử lý công khai `formResponse`, **không phải Google Forms API chính thức**. Nó có thể ngừng hoạt động hoặc thất bại với các biểu mẫu bắt đăng nhập, thu email được xác minh, tải file, phân nhánh nhiều trang hoặc giới hạn 1 phản hồi/người. Theo mặc định `ENABLE_QA_SUBMISSIONS=false` để không gửi thật khi chưa kiểm thử. Không có cách bảo đảm 100% thành công chỉ từ mã nguồn.

Nếu được bật, phần gửi ngay chia kế hoạch thành lô 25, mỗi dòng được gọi riêng; tự hiển thị số thành công/thất bại. Giữ trang web mở cho đến khi kết thúc. Không gửi lại dòng lỗi mà chưa kiểm tra trên Google Form vì có thể gây trùng. Giới hạn nhập trên giao diện là **100.000 dòng mỗi kế hoạch**, không còn 50 dòng; kết quả thực tế còn phụ thuộc vào Google và thời gian chạy.

## Chưa chuyển

- **Thanh toán, ví và đối soát ngân hàng**: Mã nguồn `ManualBillingService` chưa được cung cấp, nên giao diện thanh toán ẩn, không dùng số dư hoặc đơn giá cũ. Không đưa secret từ `Code.gs` cũ lên GitHub. Cần thay secret cũ đã chia sẻ nếu vẫn đang hoạt động.
- **Chạy nền theo lịch**: cần hàng đợi và kho lưu trữ bền vững trên Vercel; chưa được bật. Chế độ gửi ngay vẫn hỗ trợ >50 dòng với tab mở.
- Form cần đăng nhập, CAPTCHA hoặc hạn chế quyền nhận phản hồi không được tự động vượt qua.

## Ghi chú bảo mật

Cookie phiên Google được mã hóa bằng AES-GCM, `HttpOnly`, `SameSite=Lax`. Không đưa Google OAuth secret, session secret hay thông tin ngân hàng vào GitHub. `ENABLE_QA_SUBMISSIONS` phải do người quản trị bật và chỉ dùng để QA biểu mẫu được phép kiểm thử.
