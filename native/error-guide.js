'use strict';
/*
 * PandaStudy front-end error help: one classifier for every form workflow.
 * This is a best-effort diagnosis, not evidence that a user's data caused a bug.
 * Never transmit input files, answers, credentials or raw server messages.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PandaStudyErrorGuide = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const SUPPORT_EMAIL = 'trangnguyen11850.marketing@gmail.com';
  const SUPPORT_ZALO = 'https://zalo.me/0349222590';

  const STEPS = {
    upload: 'Tải Excel/CSV/JSON', paste: 'Dán dữ liệu', mapping: 'Ghép cột',
    importForm: 'Nhập Google Form', preview: 'Tạo bảng xem trước',
    validation: 'Kiểm tra dữ liệu', submission: 'Gửi phiếu',
    payment: 'Thanh toán / số dư', account: 'Tài khoản',
    general: 'Thao tác trên PandaStudy'
  };
  const GUIDES = {
    data: {
      title: 'Không đọc được hoặc dữ liệu chưa đúng định dạng',
      source: 'Dữ liệu đầu vào / định dạng tệp',
      action: 'Kiểm tra đúng loại tệp, hàng tiêu đề, số cột và ô được báo lỗi; sửa rồi tải lại. Với Excel có thể thử lưu thành CSV UTF-8.'
    },
    mapping: {
      title: 'Dữ liệu chưa khớp câu hỏi trong biểu mẫu',
      source: 'Ghép cột / quy tắc câu trả lời',
      action: 'Tại Bước 3, kiểm tra cột nào được nối với câu hỏi nào; đối chiếu chính xác nhãn đáp án và các hàng bắt buộc trong Google Form.'
    },
    validation: {
      title: 'Có dòng chưa vượt qua kiểm tra biểu mẫu',
      source: 'Đối chiếu dữ liệu và yêu cầu Google Form',
      action: 'Ở Bước 5, chọn “Chưa hợp lệ”, xem lỗi cụ thể từng dòng hoặc tải CSV các lỗi. Chưa thể kết luận do file hay hệ thống nếu chưa đối chiếu chi tiết.'
    },
    form: {
      title: 'Chưa đọc hoặc chưa sử dụng được Google Form',
      source: 'Cấu hình / quyền của Google Form',
      action: 'Kiểm tra đường dẫn /edit, quyền truy cập, trạng thái nhận phản hồi và các loại câu hỏi mà hệ thống hỗ trợ.'
    },
    auth: {
      title: 'Không đủ quyền thực hiện thao tác',
      source: 'Đăng nhập / phân quyền',
      action: 'Đăng nhập lại bằng tài khoản có quyền phù hợp, kiểm tra quyền chỉnh sửa Form hoặc quyền sử dụng chức năng cần thiết.'
    },
    payment: {
      title: 'Chưa đáp ứng điều kiện thanh toán hoặc số dư',
      source: 'Thanh toán / số dư',
      action: 'Kiểm tra số dư khả dụng và trạng thái giao dịch trong PandaStudy. Không thực hiện thanh toán trùng khi chưa có kết quả đối chiếu.'
    },
    network: {
      title: 'Kết nối bị gián đoạn hoặc yêu cầu hết thời gian',
      source: 'Mạng / kết nối máy chủ',
      action: 'Kiểm tra kết nối, tải lại dữ liệu và thử kiểm tra một số dòng trước. Nếu đang gửi phiếu, đối chiếu trạng thái trước khi thử gửi lại để tránh trùng.'
    },
    system: {
      title: 'Máy chủ PandaStudy gặp sự cố',
      source: 'Máy chủ / dịch vụ tích hợp',
      action: 'Giữ nguyên dữ liệu, không gửi lại các dòng chưa rõ trạng thái. Liên hệ hỗ trợ kèm thời điểm và bước bị lỗi để kiểm tra máy chủ.'
    },
    unknown: {
      title: 'Chưa xác định được nguồn lỗi',
      source: 'Cần kiểm tra thêm',
      action: 'Ghi lại bước đang thực hiện, xem chi tiết lỗi và liên hệ hỗ trợ. Không tự quy lỗi cho người dùng khi chưa có bằng chứng.'
    }
  };

  function classify(message, options = {}) {
    const raw = String(message?.message || message || '').trim().slice(0, 2000);
    const m = raw.toLowerCase();
    const stage = Object.hasOwn(STEPS, options.stage) ? options.stage : 'general';
    const status = Number(options.status || message?.status || 0);
    const source = options.source || '';
    let kind = 'unknown';

    // HTTP codes take priority for server failures.
    if (status >= 500) kind = 'system';
    else if ([401, 403].includes(status)) kind = 'auth';
    else if (status === 429 || [408, 504].includes(status)) kind = 'network';
    else if (/failed to fetch|networkerror|load failed|network request failed|timeout|timed out|không kết nối|mất kết nối|quá thời gian/.test(m)) kind = 'network';
    else if (/quota|credits|số dư|nạp tiền|thanh toán|insufficient|payment|billing/.test(m) || stage === 'payment') kind = 'payment';
    else if (/unauthori[sz]ed|permission|forbidden|access denied|không có quyền|chưa đăng nhập|đăng nhập|yêu cầu quyền/.test(m)) kind = 'auth';
    else if (/dòng chưa hợp lệ|dòng không hợp lệ|invalid rows|không hợp lệ.*dòng|lỗi kiểm tra dữ liệu/.test(m)) kind = 'validation';
    else if (/không tìm thấy lựa chọn|missing required|thiếu câu trả lời|chưa trả lời đủ|không khớp lựa chọn|lựa chọn không hợp lệ|chưa ghép cột|cột đã ghép|câu bắt buộc|giá trị trùng|bị lặp/.test(m)) kind = 'mapping';
    else if (/google form|biểu mẫu|\/edit|form.*(closed|not found)|form đã đóng|chưa nhập.*form/.test(m) && stage === 'importForm') kind = 'form';
    else if (/xlsx|xls|csv|json|excel|tệp|file|không có dòng|hàng tiêu đề|tên cột|dòng dữ liệu|dấu phân cách|dấu ngoặc kép|không đọc được bảng|không thể đọc|không hỗ trợ.*định dạng|quá lớn|5 mb|mã định danh/.test(m) ||
      ['upload', 'paste'].includes(stage)) kind = 'data';
    else if (stage === 'importForm') kind = 'form';
    else if (stage === 'validation') kind = 'validation';
    else if (stage === 'mapping') kind = 'mapping';
    else if (stage === 'account') kind = 'auth';
    else if (source === 'server') kind = 'system';

    const guide = GUIDES[kind];
    return {
      kind, title: guide.title, source: guide.source, action: guide.action,
      stage, step: STEPS[stage], details: raw || 'Không có mô tả chi tiết.',
      uncertain: kind === 'unknown' || kind === 'validation' || kind === 'mapping',
      email: SUPPORT_EMAIL, zalo: SUPPORT_ZALO,
      // Do not label this as a support ticket: it is only for user reference.
      time: new Date().toISOString()
    };
  }

  function supportSummary(issue) {
    // Intentionally do NOT include raw error, file name, form URL, responses,
    // user email or credentials. The user can share additional details knowingly.
    return [
      'Yêu cầu hỗ trợ PandaStudy',
      'Bước: ' + issue.step,
      'Nhóm lỗi (phân loại tự động): ' + issue.source,
      'Thời điểm (UTC): ' + issue.time,
      'Triệu chứng: ' + issue.title,
      'Tôi cần được hướng dẫn kiểm tra nguyên nhân.',
      'Tôi chưa đính kèm dữ liệu cá nhân, mã truy cập hoặc nội dung khảo sát.'
    ].join('\n');
  }
  function mailto(issue) {
    const subject = 'PandaStudy - Hỗ trợ lỗi ' + issue.step;
    return 'mailto:' + SUPPORT_EMAIL +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(supportSummary(issue));
  }
  return { classify, supportSummary, mailto, SUPPORT_EMAIL, SUPPORT_ZALO };
});
