# PandaStudy — kế hoạch phát hành và bằng chứng UAT thanh toán

Ngày kiểm tra: **17/10/2026**. Nhánh: `feat/pandastudy-manual-topups`.

Baseline production đã đối chiếu: `6dd119bc23c125e9b629c2ba28c1a84e8406d04e`, repository `NCKHtop1/auto-fill-form`, Vercel project `auto-fill-form`, root directory `native`, domain `https://auto-fill-form-liard.vercel.app`.

## 1. Trạng thái và quyết định phát hành

**Mã triển khai và UAT cục bộ đã hoàn tất. Chưa đủ điều kiện bật thanh toán production.** Các điều kiện còn thiếu là PostgreSQL production, dịch vụ email với sender đã xác minh, QR được phép công bố trên website, worker đã cấu hình và UAT qua các tài khoản/dịch vụ thật. Không coi dữ liệu giả lập hoặc database UAT cục bộ là bằng chứng đã nhận tiền/gửi email thật.

Không merge vào `main` trước các gate bên dưới: Git integration có thể tự đưa commit mới lên production. Cờ `BILLING_ENABLED` mặc định tắt; không bật thu tiền khi chưa có hạ tầng và bằng chứng UAT đích.

Đã rà soát độc lập theo ba phạm vi backend, giao diện/sản phẩm và hệ thống. Đây là đánh giá kỹ thuật bằng các nhánh công việc AI, không phải biên bản phê duyệt của nhân sự công ty.

## 2. Phạm vi đã chốt

- Giá: **500 đồng/phiếu**. Một dòng được Google báo nhận dùng một phiếu. Giá và số phiếu được kiểm tra phía server.
- Mua từ 1 đến 100.000 phiếu; giao diện mặc định 20. Giới hạn mỗi tài khoản: 5 đơn đang chờ, 20 đơn/ngày.
- Tạo đơn → quét QR/chuyển khoản → người dùng báo đã chuyển → gửi thông báo → quản trị đối soát tiền thực nhận → duyệt và cộng phiếu.
- Hai người nhận thông báo do chủ dự án chỉ định được cấu hình riêng qua `BILLING_NOTIFICATION_EMAILS`; địa chỉ cá nhân không nằm trong mã nguồn hoặc fixture UAT.
- Ngân hàng, số tài khoản và người thụ hưởng được cấu hình phía server. Giá trị thật và ảnh QR không được đưa vào thay đổi Git này.
- Duyệt tiền chỉ cập nhật số dư. Người dùng chủ động bấm gửi Form sau đó; không tự chạy hoặc tiếp tục lô đang dừng.
- Tải file, ghép cột, tạo bảng, kiểm tra, CSV và luồng sáu bước được giữ. Định dạng báo cáo gửi vẫn có đúng năm cột cũ; mã thao tác của lượt có tính phí nằm trong ghi chú.
- Quyền duyệt tiền độc lập với quyền sử dụng công cụ. Chủ ví lấy từ Google `sub` đã xác minh; email do trình duyệt gửi lên không quyết định chủ ví hoặc quyền admin.

### QR và dữ liệu người nhận

Ảnh QR gốc được cung cấp trong phiên làm việc đọc được bằng cả jsQR và ZXing; ảnh bổ sung có logo không đọc được bằng hai bộ kiểm tra, ZXing báo lỗi checksum. Payload ngân hàng và các ảnh thật không được commit. Việc sử dụng ảnh thật trên website phải được chủ dự án cho phép và kiểm tra lại bằng ứng dụng ngân hàng trong UAT đích.

`BILLING_QR_IMAGE_URL` nhận đường dẫn cùng origin hoặc URL HTTPS đúng origin app đã cấu hình. Repository không chứa ảnh thanh toán thật; `/assets/uat-payment-qr.svg` chỉ là route được mock trong kiểm thử, không phải tài nguyên production. QR đã kiểm tra là QR tĩnh, không chứa số tiền hoặc nội dung đơn. Giao diện yêu cầu nhập/copy chính xác hai trường từ đơn. Nếu cấu hình ngân hàng đổi, đơn cũ vẫn giữ thông tin ngân hàng lúc tạo và không hiển thị QR của tài khoản mới.

