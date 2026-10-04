/* Marcação de Refeições — aplicação cliente */
(function () {
  'use strict';

  var API = (window.APP_CONFIG || {}).API_URL;
  var $view = document.getElementById('view');
  var $modal = document.getElementById('modal');
  var $modalBox = document.getElementById('modalBox');
  var $toast = document.getElementById('toast');
  var $lang = document.getElementById('langSel');

  /* ---------------- storage (tolerante a falhas) ---------------- */
  function sget(k, store) { try { return (store || sessionStorage).getItem(k); } catch (e) { return null; } }
  function sset(k, v, store) { try { (store || sessionStorage).setItem(k, v); } catch (e) {} }
  function sdel(k, store) { try { (store || sessionStorage).removeItem(k); } catch (e) {} }

  /* ---------------- i18n ---------------- */
  var lang = sget('lang', localStorage) || guessLang();
  function guessLang() {
    var n = (navigator.language || 'pt').toLowerCase().split('-')[0];
    return I18N[n] ? n : 'pt';
  }
  function L() { return LANGS.filter(function (l) { return l.code === lang; })[0] || LANGS[0]; }
  function T(key, vars) {
    var s = (I18N[lang] && I18N[lang][key]) || I18N.pt[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function applyLang(isAdmin) {
    var l = isAdmin ? LANGS[0] : L();
    document.documentElement.lang = l.code === 'tet' ? 'tet' : l.code;
    document.documentElement.dir = l.rtl && !isAdmin ? 'rtl' : 'ltr';
    document.getElementById('appTitle').textContent = isAdmin ? 'Marcação de Refeições · Administração' : T('appTitle');
    document.title = isAdmin ? 'Administração — Marcação de Refeições' : T('appTitle');
    $lang.classList.toggle('hidden', !!isAdmin);
  }
  $lang.innerHTML = LANGS.map(function (l) { return '<option value="' + l.code + '">' + l.name + '</option>'; }).join('');
  $lang.value = lang;
  $lang.addEventListener('change', function () {
    lang = $lang.value; sset('lang', lang, localStorage);
    router();
  });

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseD(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fmtISO(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtISO(d); }
  function mondayOf(s) { var w = parseD(s).getUTCDay(); return addDays(s, -((w + 6) % 7)); }
  function weekDays(ws) { var a = []; for (var i = 0; i < 7; i++) a.push(addDays(ws, i)); return a; }
  function fmtDate(s, opts, locale) {
    try { return new Intl.DateTimeFormat(locale || L().locale, Object.assign({ timeZone: 'UTC' }, opts)).format(parseD(s)); }
    catch (e) { return s; }
  }
  var PT = 'pt-PT';
  function ptDay(s) { return fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long' }, PT); }
  function ptShort(s) { return fmtDate(s, { weekday: 'short', day: '2-digit', month: '2-digit' }, PT); }
  function ptDM(s) { return fmtDate(s, { day: '2-digit', month: '2-digit', year: 'numeric' }, PT); }
  function fmtStamp(st) {
    if (!st) return '';
    var p = st.split(' ');
    return fmtDate(p[0], { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + (p[1] || '').slice(0, 5);
  }

  function toast(msg, isErr) {
    $toast.textContent = msg;
    $toast.className = 'toast' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { $toast.className = 'toast hidden'; }, 3800);
  }
  function openModal(html, wide) {
    $modalBox.className = 'modal-box' + (wide ? ' wide' : '');
    $modalBox.innerHTML = html;
    $modal.classList.remove('hidden');
    var f = $modalBox.querySelector('[autofocus]'); if (f) f.focus();
  }
  function closeModal() { $modal.classList.add('hidden'); $modalBox.innerHTML = ''; }
  $modal.addEventListener('click', function (e) { if (e.target === $modal && !$modal.dataset.locked) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$modal.classList.contains('hidden')) closeModal(); });

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      openModal('<h2>' + esc(title) + '</h2><p style="white-space:pre-wrap">' + esc(text) + '</p>' +
        '<div class="modal-actions"><button class="btn" data-x="no">' + esc(T('cancel')) + '</button>' +
        '<button class="btn ' + (danger ? 'danger solid' : 'primary') + '" data-x="yes" autofocus>' + esc(okLabel || T('confirm')) + '</button></div>');
      $modalBox.querySelector('[data-x=no]').onclick = function () { closeModal(); resolve(false); };
      $modalBox.querySelector('[data-x=yes]').onclick = function () { closeModal(); resolve(true); };
    });
  }

  /* ---------------- API ---------------- */
  function api(action, data, kind) {
    var body = Object.assign({ action: action }, data || {});
    var tk = kind === 'a' ? sget('atk') : kind === 'u' ? sget('utk') : null;
    if (tk) body.token = tk;
    if (!API || API.indexOf('http') !== 0) return Promise.reject({ code: 'not_configured' });
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); }, function () { throw { code: 'network' }; })
      .then(function (j) {
        if (!j || !j.ok) {
          var code = (j && j.error) || 'server_error';
          if (code === 'session') {
            if (kind === 'a') { sdel('atk'); location.hash = '#/admin'; }
            if (kind === 'u') { sdel('utk'); location.hash = '#/'; }
          }
          throw { code: code };
        }
        return j;
      });
  }

  var ADMIN_ERR = {
    login: 'Utilizador ou password incorretos.', too_many: 'Demasiadas tentativas. Aguarde 15 minutos.',
    session: 'Sessão expirada. Entre novamente.', forbidden: 'Sem permissão.', pi_exists: 'Já existe um utente com esse número de PI.',
    max_utentes: 'Limite de 100 utentes ativos atingido. Desative ou elimine um utente primeiro.', missing_fields: 'Preencha os campos obrigatórios.',
    not_found: 'Registo não encontrado.', bad_schedule: 'Horário inválido (a abertura deve ser antes do fecho).',
    bad_meals: 'Configuração de refeições inválida (cada refeição precisa de nome e pelo menos uma opção).',
    wrong_password: 'A password atual está incorreta.', weak_password: 'A nova password deve ter pelo menos 6 caracteres.',
    network: 'Sem ligação ao servidor.', not_configured: 'O endereço do servidor (config.js) ainda não está configurado.'
  };
  function adminErr(e) { toast(ADMIN_ERR[e && e.code] || ('Erro: ' + ((e && e.code) || 'desconhecido')), true); }
  function userErr(e) {
    var c = e && e.code;
    var map = { login: 'loginError', too_many: 'tooMany', network: 'network', session: 'sessionExpired', closed: 'closedNow',
      already_submitted: 'alreadySubmitted', special_text: 'specialMissing' };
    return T(map[c] || 'error');
  }

  /* ---------------- rótulos ---------------- */
  function mealLabel(m) { if (lang !== 'pt' && m.key && I18N[lang] && I18N[lang][m.key]) return I18N[lang][m.key]; return m.label; }
  function optLabel(o) { if (lang !== 'pt' && o.key && I18N[lang] && I18N[lang][o.key]) return I18N[lang][o.key]; return o.label; }
  function findOpt(meal, id) { return (meal.options || []).filter(function (o) { return o.id === id; })[0]; }

  /* ================================================================
     ROUTER
     ================================================================ */
  function router() {
    var h = location.hash || '#/';
    closeModal();
    if (h.indexOf('#/admin') === 0) {
      applyLang(true);
      if (!sget('atk')) return viewAdminLogin();
      var tab = h.split('/')[2] || 'painel';
      return viewAdmin(tab);
    }
    applyLang(false);
    if (h === '#/u' && sget('utk')) return viewUtente();
    if (sget('utk')) { location.hash = '#/u'; return; }
    viewLogin();
  }
  window.addEventListener('hashchange', router);

  /* ================================================================
     UTENTE
     ================================================================ */
  function viewLogin() {
    $view.innerHTML =
      '<div class="narrow">' +
      '<div class="hero"><div class="mark"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M6 3v7a3 3 0 0 0 3 3v8M9 3v6M12 3v7a3 3 0 0 1-3 3M18 21V3c-2 1-3 4-3 8h3"/></svg></div>' +
      '<h1>' + esc(T('appTitle')) + '</h1></div>' +
      '<form class="card" id="lf" autocomplete="off">' +
      '<label class="f" for="pi">' + esc(T('pi')) + '</label>' +
      '<input id="pi" type="text" class="big-input" inputmode="text" autocapitalize="characters" required maxlength="30">' +
      '<label class="f" for="pin">' + esc(T('pin')) + '</label>' +
      '<input id="pin" type="password" class="big-input" inputmode="numeric" pattern="[0-9]*" required maxlength="8">' +
      '<div class="err" id="lerr" role="alert"></div>' +
      '<button class="btn primary block lg" id="lbtn">' + esc(T('login')) + '</button>' +
      '</form>' +
      '<div class="card soft small muted" id="winfo"></div>' +
      '<footer class="foot"><a href="#/admin" class="small">' + esc(T('admin')) + '</a></footer></div>';
    var f = document.getElementById('lf');
    f.onsubmit = function (e) {
      e.preventDefault();
      var b = document.getElementById('lbtn'); b.disabled = true;
      document.getElementById('lerr').textContent = '';
      api('login', { pi: f.pi.value, pin: f.pin.value }).then(function (r) {
        sset('utk', r.token); location.hash = '#/u';
      }).catch(function (e) {
        document.getElementById('lerr').textContent = userErr(e); b.disabled = false; f.pin.value = ''; f.pin.focus();
      });
    };
    api('publicInfo').then(function (r) { document.getElementById('winfo').innerHTML = windowText(r.window); })
      .catch(function () { var w = document.getElementById('winfo'); if (w) w.classList.add('hidden'); });
  }

  function windowText(w) {
    if (w.open) return '<b>' + esc(T('open')) + '</b> · ' + esc(T('weekOf', { a: fmtDate(w.days[0], { day: 'numeric', month: 'short' }), b: fmtDate(w.days[6], { day: 'numeric', month: 'short' }) })) +
      (w.manual ? '' : '<br>' + esc(T('closesAt', { t: w.closeTime })));
    return '<b>' + esc(T('closed')) + '</b><br>' + esc(T('nextOpen', { d: fmtDate(w.openDate, { weekday: 'long', day: 'numeric', month: 'long' }), t: w.openTime }));
  }

  var uState = null;
  function viewUtente() {
    $view.innerHTML = '<div class="spinner"></div>';
    api('uState', {}, 'u').then(function (s) { uState = s; renderUtente(); }).catch(function (e) {
      if (e.code !== 'session') $view.innerHTML = '<div class="narrow"><div class="banner danger">' + esc(userErr(e)) + '</div><button class="btn" onclick="location.reload()">↻</button></div>';
      else { toast(T('sessionExpired'), true); }
    });
  }

  function uLogout() { api('logout', {}, 'u').catch(function () {}); sdel('utk'); location.hash = '#/'; router(); }

  function renderUtente() {
    var s = uState, w = s.window;
    var html = '<div class="narrow">' +
      '<div class="row" style="justify-content:space-between;margin-bottom:12px"><div><h1 style="margin:0">' + esc(s.nome) + '</h1><div class="muted small">PI ' + esc(s.pi) + '</div></div>' +
      '<button class="btn sm" id="ulo">' + esc(T('logout')) + '</button></div>';
    if (s.notas) html += '<div class="card"><h2>' + esc(T('notes')) + '</h2><div class="note-box">' + esc(s.notas) + '</div></div>';
    if (s.rules) html += '<div class="card soft"><h2>' + esc(T('rules')) + '</h2><div style="white-space:pre-wrap">' + esc(s.rules) + '</div></div>';

    if (s.submitted) {
      html += '<div class="banner ok"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5 9-10"/></svg><div><b>' + esc(T('submitted')) + '</b>' +
        esc(T('weekOf', { a: fmtDate(w.days[0], { day: 'numeric', month: 'short' }), b: fmtDate(w.days[6], { day: 'numeric', month: 'short' }) })) + '<br>' +
        esc(T('submittedAt', { d: fmtStamp(s.submittedAt) })) + '</div></div>';
    } else if (!w.open) {
      html += '<div class="banner warn"><div>' + windowText(w) + '</div></div>';
    } else {
      html += '<div class="banner info"><div>' + windowText(w) + '</div></div>';
      html += '<form id="bf">';
      w.days.forEach(function (d, i) {
        html += '<section class="card day"><div class="day-h"><h2>' + esc(fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })) + '</h2>' +
          (s.dayNotes[d] ? '<span class="daynote">' + esc(s.dayNotes[d]) + '</span>' : '') + '</div><div class="day-b">';
        s.meals.forEach(function (m) {
          html += '<div class="meal" data-day="' + d + '" data-meal="' + esc(m.id) + '"><div class="meal-h"><h3>' + esc(mealLabel(m)) + '</h3>' +
            '<button type="button" class="linkbtn small" data-clear>' + esc(T('clear')) + '</button></div><div class="chips" role="radiogroup" aria-label="' + esc(mealLabel(m)) + '">';
          m.options.forEach(function (o) {
            html += '<label class="chip' + (o.special ? ' special' : '') + '"><input type="radio" name="' + d + '_' + esc(m.id) + '" value="' + esc(o.id) + '"' + (o.special ? ' data-special' : '') + '><span>' + esc(optLabel(o)) + '</span></label>';
          });
          html += '</div><input type="text" class="special-text hidden" maxlength="200" placeholder="' + esc(T('specialPh')) + '"></div>';
        });
        html += '</div></section>';
        if (i === 0) html += '<button type="button" class="btn block" id="copy1" style="margin-bottom:14px">' + esc(T('copyMonday')) + '</button>';
      });
      html += '<div class="sticky-submit"><button class="btn primary block lg" id="sbtn">' + esc(T('submit')) + '</button></div></form>';
    }
    html += '</div>';
    $view.innerHTML = html;
    document.getElementById('ulo').onclick = uLogout;
    if (!s.submitted && w.open) wireBookingForm();
  }

  function draftKey() { return 'draft_' + uState.pi + '_' + uState.window.weekStart; }
  function readForm() {
    var dados = {};
    $view.querySelectorAll('.meal').forEach(function (el) {
      var r = el.querySelector('input[type=radio]:checked');
      if (!r) return;
      var d = el.dataset.day, m = el.dataset.meal;
      dados[d] = dados[d] || {};
      dados[d][m] = { o: r.value, t: r.hasAttribute('data-special') ? el.querySelector('.special-text').value.trim() : '' };
    });
    return dados;
  }
  function fillForm(dados) {
    $view.querySelectorAll('.meal').forEach(function (el) {
      var sel = dados[el.dataset.day] && dados[el.dataset.day][el.dataset.meal];
      el.querySelectorAll('input[type=radio]').forEach(function (r) { r.checked = !!sel && r.value === sel.o; });
      var t = el.querySelector('.special-text');
      var sp = el.querySelector('input[type=radio]:checked[data-special]');
      t.classList.toggle('hidden', !sp);
      t.value = sp && sel ? (sel.t || '') : '';
    });
  }
  function saveDraft() { sset(draftKey(), JSON.stringify(readForm()), localStorage); }

  function wireBookingForm() {
    var form = document.getElementById('bf');
    try { var dr = JSON.parse(sget(draftKey(), localStorage) || 'null'); if (dr) fillForm(dr); } catch (e) {}
    form.addEventListener('change', function (e) {
      if (e.target.type === 'radio') {
        var el = e.target.closest('.meal'), t = el.querySelector('.special-text');
        var sp = e.target.hasAttribute('data-special');
        t.classList.toggle('hidden', !sp);
        if (sp) t.focus();
      }
      saveDraft();
    });
    form.addEventListener('input', function (e) { if (e.target.classList.contains('special-text')) saveDraft(); });
    form.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-clear')) {
        var el = e.target.closest('.meal');
        el.querySelectorAll('input[type=radio]').forEach(function (r) { r.checked = false; });
        var t = el.querySelector('.special-text'); t.value = ''; t.classList.add('hidden');
        saveDraft();
      }
    });
    document.getElementById('copy1').onclick = function () {
      var dados = readForm(), days = uState.window.days, first = dados[days[0]] || {};
      days.slice(1).forEach(function (d) { dados[d] = JSON.parse(JSON.stringify(first)); });
      fillForm(dados); saveDraft();
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      var dados = readForm(), missing = 0, badSpecial = null;
      $view.querySelectorAll('.meal').forEach(function (el) {
        var r = el.querySelector('input[type=radio]:checked');
        if (!r) missing++;
        else if (r.hasAttribute('data-special') && !el.querySelector('.special-text').value.trim() && !badSpecial) badSpecial = el;
      });
      if (badSpecial) {
        toast(T('specialMissing'), true);
        badSpecial.scrollIntoView({ behavior: 'smooth', block: 'center' });
        badSpecial.querySelector('.special-text').focus();
        return;
      }
      var msg = T('confirmSubmit') + (missing ? '\n\n' + T('missing', { n: missing }) : '');
      confirmBox(T('submit'), msg, T('confirm')).then(function (ok) {
        if (!ok) return;
        var b = document.getElementById('sbtn'); b.disabled = true;
        api('uSubmit', { weekStart: uState.window.weekStart, dados: dados }, 'u').then(function (r) {
          sdel(draftKey(), localStorage);
          uState.submitted = true; uState.submittedAt = r.submittedAt;
          renderUtente(); window.scrollTo(0, 0); toast(T('success'));
        }).catch(function (err) {
          b.disabled = false; toast(userErr(err), true);
          if (err.code === 'already_submitted' || err.code === 'closed') viewUtente();
        });
      });
    };
  }

  /* ================================================================
     ADMIN
     ================================================================ */
  var TABS = [
    ['painel', 'Painel'], ['marcacoes', 'Marcações'], ['resumos', 'Resumos / PDF'], ['utentes', 'Utentes'],
    ['refeicoes', 'Refeições e opções'], ['regras', 'Regras, horários e notas'], ['definicoes', 'Definições']
  ];
  var DAYNAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  function viewAdminLogin() {
    $view.innerHTML = '<div class="narrow"><div class="hero"><h1>Administração</h1><p class="muted">Acesso reservado ao administrador.</p></div>' +
      '<form class="card" id="af"><label class="f" for="au">Utilizador</label><input id="au" type="text" autocomplete="username" required value="admin">' +
      '<label class="f" for="ap">Password</label><input id="ap" type="password" autocomplete="current-password" required autofocus>' +
      '<div class="err" id="aerr" role="alert"></div><button class="btn primary block lg" id="abtn">Entrar</button></form>' +
      '<footer class="foot"><a href="#/" class="small">← Área de utente</a></footer></div>';
    var f = document.getElementById('af');
    document.getElementById('ap').focus();
    f.onsubmit = function (e) {
      e.preventDefault();
      var b = document.getElementById('abtn'); b.disabled = true;
      api('aLogin', { user: f.au.value, pass: f.ap.value }).then(function (r) {
        sset('atk', r.token); location.hash = '#/admin/painel'; router();
      }).catch(function (e) {
        b.disabled = false;
        document.getElementById('aerr').textContent = ADMIN_ERR[e.code] || 'Erro: ' + e.code;
      });
    };
  }

  function adminShell(tab) {
    return '<div class="row" style="justify-content:space-between;margin-bottom:10px"><h1 style="margin:0">' + esc((TABS.filter(function (t) { return t[0] === tab; })[0] || TABS[0])[1]) + '</h1>' +
      '<button class="btn sm" id="alo">Terminar sessão</button></div>' +
      '<nav class="tabs no-print">' + TABS.map(function (t) { return '<button class="tab' + (t[0] === tab ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</nav>' +
      '<div id="tabc"><div class="spinner"></div></div>';
  }

  function viewAdmin(tab) {
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'painel';
    $view.innerHTML = adminShell(tab);
    $view.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { location.hash = '#/admin/' + b.dataset.tab; }; });
    document.getElementById('alo').onclick = function () { api('logout', {}, 'a').catch(function () {}); sdel('atk'); location.hash = '#/admin'; };
    var c = document.getElementById('tabc');
    ({ painel: tabPainel, marcacoes: tabMarcacoes, resumos: tabResumos, utentes: tabUtentes, refeicoes: tabRefeicoes, regras: tabRegras, definicoes: tabDefinicoes })[tab](c);
  }

  var adminWeek = null; // semana selecionada (segunda-feira)

  function weekNav(ws, id) {
    return '<div class="weeknav no-print" id="' + id + '"><button class="btn sm" data-w="-7" aria-label="Semana anterior">◀</button>' +
      '<div class="lbl">' + esc(ptDM(ws)) + ' – ' + esc(ptDM(addDays(ws, 6))) + '</div>' +
      '<button class="btn sm" data-w="7" aria-label="Semana seguinte">▶</button>' +
      '<input type="date" value="' + ws + '" aria-label="Escolher data"><button class="btn sm ghost" data-w="0">Semana atual</button></div>';
  }
  function wireWeekNav(id, cb) {
    var el = document.getElementById(id);
    el.querySelectorAll('[data-w]').forEach(function (b) {
      b.onclick = function () { var n = +b.dataset.w; adminWeek = n === 0 ? null : addDays(adminWeek, n); cb(); };
    });
    el.querySelector('input[type=date]').onchange = function (e) { if (e.target.value) { adminWeek = mondayOf(e.target.value); cb(); } };
  }

  /* ---------- Painel ---------- */
  function tabPainel(c) {
    api('aDashboard', {}, 'a').then(function (d) {
      var w = d.window;
      c.innerHTML = '<div class="banner ' + (w.open ? 'ok' : 'warn') + '"><div><b>' + (w.open ? 'Marcações ABERTAS' + (w.manual ? ' (abertura manual)' : '') : 'Marcações fechadas') + '</b>' +
        'Semana das marcações: ' + esc(ptDM(w.days[0])) + ' a ' + esc(ptDM(w.days[6])) + '<br>' +
        (w.open && !w.manual ? 'Encerram hoje às ' + esc(w.closeTime) : !w.open ? 'Próxima abertura: ' + esc(ptDay(w.openDate)) + ' às ' + esc(w.openTime) : 'Desative a abertura manual em "Regras, horários e notas".') + '</div></div>' +
        '<div class="stats">' +
        '<div class="stat"><div class="v">' + d.active + ' / ' + d.max + '</div><div class="l">Utentes ativos</div></div>' +
        '<div class="stat"><div class="v">' + d.submitted + '</div><div class="l">Marcações recebidas para a semana de ' + esc(ptDM(w.days[0])) + '</div></div>' +
        '<div class="stat"><div class="v">' + Math.max(0, d.active - d.submitted) + '</div><div class="l">Utentes ativos ainda sem marcação</div></div></div>' +
        '<div class="card"><h2>Ações rápidas</h2><div class="row">' +
        '<a class="btn primary" href="#/admin/marcacoes">Ver marcações</a><a class="btn" href="#/admin/resumos">Resumo / PDF</a>' +
        '<a class="btn" href="#/admin/utentes">Novo utente</a><a class="btn" href="#/admin/definicoes">QR code</a></div></div>';
    }).catch(adminErr);
  }

  /* ---------- Marcações ---------- */
  var weekData = null;
  function loadWeek() {
    return api('aGetWeek', { weekStart: adminWeek || '' }, 'a').then(function (d) { weekData = d; adminWeek = d.weekStart; return d; });
  }
  function tabMarcacoes(c) {
    c.innerHTML = '<div class="spinner"></div>';
    loadWeek().then(function (d) {
      var rows = d.utentes.slice().sort(function (a, b) { return (b.ativo - a.ativo) || a.nome.localeCompare(b.nome, 'pt'); })
        .filter(function (u) { return u.ativo || d.bookings[u.id]; });
      var nb = Object.keys(d.bookings).length;
      c.innerHTML = weekNav(d.weekStart, 'wn') +
        '<div class="row" style="margin-bottom:12px"><input type="search" id="q" class="grow" placeholder="Procurar por nome ou PI…">' +
        '<span class="pill ok">' + nb + ' com marcação</span><span class="pill warn">' + rows.filter(function (u) { return !d.bookings[u.id]; }).length + ' sem marcação</span></div>' +
        '<div class="tablewrap"><table class="t" id="mt"><thead><tr><th>PI</th><th>Nome</th><th>Estado</th><th>Notas</th><th></th></tr></thead><tbody>' +
        rows.map(function (u) {
          var b = d.bookings[u.id];
          var st = b ? (b.submetidoEm ? '<span class="pill ok">Submetida ' + esc(fmtStamp(b.submetidoEm)) + '</span>' : '<span class="pill acc">Criada pelo admin</span>') +
            (b.atualizadoPor === 'admin' && b.submetidoEm ? ' <span class="pill acc">alterada pelo admin</span>' : '') : '<span class="pill warn">Sem marcação</span>';
          return '<tr data-s="' + esc((u.nome + ' ' + u.pi).toLowerCase()) + '"><td>' + esc(u.pi) + '</td><td>' + esc(u.nome) + (u.ativo ? '' : ' <span class="pill off">inativo</span>') + '</td><td>' + st + '</td>' +
            '<td class="small muted">' + esc((u.notas || '').slice(0, 60)) + (u.notas && u.notas.length > 60 ? '…' : '') + '</td>' +
            '<td><button class="btn sm" data-ed="' + u.id + '">' + (b ? 'Ver / alterar' : 'Criar') + '</button></td></tr>';
        }).join('') + (rows.length ? '' : '<tr><td colspan="5" class="muted">Ainda não há utentes.</td></tr>') + '</tbody></table></div>';
      wireWeekNav('wn', function () { tabMarcacoes(c); });
      document.getElementById('q').oninput = function (e) {
        var q = e.target.value.toLowerCase();
        c.querySelectorAll('#mt tbody tr').forEach(function (tr) { tr.classList.toggle('hidden', q && (tr.dataset.s || '').indexOf(q) < 0); });
      };
      c.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { editBooking(b.dataset.ed, function () { tabMarcacoes(c); }); }; });
    }).catch(adminErr);
  }

  function editBooking(uid, done) {
    var d = weekData, u = d.utentes.filter(function (x) { return x.id === uid; })[0];
    var b = d.bookings[uid] || { dados: {}, notaAdmin: '' };
    var meals = d.meals.filter(function (m) { return m.active || d.days.some(function (day) { return b.dados[day] && b.dados[day][m.id]; }); });
    var h = '<h2>' + esc(u.nome) + ' <span class="muted small">PI ' + esc(u.pi) + '</span></h2>' +
      '<label class="f" for="un">Notas gerais do utente (visíveis para o utente)</label><textarea id="un" maxlength="2000">' + esc(u.notas) + '</textarea>' +
      '<p class="small muted">Semana ' + esc(ptDM(d.days[0])) + ' a ' + esc(ptDM(d.days[6])) +
      (b.submetidoEm ? ' · submetida pelo utente em ' + esc(fmtStamp(b.submetidoEm)) : '') + (b.atualizadoEm && b.atualizadoPor === 'admin' ? ' · última alteração do admin em ' + esc(fmtStamp(b.atualizadoEm)) : '') + '</p>' +
      '<div class="tablewrap edit-grid"><table class="t"><thead><tr><th>Refeição</th>' + d.days.map(function (day) { return '<th>' + esc(ptShort(day)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      meals.map(function (m) {
        return '<tr><td><b>' + esc(m.label) + '</b></td>' + d.days.map(function (day) {
          var sel = b.dados[day] && b.dados[day][m.id];
          var opts = '<option value="">—</option>' + m.options.filter(function (o) { return o.active || (sel && sel.o === o.id); })
            .map(function (o) { return '<option value="' + esc(o.id) + '"' + (sel && sel.o === o.id ? ' selected' : '') + (o.special ? ' data-sp="1"' : '') + '>' + esc(o.label) + '</option>'; }).join('');
          var isSp = sel && findOpt(m, sel.o) && findOpt(m, sel.o).special;
          return '<td data-day="' + day + '" data-meal="' + esc(m.id) + '"><select>' + opts + '</select><input type="text" maxlength="200" placeholder="Pedido especial" class="' + (isSp ? '' : 'hidden') + '" value="' + esc(sel ? sel.t : '') + '"></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<label class="f" for="na">Nota do administrador para esta semana (interna)</label><textarea id="na" maxlength="1000">' + esc(b.notaAdmin) + '</textarea>' +
      '<div class="modal-actions">' + (d.bookings[uid] ? '<button class="btn danger" id="bdel" style="margin-inline-end:auto">Eliminar marcação</button>' : '') +
      '<button class="btn" id="bcan">Fechar</button><button class="btn primary" id="bsave">Guardar</button></div>';
    openModal(h, true);
    $modalBox.querySelectorAll('td[data-day] select').forEach(function (s) {
      s.onchange = function () {
        var inp = s.nextElementSibling, sp = s.selectedOptions[0] && s.selectedOptions[0].dataset.sp;
        inp.classList.toggle('hidden', !sp); if (sp) inp.focus();
      };
    });
    document.getElementById('bcan').onclick = closeModal;
    var del = document.getElementById('bdel');
    if (del) del.onclick = function () {
      confirmBox('Eliminar marcação', 'Eliminar a marcação de ' + u.nome + ' para esta semana? Se as marcações estiverem abertas, o utente poderá submeter de novo.', 'Eliminar', true).then(function (ok) {
        if (!ok) return editBooking(uid, done);
        api('aDeleteBooking', { utenteId: uid, weekStart: d.weekStart }, 'a').then(function () { toast('Marcação eliminada.'); done(); }).catch(adminErr);
      });
    };
    document.getElementById('bsave').onclick = function () {
      var dados = {};
      $modalBox.querySelectorAll('td[data-day]').forEach(function (td) {
        var v = td.querySelector('select').value; if (!v) return;
        dados[td.dataset.day] = dados[td.dataset.day] || {};
        dados[td.dataset.day][td.dataset.meal] = { o: v, t: td.querySelector('input').classList.contains('hidden') ? '' : td.querySelector('input').value.trim() };
      });
      var notas = document.getElementById('un').value;
      var btn = this; btn.disabled = true;
      var p = [api('aSaveBooking', { utenteId: uid, weekStart: d.weekStart, dados: dados, notaAdmin: document.getElementById('na').value }, 'a')];
      if (notas !== u.notas) p.push(api('aUpdateUtente', { id: uid, notas: notas }, 'a'));
      Promise.all(p).then(function () { closeModal(); toast('Guardado.'); done(); }).catch(function (e) { btn.disabled = false; adminErr(e); });
    };
  }

  /* ---------- Resumos / PDF ---------- */
  var reportMode = 'semanal', reportDay = null;
  function tabResumos(c) {
    c.innerHTML = '<div class="spinner"></div>';
    loadWeek().then(function (d) {
      if (!reportDay || d.days.indexOf(reportDay) < 0) reportDay = d.days[0];
      c.innerHTML = weekNav(d.weekStart, 'wn') +
        '<div class="card no-print"><div class="row">' +
        '<label class="check"><input type="radio" name="rm" value="semanal"' + (reportMode === 'semanal' ? ' checked' : '') + '> Resumo semanal</label>' +
        '<label class="check"><input type="radio" name="rm" value="diario"' + (reportMode === 'diario' ? ' checked' : '') + '> Resumo diário</label>' +
        '<select id="rday" class="grow" style="max-width:260px"' + (reportMode === 'diario' ? '' : ' disabled') + '>' + d.days.map(function (x) { return '<option value="' + x + '"' + (x === reportDay ? ' selected' : '') + '>' + esc(ptDay(x)) + '</option>'; }).join('') + '</select>' +
        '<span class="grow"></span><button class="btn" id="rprint">Imprimir</button><button class="btn primary" id="rpdf">Exportar PDF</button></div></div>' +
        '<div id="report" class="paper">' + (reportMode === 'semanal' ? reportWeekly(d) : reportDaily(d, reportDay)) + '</div>';
      wireWeekNav('wn', function () { tabResumos(c); });
      c.querySelectorAll('input[name=rm]').forEach(function (r) { r.onchange = function () { reportMode = r.value; tabResumos(c); }; });
      document.getElementById('rday').onchange = function (e) { reportDay = e.target.value; tabResumos(c); };
      document.getElementById('rprint').onclick = function () { window.print(); };
      document.getElementById('rpdf').onclick = function () {
        var name = reportMode === 'semanal' ? 'resumo-semanal-' + d.weekStart : 'resumo-diario-' + reportDay;
        exportPdf(document.getElementById('report'), name, reportMode === 'semanal' ? 'landscape' : 'portrait');
      };
    }).catch(adminErr);
  }

  function activeBookings(d) {
    var byId = {}; d.utentes.forEach(function (u) { byId[u.id] = u; });
    return Object.keys(d.bookings).filter(function (id) { return byId[id]; }).map(function (id) { return { u: byId[id], b: d.bookings[id] }; })
      .sort(function (a, b) { return a.u.nome.localeCompare(b.u.nome, 'pt'); });
  }
  function usedMeals(d) {
    return d.meals.filter(function (m) { return m.active || activeBookings(d).some(function (x) { return d.days.some(function (day) { return x.b.dados[day] && x.b.dados[day][m.id]; }); }); });
  }
  function selText(m, sel) {
    if (!sel) return '—';
    var o = findOpt(m, sel.o);
    return (o ? o.label : sel.o) + (sel.t ? ': ' + sel.t : '');
  }
  function reportHeader(title, sub) {
    var now = new Date();
    return '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-end;border-bottom:2px solid #0f5c4d;padding-bottom:8px;margin-bottom:10px">' +
      '<div><h1>' + esc(title) + '</h1><div>' + esc(sub) + '</div></div><div class="small" style="text-align:end;color:#555">Marcação de Refeições<br>Emitido em ' +
      esc(now.toLocaleDateString('pt-PT') + ' ' + now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })) + '</div></div>';
  }
  function countsTable(d, days, meals, list) {
    var h = '<table><thead><tr><th>Refeição</th><th>Opção</th>' + days.map(function (x) { return '<th class="num">' + esc(ptShort(x)) + '</th>'; }).join('') + (days.length > 1 ? '<th class="num">Total</th>' : '') + '</tr></thead><tbody>';
    meals.forEach(function (m) {
      var opts = m.options.filter(function (o) { return o.active || list.some(function (x) { return days.some(function (day) { var s = x.b.dados[day] && x.b.dados[day][m.id]; return s && s.o === o.id; }); }); });
      var totals = days.map(function () { return 0; });
      opts.forEach(function (o, i) {
        var tot = 0;
        h += '<tr>' + (i === 0 ? '<td rowspan="' + (opts.length + 1) + '"><b>' + esc(m.label) + '</b></td>' : '') + '<td>' + esc(o.label) + '</td>';
        days.forEach(function (day, k) {
          var n = list.filter(function (x) { var s = x.b.dados[day] && x.b.dados[day][m.id]; return s && s.o === o.id; }).length;
          tot += n; totals[k] += n;
          h += '<td class="num">' + (n || '') + '</td>';
        });
        h += (days.length > 1 ? '<td class="num"><b>' + (tot || '') + '</b></td>' : '') + '</tr>';
      });
      h += '<tr class="total"><td>Total ' + esc(m.label.toLowerCase()) + '</td>' + totals.map(function (n) { return '<td class="num">' + n + '</td>'; }).join('') +
        (days.length > 1 ? '<td class="num">' + totals.reduce(function (a, b) { return a + b; }, 0) + '</td>' : '') + '</tr>';
    });
    return h + '</tbody></table>';
  }
  function specialsTable(d, days, meals, list) {
    var rows = [];
    days.forEach(function (day) {
      meals.forEach(function (m) {
        list.forEach(function (x) {
          var s = x.b.dados[day] && x.b.dados[day][m.id], o = s && findOpt(m, s.o);
          if (s && o && o.special) rows.push('<tr><td>' + esc(ptShort(day)) + '</td><td>' + esc(m.label) + '</td><td>' + esc(x.u.pi) + '</td><td>' + esc(x.u.nome) + '</td><td class="sp">' + esc(s.t) + '</td></tr>');
        });
      });
    });
    return rows.length ? '<table><thead><tr><th>Dia</th><th>Refeição</th><th>PI</th><th>Utente</th><th>Pedido</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' : '<p>Sem pedidos especiais.</p>';
  }
  function notesBlock(d, days, list) {
    var dn = days.filter(function (x) { return d.dayNotes[x]; });
    var an = list.filter(function (x) { return x.b.notaAdmin; });
    var un = list.filter(function (x) { return x.u.notas; });
    var h = '';
    if (dn.length) h += '<h2>Notas do dia</h2><table><tbody>' + dn.map(function (x) { return '<tr><td style="width:160px">' + esc(ptDay(x)) + '</td><td>' + esc(d.dayNotes[x]) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (un.length || an.length) {
      h += '<h2>Notas dos utentes</h2><table><thead><tr><th>PI</th><th>Utente</th><th>Notas gerais</th><th>Nota da semana</th></tr></thead><tbody>' +
        list.filter(function (x) { return x.u.notas || x.b.notaAdmin; }).map(function (x) {
          return '<tr><td>' + esc(x.u.pi) + '</td><td>' + esc(x.u.nome) + '</td><td style="white-space:pre-wrap">' + esc(x.u.notas) + '</td><td style="white-space:pre-wrap">' + esc(x.b.notaAdmin) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return h;
  }
  function missingBlock(d) {
    var miss = d.utentes.filter(function (u) { return u.ativo && !d.bookings[u.id]; }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt'); });
    return '<h2>Utentes ativos sem marcação (' + miss.length + ')</h2>' + (miss.length ? '<p>' + miss.map(function (u) { return esc(u.nome) + ' (' + esc(u.pi) + ')'; }).join(' · ') + '</p>' : '<p>Todos os utentes ativos têm marcação.</p>');
  }
  function reportWeekly(d) {
    var list = activeBookings(d), meals = usedMeals(d);
    var h = reportHeader('Resumo semanal de refeições', 'Semana de ' + ptDM(d.days[0]) + ' a ' + ptDM(d.days[6]) + ' · ' + list.length + ' utentes com marcação');
    h += '<h2>Totais por dia</h2>' + countsTable(d, d.days, meals, list);
    h += '<h2>Pedidos especiais</h2>' + specialsTable(d, d.days, meals, list);
    h += notesBlock(d, d.days, list);
    h += '<h2>Marcações por utente</h2><table><thead><tr><th>Utente</th>' + d.days.map(function (x) { return '<th>' + esc(ptShort(x)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr><td><b>' + esc(x.u.nome) + '</b><br>' + esc(x.u.pi) + '</td>' + d.days.map(function (day) {
          return '<td>' + meals.map(function (m) { var s = x.b.dados[day] && x.b.dados[day][m.id]; return s ? '<div><b>' + esc(m.label.slice(0, 3)) + '.</b> ' + esc(selText(m, s)) + '</div>' : ''; }).join('') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    h += missingBlock(d);
    return h;
  }
  function reportDaily(d, day) {
    var list = activeBookings(d), meals = usedMeals(d);
    var h = reportHeader('Resumo diário de refeições', ptDay(day) + ' de ' + parseD(day).getUTCFullYear());
    if (d.dayNotes[day]) h += '<p><b>Nota do dia:</b> ' + esc(d.dayNotes[day]) + '</p>';
    h += '<h2>Totais</h2>' + countsTable(d, [day], meals, list);
    h += '<h2>Pedidos especiais</h2>' + specialsTable(d, [day], meals, list);
    h += '<h2>Marcações por utente</h2><table><thead><tr><th>PI</th><th>Utente</th>' + meals.map(function (m) { return '<th>' + esc(m.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      list.map(function (x) {
        return '<tr><td>' + esc(x.u.pi) + '</td><td>' + esc(x.u.nome) + '</td>' + meals.map(function (m) {
          var s = x.b.dados[day] && x.b.dados[day][m.id], o = s && findOpt(m, s.o);
          return '<td' + (o && o.special ? ' class="sp"' : '') + '>' + esc(selText(m, s)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    h += notesBlock(d, [day], list.filter(function (x) { return x.u.notas || x.b.notaAdmin; }));
    h += missingBlock(d);
    return h;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function exportPdf(el, name, orientation) {
    toast('A gerar PDF…');
    var go = window.html2pdf ? Promise.resolve() : loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
    go.then(function () {
      return window.html2pdf().set({
        margin: [8, 8, 10, 8], filename: name + '.pdf',
        image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: orientation }, pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' }
      }).from(el).save();
    }).then(function () { toast('PDF exportado.'); }).catch(function () { toast('Não foi possível gerar o PDF. Use "Imprimir" → Guardar como PDF.', true); });
  }

  /* ---------- Utentes ---------- */
  function tabUtentes(c) {
    c.innerHTML = '<div class="spinner"></div>';
    api('aListUtentes', {}, 'a').then(function (r) {
      var list = r.utentes.sort(function (a, b) { return (b.ativo - a.ativo) || a.nome.localeCompare(b.nome, 'pt'); });
      var act = list.filter(function (u) { return u.ativo; }).length;
      c.innerHTML = '<div class="row" style="margin-bottom:12px"><button class="btn primary" id="nu"' + (act >= r.max ? ' disabled' : '') + '>+ Novo utente</button>' +
        '<span class="pill ' + (act >= r.max ? 'warn' : 'ok') + '">' + act + ' / ' + r.max + ' ativos</span>' +
        '<input type="search" id="q" class="grow" placeholder="Procurar por nome ou PI…"></div>' +
        (act >= r.max ? '<div class="banner warn">Limite de ' + r.max + ' utentes ativos atingido. Desative ou elimine utentes que saíram para libertar lugares.</div>' : '') +
        '<div class="tablewrap"><table class="t" id="ut"><thead><tr><th>PI</th><th>Nome</th><th>Estado</th><th>Notas gerais</th><th>Ações</th></tr></thead><tbody>' +
        list.map(function (u) {
          return '<tr data-s="' + esc((u.nome + ' ' + u.pi).toLowerCase()) + '"><td><b>' + esc(u.pi) + '</b></td><td>' + esc(u.nome) + '</td><td>' + (u.ativo ? '<span class="pill ok">ativo</span>' : '<span class="pill off">inativo</span>') + '</td>' +
            '<td class="small" style="max-width:280px;white-space:pre-wrap">' + esc(u.notas) + '</td>' +
            '<td><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-e="' + u.id + '">Editar</button><button class="btn sm" data-p="' + u.id + '">Novo PIN</button><button class="btn sm danger" data-d="' + u.id + '">Eliminar</button></div></td></tr>';
        }).join('') + (list.length ? '' : '<tr><td colspan="5" class="muted">Ainda não há utentes. Crie o primeiro com "+ Novo utente".</td></tr>') + '</tbody></table></div>';
      document.getElementById('q').oninput = function (e) {
        var q = e.target.value.toLowerCase();
        c.querySelectorAll('#ut tbody tr').forEach(function (tr) { tr.classList.toggle('hidden', q && (tr.dataset.s || '').indexOf(q) < 0); });
      };
      var byId = {}; list.forEach(function (u) { byId[u.id] = u; });
      var reload = function () { tabUtentes(c); };
      document.getElementById('nu').onclick = function () { utenteForm(null, reload); };
      c.querySelectorAll('[data-e]').forEach(function (b) { b.onclick = function () { utenteForm(byId[b.dataset.e], reload); }; });
      c.querySelectorAll('[data-p]').forEach(function (b) {
        b.onclick = function () {
          var u = byId[b.dataset.p];
          confirmBox('Gerar novo PIN', 'Gerar um novo PIN para ' + u.nome + '? O PIN atual deixa de funcionar.', 'Gerar PIN').then(function (ok) {
            if (ok) api('aResetPin', { id: u.id }, 'a').then(function (r) { showPin(r.utente, r.pin); }).catch(adminErr);
          });
        };
      });
      c.querySelectorAll('[data-d]').forEach(function (b) {
        b.onclick = function () {
          var u = byId[b.dataset.d];
          confirmBox('Eliminar utente', 'Eliminar definitivamente ' + u.nome + ' (PI ' + u.pi + ') e todas as suas marcações?\n\nSe preferir manter o histórico, edite o utente e desative-o.', 'Eliminar', true).then(function (ok) {
            if (ok) api('aDeleteUtente', { id: u.id }, 'a').then(function () { toast('Utente eliminado.'); reload(); }).catch(adminErr);
          });
        };
      });
    }).catch(adminErr);
  }

  function utenteForm(u, done) {
    openModal('<h2>' + (u ? 'Editar utente' : 'Novo utente') + '</h2><form id="uf">' +
      '<div class="grid2"><div><label class="f" for="fpi">Número de PI *</label><input id="fpi" type="text" required maxlength="30" value="' + esc(u ? u.pi : '') + '" autofocus></div>' +
      '<div><label class="f" for="fn">Nome *</label><input id="fn" type="text" required maxlength="80" value="' + esc(u ? u.nome : '') + '"></div></div>' +
      '<label class="f" for="fno">Notas gerais (aparecem no topo da página do utente)</label><textarea id="fno" maxlength="2000">' + esc(u ? u.notas : '') + '</textarea>' +
      (u ? '<label class="check" style="margin-top:12px"><input type="checkbox" id="fat"' + (u.ativo ? ' checked' : '') + '> Utente ativo (pode entrar e fazer marcações)</label>' : '<p class="small muted">O PIN é gerado automaticamente e mostrado a seguir.</p>') +
      '<div class="modal-actions"><button type="button" class="btn" id="fc">Cancelar</button><button class="btn primary" id="fs">' + (u ? 'Guardar' : 'Criar utente') + '</button></div></form>');
    document.getElementById('fc').onclick = closeModal;
    document.getElementById('uf').onsubmit = function (e) {
      e.preventDefault();
      var btn = document.getElementById('fs'); btn.disabled = true;
      var data = { pi: document.getElementById('fpi').value, nome: document.getElementById('fn').value, notas: document.getElementById('fno').value };
      var p = u ? api('aUpdateUtente', Object.assign({ id: u.id, ativo: document.getElementById('fat').checked }, data), 'a') : api('aCreateUtente', data, 'a');
      p.then(function (r) {
        done();
        if (u) { closeModal(); toast('Utente atualizado.'); } else showPin(r.utente, r.pin);
      }).catch(function (e) { btn.disabled = false; adminErr(e); });
    };
  }

  function appUrl() { return location.href.split('#')[0].split('?')[0]; }

  function showPin(u, pin) {
    openModal('<h2>PIN de acesso</h2><p><b>' + esc(u.nome) + '</b> · PI ' + esc(u.pi) + '</p>' +
      '<div class="pinbox" aria-label="PIN">' + esc(pin) + '</div>' +
      '<p class="small muted">Entregue este PIN ao utente. Por segurança, o PIN não volta a ser mostrado; se for esquecido, gere um novo.</p>' +
      '<div class="modal-actions"><button class="btn" id="pc">Imprimir cartão</button><button class="btn primary" id="pok" autofocus>Concluído</button></div>');
    $modal.dataset.locked = '1';
    document.getElementById('pok').onclick = function () { delete $modal.dataset.locked; closeModal(); };
    document.getElementById('pc').onclick = function () { printCard(u, pin); };
  }

  function qrDataUrl(text, size) {
    if (!window.qrcode) return '';
    var q = window.qrcode(0, 'M'); q.addData(text); q.make();
    var n = q.getModuleCount(), quiet = 4, cell = Math.max(1, Math.floor(size / (n + quiet * 2)));
    var px = cell * (n + quiet * 2), cv = document.createElement('canvas');
    cv.width = cv.height = px;
    var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    return cv.toDataURL('image/png');
  }

  function printCard(u, pin) {
    var qr = qrDataUrl(appUrl(), 220);
    var w = window.open('', '_blank');
    if (!w) return toast('Permita janelas pop-up para imprimir.', true);
    w.document.write('<!doctype html><meta charset="utf-8"><title>Cartão de acesso</title><style>body{font-family:system-ui,Arial,sans-serif;margin:24px}' +
      '.c{border:2px solid #0f5c4d;border-radius:14px;padding:18px;width:340px;text-align:center}h1{font-size:18px;color:#0f5c4d;margin:0 0 8px}' +
      '.k{font-size:13px;color:#555;margin-top:10px}.v{font-size:26px;font-weight:800;letter-spacing:.12em}</style>' +
      '<div class="c"><h1>Marcação de Refeições</h1>' + (qr ? '<img src="' + qr + '" width="180" height="180">' : '') +
      '<div class="k">Nome</div><div style="font-weight:700">' + esc(u.nome) + '</div><div class="k">Número de PI</div><div class="v">' + esc(u.pi) + '</div>' +
      '<div class="k">PIN</div><div class="v">' + esc(pin) + '</div><div class="k">Marcações: domingo 08h00–23h59</div></div>' +
      '<script>setTimeout(function(){print()},300)<\/script>');
    w.document.close();
  }

  /* ---------- Refeições e opções ---------- */
  function slug(s, used) {
    var b = String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'item';
    var id = b, i = 2; while (used[id]) id = b + '_' + i++;
    used[id] = 1; return id;
  }
  function tabRefeicoes(c) {
    c.innerHTML = '<div class="spinner"></div>';
    api('aGetConfig', {}, 'a').then(function (cfg) {
      var meals = JSON.parse(JSON.stringify(cfg.meals));
      function render() {
        c.innerHTML = '<div class="banner info"><div>Ative/desative refeições e opções, altere nomes ou acrescente novas. Opções marcadas como <b>especial</b> abrem uma caixa de texto para o utente descrever o pedido. As alterações aplicam-se às marcações seguintes.</div></div>' +
          meals.map(function (m, i) {
            return '<div class="meal-edit" data-i="' + i + '"><div class="row"><input type="text" class="grow" data-f="label" value="' + esc(m.label) + '" maxlength="40" aria-label="Nome da refeição" style="font-weight:700">' +
              '<label class="check"><input type="checkbox" data-f="active"' + (m.active ? ' checked' : '') + '> Ativa</label>' +
              '<button class="btn sm" data-mv="-1" title="Subir">↑</button><button class="btn sm" data-mv="1" title="Descer">↓</button><button class="btn sm danger" data-rm>Remover</button></div>' +
              '<div class="small muted" style="margin-top:8px">Opções</div>' +
              m.options.map(function (o, j) {
                return '<div class="opt-row" data-j="' + j + '"><input type="text" data-o="label" value="' + esc(o.label) + '" maxlength="40" aria-label="Nome da opção">' +
                  '<label class="check small"><input type="checkbox" data-o="special"' + (o.special ? ' checked' : '') + '> especial</label>' +
                  '<label class="check small"><input type="checkbox" data-o="active"' + (o.active ? ' checked' : '') + '> ativa</label>' +
                  '<button class="btn sm ghost" data-orm title="Remover opção" aria-label="Remover opção">✕</button></div>';
              }).join('') +
              '<button class="btn sm" data-oadd style="margin-top:8px">+ Opção</button></div>';
          }).join('') +
          '<div class="row"><button class="btn" id="madd">+ Nova refeição</button><span class="grow"></span><button class="btn primary" id="msave">Guardar alterações</button></div>';
        c.querySelectorAll('.meal-edit').forEach(function (el) {
          var m = meals[+el.dataset.i];
          el.querySelector('[data-f=label]').oninput = function (e) { m.label = e.target.value; };
          el.querySelector('[data-f=active]').onchange = function (e) { m.active = e.target.checked; };
          el.querySelectorAll('[data-mv]').forEach(function (b) {
            b.onclick = function () { var i = +el.dataset.i, j = i + +b.dataset.mv; if (j < 0 || j >= meals.length) return; var t = meals[i]; meals[i] = meals[j]; meals[j] = t; render(); };
          });
          el.querySelector('[data-rm]').onclick = function () {
            confirmBox('Remover refeição', 'Remover "' + m.label + '"? Para apenas deixar de a mostrar, desative-a.', 'Remover', true).then(function (ok) { if (ok) { meals.splice(+el.dataset.i, 1); } render(); });
          };
          el.querySelectorAll('.opt-row').forEach(function (r) {
            var o = m.options[+r.dataset.j];
            r.querySelector('[data-o=label]').oninput = function (e) { o.label = e.target.value; };
            r.querySelector('[data-o=special]').onchange = function (e) { o.special = e.target.checked; };
            r.querySelector('[data-o=active]').onchange = function (e) { o.active = e.target.checked; };
            r.querySelector('[data-orm]').onclick = function () { m.options.splice(+r.dataset.j, 1); render(); };
          });
          el.querySelector('[data-oadd]').onclick = function () { m.options.push({ id: '', label: '', active: true, special: false }); render(); };
        });
        document.getElementById('madd').onclick = function () {
          meals.push({ id: '', label: 'Nova refeição', active: true, options: [{ id: '', label: 'Sim', active: true }, { id: '', label: 'Não', active: true }, { id: '', label: 'Especial', active: true, special: true }] });
          render();
        };
        document.getElementById('msave').onclick = function () {
          var used = {};
          meals.forEach(function (m) { if (m.id) used[m.id] = 1; });
          var out = meals.map(function (m) {
            var ou = {}; m.options.forEach(function (o) { if (o.id) ou[o.id] = 1; });
            var mm = { id: m.id || slug(m.label, used), key: m.key || '', label: m.label.trim(), active: m.active,
              options: m.options.filter(function (o) { return o.label.trim(); }).map(function (o) {
                var oo = { id: o.id || slug(o.label, ou), key: o.key || '', label: o.label.trim(), active: o.active, special: !!o.special };
                if (oo.key && I18N.pt[oo.key] !== oo.label) oo.key = ''; // nome alterado → deixa de usar a tradução automática
                return oo;
              }) };
            if (mm.key && I18N.pt[mm.key] !== mm.label) mm.key = '';
            return mm;
          });
          api('aSaveConfig', { meals: out }, 'a').then(function (r) { meals = JSON.parse(JSON.stringify(r.meals)); render(); toast('Refeições guardadas.'); }).catch(adminErr);
        };
      }
      render();
    }).catch(adminErr);
  }

  /* ---------- Regras, horários e notas ---------- */
  function tabRegras(c) {
    c.innerHTML = '<div class="spinner"></div>';
    Promise.all([api('aGetConfig', {}, 'a'), loadWeek()]).then(function (res) {
      var cfg = res[0], d = res[1], s = cfg.schedule;
      c.innerHTML = '<div class="card"><h2>Horário das marcações</h2>' +
        '<p class="small muted">Os utentes marcam no dia de abertura, para a semana seguinte (segunda a domingo). Hora de Portugal continental.</p>' +
        '<div class="grid2"><div><label class="f" for="od">Dia de abertura</label><select id="od">' + DAYNAMES.map(function (n, i) { return '<option value="' + i + '"' + (i === s.openDay ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
        '<div class="grid2"><div><label class="f" for="ot">Abre às</label><input type="time" id="ot" value="' + esc(s.openTime) + '"></div><div><label class="f" for="ct">Fecha às</label><input type="time" id="ct" value="' + esc(s.closeTime) + '"></div></div></div>' +
        '<label class="check" style="margin-top:14px"><input type="checkbox" id="mo"' + (cfg.manualOpen ? ' checked' : '') + '> Abrir marcações manualmente agora (exceção — ex.: feriado ou problema técnico). Desative depois!</label>' +
        '<div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn primary" id="ssave">Guardar horário</button></div></div>' +
        '<div class="card"><h2>Regras e avisos para os utentes</h2><p class="small muted">Texto mostrado a todos os utentes na página de marcação.</p>' +
        '<textarea id="rules" maxlength="4000" style="min-height:130px">' + esc(cfg.rules) + '</textarea>' +
        '<div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn primary" id="rsave">Guardar regras</button></div></div>' +
        '<div class="card"><h2>Notas por dia</h2><p class="small muted">Ex.: "Feriado — almoço especial", "Jantar às 18h30". Visíveis aos utentes e nos resumos.</p>' +
        weekNav(d.weekStart, 'wn') +
        d.days.map(function (x) { return '<label class="f" for="dn_' + x + '" style="text-transform:capitalize">' + esc(ptDay(x)) + '</label><input type="text" id="dn_' + x + '" data-d="' + x + '" maxlength="500" value="' + esc(d.dayNotes[x] || '') + '">'; }).join('') +
        '<div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn primary" id="dsave">Guardar notas</button></div></div>';
      wireWeekNav('wn', function () { tabRegras(c); });
      document.getElementById('ssave').onclick = function () {
        api('aSaveConfig', { schedule: { openDay: +document.getElementById('od').value, openTime: document.getElementById('ot').value, closeTime: document.getElementById('ct').value }, manualOpen: document.getElementById('mo').checked }, 'a')
          .then(function () { toast('Horário guardado.'); }).catch(adminErr);
      };
      document.getElementById('rsave').onclick = function () {
        api('aSaveConfig', { rules: document.getElementById('rules').value }, 'a').then(function () { toast('Regras guardadas.'); }).catch(adminErr);
      };
      document.getElementById('dsave').onclick = function () {
        var inputs = Array.prototype.slice.call(c.querySelectorAll('[data-d]'));
        var changed = inputs.filter(function (i) { return (d.dayNotes[i.dataset.d] || '') !== i.value.trim(); });
        if (!changed.length) return toast('Sem alterações.');
        changed.reduce(function (p, i) { return p.then(function () { return api('aSaveDayNote', { date: i.dataset.d, text: i.value }, 'a'); }); }, Promise.resolve())
          .then(function () { toast('Notas guardadas.'); tabRegras(c); }).catch(adminErr);
      };
    }).catch(adminErr);
  }

  /* ---------- Definições ---------- */
  function tabDefinicoes(c) {
    var url = appUrl();
    c.innerHTML = '<div class="grid2" style="align-items:start"><div class="card"><h2>QR code de acesso</h2><p class="small muted">Um único QR code para todos os utentes e para o administrador.</p>' +
      '<div class="qrwrap" id="qr"></div><p class="small" style="word-break:break-all;margin-top:10px"><a href="' + esc(url) + '">' + esc(url) + '</a></p>' +
      '<div class="row"><button class="btn" id="qdl">Descarregar PNG</button><button class="btn" id="qpr">Imprimir cartaz</button></div></div>' +
      '<div class="card"><h2>Alterar password do administrador</h2><form id="pf">' +
      '<label class="f" for="pcur">Password atual</label><input type="password" id="pcur" autocomplete="current-password" required>' +
      '<label class="f" for="pnew">Nova password (mín. 6 caracteres)</label><input type="password" id="pnew" autocomplete="new-password" required minlength="6">' +
      '<label class="f" for="pnew2">Repetir nova password</label><input type="password" id="pnew2" autocomplete="new-password" required minlength="6">' +
      '<div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn primary">Alterar password</button></div></form></div></div>' +
      '<div class="card"><h2>Registo de atividade</h2><div id="lg"><div class="spinner"></div></div></div>';
    var qr = qrDataUrl(url, 300);
    document.getElementById('qr').innerHTML = qr ? '<img src="' + qr + '" width="260" height="260" alt="QR code">' : '<p class="muted">QR indisponível (sem ligação à internet).</p>';
    document.getElementById('qdl').onclick = function () { var a = document.createElement('a'); a.href = qrDataUrl(url, 1000); a.download = 'qrcode-marcacao-refeicoes.png'; a.click(); };
    document.getElementById('qpr').onclick = function () {
      var w = window.open('', '_blank'); if (!w) return toast('Permita janelas pop-up para imprimir.', true);
      w.document.write('<!doctype html><meta charset="utf-8"><title>QR code</title><style>body{font-family:system-ui,Arial,sans-serif;text-align:center;padding:40px}h1{color:#0f5c4d;font-size:34px}p{font-size:20px}</style>' +
        '<h1>Marcação de Refeições</h1><p>Leia o código com a câmara do telemóvel</p><img src="' + qrDataUrl(url, 700) + '" width="420" height="420"><p>Marcações ao domingo, das 08h00 às 23h59</p><p style="font-size:14px;color:#555">' + esc(url) + '</p><script>setTimeout(function(){print()},300)<\/script>');
      w.document.close();
    };
    document.getElementById('pf').onsubmit = function (e) {
      e.preventDefault();
      var n1 = document.getElementById('pnew').value, n2 = document.getElementById('pnew2').value;
      if (n1 !== n2) return toast('As novas passwords não coincidem.', true);
      api('aChangePassword', { current: document.getElementById('pcur').value, next: n1 }, 'a').then(function () { e.target.reset(); toast('Password alterada.'); }).catch(adminErr);
    };
    api('aSaveConfig', { appUrl: url }, 'a').catch(function () {});
    api('aLog', {}, 'a').then(function (r) {
      document.getElementById('lg').innerHTML = r.log.length ? '<div class="tablewrap" style="max-height:360px;overflow:auto"><table class="t"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>' +
        r.log.map(function (x) { return '<tr><td style="white-space:nowrap">' + esc(x.quando) + '</td><td>' + esc(x.quem) + '</td><td>' + esc(x.acao) + '</td><td>' + esc(x.detalhe) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">Sem registos.</p>';
    }).catch(adminErr);
  }

  /* ---------------- arranque ---------------- */
  router();
})();
