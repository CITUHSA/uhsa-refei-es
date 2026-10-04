/**
 * Marcação de Refeições — Backend (Google Apps Script)
 * ----------------------------------------------------
 * Guarda todos os dados numa folha de cálculo Google privada da conta proprietária.
 * Separação de dados:
 *   - Ações de utente ("u*") só leem/escrevem os dados do próprio utente autenticado.
 *   - Ações de administrador ("a*") exigem sessão de administrador.
 *   - Hashes de PIN/password nunca saem do servidor.
 */

var TZ = 'Europe/Lisbon';
var MAX_UTENTES = 100;
var SESSION_TTL = 6 * 60 * 60;          // 6 horas
var ADMIN_USER = 'admin';
var DEFAULT_ADMIN_PASS = 'DEFINIR_NO_APPS_SCRIPT'; // a password inicial real fica apenas no Apps Script
var NOTIFY_EMAIL = 'servicouhsa@gmail.com';
var APP_URL = 'https://cituhsa.github.io/uhsa-refei-es/';

var SHEETS = {
  utentes:   ['id', 'pi', 'nome', 'pinHash', 'pinSalt', 'ativo', 'notas', 'criadoEm', 'atualizadoEm'],
  marcacoes: ['utenteId', 'semana', 'dados', 'notaAdmin', 'submetidoEm', 'atualizadoEm', 'atualizadoPor'],
  config:    ['chave', 'valor'],
  registo:   ['quando', 'quem', 'acao', 'detalhe']
};

var DEFAULT_MEALS = [
  { id: 'pa', key: 'meal.pa', label: 'Pequeno-almoço', active: true, options: [
    { id: 'cafe_leite', key: 'opt.cafe_leite', label: 'Café + leite', active: true },
    { id: 'cafe', key: 'opt.cafe', label: 'Café', active: true },
    { id: 'leite', key: 'opt.leite', label: 'Leite', active: true },
    { id: 'cereais', key: 'opt.cereais', label: 'Cereais', active: true },
    { id: 'especial', key: 'opt.especial', label: 'Especial', active: true, special: true }
  ]},
  { id: 'almoco', key: 'meal.almoco', label: 'Almoço', active: true, options: [
    { id: 'carne', key: 'opt.carne', label: 'Carne', active: true },
    { id: 'peixe', key: 'opt.peixe', label: 'Peixe', active: true },
    { id: 'dieta', key: 'opt.dieta', label: 'Dieta', active: true },
    { id: 'vegetariano', key: 'opt.vegetariano', label: 'Vegetariano', active: true },
    { id: 'especial', key: 'opt.especial', label: 'Especial', active: true, special: true }
  ]},
  { id: 'lanche', key: 'meal.lanche', label: 'Lanche', active: true, options: [
    { id: 'sim', key: 'opt.sim', label: 'Sim', active: true },
    { id: 'nao', key: 'opt.nao', label: 'Não', active: true },
    { id: 'especial', key: 'opt.especial', label: 'Especial', active: true, special: true }
  ]},
  { id: 'jantar', key: 'meal.jantar', label: 'Jantar', active: true, options: [
    { id: 'carne', key: 'opt.carne', label: 'Carne', active: true },
    { id: 'peixe', key: 'opt.peixe', label: 'Peixe', active: true },
    { id: 'dieta', key: 'opt.dieta', label: 'Dieta', active: true },
    { id: 'vegetariano', key: 'opt.vegetariano', label: 'Vegetariano', active: true },
    { id: 'especial', key: 'opt.especial', label: 'Especial', active: true, special: true }
  ]},
  { id: 'ceia', key: 'meal.ceia', label: 'Ceia', active: true, options: [
    { id: 'sim', key: 'opt.sim', label: 'Sim', active: true },
    { id: 'nao', key: 'opt.nao', label: 'Não', active: true },
    { id: 'especial', key: 'opt.especial', label: 'Especial', active: true, special: true }
  ]}
];

var DEFAULT_SCHEDULE = { openDay: 0, openTime: '08:00', closeTime: '23:59' };

