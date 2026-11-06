# PandaStudy — kế hoạch phát hành và bằng chứng UAT thanh toán

Lập ban đầu: **17/10/2026**. Đối chiếu mã nguồn: **20/10/2026 (UTC+7)**, `main` tại `612c89121c40bcbd176941ad4323e3386caf1974`.

Baseline production lịch sử ngày 17/10 (không phải xác nhận deployment hiện tại): `6dd119bc23c125e9b629c2ba28c1a84e8406d04e`, repository `NCKHtop1/auto-fill-form`, Vercel project `auto-fill-form`, root directory `native`, domain `https://auto-fill-form-liard.vercel.app`.

## 1. Trạng thái và quyết định phát hành

**Mã đã merge; chưa có bằng chứng trong lần đối chiếu này để kết luận production sẵn sàng hoặc thu phí đã bật.**
- [PR #12](https://github.com/NCKHtop1/auto-fill-form/pull/12) merge ngày 18/10/2026, commit `8090f58011be9fd1796165c08e47953ff243ad19`.
- [PR #14](https://github.com/NCKHtop1/auto-fill-form/pull/14) merge ngày 19/10/2026, commit `e7292fcbd6213cd5a7f6e48c508cf65f0e5b0366`.
- Yêu cầu “không merge” ngày 17/10 là lịch sử, được thay bằng gate trước khi mở thu phí ở mục 7. Merge, deploy, cấu hình runtime và GO là bốn trạng thái riêng. Git integration có thể tự deploy nhưng không chứng minh UAT đã đạt.
- Phiên này chỉ đối chiếu repository; không đọc secrets, đổi cờ, migrate database, chuyển tiền, duyệt đơn hay ghi Google Form thật. Các bằng chứng kiểm thử cũ ở mục 6 không được nâng thành bằng chứng production.

### Phân loại điều kiện

| Điều kiện | Mã nguồn hiện tại | Gate vận hành / quyết định |
|---|---|---|
| Billing và mua mới | `assertReady()` yêu cầu `BILLING_ENABLED=true` và đủ cấu hình bắt buộc; tạo đơn còn yêu cầu `BILLING_TOPUPS_PAUSED` khác `true` | Chủ dự án phê duyệt cửa sổ UAT và GO riêng; không tự bật cờ |
| Cấu hình tài chính | `getConfigStatus().missing`: `database`, `administrators`, `bank`, `payment_qr`, `admin_url` | Xác minh database thật, quyền admin, chủ tài khoản ngân hàng, QR được phép công bố và origin đúng |
| Email thông báo | Thiếu transport/recipients/worker chỉ tạo `warnings`: `email_notifications`, `notification_recipients`, `notification_worker` | Chủ dự án chọn email là gate bắt buộc hoặc chấp nhận vận hành qua dashboard với người trực, tần suất kiểm tra và xử lý tồn đọng; chưa quyết định thì chưa GO |
| Email danh tính Google | `sub`, email hợp lệ và `email_verified=true` bắt buộc cho billing; admin phải thuộc `BILLING_ADMIN_EMAILS` | Đây là xác minh danh tính, khác với xác minh sender email thông báo |
| Database/schema | Có `DATABASE_URL` chỉ là kiểm tra cấu hình; health chỉ kiểm tra migration v1 | Bản hiện tại cần migration 001 và 002, bảng/cột commerce, quyền đọc/ghi, backup/restore được xác minh |
| OAuth | Client ID/secret, `APP_SESSION_SECRET` ít nhất 32 ký tự; scopes `openid email profile`; API tự kiểm tra quyền | Đăng nhập thật trên canonical domain, callback/session/logout và tài khoản buyer/admin/non-admin phải đạt |
| Duyệt ngân hàng | Admin đã xác minh + `confirmedBankTransfer=true`; amount/reference là tùy chọn, được kiểm tra khi nhập | Bắt buộc đối soát tiền thực nhận. Chủ dự án chốt chính sách ghi chứng từ; không coi checkbox là bằng chứng ngân hàng |
| Giá/gói/khuyến mãi | Giá và lượt do server quyết định; catalog có thể sửa trong database; đơn giữ snapshot | Chủ dự án duyệt catalog và campaign thực tế trước GO |

`configured=true` khi billing tắt không có nghĩa hạ tầng sẵn sàng. `/api/billing?action=health` cung cấp `financialConfigReady`, `missing`, `warnings`, `databaseReachable`, `schemaReady`; HTTP 200/`ok:true` không chứng minh tất cả đều đạt. `schemaVersion:1` không xác nhận migration 002. Xem [UAT production](PRODUCTION_UAT.md) để ghi bằng chứng và quyết định.

## 2. Phạm vi đã chốt

- Giá tùy chọn số lượng: **500 đồng/phiếu**, không chiết khấu gói. Một dòng được Google báo nhận dùng một phiếu. Giá và số phiếu được kiểm tra phía server.
- Mua từ 1 đến 100.000 phiếu; giao diện mặc định 20. Giới hạn mỗi tài khoản: 5 đơn đang chờ, 20 đơn/ngày.
- Tạo đơn → quét QR/chuyển khoản → người dùng báo đã chuyển → gửi thông báo → quản trị đối soát tiền thực nhận → duyệt và cộng phiếu.
- Người nhận thông báo tùy chọn do chủ dự án chỉ định qua `BILLING_NOTIFICATION_EMAILS` (1–10 địa chỉ hợp lệ nếu dùng); tách biệt quyền admin. Không mặc định bắt buộc đúng hai người nhận.
- Ngân hàng, số tài khoản và người thụ hưởng được cấu hình phía server. Giá trị thật và ảnh QR không được đưa vào thay đổi Git này.
- Duyệt tiền chỉ cập nhật số dư. Người dùng chủ động bấm gửi Form sau đó; không tự chạy hoặc tiếp tục lô đang dừng.
- Tải file, ghép cột, tạo bảng, kiểm tra, CSV và luồng sáu bước được giữ. Định dạng báo cáo gửi vẫn có đúng năm cột cũ; mã thao tác của lượt có tính phí nằm trong ghi chú.
- Quyền duyệt tiền độc lập với quyền sử dụng công cụ. Chủ ví lấy từ Google `sub` đã xác minh; email do trình duyệt gửi lên không quyết định chủ ví hoặc quyền admin.

### Bảng giá mặc định và catalog đang vận hành

| ID gói | Lượt | Giá niêm yết (VND) | Giá thanh toán (VND) | Giảm |
|---|---:|---:|---:|---:|
| `starter` | 20 | 10.000 | 10.000 | 0% |
| `popular` | 100 | 50.000 | 45.000 | 10% |
| `research` | 250 | 125.000 | 110.000 | 12% |
| `pro` | 500 | 250.000 | 200.000 | 20% |

Đây là seed/fallback trong `native/lib/billing.js` và migration 002, không phải cam kết catalog production chưa bị sửa. Bảng `ps_billing_packages` cho admin sửa tên, lượt, giá, badge, thứ tự, featured/enabled; phải đối chiếu catalog thực tế với bản được chủ dự án duyệt. Đơn đã tạo giữ snapshot giá/lượt/tên gói; sửa catalog không đổi đơn cũ. Doanh thu chỉ gồm đơn approved, không gồm lượt tặng; báo cáo tháng dùng Asia/Ho_Chi_Minh.

### QR và dữ liệu người nhận

Ảnh QR gốc được cung cấp trong phiên làm việc đọc được bằng cả jsQR và ZXing; ảnh bổ sung có logo không đọc được bằng hai bộ kiểm tra, ZXing báo lỗi checksum. Payload ngân hàng và các ảnh thật không được commit. Việc sử dụng ảnh thật trên website phải được chủ dự án cho phép và kiểm tra lại bằng ứng dụng ngân hàng trong UAT đích.

`BILLING_QR_IMAGE_URL` nhận đường dẫn cùng origin hoặc URL HTTPS đúng origin app đã cấu hình. Repository không chứa ảnh thanh toán thật; `/assets/uat-payment-qr.svg` chỉ là route được mock trong kiểm thử, không phải tài nguyên production. QR đã kiểm tra là QR tĩnh, không chứa số tiền hoặc nội dung đơn. Giao diện yêu cầu nhập/copy chính xác hai trường từ đơn. Nếu cấu hình ngân hàng đổi, đơn cũ vẫn giữ thông tin ngân hàng lúc tạo và không hiển thị QR của tài khoản mới.

## 3. Trạng thái nghiệp vụ và tính toàn vẹn

| Trạng thái đơn | Ý nghĩa | Có cộng phiếu? |
|---|---|---|
| `pending_payment` | Đã tạo đơn; chưa báo chuyển | Không |
| `pending_review` | Người dùng báo đã chuyển, chờ ngân hàng được đối soát | Không |
| `approved` | Quản trị xác nhận đã đối soát ngân hàng | Cộng đúng một lần |
| `rejected` | Không đủ điều kiện duyệt, có lý do | Không |

Ảnh chụp, nút “Tôi đã chuyển khoản” và email không chứng minh ngân hàng đã nhận tiền. Khi nhập mã giao dịch ngân hàng thật, mã chuẩn hóa được ràng buộc duy nhất trên tài khoản nhận. Nếu bỏ trống, mã sinh riêng theo đơn không phát hiện cùng một khoản tiền bị dùng cho hai đơn khác nhau. Số tiền nhập phải khớp đơn; nếu bỏ trống, mã dùng số tiền của đơn. Chính sách vận hành yêu cầu ghi số tiền thực nhận và mã chứng từ khi ngân hàng cung cấp; trường hợp không có mã cần chủ dự án chấp thuận quy trình đối soát thay thế. Nếu yêu cầu hai trường bắt buộc ở cấp API, cần thay đổi mã riêng trước GO; bản cập nhật tài liệu này không thêm ràng buộc đó. Duyệt, cập nhật ví, ledger và dấu vết quản trị nằm trong cùng transaction PostgreSQL.

| Kết quả gửi Form | Xử lý phiếu | Xử lý gửi lại |
|---|---|---|
| Google hiện trang xác nhận | Giữ rồi trừ một phiếu | Operation lặp chỉ đọc kết quả |
| Chắc chắn chưa thực hiện POST | Hoàn phiếu đang giữ | Không tự gửi lại |
| Timeout/lỗi sau POST/kết quả chưa rõ | Giữ một phiếu chờ đối chiếu | Không tự gửi lại |
| Database lỗi sau dispatch | Giữ operation bền vững và phiếu chờ | Không cấp quyền dispatch lần hai |

Mỗi operation gắn với người dùng, Form và hash đáp án phía server. Chỉ một request được nhận quyền dispatch. Không khẳng định Google Forms có bảo đảm exactly-once: phía Google không cung cấp giao dịch chung với PostgreSQL hoặc response ID qua trang trả lời này. Tổng phản hồi tăng cũng không xác định riêng phản hồi nào nếu có người khác gửi đồng thời.

Quản trị có thể đối soát operation chưa rõ sau ít nhất 5 phút, phải ghi căn cứ và xác nhận đã kiểm tra. Quyết định hoàn/trừ được lưu và không gọi lại Google. Không tự hết hạn rồi hoàn các lượt chưa rõ vì có thể Google đã nhận.

## 4. Cấu hình và hạ tầng cần xác minh

Các biến email/recipients/worker dưới đây chỉ bắt buộc cho chế độ email được chọn, không thuộc lỗi tài chính `missing`. Mọi giá trị production vẫn chưa được xác minh trong lần rà soát này.

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

Cấu hình OAuth bắt buộc: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_SESSION_SECRET` ít nhất 32 ký tự và `PUBLIC_SITE_URL=https://www.pandastudy.info.vn`. Authorized origin là `https://www.pandastudy.info.vn`, redirect URI là `https://www.pandastudy.info.vn/api/auth/callback`. `BILLING_PUBLIC_SITE_URL` nếu đặt phải phù hợp host phát hành. Cookie cũ được bổ sung định danh Google theo yêu cầu khi vào billing; không đổi OAuth scopes. UAT preview cần origin và callback OAuth thực sự được cho phép; không vô hiệu hóa bảo vệ deployment để thử.

Trong phiên lịch sử ngày 17/10, metadata production chỉ có cấu hình Google/session/site, chưa có database hoặc email. Connector không có thao tác cấp integration; Vercel CLI chưa đăng nhập. Đã tìm thấy lựa chọn Neon free, nhưng chưa tạo tài nguyên, chấp nhận điều khoản hay mua dịch vụ.

Nếu chọn email làm gate, phải dùng sender được phép gửi tới toàn bộ người nhận đã chỉ định và kiểm chứng inbox thực tế; domain thử hạn chế người nhận không đủ cho UAT nhiều người. Không đặt API key, connection string hoặc mật khẩu trong chat, GitHub hay file được commit.

## 5. Email và vận hành worker

Email là hỗ trợ tùy chọn, không phải ủy quyền tài chính. Đơn và outbox cho danh sách người nhận hợp lệ được ghi trước khi thử gửi email; nếu có hai người nhận thì tạo hai bản ghi. Nếu không có người nhận hợp lệ, không có outbox tương ứng để tự phát lại; admin phải theo dõi dashboard. Request báo chuyển khoản thử xử lý tối đa hai email; lỗi provider không làm mất hoặc hoàn tác đơn. Worker dùng lease, khóa bản ghi, payload được giữ nguyên từ lần gửi đầu và idempotency key ổn định.

Workflow `billing-notifications.yml` hiện gọi `https://auto-fill-form-liard.vercel.app/api/billing-notifications` mỗi 5 phút khi cờ repository cho phép. Trước khi bật phải xác minh alias cũ trỏ đúng deployment/database và endpoint nhận đúng secret; không suy ra từ canonical domain mới. Đây là lịch theo khả năng của GitHub, không phải cam kết email đến trong 5 phút. Scheduled Actions có thể bị trì hoãn, chỉ chạy từ default branch và có thể bị tắt sau thời gian repository công khai không hoạt động. Admin cũng có nút thử gửi lại email lỗi.

Lần gửi có kết quả chưa rõ quá 23 giờ được giữ để kiểm tra, tránh gửi lại sau cửa sổ idempotency của provider. Trạng thái `sent` ghi nhận provider chấp nhận request; UAT đích phải xác nhận nhận mail thực tế, gồm cả thư rác. Không dùng email để tự duyệt giao dịch.

Quyết định lịch sử ngày 17/10 là dùng workflow GitHub thay vì thêm cron Vercel; không suy ra gói dịch vụ hoặc trạng thái job hiện tại từ ghi chép đó. Chỉ bật worker khi chọn dùng email và đã kiểm chứng endpoint, secret, sender cùng hạ tầng đích.

## 6. Bằng chứng kiểm thử lịch sử ngày 17/10

Các kết quả dưới đây được giữ từ runbook ban đầu, không phải kết quả chạy lại trên commit đối chiếu hiện tại. CI mới cần gắn đúng SHA; PostgreSQL thử nghiệm, email/API mock và browser giả lập không chứng minh UAT production.

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

## 7. Trình tự và quyết định GO/NO-GO sau merge

1. **Chốt bản phát hành và quyền vận hành.** Ghi SHA/deployment/alias, project `auto-fill-form`, root `native`, canonical host `https://www.pandastudy.info.vn`; xác minh project ID thực tế thay vì dùng baseline cũ. Kiểm kê trạng thái cờ và paid credits trước mọi thay đổi. Trước lần thu phí đầu tiên giữ mua mới đóng; nếu đã có thanh toán thật tuyệt đối không tắt enforcement.
2. **Database.** Chủ dự án chọn database đích; backup trước migration. Người được ủy quyền chạy `npm run migrate:billing` (001 + 002), kiểm tra versions 1/2, bảng/cột/ràng buộc, quyền đọc/ghi, kết nối bảo mật và phục hồi. Không import số dư giả legacy. Dùng database/schema tách biệt cho kiểm thử phá lỗi/cạnh tranh.
3. **Campaign và giá.** Migration 002 seed `WELCOME_OCT_2026` enabled, 10 lượt, từ 19/10/2026 23:40 đến trước 28/10/2026 00:00 UTC+7. Profile có đăng nhập có thể tạo customer và cấp lượt tặng ngay cả khi billing tắt; không dùng nó như probe chỉ đọc. Chủ dự án phải duyệt campaign/catalog và kế hoạch migration trước khi chạy; không tự sửa dữ liệu trong lần rà soát này.
4. **OAuth và phân quyền.** UAT A–D trong [PRODUCTION_UAT.md](PRODUCTION_UAT.md): buyer/admin/non-admin, callback, session/logout, sáu bước, wallet, health và schema thực tế.
5. **Chốt email và chứng từ.** Ghi lựa chọn email bắt buộc hoặc dashboard-only, người trực và thời gian kiểm tra. Nếu email là gate: sender/recipients thật, inbox/spam, retry, worker secret đúng/sai và alias phải qua UAT. Nếu dashboard-only: chứng minh đơn vẫn hiện pending_review, không mất đối soát; đánh dấu kiểm thử gửi mail N/A có phê duyệt, không đánh dấu PASS. Chốt quy trình chứng từ ở mục 3.
6. **UAT có kiểm soát, cần ủy quyền riêng.** Chủ dự án duyệt người thực hiện, số tiền, cửa sổ, phương án đóng mua mới và Form bản sao. Cờ môi trường hiện tại không giới hạn riêng buyer UAT: mở mua mới có thể mở cho mọi người đăng nhập, phải có biện pháp giới hạn truy cập được phê duyệt trước. Sau đó người được ủy quyền mới thực hiện UAT E/F/H/I, đối soát tiền thật, cộng đúng lượt, kiểm tra lặp, snapshot giá và vòng đời giữ/trừ/hoàn. Không thử lỗi phá dữ liệu hoặc sửa catalog/campaign live chỉ để kiểm thử.
7. **GO chỉ khi** CI đúng SHA đạt; database 001/002 và backup/restore, OAuth, bank/QR, quyền admin, UAT tiền thật và Form bản sao đạt; catalog/campaign/chứng từ/email được chủ dự án chốt; không còn blocker; biên bản ghi người duyệt, thời gian, môi trường và bằng chứng đã che dữ liệu nhạy cảm. Thiếu bằng chứng hoặc quyết định: **NO-GO cho mở thu phí mới**, không khẳng định production đang tắt.
8. **Sau GO do người có thẩm quyền thực hiện:** xác minh deployment/cờ, theo dõi đơn chờ, ledger/số dư, operation unknown và outbox nếu dùng. Khi cần dừng mua mới dùng mục 8. Merge tài liệu không cấp phép bật cờ hoặc tạo giao dịch.

Lần đối chiếu này chưa xác minh các gate production; giữ trạng thái **chưa đủ bằng chứng để GO**. Không tự động thay đổi cấu hình sau khi tài liệu được merge.

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
