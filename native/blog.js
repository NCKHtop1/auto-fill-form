(function () {
  'use strict';
  var blog = document.getElementById('blog');
  if (!blog) return;
  var repo = 'NCKHtop1/auto-fill-form';
  var $ = function (id) { return document.getElementById(id); };
  var allPosts = [], category = 'Tất cả';
  var draftKey = 'pandastudy.blog.draft.v1';
  var categories = ['SPSS','Stata','Python','Dữ liệu','Phương pháp','Khác'];
  var colors = {'SPSS':'thumb-blue','Stata':'thumb-red','Python':'thumb-python','Dữ liệu':'thumb-green','Phương pháp':'thumb-brown','Khác':'thumb-green'};
  function el(tag, cls, value) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function norm(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  }
  function prettyDate(value) {
    var date = new Date(String(value) + 'T12:00:00');
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
  }
  function createCard(post) {
    var article = el('article','panda-blog-card');
    var link = el('a','panda-blog-card-link');
    link.href = '#blog/' + encodeURIComponent(post.id);
    link.setAttribute('aria-label','Đọc bài: ' + post.title);
    var thumb = el('div','blog-thumb ' + (colors[post.category] || colors.Khác));
    thumb.appendChild(el('span','blog-cover-label',post.cover || post.category || 'Blog'));
    var body = el('div','blog-card-body');
    body.appendChild(el('div','blog-card-category',post.category || 'Bài viết'));
    body.appendChild(el('h3','',post.title));
    body.appendChild(el('p','',post.summary));
    var bottom = el('div','blog-card-meta');
    bottom.appendChild(el('time','',prettyDate(post.date)));
    bottom.appendChild(el('span','blog-read-arrow','Đọc bài ↗'));
    body.appendChild(bottom);
    link.appendChild(thumb);
    link.appendChild(body);
    article.appendChild(link);
    return article;
  }
  function renderCards() {
    var grid = $('blogGrid');
    var query = norm($('blogSearch').value.trim());
    var filtered = allPosts.filter(function (p) {
      return (category === 'Tất cả' || p.category === category) &&
        norm([p.title,p.summary,p.category].join(' ')).includes(query);
    });
    grid.replaceChildren();
    filtered.forEach(function (p) { grid.appendChild(createCard(p)); });
    $('blogCount').textContent = filtered.length + ' bài viết';
    $('blogEmpty').hidden = filtered.length !== 0;
  }
  function renderMarkdown(container, markdown) {
    container.replaceChildren();
    var lines = String(markdown || '').replace(/\r\n/g,'\n').split('\n');
    var i = 0, ticks = String.fromCharCode(96).repeat(3);
    while (i < lines.length) {
      var line = lines[i].trim();
      if (!line) { i++; continue; }
      if (line.startsWith(ticks)) {
        i++;
        var codeLines = [];
        while (i < lines.length && !lines[i].trim().startsWith(ticks)) codeLines.push(lines[i++]);
        if (i < lines.length) i++;
        var pre = el('pre'), code = el('code','',codeLines.join('\n'));
        pre.appendChild(code);
        container.appendChild(pre);
        continue;
      }
      var heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        container.appendChild(el('h' + Math.min(heading[1].length + 1,4),'',heading[2]));
        i++; continue;
      }
      if (/^[-*]\s+/.test(line)) {
        var list = el('ul');
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim()))
          list.appendChild(el('li','',lines[i++].trim().replace(/^[-*]\s+/,'')));
        container.appendChild(list);
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        var ordered = el('ol');
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim()))
          ordered.appendChild(el('li','',lines[i++].trim().replace(/^\d+\.\s+/,'')));
        container.appendChild(ordered);
        continue;
      }
      if (line === '---') { container.appendChild(el('hr')); i++; continue; }
      if (line.startsWith('> ')) { container.appendChild(el('blockquote','',line.slice(2))); i++; continue; }
      var text = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(#{1,3}\s|[-*]\s|\d+\.\s|> |---$)/.test(lines[i].trim()) &&
             !lines[i].trim().startsWith(ticks)) text.push(lines[i++].trim());
      if (!text.length) { i++; continue; }
      container.appendChild(el('p','',text.join(' ')));
    }
  }
  function showMode(mode) {
    $('blogIndex').hidden = mode !== 'index';
    $('blogReader').hidden = mode !== 'reader';
    $('blogEditor').hidden = mode !== 'editor';
  }
  function showArticle(post) {
    showMode('reader');
    $('articleCategory').textContent = post.category || 'Blog';
    $('articleTitle').textContent = post.title;
    $('articleSummary').textContent = post.summary;
    $('articleDate').textContent = prettyDate(post.date);
    $('articleDate').dateTime = post.date;
    $('articleCover').className = 'article-cover ' + (colors[post.category] || colors.Khác);
    $('articleCover').textContent = post.cover || post.category || 'Blog';
    renderMarkdown($('articleContent'),post.content);
  }
  function route() {
    var hash = location.hash.slice(1);
    try { hash = decodeURIComponent(hash); } catch (_) { hash = ''; }
    if (hash === 'blog-viet-bai') {
      showMode('editor');
      blog.scrollIntoView({block:'start'});
      return;
    }
    if (hash.indexOf('blog/') === 0) {
      var id = hash.slice(5), post = allPosts.find(function (p) { return p.id === id; });
      if (post) {
        showArticle(post);
        blog.scrollIntoView({block:'start'});
        return;
      }
      showMode('index');
      if (allPosts.length) $('blogLoadStatus').textContent = 'Không tìm thấy bài viết.';
      blog.scrollIntoView({block:'start'});
      return;
    }
    showMode('index');
    if (hash === 'blog') blog.scrollIntoView({block:'start'});
  }
  function getDraft() {
    return {title:$('postTitle').value.trim(),summary:$('postSummary').value.trim(),
      category:$('postCategory').value,content:$('postBody').value.trim()};
  }
  function saveDraft() {
    try {
      localStorage.setItem('pandastudy.blog.draft.v1',JSON.stringify(getDraft()));
      $('blogEditorStatus').textContent = 'Đã lưu bản nháp trên thiết bị này.';
    } catch (_) {
      $('blogEditorStatus').textContent = 'Không lưu được bản nháp. Hãy sao chép nội dung trước khi rời trang.';
    }
  }
  function restoreDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(draftKey) || '{}');
      if (d.title) $('postTitle').value = d.title;
      if (d.summary) $('postSummary').value = d.summary;
      if (categories.includes(d.category)) $('postCategory').value = d.category;
      if (d.content) $('postBody').value = d.content;
    } catch (_) {}
  }
  function articleError(post) {
    if (post.title.length < 8 || post.title.length > 130) return 'Tiêu đề cần từ 8 đến 130 ký tự.';
    if (post.summary.length < 15 || post.summary.length > 280) return 'Tóm tắt cần từ 15 đến 280 ký tự.';
    if (!categories.includes(post.category)) return 'Chọn chuyên mục.';
    if (post.content.length < 80 || post.content.length > 18000) return 'Nội dung cần từ 80 đến 18.000 ký tự.';
    return '';
  }
  function previewDraft() {
    var d = getDraft();
    $('blogEditorPreview').hidden = false;
    $('blogEditorPreviewTitle').textContent = d.title || 'Tiêu đề bài viết';
    renderMarkdown($('blogEditorPreviewBody'), d.content || 'Nhập nội dung để xem trước.');
    $('blogEditorPreview').scrollIntoView({block:'nearest'});
  }
  function publishDraft(event) {
    event.preventDefault();
    var d = getDraft();
    var error = articleError(d);
    if (error) { $('blogEditorStatus').textContent = error; return; }
    saveDraft();
    var issueTitle = '[PandaStudy] ' + d.title;
    var issueBody = 'PANDASTUDY_POST_V1\n' + JSON.stringify(d,null,2);
    var base = 'https://github.com/' + repo + '/issues/new?title=' + encodeURIComponent(issueTitle);
    var full = base + '&body=' + encodeURIComponent(issueBody);
    if (full.length <= 6500) {
      window.open(full,'_blank','noopener,noreferrer');
      $('blogEditorStatus').textContent = 'GitHub đã mở. Đăng nhập NCKHtop1 rồi bấm Submit new issue để xuất bản.';
    } else {
      $('issueCopyText').value = issueBody;
      $('issueCopyBox').hidden = false;
      $('blogEditorStatus').textContent = 'Bài dài: sao chép nội dung bên dưới và dán vào mô tả trên GitHub để đăng.';
      window.open(base,'_blank','noopener,noreferrer');
    }
  }
  function bindEditor() {
    $('postEditorForm').addEventListener('submit',publishDraft);
    $('saveBlogDraft').addEventListener('click',saveDraft);
    $('previewBlogDraft').addEventListener('click',previewDraft);
    $('copyIssueText').addEventListener('click',function () {
      var box = $('issueCopyText');
      box.select();
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(box.value).then(function () {
          $('blogEditorStatus').textContent = 'Đã sao chép. Dán vào GitHub để đăng bài.';
        }).catch(function () {
          $('blogEditorStatus').textContent = 'Nhấn Ctrl+C để sao chép nội dung đang chọn.';
        });
      else $('blogEditorStatus').textContent = 'Nhấn Ctrl+C để sao chép nội dung đang chọn.';
    });
  }
  function bindMobileNav() {
    var menu = $('mobileMenu'), nav = $('mainNav');
    if (!menu || !nav) return;
    function close() {
      nav.classList.remove('mobile-open');
      menu.setAttribute('aria-expanded','false');
    }
    menu.addEventListener('click',function () {
      var open = nav.classList.toggle('mobile-open');
      menu.setAttribute('aria-expanded',String(open));
    });
    nav.querySelectorAll('a').forEach(function (link) { link.addEventListener('click',close); });
    document.addEventListener('keydown',function (e) { if (e.key === 'Escape') close(); });
    document.addEventListener('click',function (e) {
      if (!nav.contains(e.target) && !menu.contains(e.target)) close();
    });
  }
  async function loadBlog() {
    try {
      var res = await fetch('/blog/posts.json',{cache:'no-store'});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (!data || !Array.isArray(data.posts)) throw new Error('Bài viết không hợp lệ');
      allPosts = data.posts.filter(function (p) {
        return p && /^[a-z0-9-]+$/.test(p.id || '') && typeof p.title === 'string' && typeof p.content === 'string';
      });
      $('blogLoadStatus').textContent = '';
      renderCards();
      route();
    } catch (_) {
      $('blogLoadStatus').textContent = 'Chưa tải được bài viết. Vui lòng tải lại trang.';
      $('blogCount').textContent = '';
    }
  }
  function init() {
    $('blogSearch').addEventListener('input',renderCards);
    $('blogCategory').addEventListener('change',function (e) { category = e.target.value; renderCards(); });
    $('blogClear').addEventListener('click',function () {
      $('blogSearch').value = '';
      $('blogCategory').value = 'Tất cả';
      category = 'Tất cả';
      renderCards();
    });
    addEventListener('hashchange',route);
    bindEditor();
    bindMobileNav();
    restoreDraft();
    loadBlog();
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