/* ======================= HTTP ======================= */

function doGet() {
  return json({ ok: true, app: 'marcacao-refeicoes', now: nowLisbon() });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad_request' }); }
  try {
    var res = route(req || {});
    var out = { ok: true };
    for (var k in res) out[k] = res[k];
    return json(out);
  } catch (err) {
    if (!err.code) console.error(err && err.stack || err);
    return json({ ok: false, error: err.code || 'server_error' });
  } finally {
    _ss = null;
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail(code) { var e = new Error(code); e.code = code; throw e; }

var PUBLIC = { ping: 1, publicInfo: 1, login: 1, aLogin: 1 };
var UTENTE = { uState: 1, uSubmit: 1, logout: 1 };

function route(req) {
  var a = String(req.action || '');
  if (PUBLIC[a]) return ACTIONS[a](req);
  var s = getSession(req.token);
  if (!s) fail('session');
  if (a === 'logout') { CacheService.getScriptCache().remove('s_' + req.token); return {}; }
  if (UTENTE[a]) { if (s.role !== 'u') fail('forbidden'); return ACTIONS[a](req, s); }
  if (a.charAt(0) === 'a' && ACTIONS[a]) { if (s.role !== 'a') fail('forbidden'); touchSession(req.token, s); return ACTIONS[a](req, s); }
  fail('unknown_action');
}

/* ======================= Sessions & security ======================= */

function newSession(data) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('s_' + token, JSON.stringify(data), SESSION_TTL);
  return token;
}
function getSession(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  var v = CacheService.getScriptCache().get('s_' + token);
  return v ? JSON.parse(v) : null;
}
function touchSession(token, s) { CacheService.getScriptCache().put('s_' + token, JSON.stringify(s), SESSION_TTL); }

function hash(value, salt) {
  var h = salt + '|' + value;
  for (var i = 0; i < 300; i++) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8);
    h = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }
  return h;
}
function newSalt() { return Utilities.getUuid().replace(/-/g, ''); }

function randomPin() {
  var hex = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var n = parseInt(hex.slice(0, 12), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

function rateLimit(key, max) {
  var c = CacheService.getScriptCache();
  var n = parseInt(c.get('rl_' + key) || '0', 10);
  if (n >= max) fail('too_many');
  return function () { c.put('rl_' + key, String(n + 1), 900); };
}
function clearRate(key) { CacheService.getScriptCache().remove('rl_' + key); }

/* ======================= Storage ======================= */

var _ss = null;
function ss() {
  if (_ss) return _ss;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_ID');
  if (id) { try { _ss = SpreadsheetApp.openById(id); } catch (e) { _ss = null; } }
  if (!_ss) {
    _ss = SpreadsheetApp.create('Marcação de Refeições — DADOS (não partilhar)');
    props.setProperty('DB_ID', _ss.getId());
  }
  return _ss;
}
function sheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
    s.setFrozenRows(1);
  }
  return s;
}
function readAll(name) {
  var s = sheet(name), h = SHEETS[name];
  var last = s.getLastRow();
  if (last < 2) return [];
  var vals = s.getRange(2, 1, last - 1, h.length).getValues();
  return vals.map(function (r, i) {
    var o = { _row: i + 2 };
    h.forEach(function (k, j) { o[k] = r[j] === null || r[j] === undefined ? '' : String(r[j]); });
    return o;
  });
}
function toRow(name, obj) {
  return SHEETS[name].map(function (k) {
    var v = obj[k];
    if (v === undefined || v === null || v === '') return '';
    return "'" + String(v); // força texto (evita conversões automáticas de datas/números)
  });
}
function insertRow(name, obj) { sheet(name).appendRow(toRow(name, obj)); }
function updateRow(name, row, obj) { sheet(name).getRange(row, 1, 1, SHEETS[name].length).setValues([toRow(name, obj)]); }
function deleteRow(name, row) { sheet(name).deleteRow(row); }

