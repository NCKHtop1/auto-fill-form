/* Bai viet goc cua PandaStudy. Khong chua noi dung do nguoi dung nhap. */
window.PandaStudyArticles = [
{
  slug:'spss-kiem-tra-du-lieu-khao-sat',
  category:'SPSS', categoryKey:'spss', color:'sage',
  title:'Nhận file khảo sát rồi, mở SPSS kiểm tra gì trước?',
  excerpt:'Một checklist đủ dùng trước khi tính điểm trung bình, Cronbach’s alpha hay chạy hồi quy. Có cả ví dụ syntax để làm lại lần sau.',
  date:'12.10.2026', level:'Bắt đầu',
  contents: `
    <p class="article-lede">Có một việc mình thường làm trước khi bắt đầu phân tích khảo sát: dành khoảng 20 phút xem dữ liệu có thực sự đúng như mình nghĩ không. File nhìn gọn trong Excel chưa chắc đã sẵn sàng cho SPSS.</p>
    <h2 id="spss-1">1. Kiểm tra cấu trúc trước khi kiểm định</h2>
    <p>Mở <strong>Variable View</strong> và nhìn lần lượt: tên biến, kiểu dữ liệu, nhãn biến (<em>Label</em>), mã giá trị (<em>Values</em>), giá trị thiếu (<em>Missing</em>) và thang đo (<em>Measure</em>). Ví dụ một câu trả lời giới tính được mã 1 = Nam, 2 = Nữ thì cần gán nhãn tương ứng. Nếu một người nhập 3, bạn phải biết 3 có ý nghĩa gì trước khi giữ lại.</p>
    <div class="article-callout"><b>Ví dụ</b><p>Câu hỏi “Mức độ hài lòng” dùng thang 1–5. Trong file có giá trị 9 nghĩa là “không trả lời”. Nếu không khai báo 9 là giá trị thiếu, phép tính trung bình sẽ bị kéo lệch.</p></div>
    <h2 id="spss-2">2. Chạy bảng tần suất, đừng đi ngay vào hồi quy</h2>
    <p>Trong SPSS, mở <strong>Analyze → Descriptive Statistics → Frequencies</strong>. Chọn những biến cần rà soát như giới tính, nhóm tuổi, các câu hỏi Likert. Bảng tần suất giúp tìm mã lạ (chẳng hạn 6 trong thang 1–5), nhóm ít người và số trường hợp bỏ trống. Với biến định lượng, xem thêm <strong>Descriptives</strong> để kiểm tra min, max, trung bình và độ lệch chuẩn.</p>
    <p>Nếu phải làm đi làm lại, lưu syntax thay vì chỉ bấm menu:</p>
    <pre><code class="language-spss">* Vi du: q1, q2 la cau hoi thang 1-5.
MISSING VALUES q1 q2 (99).
FREQUENCIES VARIABLES=q1 q2
  /ORDER=ANALYSIS.
DESCRIPTIVES VARIABLES=age
  /STATISTICS=MEAN STDDEV MIN MAX.</code></pre>
    <p>Đoạn trên giả định bạn đã nhập biến <code>q1</code>, <code>q2</code> và <code>age</code>, trong đó <code>99</code> được quy ước là “không trả lời”. Đừng chạy lệnh khai báo 99 nếu bộ mã hóa của bạn dùng quy ước khác.</p>
    <h2 id="spss-3">3. Câu hỏi đảo chiều phải được xử lý có ghi chép</h2>
    <p>Thang đo có câu hỏi mang nghĩa ngược? Ví dụ: “Tôi thấy khó sử dụng dịch vụ” nằm trong nhóm câu hỏi đo mức độ thuận tiện. Trước khi cộng điểm, bạn có thể cần đảo mã. Với thang 1–5, công thức là <strong>điểm mới = 6 − điểm cũ</strong>.</p>
    <pre><code class="language-spss">RECODE q3 (1=5) (2=4) (3=3) (4=2) (5=1)
  INTO q3_rev.
VARIABLE LABELS q3_rev 'Q3 - da dao chieu'.
EXECUTE.</code></pre>
    <p>Giữ lại biến gốc <code>q3</code> và tạo biến mới <code>q3_rev</code> giúp bạn kiểm tra được thao tác. Chỉ đảo chiều khi nội dung câu hỏi và thiết kế thang đo yêu cầu; không phải cứ thấy hệ số âm là đảo.</p>
    <h2 id="spss-4">4. Ghi lại số mẫu ở từng bước</h2>
    <p>Giả sử thu được 300 phiếu, nhưng biến thu nhập trống ở một số phiếu. Một bảng Frequencies có thể dùng 300 dòng, trong khi mô hình hồi quy chỉ còn 264 quan sát vì SPSS loại các trường hợp thiếu dữ liệu ở biến liên quan. Hai con số khác nhau không tự động là lỗi phần mềm. Điều cần làm là ghi rõ mẫu phân tích cuối cùng và vì sao giảm.</p>
    <div class="article-checklist"><strong>Checklist trước khi phân tích</strong><ul><li>Đã có từ điển mã hóa cho các biến và giá trị thiếu.</li><li>Không còn giá trị ngoài phạm vi quy định mà chưa giải thích.</li><li>Đã ghi nhận câu hỏi đảo chiều và cách tính điểm.</li><li>Biết số quan sát hợp lệ cho từng phân tích.</li><li>Đã lưu bản dữ liệu gốc và syntax riêng.</li></ul></div>
    <h2 id="spss-5">5. Khi nào có thể bắt đầu phân tích?</h2>
    <p>Khi bạn giải thích được từng biến, các mã đặc biệt và số trường hợp bị loại, lúc đó mới nên chọn độ tin cậy thang đo, so sánh nhóm hay hồi quy. SPSS không quyết định câu hỏi nghiên cứu thay bạn: phần mềm chỉ xử lý những gì bạn đưa vào.</p>
    <div class="article-sources"><h2 id="spss-nguon">Đọc thêm từ tài liệu gốc</h2><ul><li><a href="https://www.ibm.com/docs/en/spss-statistics/30.0.0?topic=features-frequencies" target="_blank" rel="noopener noreferrer">IBM SPSS — Frequencies</a></li><li><a href="https://www.ibm.com/docs/en/spss-statistics/32.0.0?topic=analysis-missing-value" target="_blank" rel="noopener noreferrer">IBM SPSS — Missing Value Analysis</a></li></ul></div>
  `
},
{
  slug:'stata-do-file-tu-csv-den-hoi-quy',
  category:'Stata', categoryKey:'stata', color:'mint',
  title:'Stata: viết một do-file để không phải làm lại từ đầu',
  excerpt:'Nhập CSV, kiểm tra biến, chạy hồi quy và lưu lại kết quả. Một quy trình nhỏ, nhưng khi sửa số liệu sẽ thấy rất đáng công.',
  date:'12.10.2026', level:'Thực hành',
  contents: `
    <p class="article-lede">Bạn chạy được một mô hình Stata bằng cách gõ từng dòng trên Command. Nhưng đến lần thầy hướng dẫn yêu cầu đổi một biến kiểm soát, bạn có nhớ hôm trước đã lọc dữ liệu thế nào không? Đây là lý do nên có do-file từ đầu.</p>
    <h2 id="stata-1">1. Do-file là nhật ký công việc của bạn</h2>
    <p>Do-file lưu các lệnh theo đúng thứ tự: mở dữ liệu, đổi tên biến, xử lý giá trị thiếu, mô tả mẫu và ước lượng mô hình. Nếu dữ liệu cập nhật, bạn chạy lại từ đầu và kiểm tra sự khác biệt. Việc này cũng giúp người khác đọc được bạn đã làm gì mà không phải đoán từ một file kết quả.</p>
    <h2 id="stata-2">2. Bắt đầu bằng dữ liệu mẫu rõ ràng</h2>
    <p>Giả sử bạn có file <code>survey.csv</code> với các cột <code>income</code> (thu nhập), <code>education</code> (số năm học), <code>age</code> và <code>region</code> (mã vùng). Tạo file <code>analysis.do</code> và viết:</p>
    <pre><code class="language-stata">clear all
set more off
capture log close
log using "ketqua.log", text replace

import delimited using "survey.csv", varnames(1) clear

describe
codebook income education age region
misstable summarize
summarize income education age, detail

drop if missing(income, education, age, region)
regress income education age i.region, vce(robust)

log close</code></pre>
    <p>Đây là ví dụ minh họa, không phải mô hình có thể áp dụng nguyên xi cho mọi nghiên cứu. Bạn cần đặt đúng tên biến và quyết định cách xử lý dữ liệu thiếu trước khi dùng <code>drop</code>.</p>
    <h2 id="stata-3">3. Đừng bỏ qua ba dòng kiểm tra</h2>
    <p><code>describe</code> cho biết tên và kiểu biến; <code>codebook</code> giúp kiểm tra khoảng giá trị và các mã; <code>misstable summarize</code> tổng hợp tình trạng thiếu. Khi nhập CSV, đặc biệt chú ý trường hợp Stata đọc cột số thành <em>string</em> vì chứa ký tự lạ như dấu phẩy, khoảng trắng hay chữ “N/A”.</p>
    <p>Trước khi sửa một biến thành dạng số, kiểm tra ít nhất vài giá trị sai. Lệnh chuyển kiểu chỉ là bước kỹ thuật; bạn vẫn phải quyết định chữ “không biết” nên được mã hóa như thế nào.</p>
    <h2 id="stata-4">4. Hiểu đúng vce(robust)</h2>
    <p><code>vce(robust)</code> tính sai số chuẩn theo cách vững hơn trước hiện tượng phương sai sai số thay đổi. Nó <strong>không</strong> chữa được thiếu biến, thiên lệch chọn mẫu, quan hệ nhân quả chưa xác định hay nhập sai dữ liệu. Nếu quan sát được lấy theo cụm (chẳng hạn nhiều người trong cùng trường), cần cân nhắc sai số chuẩn theo cụm phù hợp với thiết kế:</p>
    <pre><code class="language-stata">* Vi du neu school_id la ma cum lay mau:
regress income education age i.region, vce(cluster school_id)</code></pre>
    <p>Không nên chọn cụm tùy tiện; cần xét đơn vị lấy mẫu và số cụm. Trong báo cáo, nêu rõ vì sao dùng loại sai số chuẩn đó.</p>
    <h2 id="stata-5">5. Kết quả cần được giải thích, không chỉ dán bảng</h2>
    <p>Với ví dụ trên, hệ số của <code>education</code> cho biết mức chênh lệch thu nhập dự kiến khi số năm học tăng một đơn vị, <em>giữ các biến khác trong mô hình không đổi</em>. Đây là mô tả liên hệ có điều kiện, chưa đủ để nói “học thêm một năm làm thu nhập tăng” theo nghĩa nhân quả.</p>
    <div class="article-checklist"><strong>Trước khi gửi bảng kết quả</strong><ul><li>Đã lưu <code>.do</code> và file log.</li><li>Ghi rõ cách xử lý dữ liệu thiếu và số mẫu còn lại.</li><li>Kiểm tra đơn vị đo và cách mã hóa biến phân loại.</li><li>Trình bày hệ số, sai số chuẩn/khoảng tin cậy và giả định liên quan.</li></ul></div>
    <div class="article-sources"><h2 id="stata-nguon">Đọc thêm từ tài liệu gốc</h2><ul><li><a href="https://www.stata.com/manuals/dimportdelimited.pdf" target="_blank" rel="noopener noreferrer">Stata — import delimited (manual)</a></li><li><a href="https://www.stata.com/features/overview/robust-inference-for-linear-models/" target="_blank" rel="noopener noreferrer">Stata — Robust inference for linear models</a></li></ul></div>
  `
},
{
  slug:'python-pandas-lam-sach-du-lieu-khao-sat',
  category:'Python', categoryKey:'python', color:'lime',
  title:'Python & pandas: dọn bảng khảo sát mà không phải sửa tay',
  excerpt:'Một đoạn Python kiểm tra dòng trùng, tuổi ngoài phạm vi và dữ liệu thiếu. Có thể chạy lại khi nhận file mới, không phải làm từ đầu.',
  date:'12.10.2026', level:'Thực hành',
  contents: `
    <p class="article-lede">Mỗi tuần nhận một file Excel mới, bạn lại lọc trùng, dò tuổi nhập sai và kiểm tra ô trống. Sau vài lần, bạn sẽ muốn giữ những quy tắc ấy trong một đoạn mã để chạy lại. pandas phù hợp với kiểu công việc này.</p>
    <h2 id="python-1">1. Đừng bắt đầu bằng việc xóa dòng</h2>
    <p>Một bảng nghiên cứu nên có định danh cho mỗi quan sát (<code>id</code>), các biến phân tích và mô tả ý nghĩa từng cột. Trước hết, tạo bản sao file gốc. Sau đó đọc dữ liệu vào Python; kiểm tra số dòng, tên cột và vài dòng đầu tiên. Đừng vội dùng <code>dropna()</code> cho cả bảng vì có thể xóa nhiều người trả lời mà bạn không để ý.</p>
    <h2 id="python-2">2. Đoạn mã đủ dùng cho một file CSV</h2>
    <p>Ví dụ dưới đây giả định <code>khaosat.csv</code> có các cột <code>id</code>, <code>age</code>, <code>group</code>. Chạy trong môi trường đã cài <code>pandas</code>:</p>
    <pre><code class="language-python">import pandas as pd

# Giu ID dang chuoi de khong mat so 0 o dau
raw = pd.read_csv("khaosat.csv", dtype={"id": "string"})
df = raw.copy()

print("So dong:", len(df))
print("Ten cot:", df.columns.tolist())
print(df.head())

# Phat hien ID rong / trung
id_missing = df["id"].isna() | df["id"].str.strip().eq("")
id_duplicate = df["id"].duplicated(keep=False) & ~id_missing

# Chuyen tuoi sang so, danh dau gia tri khong hop le
age_numeric = pd.to_numeric(df["age"], errors="coerce")
age_invalid = age_numeric.isna() | ~age_numeric.between(15, 100)

issues = df.loc[id_missing | id_duplicate | age_invalid].copy()
issues["loi_id_trong"] = id_missing.loc[issues.index]
issues["loi_id_trung"] = id_duplicate.loc[issues.index]
issues["loi_tuoi"] = age_invalid.loc[issues.index]

print("So dong can kiem tra:", len(issues))
issues.to_csv("can_kiem_tra.csv", index=False, encoding="utf-8-sig")</code></pre>
    <p>Khoảng tuổi 15–100 ở đây chỉ là <strong>giả định để minh họa</strong>. Với khảo sát học sinh tiểu học, quy tắc đó sẽ sai. Hãy thay ngưỡng bằng tiêu chí của nghiên cứu bạn. Việc xuất file <code>can_kiem_tra.csv</code> giúp giữ lại những dòng cần xem, thay vì tự động xóa.</p>
    <h2 id="python-3">3. Nhập liệu và mã hóa cần có từ điển biến</h2>
    <p>Ví dụ nhóm <code>group</code> có các giá trị “Control”, “control” và “Đối chứng”. Nếu thực tế đều chỉ cùng một nhóm, bạn có thể chuẩn hóa; nhưng phải có bằng chứng từ bảng hỏi hoặc hướng dẫn mã hóa, không nên tự gộp chỉ vì trông giống nhau.</p>
    <pre><code class="language-python">print(df["group"].value_counts(dropna=False))
print(df.isna().sum().sort_values(ascending=False))</code></pre>
    <p>Dòng đầu đếm cả nhóm bị thiếu; dòng sau cho bạn số giá trị thiếu ở từng cột. Nếu muốn tính tỷ lệ phần trăm thiếu, dùng <code>df.isna().mean().mul(100)</code>. Trước khi thay thế bằng số trung bình hay phương pháp khác, cần xem tại sao dữ liệu bị thiếu.</p>
    <h2 id="python-4">4. Vài lỗi nhỏ khiến kết quả lệch nhiều</h2>
    <div class="article-table-wrap"><table><thead><tr><th>Hiện tượng</th><th>Rủi ro</th><th>Nên làm</th></tr></thead><tbody><tr><td>ID bị mất số 0 đầu</td><td>Khó ghép với đợt khảo sát sau</td><td>Đọc ID dưới dạng chuỗi</td></tr><tr><td>Tuổi lẫn “20 tuổi” và “20”</td><td>Cột bị hiểu là chữ</td><td>Rà dữ liệu gốc, chuẩn hóa có quy tắc</td></tr><tr><td>Trả lời trống được gán 0</td><td>Lẫn “không trả lời” và giá trị thật</td><td>Giữ thiếu dữ liệu theo từ điển biến</td></tr><tr><td>Chỉnh tay trên file gốc</td><td>Không truy lại được thao tác</td><td>Lưu file gốc, xuất file đã làm sạch riêng</td></tr></tbody></table></div>
    <h2 id="python-5">5. Khi nào nên dùng Python thay Excel?</h2>
    <p>Nếu mỗi lần khảo sát chỉ vài chục dòng và có một người xử lý, Excel có thể đủ. Python hữu ích khi bảng có nhiều cột, bạn cần áp dụng cùng quy tắc cho các đợt nhập dữ liệu và muốn người khác chạy lại đúng các bước. Đừng chọn Python chỉ vì nó “chuyên nghiệp hơn”. Chọn công cụ giúp bạn kiểm soát sai sót tốt hơn.</p>
    <div class="article-sources"><h2 id="python-nguon">Đọc thêm từ tài liệu gốc</h2><ul><li><a href="https://pandas.pydata.org/docs/reference/api/pandas.read_csv.html" target="_blank" rel="noopener noreferrer">pandas — read_csv</a></li><li><a href="https://pandas.pydata.org/docs/user_guide/missing_data.html" target="_blank" rel="noopener noreferrer">pandas — Working with missing data</a></li></ul></div>
  `
},
{
  slug:'du-lieu-thieu-khong-phai-so-khong',
  category:'Dữ liệu', categoryKey:'data', color:'stone',
  title:'Dữ liệu trống không có nghĩa là số 0',
  excerpt:'“Không biết”, “không trả lời” và ô bỏ trống không phải lúc nào cũng giống nhau. Xử lý sai từ đầu thì phân tích phía sau cũng sai.',
  date:'12.10.2026', level:'Nền tảng',
  contents: `
    <p class="article-lede">Bạn hỏi thu nhập mỗi tháng, có người trả lời 0, có người chọn “không muốn nói”, có người bỏ qua câu hỏi. Nếu thay hết bằng 0 để bảng Excel trông sạch hơn, bạn vừa tạo ra một nhóm người thu nhập bằng 0 mà không chắc họ có thật.</p>
    <h2 id="missing-1">1. Ba trường hợp cần phân biệt</h2>
    <div class="article-table-wrap"><table><thead><tr><th>Giá trị trong file</th><th>Ý nghĩa có thể có</th><th>Cách xử lý</th></tr></thead><tbody><tr><td><strong>0</strong></td><td>Giá trị bằng không thực sự</td><td>Giữ nếu câu hỏi cho phép</td></tr><tr><td><strong>99</strong></td><td>Mã “không biết/không trả lời”</td><td>Khai báo là thiếu nếu codebook quy định</td></tr><tr><td><strong>Ô trống</strong></td><td>Bị bỏ qua hoặc lỗi nhập liệu</td><td>Kiểm tra logic bảng hỏi và lý do trống</td></tr></tbody></table></div>
    <p>Số 99 có thể là mã thiếu ở nghiên cứu này nhưng là một số đo hợp lệ ở nghiên cứu khác. Quy tắc phải nằm trong <strong>codebook</strong>, không nằm trong trí nhớ người phân tích.</p>
    <h2 id="missing-2">2. Vì sao dữ liệu thiếu lại quan trọng?</h2>
    <p>Mất vài câu trả lời ngẫu nhiên có thể không đáng ngại bằng việc một nhóm người nhất định thường xuyên không trả lời. Ví dụ, người có thu nhập cao ngại khai báo thu nhập hơn. Nếu chỉ phân tích người đã trả lời, mẫu còn lại có thể không còn đại diện như ban đầu.</p>
    <p>Trong lý thuyết, người ta hay phân biệt <strong>MCAR</strong> (việc thiếu không liên quan dữ liệu), <strong>MAR</strong> (liên quan tới thông tin đã quan sát được) và <strong>MNAR</strong> (còn liên quan tới chính giá trị bị thiếu sau khi xét dữ liệu quan sát). Đây là những giả định về cơ chế thiếu dữ liệu; không thể kết luận hoàn toàn chỉ bằng việc nhìn tỷ lệ ô trống.</p>
    <h2 id="missing-3">3. Làm gì trong thực tế?</h2>
    <p>Bắt đầu bằng việc đếm số và tỷ lệ thiếu của từng biến, sau đó xem những người thiếu có tập trung theo nhóm tuổi, địa bàn, thời gian khảo sát hay điều tra viên nào không. Đọc lại logic rẽ nhánh của bảng hỏi: câu “Nếu chưa đi làm thì bỏ qua thu nhập” tạo ra một dạng trống có chủ đích, không phải lỗi nhập liệu.</p>
    <div class="article-callout"><b>Trước khi dùng phương pháp bù dữ liệu</b><p>Đừng mặc định thế số trung bình là cách “làm sạch”. Nó có thể làm mất biến thiên và khiến kết luận về độ không chắc chắn quá lạc quan. Với tỷ lệ thiếu đáng kể, nên thảo luận cách xử lý phù hợp thiết kế nghiên cứu và thử phân tích độ nhạy.</p></div>
    <h2 id="missing-4">4. Ví dụ làm báo cáo thiếu dữ liệu</h2>
    <p>Bạn có thể lập một bảng gồm: tên biến, số mẫu dự kiến, số giá trị hợp lệ, số thiếu, tỷ lệ thiếu, lý do chính (nếu biết), cách xử lý. Trong luận văn hoặc bài báo, ghi rõ biến nào được loại khỏi mô hình, mẫu giảm từ bao nhiêu xuống bao nhiêu và tại sao.</p>
    <pre><code class="language-python"># Vi du voi pandas
missing_report = pd.DataFrame({
    "so_thieu": df.isna().sum(),
    "ty_le_thieu_%": df.isna().mean().mul(100).round(1)
})
print(missing_report.sort_values("ty_le_thieu_%", ascending=False))</code></pre>
    <p>Đoạn mã giả định bạn đã có DataFrame tên <code>df</code>; những giá trị như 99 cần được mã hóa thành missing theo codebook trước khi tính.</p>
    <h2 id="missing-5">5. Điều nên viết trong phần phương pháp</h2>
    <p>Không chỉ nói “đã loại bỏ các quan sát thiếu”. Hãy ghi cách xác định missing, tỷ lệ thiếu ở biến chính, quyết định xử lý và phân tích độ nhạy (nếu có). Người đọc cần đủ thông tin để đánh giá kết quả, chứ không cần một bảng dữ liệu trông thật đầy.</p>
    <div class="article-sources"><h2 id="missing-nguon">Đọc thêm từ tài liệu gốc</h2><ul><li><a href="https://www.ibm.com/docs/en/spss-statistics/32.0.0?topic=analysis-missing-value" target="_blank" rel="noopener noreferrer">IBM SPSS — Missing Value Analysis</a></li><li><a href="https://pandas.pydata.org/docs/user_guide/missing_data.html" target="_blank" rel="noopener noreferrer">pandas — Working with missing data</a></li></ul></div>
  `
},
{
  slug:'chon-kiem-dinh-theo-cau-hoi-nghien-cuu',
  category:'Phương pháp', categoryKey:'method', color:'leaf',
  title:'Chọn kiểm định từ câu hỏi nghiên cứu, đừng chọn theo tên phần mềm',
  excerpt:'T-test, Chi-square, tương quan, hồi quy: bắt đầu từ loại biến và thiết kế lấy mẫu, không phải từ việc thấy nút nào quen trên SPSS.',
  date:'12.10.2026', level:'Nền tảng',
  contents: `
    <p class="article-lede">“Em dùng SPSS thì nên chạy T-test hay hồi quy?” là câu hỏi rất hay gặp. Nhưng phần mềm không đủ thông tin để trả lời. Bạn cần nói rõ muốn tìm điều gì, biến kết quả là gì và dữ liệu được thu thập như thế nào.</p>
    <h2 id="method-1">1. Viết câu hỏi thành một câu đơn giản</h2>
    <p>Ví dụ: <em>“Điểm hài lòng có khác giữa hai nhóm học viên không?”</em> Đây là câu hỏi so sánh. Khác với <em>“Tuổi, kinh nghiệm và thời gian học liên quan thế nào đến điểm hài lòng?”</em> — câu hỏi thứ hai hướng đến mô hình có nhiều biến giải thích.</p>
    <p>Viết một câu hỏi cụ thể thường giúp bạn nhận ra biến kết quả, biến giải thích và nhóm cần so sánh. Sau đó mới đến bước lựa chọn phép phân tích.</p>
    <h2 id="method-2">2. Bảng gợi ý để định hướng</h2>
    <div class="article-table-wrap"><table><thead><tr><th>Bạn muốn biết</th><th>Tình huống thường gặp</th><th>Phương pháp có thể cân nhắc</th></tr></thead><tbody><tr><td>Hai nhóm khác nhau không?</td><td>Kết quả định lượng, hai nhóm độc lập</td><td>T-test độc lập; xem giả định và phương án thay thế</td></tr><tr><td>Cùng người trước/sau có đổi không?</td><td>Hai lần đo trên cùng đối tượng</td><td>Paired t-test hoặc phép thay thế thích hợp</td></tr><tr><td>Hai biến phân loại có liên hệ?</td><td>Bảng chéo nhóm × lựa chọn</td><td>Chi-square; với ô tần số kỳ vọng nhỏ xem xét Fisher</td></tr><tr><td>Hai biến định lượng liên hệ thế nào?</td><td>Điểm X và điểm Y</td><td>Hệ số tương quan phù hợp, kiểm tra dạng quan hệ</td></tr><tr><td>Giải thích kết quả bằng nhiều biến?</td><td>Biến kết quả liên tục hoặc nhị phân</td><td>Hồi quy tuyến tính hoặc logistic, tùy loại biến kết quả</td></tr></tbody></table></div>
    <p>Đây không phải “công thức chọn kiểm định” áp dụng cho mọi bộ dữ liệu. Cách lấy mẫu, độ độc lập giữa quan sát, phân phối, số nhóm, cỡ mẫu và mục tiêu suy luận đều có thể thay đổi lựa chọn.</p>
    <h2 id="method-3">3. Thang Likert có một câu và điểm thang đo không hoàn toàn giống nhau</h2>
    <p>Một câu Likert 1–5 là dữ liệu có thứ bậc. Điểm tổng hợp từ nhiều mục hỏi có thể được phân tích như biến gần liên tục trong một số hoàn cảnh, nhưng bạn phải giải thích được cách tạo điểm và giả định đi kèm. Đừng thấy SPSS cho phép tính trung bình là mặc nhiên mọi phép kiểm định đều phù hợp.</p>
    <h2 id="method-4">4. P-value chưa kể hết câu chuyện</h2>
    <p>Khi báo cáo, ngoài p-value, hãy xem <strong>độ lớn hiệu ứng</strong> và <strong>khoảng tin cậy</strong>. Một kết quả có p nhỏ không có nghĩa khác biệt đó quan trọng trong thực tế. Ngược lại, p lớn cũng không chứng minh hai nhóm giống hệt nhau — đặc biệt khi mẫu nhỏ hoặc phép đo nhiều nhiễu.</p>
    <p>Nếu mô hình có nhiều biến giải thích, kiểm tra giả định, quan sát ảnh hưởng lớn, đa cộng tuyến khi phù hợp và độ nhạy khi thay đổi cách đặc tả. Chỉ chạy thêm nhiều mô hình đến khi có p dưới 0,05 sẽ làm tăng nguy cơ diễn giải sai.</p>
    <h2 id="method-5">5. Một trang kế hoạch phân tích là đủ để bắt đầu</h2>
    <div class="article-checklist"><strong>Trước khi mở phần mềm, ghi ra:</strong><ul><li>Câu hỏi nghiên cứu và giả thuyết chính.</li><li>Biến kết quả, loại thang đo và cách mã hóa.</li><li>Nhóm so sánh hoặc các biến giải thích.</li><li>Đơn vị quan sát, cách lấy mẫu và dữ liệu lặp/cụm nếu có.</li><li>Phép phân tích dự kiến, giả định cần kiểm tra, cách báo cáo.</li></ul></div>
    <p>Nếu năm dòng này còn mơ hồ, nên trao đổi thêm về thiết kế nghiên cứu. Đổi từ SPSS sang Stata hay Python không tự giải quyết được vấn đề phương pháp.</p>
    <div class="article-sources"><h2 id="method-nguon">Đọc thêm từ tài liệu gốc</h2><ul><li><a href="https://www.statsmodels.org/stable/diagnostic.html" target="_blank" rel="noopener noreferrer">statsmodels — Regression diagnostics</a></li><li><a href="https://www.ibm.com/docs/en/spss-statistics/32.0.0?topic=regression-overview-command" target="_blank" rel="noopener noreferrer">IBM SPSS — REGRESSION command</a></li></ul></div>
  `
}
];