## 3. Trạng thái nghiệp vụ và tính toàn vẹn

| Trạng thái đơn | Ý nghĩa | Có cộng phiếu? |
|---|---|---|
| `pending_payment` | Đã tạo đơn; chưa báo chuyển | Không |
| `pending_review` | Người dùng báo đã chuyển, chờ ngân hàng được đối soát | Không |
| `approved` | Quản trị xác nhận tiền, đúng số tiền và mã giao dịch | Cộng đúng một lần |
| `rejected` | Không đủ điều kiện duyệt, có lý do | Không |

Ảnh chụp, nút “Tôi đã chuyển khoản” và email không chứng minh ngân hàng đã nhận tiền. Mã giao dịch ngân hàng được ràng buộc duy nhất trên tài khoản nhận để không duyệt cho hai đơn. Duyệt, cập nhật ví, ledger và dấu vết quản trị nằm trong cùng transaction PostgreSQL.

| Kết quả gửi Form | Xử lý phiếu | Xử lý gửi lại |
|---|---|---|
| Google hiện trang xác nhận | Giữ rồi trừ một phiếu | Operation lặp chỉ đọc kết quả |
| Chắc chắn chưa thực hiện POST | Hoàn phiếu đang giữ | Không tự gửi lại |
| Timeout/lỗi sau POST/kết quả chưa rõ | Giữ một phiếu chờ đối chiếu | Không tự gửi lại |
| Database lỗi sau dispatch | Giữ operation bền vững và phiếu chờ | Không cấp quyền dispatch lần hai |

Mỗi operation gắn với người dùng, Form và hash đáp án phía server. Chỉ một request được nhận quyền dispatch. Không khẳng định Google Forms có bảo đảm exactly-once: phía Google không cung cấp giao dịch chung với PostgreSQL hoặc response ID qua trang trả lời này. Tổng phản hồi tăng cũng không xác định riêng phản hồi nào nếu có người khác gửi đồng thời.

Quản trị có thể đối soát operation chưa rõ sau ít nhất 5 phút, phải ghi căn cứ và xác nhận đã kiểm tra. Quyết định hoàn/trừ được lưu và không gọi lại Google. Không tự hết hạn rồi hoàn các lượt chưa rõ vì có thể Google đã nhận.

## 4. Cấu hình và hạ tầng cần hoàn thiện

| Biến/cấu hình | Mục đích |
|---|---|
| `DATABASE_URL` | PostgreSQL thật, được chọn đúng môi trường; ưu tiên kết nối có TLS của nhà cung cấp |
| `BILLING_ENABLED` | Chỉ `true` khi đã đạt gate phát hành |
| `BILLING_TOPUPS_PAUSED` | `true` để dừng mua mới, giữ ví/duyệt/quyết toán hoạt động |
| `BILLING_ADMIN_EMAILS` | Danh sách quản trị được chỉ định; phải đăng nhập Google với email đã xác minh |
| `BILLING_NOTIFICATION_EMAILS` | Danh sách người nhận thông báo, kiểm tra từng địa chỉ; không tự cấp quyền admin |
| `BILLING_BANK_ID` | Mã BIN ngân hàng, đúng 6 chữ số |
| `BILLING_BANK_NAME` | Tên ngân hàng hiển thị |
| `BILLING_BANK_ACCOUNT_NUMBER` | Tài khoản nhận được chủ dự án xác nhận |
| `BILLING_BANK_ACCOUNT_NAME` | Tên người thụ hưởng được chủ dự án xác nhận |
| `BILLING_QR_IMAGE_URL` | Ảnh QR được phép công bố, phục vụ cùng origin với ứng dụng |
| `RESEND_API_KEY` | API key của tài khoản gửi mail, nhập trong cấu hình bảo mật |
| `BILLING_EMAIL_FROM` | Địa chỉ gửi thuộc domain đã được xác minh |
| `BILLING_PUBLIC_SITE_URL` | Origin đúng của môi trường để email mở trang quản trị đúng nơi |
| `BILLING_CRON_SECRET` hoặc `CRON_SECRET` | Secret ngẫu nhiên ít nhất 32 ký tự cho worker |
| GitHub secret `PANDASTUDY_BILLING_CRON_SECRET` | Khớp secret worker trên production |
| GitHub variable `PANDASTUDY_BILLING_LIVE=true` | Bật job retry sau UAT đích; mặc định job không chạy |