function cfgAll() {
  var o = {};
  readAll('config').forEach(function (r) { o[r.chave] = { v: r.valor, row: r._row }; });
  return o;
}
function cfgGet(key, def) {
  var all = cfgAll();
  if (!all[key]) return def;
  try { return JSON.parse(all[key].v); } catch (e) { return def; }
}
function cfgSet(key, value) {
  var all = cfgAll();
  var obj = { chave: key, valor: JSON.stringify(value) };
  if (all[key]) updateRow('config', all[key].row, obj); else insertRow('config', obj);
}
function config() {
  var all = cfgAll();
  function g(k, d) { if (!all[k]) return d; try { return JSON.parse(all[k].v); } catch (e) { return d; } }
  return {
    meals: g('meals', DEFAULT_MEALS),
    schedule: g('schedule', DEFAULT_SCHEDULE),
    manualOpen: g('manualOpen', false),
    rules: g('rules', ''),
    dayNotes: g('dayNotes', {}),
    appUrl: g('appUrl', '')
  };
}

function log(who, action, detail) {
  try { insertRow('registo', { quando: nowLisbon().stamp, quem: who, acao: action, detalhe: detail || '' }); } catch (e) {}
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ======================= Time ======================= */

function nowLisbon() {
  var d = new Date();
  var date = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  var time = Utilities.formatDate(d, TZ, 'HH:mm');
  return { date: date, time: time, dow: dow(date), stamp: date + ' ' + Utilities.formatDate(d, TZ, 'HH:mm:ss') };
}
function parseD(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function fmtD(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { var d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); }
function dow(s) { return parseD(s).getUTCDay(); }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmtD(parseD(s)) === s; }
function weekDays(start) { var a = []; for (var i = 0; i < 7; i++) a.push(addDays(start, i)); return a; }
function mondayOf(s) { return addDays(s, -((dow(s) + 6) % 7)); }

function windowStatus(cfg) {
  var n = nowLisbon(), sch = cfg.schedule;
  var inWindow = n.dow === sch.openDay && n.time >= sch.openTime && n.time <= sch.closeTime;
  var delta = (sch.openDay - n.dow + 7) % 7;
  var openDate = addDays(n.date, delta);
  if (delta === 0 && n.time > sch.closeTime) openDate = addDays(n.date, 7);
  var toMon = (1 - dow(openDate) + 7) % 7 || 7;
  var weekStart = addDays(openDate, toMon);
  return {
    open: !!(inWindow || cfg.manualOpen), manual: !!cfg.manualOpen,
    today: n.date, now: n.time, openDate: openDate, openTime: sch.openTime, closeTime: sch.closeTime,
    weekStart: weekStart, days: weekDays(weekStart)
  };
}

/* ======================= Helpers ======================= */

function activeMeals(meals) {
  return meals.filter(function (m) { return m.active; }).map(function (m) {
    return { id: m.id, key: m.key || '', label: m.label, options: m.options.filter(function (o) { return o.active; })
      .map(function (o) { return { id: o.id, key: o.key || '', label: o.label, special: !!o.special }; }) };
  });
}
function cleanText(s, max) {
  return String(s || '').replace(/\r\n?/g, '\n').split('').map(function (c) { var k = c.charCodeAt(0); return k < 32 && k !== 10 ? ' ' : c; }).join('').trim().slice(0, max);
}
function sanitizeDados(dados, days, meals, strict) {
  var out = {};
  if (!dados || typeof dados !== 'object') return out;
  days.forEach(function (d) {
    var day = dados[d]; if (!day || typeof day !== 'object') return;
    meals.forEach(function (m) {
      var sel = day[m.id]; if (!sel || !sel.o) return;
      var opt = m.options.filter(function (o) { return o.id === sel.o && (o.active || !strict); })[0];
      if (!opt) { if (strict) fail('invalid_option'); return; }
      var t = opt.special ? cleanText(sel.t, 200) : '';
      if (opt.special && strict && !t) fail('special_text');
      out[d] = out[d] || {};
      out[d][m.id] = { o: opt.id, t: t };
    });
  });
  return out;
}
function publicUtente(u) {
  return { id: u.id, pi: u.pi, nome: u.nome, ativo: u.ativo === '1', notas: u.notas, criadoEm: u.criadoEm, atualizadoEm: u.atualizadoEm };
}
function findUtente(id) { return readAll('utentes').filter(function (u) { return u.id === id; })[0]; }
function countActive(list, exceptId) { return list.filter(function (u) { return u.ativo === '1' && u.id !== exceptId; }).length; }
function normPi(pi) { return cleanText(pi, 30).replace(/\s+/g, ''); }
function uniquePin(list) {
  for (var i = 0; i < 20; i++) {
    var pin = randomPin();
    var clash = list.some(function (u) { return u.ativo === '1' && u.pinSalt && hash(pin, u.pinSalt) === u.pinHash; });
    if (!clash) return pin;
  }
  return randomPin();
}
function ensureAdmin() {
  var all = cfgAll();
  if (!all.adminHash) {
    var salt = newSalt();
    cfgSet('adminSalt', salt);
    cfgSet('adminHash', hash(DEFAULT_ADMIN_PASS, salt));
  }
}

/* ======================= Actions ======================= */

var ACTIONS = {

  ping: function () { return { now: nowLisbon() }; },

  publicInfo: function () {
    var cfg = config();
    return { window: windowStatus(cfg) };
  },

  /* ---------- Utente ---------- */

  login: function (req) {
    var pi = normPi(req.pi), pin = String(req.pin || '').trim();
    if (!pi || !/^\d{4,8}$/.test(pin)) fail('login');
    var hit = rateLimit('u_' + pi.toLowerCase(), 6);
    var u = readAll('utentes').filter(function (x) { return x.ativo === '1' && x.pi.toLowerCase() === pi.toLowerCase(); })[0];
    if (!u || hash(pin, u.pinSalt) !== u.pinHash) { hit(); fail('login'); }
    clearRate('u_' + pi.toLowerCase());
    return { token: newSession({ role: 'u', uid: u.id }), nome: u.nome };
  },

  uState: function (req, s) {
    var u = findUtente(s.uid);
    if (!u || u.ativo !== '1') fail('session');
    var cfg = config(), w = windowStatus(cfg);
    var b = readAll('marcacoes').filter(function (m) { return m.utenteId === u.id && m.semana === w.weekStart; })[0];
    var notes = {};
    w.days.forEach(function (d) { if (cfg.dayNotes[d]) notes[d] = cfg.dayNotes[d]; });
    return {
      nome: u.nome, pi: u.pi, notas: u.notas, rules: cfg.rules,
      meals: activeMeals(cfg.meals), window: w, dayNotes: notes,
      submitted: !!b, submittedAt: b ? (b.submetidoEm || b.atualizadoEm) : ''
    };
  },

  uSubmit: function (req, s) {
    return withLock(function () {
      var u = findUtente(s.uid);
      if (!u || u.ativo !== '1') fail('session');
      var cfg = config(), w = windowStatus(cfg);
      if (!w.open) fail('closed');
      if (req.weekStart !== w.weekStart) fail('closed');
      var exists = readAll('marcacoes').some(function (m) { return m.utenteId === u.id && m.semana === w.weekStart; });
      if (exists) fail('already_submitted');
      var dados = sanitizeDados(req.dados, w.days, cfg.meals, true);
      var now = nowLisbon().stamp;
      insertRow('marcacoes', { utenteId: u.id, semana: w.weekStart, dados: JSON.stringify(dados), submetidoEm: now, atualizadoEm: now, atualizadoPor: 'utente' });
      log('utente ' + u.pi, 'submeteu', 'semana ' + w.weekStart);
      return { submittedAt: now };
    });
  },

  /* ---------- Administrador ---------- */

  aLogin: function (req) {
    var user = String(req.user || '').trim().toLowerCase(), pass = String(req.pass || '');
    var hit = rateLimit('admin', 8);
    ensureAdmin();
    var salt = cfgGet('adminSalt', ''), h = cfgGet('adminHash', '');
    if (user !== ADMIN_USER || hash(pass, salt) !== h) { hit(); fail('login'); }
    clearRate('admin');
    log('admin', 'login', '');
    return { token: newSession({ role: 'a' }) };
  },

  aDashboard: function () {
    var cfg = config(), w = windowStatus(cfg);
    var utentes = readAll('utentes');
    var subs = readAll('marcacoes').filter(function (m) { return m.semana === w.weekStart; }).length;
    return { window: w, active: countActive(utentes), total: utentes.length, max: MAX_UTENTES, submitted: subs, appUrl: cfg.appUrl };
  },

  aListUtentes: function () {
    return { utentes: readAll('utentes').map(publicUtente), max: MAX_UTENTES };
  },

  aCreateUtente: function (req) {
    return withLock(function () {
      var list = readAll('utentes');
      var pi = normPi(req.pi), nome = cleanText(req.nome, 80);
      if (!pi || !nome) fail('missing_fields');
      if (list.some(function (u) { return u.pi.toLowerCase() === pi.toLowerCase(); })) fail('pi_exists');
      if (countActive(list) >= MAX_UTENTES) fail('max_utentes');
      var pin = uniquePin(list), salt = newSalt(), now = nowLisbon().stamp;
      var u = { id: Utilities.getUuid(), pi: pi, nome: nome, pinHash: hash(pin, salt), pinSalt: salt, ativo: '1', notas: cleanText(req.notas, 2000), criadoEm: now, atualizadoEm: now };
      insertRow('utentes', u);
      log('admin', 'criou utente', pi);
      return { utente: publicUtente(u), pin: pin };
    });
  },

  aUpdateUtente: function (req) {
    return withLock(function () {
      var list = readAll('utentes');
      var u = list.filter(function (x) { return x.id === req.id; })[0];
      if (!u) fail('not_found');
      if (req.pi !== undefined) {
        var pi = normPi(req.pi);
        if (!pi) fail('missing_fields');
        if (list.some(function (x) { return x.id !== u.id && x.pi.toLowerCase() === pi.toLowerCase(); })) fail('pi_exists');
        u.pi = pi;
      }
      if (req.nome !== undefined) { var n = cleanText(req.nome, 80); if (!n) fail('missing_fields'); u.nome = n; }
      if (req.notas !== undefined) u.notas = cleanText(req.notas, 2000);
      if (req.ativo !== undefined) {
        var on = !!req.ativo;
        if (on && u.ativo !== '1' && countActive(list, u.id) >= MAX_UTENTES) fail('max_utentes');
        u.ativo = on ? '1' : '0';
      }
      u.atualizadoEm = nowLisbon().stamp;
      updateRow('utentes', u._row, u);
      log('admin', 'alterou utente', u.pi);
      return { utente: publicUtente(u) };
    });
  },

  aResetPin: function (req) {
    return withLock(function () {
      var list = readAll('utentes');
      var u = list.filter(function (x) { return x.id === req.id; })[0];
      if (!u) fail('not_found');
      var pin = uniquePin(list);
      u.pinSalt = newSalt(); u.pinHash = hash(pin, u.pinSalt); u.atualizadoEm = nowLisbon().stamp;
      updateRow('utentes', u._row, u);
      log('admin', 'novo PIN', u.pi);
      return { pin: pin, utente: publicUtente(u) };
    });
  },

  aDeleteUtente: function (req) {
    return withLock(function () {
      var u = findUtente(req.id);
      if (!u) fail('not_found');
      var rows = readAll('marcacoes').filter(function (m) { return m.utenteId === u.id; }).map(function (m) { return m._row; });
      rows.sort(function (a, b) { return b - a; }).forEach(function (r) { deleteRow('marcacoes', r); });
      deleteRow('utentes', u._row);
      log('admin', 'eliminou utente', u.pi + ' ' + u.nome);
      return {};
    });
  },

  aGetWeek: function (req) {
    var cfg = config();
    var ws = isDate(req.weekStart) ? mondayOf(req.weekStart) : mondayOf(addDays(nowLisbon().date, 1));
    var days = weekDays(ws);
    var bookings = {};
    readAll('marcacoes').forEach(function (m) {
      if (m.semana !== ws) return;
      var d = {}; try { d = JSON.parse(m.dados || '{}'); } catch (e) {}
      bookings[m.utenteId] = { dados: d, notaAdmin: m.notaAdmin, submetidoEm: m.submetidoEm, atualizadoEm: m.atualizadoEm, atualizadoPor: m.atualizadoPor };
    });
    var notes = {};
    days.forEach(function (d) { if (cfg.dayNotes[d]) notes[d] = cfg.dayNotes[d]; });
    return { weekStart: ws, days: days, utentes: readAll('utentes').map(publicUtente), bookings: bookings, meals: cfg.meals, dayNotes: notes, window: windowStatus(cfg) };
  },

  aSaveBooking: function (req) {
    return withLock(function () {
      var u = findUtente(req.utenteId);
      if (!u) fail('not_found');
      if (!isDate(req.weekStart)) fail('bad_request');
      var ws = mondayOf(req.weekStart), cfg = config();
      var dados = sanitizeDados(req.dados, weekDays(ws), cfg.meals, false);
      var existing = readAll('marcacoes').filter(function (m) { return m.utenteId === u.id && m.semana === ws; })[0];
      var now = nowLisbon().stamp;
      var row = { utenteId: u.id, semana: ws, dados: JSON.stringify(dados), notaAdmin: cleanText(req.notaAdmin, 1000),
        submetidoEm: existing ? existing.submetidoEm : '', atualizadoEm: now, atualizadoPor: 'admin' };
      if (existing) updateRow('marcacoes', existing._row, row); else insertRow('marcacoes', row);
      log('admin', 'alterou marcação', u.pi + ' semana ' + ws);
      return { saved: now };
    });
  },

  aDeleteBooking: function (req) {
    return withLock(function () {
      var ws = isDate(req.weekStart) ? mondayOf(req.weekStart) : '';
      var m = readAll('marcacoes').filter(function (x) { return x.utenteId === req.utenteId && x.semana === ws; })[0];
      if (!m) fail('not_found');
      deleteRow('marcacoes', m._row);
      log('admin', 'eliminou marcação', 'semana ' + ws);
      return {};
    });
  },

  aGetConfig: function () {
    var cfg = config();
    return { meals: cfg.meals, schedule: cfg.schedule, manualOpen: cfg.manualOpen, rules: cfg.rules, appUrl: cfg.appUrl };
  },

  aSaveConfig: function (req) {
    return withLock(function () {
      if (req.meals !== undefined) cfgSet('meals', validateMeals(req.meals));
      if (req.schedule !== undefined) {
        var s = req.schedule || {};
        var t = /^([01]\d|2[0-3]):[0-5]\d$/;
        var od = parseInt(s.openDay, 10);
        if (!(od >= 0 && od <= 6) || !t.test(s.openTime) || !t.test(s.closeTime) || s.openTime >= s.closeTime) fail('bad_schedule');
        cfgSet('schedule', { openDay: od, openTime: s.openTime, closeTime: s.closeTime });
      }
      if (req.manualOpen !== undefined) cfgSet('manualOpen', !!req.manualOpen);
      if (req.rules !== undefined) cfgSet('rules', cleanText(req.rules, 4000));
      if (req.appUrl !== undefined) cfgSet('appUrl', cleanText(req.appUrl, 300));
      log('admin', 'alterou definições', Object.keys(req).filter(function (k) { return k !== 'token' && k !== 'action'; }).join(','));
      return ACTIONS.aGetConfig();
    });
  },

  aSaveDayNote: function (req) {
    return withLock(function () {
      if (!isDate(req.date)) fail('bad_request');
      var notes = cfgGet('dayNotes', {});
      var t = cleanText(req.text, 500);
      if (t) notes[req.date] = t; else delete notes[req.date];
      // limpa notas com mais de 120 dias
      var limit = addDays(nowLisbon().date, -120);
      Object.keys(notes).forEach(function (k) { if (k < limit) delete notes[k]; });
      cfgSet('dayNotes', notes);
      return { dayNotes: notes };
    });
  },

  aChangePassword: function (req) {
    ensureAdmin();
    var salt = cfgGet('adminSalt', ''), h = cfgGet('adminHash', '');
    if (hash(String(req.current || ''), salt) !== h) fail('wrong_password');
    var next = String(req.next || '');
    if (next.length < 6) fail('weak_password');
    var ns = newSalt();
    cfgSet('adminSalt', ns);
    cfgSet('adminHash', hash(next, ns));
    log('admin', 'alterou password', '');
    return {};
  },

  aLog: function () {
    var all = readAll('registo');
    return { log: all.slice(-300).reverse().map(function (r) { return { quando: r.quando, quem: r.quem, acao: r.acao, detalhe: r.detalhe }; }) };
  }
};

/* Cada utente "submete"/"é eliminado" apenas pelo próprio ou pelo admin; logout é tratado no route */
ACTIONS.logout = function () { return {}; };

function validateMeals(meals) {
  if (!Array.isArray(meals) || !meals.length || meals.length > 12) fail('bad_meals');
  var ids = {};
  return meals.map(function (m) {
    var id = String(m.id || '').replace(/[^a-z0-9_]/gi, '').slice(0, 30);
    if (!id || ids[id]) fail('bad_meals'); ids[id] = 1;
    var label = cleanText(m.label, 40); if (!label) fail('bad_meals');
    if (!Array.isArray(m.options) || !m.options.length || m.options.length > 15) fail('bad_meals');
    var oids = {};
    return { id: id, key: /^meal\.[a-z_]+$/.test(m.key || '') ? m.key : '', label: label, active: !!m.active,
      options: m.options.map(function (o) {
        var oid = String(o.id || '').replace(/[^a-z0-9_]/gi, '').slice(0, 30);
        if (!oid || oids[oid]) fail('bad_meals'); oids[oid] = 1;
        var ol = cleanText(o.label, 40); if (!ol) fail('bad_meals');
        return { id: oid, key: /^opt\.[a-z_]+$/.test(o.key || '') ? o.key : '', label: ol, active: !!o.active, special: !!o.special };
      }) };
  });
}

/* ======================= Configuração inicial (executar uma vez no editor) ======================= */

/** Executar no editor do Apps Script: cria a folha de dados e a password inicial do administrador. */
function setup() {
  ss();
  Object.keys(SHEETS).forEach(sheet);
  ensureAdmin();
  var def = ss().getSheetByName('Sheet1') || ss().getSheetByName('Folha1');
  if (def && ss().getSheets().length > 1) ss().deleteSheet(def);
  Logger.log('Base de dados: ' + ss().getUrl());
}

/**
 * Envia o link e o QR code da aplicação para o email do serviço.
 * appUrl: endereço da app (GitHub Pages). qrUrl: endereço da imagem PNG do QR code.
 */
function enviarEmailAcesso(appUrl, qrUrl) {
  appUrl = appUrl || config().appUrl || APP_URL;
  if (!appUrl) throw new Error('Indique o endereço da app.');
  var qr = UrlFetchApp.fetch(qrUrl || (appUrl.replace(/\/$/, '') + '/qrcode.png')).getBlob().setName('qrcode-marcacao-refeicoes.png');
  var html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">'
    + '<h2 style="color:#0f5c4d">Marcação de Refeições — acesso</h2>'
    + '<p>Endereço da aplicação (utentes e administrador):<br><a href="' + appUrl + '">' + appUrl + '</a></p>'
    + '<p><img src="cid:qr" width="260" height="260" alt="QR code"></p>'
    + '<p><b>Utentes:</b> leem o QR code e entram com o número de PI e o PIN entregue pelo administrador.<br>'
    + '<b>Administrador:</b> no fundo da página, "Administração" — utilizador <b>admin</b>. Altere a password inicial em Definições.</p>'
    + '<p>As marcações abrem ao domingo das 08h00 às 23h59, para a semana seguinte (segunda a domingo).</p></div>';
  MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: 'Marcação de Refeições — link e QR code de acesso', htmlBody: html,
    inlineImages: { qr: qr }, attachments: [qr] });
}
