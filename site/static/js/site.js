/* HagiiZ 災害レビュー — 共通スクリプト
   ・動きの停止 ・時計 ・ボードの糸 ・絞り込み ・地域 ・答える／答えを読む ・納得／通報 ・シェア画像 ・わたしの答え ・受付
   受け皿（Apps Script）のURLが空のときは「試作モード」：答えはこの端末だけに保存する。 */
(function () {
  'use strict';
  var CFG = {};
  try { CFG = JSON.parse(document.getElementById('hz-config').textContent); } catch (e) { CFG = {}; }
  var API = CFG.api || '';
  var DEMO = !API;

  // ---------- 小物 ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function store(k, v) { try { if (v === undefined) { return JSON.parse(localStorage.getItem(k)); } localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toast(msg) {
    var t = el('div', 'toast', msg); t.setAttribute('role', 'status'); document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function clientId() {
    var c = store('hz-client');
    if (!c) { c = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36); store('hz-client', c); }
    return c;
  }
  function api(params, body) {
    if (DEMO) return Promise.reject(new Error('demo'));
    if (body) {
      return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
    }
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(API + (API.indexOf('?') < 0 ? '?' : '&') + q).then(function (r) { return r.json(); });
  }

  // ---------- 動きを止める ----------
  function applyMotion() {
    var m = store('hz-motion');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var still = m === 'still' || (m !== 'moving' && reduce);
    document.documentElement.classList.toggle('still', still);
    document.documentElement.classList.toggle('moving', m === 'moving');
    $$('[data-motion]').forEach(function (b) {
      b.textContent = still ? '▶' : 'Ⅱ';
      b.setAttribute('aria-label', still ? '動きを出す' : '動きを止める');
      b.setAttribute('aria-pressed', still ? 'true' : 'false');
    });
  }
  $$('[data-motion]').forEach(function (b) {
    b.addEventListener('click', function () {
      store('hz-motion', document.documentElement.classList.contains('still') ? 'moving' : 'still');
      applyMotion(); drawThreads();
    });
  });
  applyMotion();

  // ---------- 時計 ----------
  function jst() { return new Date(Date.now() + 9 * 3600e3); }
  function tick() {
    var d = jst();
    $$('[data-since]').forEach(function (box) {
      var p = box.getAttribute('data-since').split('-').map(Number);
      var y = d.getUTCFullYear() - p[0];
      var an = Date.UTC(p[0] + y, p[1] - 1, p[2]);
      if (d.getTime() < an) { y -= 1; an = Date.UTC(p[0] + y, p[1] - 1, p[2]); }
      var days = Math.floor((d.getTime() - an) / 864e5);
      var set = function (s, v) { var e = $(s, box); if (e && e.textContent !== String(v)) e.textContent = v; };
      set('[data-y]', y); set('[data-d]', days);
      set('[data-t]', pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()));
    });
    // 当時小学生だった人（最年少の1年生は1953年4月1日生まれ）
    $$('[data-witness]').forEach(function (e) {
      var age = d.getUTCFullYear() - 1953 - ((d.getUTCMonth() < 3) ? 1 : 0);
      if (e.textContent !== String(age)) e.textContent = age;
    });
  }
  tick(); setInterval(tick, 1000);

  // ---------- ボードの糸 ----------
  var board = $('[data-board]');
  var threadPaths = [];
  function drawThreads() {
    if (!board) return;
    var svg = $('.board__threads', board); if (!svg) return;
    var links = []; try { links = JSON.parse(board.getAttribute('data-threads') || '[]'); } catch (e) {}
    var br = board.getBoundingClientRect();
    svg.setAttribute('width', br.width); svg.setAttribute('height', br.height);
    svg.setAttribute('viewBox', '0 0 ' + br.width + ' ' + br.height);
    links.forEach(function (l, i) {
      var p = threadPaths[i];
      if (!p) {
        // 糸は最初の1回だけ引く。あとは位置だけ直す（引き直しでチカチカさせない）
        p = threadPaths[i] = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('stroke', l[2] === 'soon' ? '#9A9AA4' : '#E24F93');
        p.setAttribute('stroke-width', l[2] === 'soon' ? '1.5' : '2.5');
        if (l[2] === 'soon') p.setAttribute('stroke-dasharray', '4 4');
        else { p.setAttribute('pathLength', '100'); p.style.strokeDasharray = '100'; p.style.setProperty('--len', '100'); p.style.animation = 'hz-draw 1.2s ' + (0.2 + i * 0.06) + 's ease-out both'; }
        svg.appendChild(p);
      }
      var a = board.querySelector('[data-node="' + l[0] + '"]'), b = board.querySelector('[data-node="' + l[1] + '"]');
      var ok = a && b && a.offsetParent && b.offsetParent;
      if (ok) {
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        ok = !(rb.right < br.left || rb.left > br.right);
      }
      if (!ok) { p.style.display = 'none'; return; }
      p.style.display = '';
      var x1 = ra.left + ra.width / 2 - br.left, y1 = ra.top + ra.height * 0.35 - br.top;
      var x2 = rb.left + rb.width / 2 - br.left, y2 = rb.top + 10 - br.top;
      var mx = (x1 + x2) / 2, my = Math.max(y1, y2) + 30;
      p.setAttribute('d', 'M' + x1 + ' ' + y1 + ' Q' + mx + ' ' + my + ' ' + x2 + ' ' + y2);
    });
  }
  if (board) {
    var raf = 0;
    var redraw = function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawThreads); };
    window.addEventListener('resize', redraw);
    $$('.board__qs', board).forEach(function (s) { s.addEventListener('scroll', redraw, { passive: true }); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
    window.addEventListener('load', redraw);
    drawThreads();
  }

  // ---------- 絞り込み（ボタン） ----------
  $$('[data-filter-group]').forEach(function (g) {
    var target = $(g.getAttribute('data-filter-group'));
    $$('[data-filter]', g).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('[data-filter]', g).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var v = b.getAttribute('data-filter');
        $$('[data-tags]', target).forEach(function (it) {
          it.dataset.fh = (v === '' || (',' + it.getAttribute('data-tags') + ',').indexOf(',' + v + ',') >= 0) ? '' : '1';
          it.hidden = !!(it.dataset.fh || it.dataset.sh);
        });
      });
    });
  });
  // キーワード
  $$('[data-search]').forEach(function (inp) {
    var target = $(inp.getAttribute('data-search'));
    inp.addEventListener('input', function () {
      var v = inp.value.trim();
      $$('[data-text]', target).forEach(function (it) { it.dataset.sh = (v && it.getAttribute('data-text').indexOf(v) < 0) ? '1' : ''; it.hidden = !!(it.dataset.fh || it.dataset.sh); });
    });
  });

  // ---------- 地域 ----------
  var chiiki = $('[data-chiiki]');
  if (chiiki) {
    var show = function (pref) {
      $$('.prefs button', chiiki).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-pref') === pref ? 'true' : 'false'); });
      $$('[data-pref-box]', chiiki).forEach(function (bx) { bx.hidden = bx.getAttribute('data-pref-box') !== pref; });
    };
    $$('.prefs button', chiiki).forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-pref')); var t = $('[data-pref-box="' + b.getAttribute('data-pref') + '"]', chiiki); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); });
    var q = $('[data-muni-search]', chiiki);
    if (q) q.addEventListener('input', function () {
      var v = q.value.trim();
      var sec = $('[data-prefs-sec]', chiiki), cnt = $('[data-muni-count]', chiiki);
      if (!v) { if (sec) sec.hidden = false; if (cnt) cnt.hidden = true; show(chiiki.getAttribute('data-default')); $$('.muni', chiiki).forEach(function (m) { m.hidden = false; }); return; }
      var n = 0;
      $$('[data-pref-box]', chiiki).forEach(function (bx) {
        var any = false;
        $$('.muni', bx).forEach(function (m) { var hit = m.getAttribute('data-text').indexOf(v) >= 0; m.hidden = !hit; if (hit) n++; any = any || hit; });
        bx.hidden = !any;
      });
      // さがしている間は、都道府県のボタンを隠して、結果をすぐ下に出す
      if (sec) sec.hidden = true;
      if (cnt) { cnt.hidden = false; cnt.textContent = n ? '「' + v + '」に合うところ：' + n + '件' : '「' + v + '」に合うところは見つかりませんでした。ひらがなではなく漢字で入れてみてください。'; }
    });
    show(chiiki.getAttribute('data-default'));
  }

  // ---------- 答えの数 ----------
  function localAll() { return store('hz-local-answers') || {}; }
  function fillCounts() {
    var nodes = $$('[data-count]'); if (!nodes.length) return;
    var put = function (counts) {
      nodes.forEach(function (n) { var k = n.getAttribute('data-count'); var v = k === '*' ? counts.__total : counts[k]; n.textContent = v == null ? '0' : v; });
    };
    if (DEMO) {
      var all = localAll(), c = { __total: 0 };
      Object.keys(all).forEach(function (k) { c[k] = all[k].length; c.__total += all[k].length; });
      put(c); return;
    }
    api({ action: 'counts' }).then(function (r) { var c = r.counts || {}; c.__total = r.total || 0; put(c); }).catch(function () {});
  }
  fillCounts();
  function paintMineCount() { var m = store('hz-mine') || []; $$('[data-mine-count]').forEach(function (n) { n.textContent = m.length; }); }
  paintMineCount();

  // ---------- 答えを描く ----------
  var CARDS = {};
  try { CARDS = JSON.parse(($('#hz-cards') || {}).textContent || '{}'); } catch (e) {}
  function renderAnswer(a, mineIds, agreed) {
    var box = el('article', 'ans' + (a.picked ? ' ans--picked' : ''));
    if (a.picked) box.appendChild(el('span', 'ans__picked', '防災士が採用'));
    var who = el('div', 'ans__who');
    who.appendChild(el('span', 'ans__av', (a.name || '？').slice(0, 1)));
    var nm = el('span'); var n1 = el('span', 'ans__name', a.name || '名前なし');
    if (mineIds.indexOf(a.id) >= 0) n1.appendChild(el('span', 'ans__mine', 'あなた'));
    nm.appendChild(n1); nm.appendChild(el('span', 'ans__role', a.role || '')); nm.style.display = 'flex'; nm.style.flexDirection = 'column';
    who.appendChild(nm);
    if (a.stance) who.appendChild(el('span', 'ans__stance', a.stance));
    box.appendChild(who);
    var body = el('div', 'ans__body');
    body.appendChild(el('p', 'ans__a', a.answer)); body.lastChild.style.margin = '0';
    var evs = el('div'); evs.style.display = 'flex'; evs.style.flexDirection = 'column'; evs.style.gap = '6px';
    evs.appendChild(el('span', 'small', '根拠')); evs.lastChild.style.fontWeight = '900';
    (a.cards || []).forEach(function (cid) { var c = CARDS[cid]; if (!c) return; var e = el('span', 'ev'); e.appendChild(el('span', 'mono', cid)); e.appendChild(document.createTextNode(c.t)); evs.appendChild(e); });
    body.appendChild(evs);
    if (a.proposal) { var p = el('p', 'ans__p'); p.style.margin = '0'; var b = el('b', null, '提案：'); p.appendChild(b); p.appendChild(document.createTextNode(a.proposal)); body.appendChild(p); }
    box.appendChild(body);
    var acts = el('div', 'ans__acts');
    var re = el('a', null, '別の根拠で応える'); re.href = '#kotaeru'; acts.appendChild(re);
    var ag = el('button', null, '根拠に納得 ' + (a.agree || 0)); ag.type = 'button';
    var on = agreed.indexOf(a.id) >= 0; ag.setAttribute('aria-pressed', on ? 'true' : 'false');
    ag.addEventListener('click', function () {
      var list = store('hz-agree') || []; if (list.indexOf(a.id) >= 0) return;
      list.push(a.id); store('hz-agree', list); a.agree = (a.agree || 0) + 1;
      ag.textContent = '根拠に納得 ' + a.agree; ag.setAttribute('aria-pressed', 'true');
      if (!DEMO) api(null, { action: 'agree', id: a.id, client: clientId() }).catch(function () {});
    });
    acts.appendChild(ag); box.appendChild(acts);
    var rp = el('button', 'ans__report', '問題を知らせる'); rp.type = 'button';
    rp.addEventListener('click', function () {
      if (DEMO) { box.remove(); toast('試作モード：この端末で隠しました'); return; }
      api(null, { action: 'report', id: a.id, client: clientId() }).then(function () { box.remove(); toast('知らせを受け取りました。運営が確認します'); }).catch(function () { toast('送れませんでした。時間をおいて試してください'); });
    });
    box.appendChild(rp);
    return box;
  }

  // ---------- 問いのページ ----------
  var toiBox = $('[data-toi]');
  if (toiBox) {
    var slug = toiBox.getAttribute('data-toi');
    var list = $('[data-answers]'), empty = $('[data-answers-empty]');
    var mineIds = (store('hz-mine') || []).map(function (x) { return x.id; });
    var agreed = store('hz-agree') || [];
    var paint = function (answers) {
      while (list.firstChild) list.removeChild(list.firstChild);
      answers.forEach(function (a) { list.appendChild(renderAnswer(a, mineIds, agreed)); });
      if (empty) empty.hidden = answers.length > 0;
      $$('[data-toi-count]').forEach(function (n) { n.textContent = answers.length; });
      var roles = {}; answers.forEach(function (a) { roles[a.role] = 1; });
      $$('[data-toi-roles]').forEach(function (n) { n.textContent = Object.keys(roles).length; });
      $$('[data-toi-picked]').forEach(function (n) { n.textContent = answers.filter(function (a) { return a.picked; }).length; });
    };
    var load = function () {
      if (DEMO) { paint((localAll()[slug] || []).slice().reverse()); return; }
      api({ action: 'list', toi: slug }).then(function (r) { paint(r.answers || []); }).catch(function () { if (empty) { empty.hidden = false; empty.textContent = '答えを読みこめませんでした。時間をおいて開き直してください。'; } });
    };
    load();

    // 答えるフォーム
    var form = $('[data-answer-form]');
    if (form) {
      var picks = $$('.pick', form), maxPick = 2;
      var sync = function () {
        var n = picks.filter(function (p) { return p.getAttribute('aria-pressed') === 'true'; }).length;
        picks.forEach(function (p) { p.disabled = n >= maxPick && p.getAttribute('aria-pressed') !== 'true'; });
        $$('[data-pick-count]', form).forEach(function (c) { c.textContent = n; });
      };
      picks.forEach(function (p) { p.addEventListener('click', function () { p.setAttribute('aria-pressed', p.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); $('.pick__box', p).textContent = p.getAttribute('aria-pressed') === 'true' ? '✓' : ''; sync(); }); });
      $$('[data-chips]', form).forEach(function (g) {
        $$('.chip', g).forEach(function (c) { c.addEventListener('click', function () { $$('.chip', g).forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); }); }); });
      });
      $$('[data-max]', form).forEach(function (t) {
        var out = $('[data-count-for="' + t.id + '"]', form);
        var upd = function () { if (out) out.textContent = t.value.length + ' / ' + t.getAttribute('data-max'); };
        t.addEventListener('input', upd); upd();
      });
      var saved = store('hz-name'); if (saved) { var nmI = $('[name="name"]', form); if (nmI) nmI.value = saved.name || ''; var rc = saved.role && $('[data-chips="role"] .chip[data-v="' + saved.role + '"]', form); if (rc) rc.click(); }
      var errBox = $('[data-err]', form);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var cards = picks.filter(function (p) { return p.getAttribute('aria-pressed') === 'true'; }).map(function (p) { return p.getAttribute('data-card'); });
        var pickedChip = function (k) { var c = $('[data-chips="' + k + '"] .chip[aria-pressed="true"]', form); return c ? c.getAttribute('data-v') : ''; };
        var data = {
          action: 'answer', toi: slug, cards: cards, stance: pickedChip('stance'),
          answer: $('[name="answer"]', form).value.trim(), proposal: $('[name="proposal"]', form).value.trim(),
          name: $('[name="name"]', form).value.trim(), role: pickedChip('role'), client: clientId()
        };
        var msg = !cards.length ? '根拠カードを1枚以上選んでください。' : !data.answer ? '答えを1文で書いてください。' : !data.name ? '表示する名前を書いてください。' : !data.role ? '立場を選んでください。' : '';
        if (msg) { errBox.textContent = msg; errBox.hidden = false; errBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        errBox.hidden = true;
        store('hz-name', { name: data.name, role: data.role });
        var btn = $('[type="submit"]', form); btn.disabled = true; btn.textContent = '送っています…';
        var finish = function (id) {
          var rec = { id: id, toi: slug, answer: data.answer, proposal: data.proposal, cards: cards, stance: data.stance, name: data.name, role: data.role, ts: Date.now(), agree: 0 };
          var mine = store('hz-mine') || []; mine.push(rec); store('hz-mine', mine); mineIds.push(id); paintMineCount();
          if (DEMO) { var all = localAll(); (all[slug] = all[slug] || []).push(rec); store('hz-local-answers', all); }
          form.hidden = true; var done = $('[data-done]'); done.hidden = false;
          $$('[data-share-answer]').forEach(function (n) { n.textContent = data.answer; });
          $$('[data-share-name]').forEach(function (n) { n.textContent = data.name + '・' + data.role; });
          $$('[data-share-cards]').forEach(function (n) { n.textContent = cards.length; });
          done.scrollIntoView({ behavior: 'smooth', block: 'start' });
          window.HZ_LAST = rec; load();
        };
        if (DEMO) { finish('local-' + Date.now().toString(36)); return; }
        api(null, data).then(function (r) { if (r && r.ok) finish(r.id); else throw new Error((r && r.error) || 'NG'); })
          .catch(function (e) { btn.disabled = false; btn.textContent = '答えを出す'; errBox.textContent = '送れませんでした（' + e.message + '）。時間をおいてもう一度試してください。'; errBox.hidden = false; });
      });
      if (location.hash === '#kotaeru') setTimeout(function () { var f = $('#kotaeru'); if (f) f.scrollIntoView({ block: 'start' }); }, 200);
    }
  }

  // ---------- シェア ----------
  function wrapText(ctx, text, maxW) {
    var lines = [], line = '';
    Array.from(text).forEach(function (ch) { var t = line + ch; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = ch; } else line = t; });
    if (line) lines.push(line); return lines;
  }
  function makeImage(info) {
    return (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('900 60px "Zen Kaku Gothic New"'), document.fonts.load('700 40px "IBM Plex Mono"')]) : Promise.resolve()).catch(function () {}).then(function () {
      return new Promise(function (res) {
        var W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d');
        var F = '"Zen Kaku Gothic New","Hiragino Sans","Noto Sans JP",sans-serif', M = '"IBM Plex Mono",monospace';
        x.fillStyle = '#F6F6F8'; x.fillRect(0, 0, W, H);
        x.strokeStyle = '#E6E6EC'; x.lineWidth = 2;
        for (var gx = 0; gx < W; gx += 54) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
        for (var gy = 0; gy < H; gy += 54) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
        var draw = function () {
          var cx = 80, cw = W - 160, y = 170;
          x.fillStyle = '#fff'; x.strokeStyle = '#0E0E10'; x.lineWidth = 8;
          x.fillStyle = '#E24F93'; x.fillRect(cx + 20, 120 + 20, cw, 1580); x.fillStyle = '#fff'; x.fillRect(cx, 120, cw, 1580); x.strokeRect(cx, 120, cw, 1580);
          x.fillStyle = '#4D4D57'; x.font = '700 30px ' + M; x.fillText('HagiiZ 災害レビュー', cx + 50, y + 40);
          x.fillStyle = '#0E0E10'; x.font = '900 40px ' + F; x.fillText(info.lead, cx + 50, y + 120);
          x.font = '900 52px ' + F; var ql = wrapText(x, info.question, cw - 140);
          var qh = ql.length * 76 + 50; x.fillStyle = '#0E0E10'; x.fillRect(cx + 50, y + 170, cw - 100, qh);
          x.fillStyle = '#fff'; ql.forEach(function (l, i) { x.fillText(l, cx + 80, y + 240 + i * 76); });
          var ay = y + 170 + qh + 90; x.fillStyle = '#0E0E10'; x.font = '900 36px ' + F; x.fillText('私の答え', cx + 50, ay);
          x.font = '900 58px ' + F; var al = wrapText(x, info.answer, cw - 100).slice(0, 6);
          al.forEach(function (l, i) { x.fillText(l, cx + 50, ay + 90 + i * 84); });
          var by = ay + 90 + al.length * 84 + 40; x.font = '700 34px ' + F; x.fillStyle = '#4D4D57';
          x.fillText('根拠 ' + info.cards + '枚・' + info.name, cx + 50, by);
          x.save(); x.translate(cx + cw - 230, 120 + 1580 - 150); x.rotate(-0.12); x.strokeStyle = '#E24F93'; x.lineWidth = 8; x.strokeRect(-20, -70, 300, 110); x.fillStyle = '#E24F93'; x.font = '900 60px ' + F; x.fillText('回答ずみ', 0, 10); x.restore();
          x.fillStyle = '#0E0E10'; x.font = '900 40px ' + F; x.fillText('あなたなら、どう答える？', 80, 1800);
          x.font = '700 30px ' + M; x.fillStyle = '#4D4D57'; x.fillText(info.url.replace(/^https?:\/\//, '').replace(/index\.html/, '').replace(/#.*$/, '').slice(0, 56), 80, 1860);
          c.toBlob(function (b) { res({ blob: b, url: c.toDataURL('image/png') }); }, 'image/png');
        };
        var im = new Image(); im.onload = function () { x.globalAlpha = 0.25; x.drawImage(im, W - 620, -60, 640, 855); x.globalAlpha = 1; draw(); }; im.onerror = draw; im.src = info.img || '';
        if (!info.img) draw();
      });
    });
  }
  function showImageDialog(dataUrl) {
    var d = el('div', 'dialog'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'シェア用の画像');
    var b = el('div', 'dialog__box'); b.appendChild(el('b', null, '画像を長押しして保存し、アプリから投稿してください。'));
    var img = el('img'); img.src = dataUrl; img.alt = 'シェア用の画像'; b.appendChild(img);
    var a = el('a', 'btn btn--ink btn--center', '画像を保存する'); a.href = dataUrl; a.download = 'hagiiz-answer.png'; b.appendChild(a);
    var cl = el('button', 'btn btn--center', '閉じる'); cl.type = 'button'; cl.onclick = function () { d.remove(); }; b.appendChild(cl);
    d.appendChild(b); d.addEventListener('click', function (e) { if (e.target === d) d.remove(); }); document.body.appendChild(d);
  }
  $$('[data-share]').forEach(function (wrap) {
    $$('button[data-app]', wrap).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var app = btn.getAttribute('data-app');
        var url = location.href.split('#')[0];
        try { url = new URL(wrap.getAttribute('data-url') || '', location.href).href; } catch (e) {}
        var text = wrap.getAttribute('data-text') || document.title;
        var last = window.HZ_LAST;
        if (last) text = (wrap.getAttribute('data-lead') || '過去の災害を根拠に、未来の問いに答えた') + '。「' + last.answer + '」 あなたならどう答える？';
        var open = function (u) { var a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); };
        if (app === 'x') return open('https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url));
        if (app === 'line') return open('https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(url));
        if (app === 'threads') return open('https://www.threads.net/intent/post?text=' + encodeURIComponent(text + ' ' + url));
        if (app === 'copy') {
          try { navigator.clipboard.writeText(url).then(function () { toast('リンクをコピーしました'); }, function () { toast(url); }); } catch (e) { toast(url); }
          return;
        }
        // Instagram・TikTok：画像を作って、共有メニューか保存
        var info = { lead: wrap.getAttribute('data-lead') || '過去の災害を根拠に、未来の問いに答えた', question: wrap.getAttribute('data-question') || document.title, answer: last ? last.answer : (wrap.getAttribute('data-answer') || ''), cards: last ? last.cards.length : 0, name: last ? (last.name + '・' + last.role) : '', url: url, img: wrap.getAttribute('data-img') };
        btn.disabled = true;
        makeImage(info).then(function (r) {
          btn.disabled = false;
          try {
            var file = new File([r.blob], 'hagiiz-answer.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], text: text + ' ' + url }).catch(function (e) { if (!e || e.name !== 'AbortError') showImageDialog(r.url); }); return; }
          } catch (e) {}
          showImageDialog(r.url);
        });
      });
    });
  });

  // ---------- わたしの答え ----------
  var meBox = $('[data-me]');
  if (meBox) {
    var mine = store('hz-mine') || [];
    var bySlug = {}; mine.forEach(function (a) { bySlug[a.toi] = (bySlug[a.toi] || 0) + 1; });
    $$('[data-me-toi]', meBox).forEach(function (a) { if (bySlug[a.getAttribute('data-me-toi')]) a.classList.add('on'); });
    $$('[data-me-n]').forEach(function (n) { n.textContent = Object.keys(bySlug).length; });
    $$('[data-me-cards]').forEach(function (n) { var s = {}; mine.forEach(function (a) { (a.cards || []).forEach(function (c) { s[c] = 1; }); }); n.textContent = Object.keys(s).length; });
    var name = store('hz-name'); if (name) { $$('[data-me-name]').forEach(function (n) { n.textContent = name.name; }); $$('[data-me-role]').forEach(function (n) { n.textContent = name.role; }); $$('[data-me-init]').forEach(function (n) { n.textContent = name.name.slice(0, 1); }); }
    var listBox = $('[data-me-list]'), titles = {};
    $$('[data-me-toi]', meBox).forEach(function (a) { titles[a.getAttribute('data-me-toi')] = { q: a.getAttribute('title'), href: a.getAttribute('href') }; });
    if (listBox && mine.length) {
      $('[data-me-empty]').hidden = true;
      mine.slice().reverse().forEach(function (a) {
        var t = titles[a.toi] || { q: a.toi, href: '#' };
        var card = el('a', 'qrow'); card.href = t.href;
        card.appendChild(el('span', 'qrow__h', t.q));
        card.appendChild(el('span', 'qrow__q', a.answer));
        card.appendChild(el('span', 'small mute', '根拠 ' + (a.cards || []).length + '枚・' + new Date(a.ts).toLocaleDateString('ja-JP')));
        card.setAttribute('data-id', a.id); listBox.appendChild(card);
      });
    }
    if (!DEMO && mine.length) {
      api({ action: 'mine', ids: mine.map(function (a) { return a.id; }).join(',') }).then(function (r) {
        var st = r.status || {}, picked = 0;
        mine.forEach(function (a) { if (st[a.id] && st[a.id].picked) { picked++; var g = $('[data-me-toi="' + a.toi + '"]', meBox); if (g) g.classList.add('picked'); } });
        $$('[data-me-picked]').forEach(function (n) { n.textContent = picked; });
      }).catch(function () {});
    } else { $$('[data-me-picked]').forEach(function (n) { n.textContent = 0; }); }
  }

  // ---------- 受付（提供・提案・団体・リンク切れ） ----------
  $$('[data-teikyo]').forEach(function (f) {
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var data = { action: 'teikyo', client: clientId() };
      $$('input,select,textarea', f).forEach(function (i) { if (i.name) data[i.name] = i.value.trim(); });
      var err = $('[data-err]', f);
      if (!data.kind || !data.body) { err.textContent = '種類と内容を書いてください。'; err.hidden = false; return; }
      err.hidden = true;
      var ok = function () { f.hidden = true; $('[data-teikyo-done]').hidden = false; };
      if (DEMO) { ok(); return; }
      api(null, data).then(function (r) { if (r && r.ok) ok(); else throw new Error('NG'); }).catch(function () { err.textContent = '送れませんでした。時間をおいてもう一度試してください。'; err.hidden = false; });
    });
    var kind = new URLSearchParams(location.search).get('kind') || (location.hash || '').replace('#', '');
    var sel = $('[name="kind"]', f); if (sel && kind) { $$('option', sel).forEach(function (o) { if (o.value === kind || o.getAttribute('data-k') === kind) sel.value = o.value; }); }
  });
})();