Các biến Google OAuth và `APP_SESSION_SECRET` hiện có được tiếp tục sử dụng. Cookie cũ được bổ sung định danh Google theo yêu cầu khi vào billing; không đổi OAuth scopes. UAT preview cần origin và callback OAuth thực sự được cho phép; không vô hiệu hóa bảo vệ deployment để thử.

Trong phiên kiểm tra, metadata production chỉ có cấu hình Google/session/site, chưa có database hoặc email. Connector không có thao tác cấp integration; Vercel CLI chưa đăng nhập. Đã tìm thấy lựa chọn Neon free, nhưng chưa tạo tài nguyên, chấp nhận điều khoản hay mua dịch vụ.

Resend với domain thử `resend.dev` chỉ cho gửi đến email chủ tài khoản, nên không đủ để kiểm chứng gửi đến cả hai quản trị viên. Phải dùng sender được phép gửi đến cả hai người nhận. Không đặt API key, connection string hoặc mật khẩu trong chat, GitHub hay file được commit.

## 5. Email và vận hành worker

Đơn và các bản ghi outbox được ghi trước khi thử gửi email; với hai người nhận đã chỉ định, mỗi đơn tạo hai bản ghi. Request báo chuyển khoản thử xử lý tối đa hai email; lỗi provider không làm mất hoặc hoàn tác đơn. Worker dùng lease, khóa bản ghi, payload được giữ nguyên từ lần gửi đầu và idempotency key ổn định.

Workflow `billing-notifications.yml` gọi đúng endpoint production mỗi 5 phút khi cờ repository cho phép. Đây là lịch theo khả năng của GitHub, không phải cam kết email đến trong 5 phút. Scheduled Actions có thể bị trì hoãn, chỉ chạy từ default branch và có thể bị tắt sau thời gian repository công khai không hoạt động. Admin cũng có nút thử gửi lại email lỗi.

Lần gửi có kết quả chưa rõ quá 23 giờ được giữ để kiểm tra, tránh gửi lại sau cửa sổ idempotency của provider. Trạng thái `sent` ghi nhận provider chấp nhận request; UAT đích phải xác nhận nhận mail thực tế, gồm cả thư rác. Không dùng email để tự duyệt giao dịch.

Không thêm cron Vercel mỗi 5 phút: tài khoản default hiện báo Hobby, còn gói của team/project chưa được xác nhận độc lập. Hobby giới hạn lịch cron một lần/ngày. Job GitHub giữ cờ tắt cho tới khi secret và hạ tầng thật đã sẵn sàng.

## 6. Bằng chứng kiểm thử

| Nhóm | Kết quả | Phạm vi |
|---|---|---|
| Native Node tests | 67 ca đạt | Form/parser/validation, quyền, định danh, wrapper tính phiếu, API, PGlite/outbox |
| Blog publish tests | 5 ca đạt | Hồi quy chức năng có sẵn |
| PostgreSQL 18.4 thật | 14 ca con đạt; runner báo 15 tính cả ca cha; 0 bỏ qua | Nhiều kết nối độc lập, transaction và lock thật |
| Google Form công khai | 1 ca chỉ đọc đạt | 11 câu hỏi, 3 grid, 19 entry ID; xác minh phiên điền, không submit |
| Payment browser UAT | Toàn bộ nhóm ca đạt | API giả lập, cả ví/admin, desktop và 320 px |
| Browser QA cũ | Đạt | Gửi 1 dòng rồi phần còn lại bằng API giả lập, đối chiếu và CSV |
| Browser native smoke | Đạt | Blog, editor, điều hướng, bản nháp và mobile |
| Smoke của site gốc | 36 ca đạt | Import, mapping, export và giữ trạng thái |
| UX audit | 75 đạt, 0 lỗi, 3 cần kiểm tra ngoài script | OAuth thật, Form thử nghiệm thật, chỉ số hiệu năng thực tế |
| Dependency production | 0 lỗ hổng được npm audit báo | `npm audit --omit=dev --audit-level=high` |

Đối với PostgreSQL thật, đã chèn trigger cố tình gây lỗi sau khi cập nhật một phần: cộng phiếu, giữ phiếu và quyết toán đều rollback đúng. Hai migration process chạy đồng thời và chạy lại sau khi có dữ liệu không làm mất đơn/số dư.

Các ca cạnh tranh nổi bật: hai admin/đơn chỉ cộng một lần; một chứng từ/hai khách chỉ một đơn được duyệt; 12 lần báo chuyển chỉ có hai outbox; 20 yêu cầu giữ trên số dư 7 chỉ có 7 claim; 20 lần lặp operation chỉ có một quyền dispatch; quyết toán/hoàn lặp chỉ tác động một lần.

UAT giao diện giữ nguyên file, mapping và bảy dòng đã kiểm tra qua mua/duyệt; duyệt không gọi gửi Form. Khi cố ý đổi Form và dựng plan mới trong request đang chờ, chỉ một request dùng URL/đáp án đã chụp lại, không cập nhật nhầm plan mới, dừng phần còn lại và giữ kết quả để tải. Năm vùng nhập liệu được khóa trong lúc gửi và mở lại sau đó.

Lỗi bắt được và sửa trong kiểm tra: race đổi Form; thiếu cập nhật ví do khác nơi phát/nghe event; thông báo lỗi database có thể lộ chi tiết; thông báo “chưa thay đổi” không đúng khi mất phản hồi sau COMMIT; giữ đúng năm cột CSV cũ.

Sau khi chuyển cấu hình ngân hàng sang biến môi trường, đã chạy lại 14 ca PGlite, 14 ca con PostgreSQL thật và toàn bộ nhóm payment browser UAT. Fixture chỉ dùng tài khoản giả toàn số 0, email `example.test` và QR placeholder ghi rõ “QR UAT — Không chuyển tiền”; không có payload thanh toán. Ca QR khác origin bị từ chối cũng đã đạt.

Ảnh giao diện sinh trong `qa-artifacts/` và artifact của CI chỉ dùng dữ liệu giả; không đưa ảnh QR hoặc screenshot chứa dữ liệu ngân hàng thật vào Git.

### Cách chạy lại

```bash
cd native
npm ci
npm test
npm run check
# Chỉ với DATABASE_URL đã trỏ đúng database được phép:
npm run migrate:billing
# BILLING_TEST_DATABASE_URL phải là database được phép kiểm thử:
npm run test:postgres
```

Browser: dùng Python Playwright theo `.github/workflows/tests.yml`; chạy `tests/billing_browser.py`, `tests/qa_browser.py`, `tests/native_smoke.py`, `tests/ux_audit.py`, `tests/smoke.py` từ root. Các test ghi Google thật luôn được tách khỏi test giả lập. Trong môi trường thực hiện lần này, test Google chỉ đọc cần `NODE_USE_ENV_PROXY=1` để dùng proxy mạng; production không cần thay code vì điều đó.

## 7. Trình tự phát hành sau khi có hạ tầng

1. **Chọn đúng project/database.** Xác nhận project ID `prj_BNL9GBoMnWf4otcPGCG53qIeERcb`, root `native`, commit dự kiến. Cấp PostgreSQL, sender và QR được phép công bố trên website; dùng database/schema UAT riêng, chưa bật thu tiền.
2. **Migration và kiểm thử database đích.** Chạy migration trên database được chọn; xác nhận schema version 1, đọc/ghi, TLS, sao lưu và khả năng khôi phục. Không nhập số dư giả 1.000.000 của legacy stub thành tiền/phiếu thật.
3. **UAT bản triển khai đích.** Đăng nhập người mua và cả hai admin, tạo đơn thử, kiểm tra QR bằng app ngân hàng, đối chiếu số tiền/memo, xác nhận cả hai hộp thư nhận thông báo; duyệt và kiểm tra số dư sau tải lại. Lặp nút duyệt phải không cộng thêm.
4. **UAT gửi có tính phiếu.** Dùng Form bản sao được cấp phép và dữ liệu tổng hợp; gửi một dòng, kiểm tra trang xác nhận/số liệu, trừ đúng một phiếu. Kiểm tra lỗi chắc chắn chưa gửi, kết quả chưa rõ và đối soát. Không thử ghi vào khảo sát thật đang vận hành.
5. **Kiểm chứng worker.** Cấu hình secret matching, chạy worker bằng quyền hợp lệ và kiểm tra khi thiếu/sai secret bị từ chối. Thử retry trên môi trường UAT, không tạo email giả mang nghĩa tiền đã nhận.
6. **Gate phát hành.** CI trên đúng commit thành công; bằng chứng UAT dịch vụ thật đầy đủ; không còn lỗi chặn. Chỉ khi đó merge/promote đúng bản đã kiểm tra và bật enforcement. Git integration merge main có thể tự deploy: không merge sớm chỉ để lấy preview.
7. **Kiểm tra production.** Xác nhận commit/alias, người dùng cũ vẫn import/map/export được, admin truy cập đúng quyền, profile/config sẵn sàng, đơn tồn tại qua reload, mail có link đúng host. Bật biến worker sau kiểm tra.
8. **Theo dõi sau mở.** Theo dõi lỗi API, outbox retry/failed, đơn chờ và operation unknown. Đối chiếu số dư với tổng delta ledger. Nếu lỗi, áp dụng mục 8; không tự cấp phiếu hoặc gửi lại hàng loạt.

Hiện các bước liên quan dịch vụ thật còn mở; chưa có bằng chứng go-live và không có tự động hóa nào âm thầm bật thanh toán sau cuộc trao đổi.

## 8. Tạm dừng và phục hồi

- Dừng mua mới bằng `BILLING_TOPUPS_PAUSED=true`, redeploy đúng môi trường. Giữ xem đơn, báo chuyển của đơn cũ, duyệt và sử dụng phiếu.
- **Không dùng `BILLING_ENABLED=false` sau khi đã nhận thanh toán thật:** thao tác đó mở lại đường gửi miễn phí cũ. Không rollback về commit trước khi có enforcement sau khi đã bán phiếu.
- Không xóa bảng, reset số dư hoặc đảo ledger khi rollback code. Migration hiện tại chỉ thêm cấu trúc; sửa tiếp theo phải tương thích với dữ liệu đã phát sinh.
- Đơn đã trả tiền phải được đối soát từ ngân hàng và mã giao dịch thật. Không duyệt bằng ảnh chụp/email đơn lẻ.
- Operation chưa rõ phải giữ bằng chứng và xử lý có audit. Khôi phục database không có nghĩa được phát lại request Google.
- Nếu provider lỗi, giữ outbox, sửa cấu hình hợp lệ và chạy retry; các email chưa rõ quá cửa sổ an toàn cần người quản trị xem xét.

## 9. Tài liệu chính thức

- [node-postgres — transactions dùng cùng client](https://node-postgres.com/features/transactions)
- [Resend — giới hạn domain thử resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [GitHub — schedule workflow và giới hạn vận hành](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Vercel — cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
