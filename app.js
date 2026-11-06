(function () {
  'use strict';

  /* =================================================================
   * Configuración y estado
   * ================================================================= */

  const CONFIG = window.MS_HORAS_CONFIG || {};
  const API = CONFIG.API_URL || '';
  const DEMO = !API || API.indexOf('PEGA_AQUI') === 0 || /[?&]demo=1/.test(location.search);
  const CLAVE_SESION = 'msHorasCodigo';
  const CLAVE_PREFS = 'msHorasPrefs';

  const COLORES = ['#3b6fd6', '#0a8f7a', '#d9730d', '#8b4fc9', '#c83d7a', '#0e86b0', '#6f7f12', '#9a6a3a', '#5561c4', '#b0478f'];
  const DOW_CORTO = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
  const DOW_LETRA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const ESTADOS = [
    { id: 'aprobado', nombre: 'Aprobadas', color: 'var(--ok)' },
    { id: 'pendiente', nombre: 'Pendientes', color: 'var(--pend)' },
    { id: 'rechazado', nombre: 'Rechazadas', color: 'var(--rech)' },
  ];

  const S = {
    codigo: '', usuario: null, areas: [],
    pagina: 'calendario',
    vista: 'semana',
    ancla: null,             // Date: fecha de referencia de la vista
    miniMes: null,           // Date: mes mostrado en el mini calendario
    registros: [],           // registros del rango visible
    equipo: [],              // personas cuyas horas puede revisar el usuario
    viendo: null,            // {id, nombre, area, rol} cuando se ve el calendario de otra persona
    estados: { aprobado: true, pendiente: true, rechazado: true },
    scroll: null,
    peticion: 0,
  };

  const prefs = leerPrefs();
  if (prefs.vista) S.vista = prefs.vista;
  else if (window.innerWidth < 640) S.vista = 'dia';

  /* =================================================================
   * Utilidades
   * ================================================================= */

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const aFecha = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const inicioSemana = (d) => sumarDias(d, -((d.getDay() + 6) % 7));
  const hoyStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const hoy = () => aFecha(hoyStr());
  const aMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  const deMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const horaCorta = (s) => { const m = aMin(s); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
  const minutosAhoraLima = () => {
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Lima', hour12: false });
    return aMin(t.slice(0, 5));
  };
  const fmtH = (n) => (Math.round(n * 100) / 100).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const fmtDur = (min) => {
    const h = Math.floor(min / 60), m = min % 60;
    return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
  };
  const fmtFechaLarga = (s) => { const d = aFecha(s); return `${DIAS_LARGO[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };
  const fmtFechaCorta = (s) => { const d = aFecha(s); return `${DIAS_LARGO[d.getDay()].slice(0, 3)} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
  const fmtMes = (m) => { const [a, mm] = m.split('-').map(Number); return `${MESES[mm - 1]} ${a}`; };
  const iniciales = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const colorArea = (a) => { const i = S.areas.indexOf(a); return COLORES[(i < 0 ? S.areas.length : i) % COLORES.length]; };
  const enlaceSeguro = (u) => (/^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\//, '').slice(0, 48))}</a>` : '');
  const etiquetaEstado = (e) => `<span class="estado ${esc(e)}">${{ aprobado: 'Aprobado', pendiente: 'Pendiente', rechazado: 'Rechazado' }[e] || esc(e)}</span>`;
  const esRevisor = () => S.usuario && (S.usuario.rol === 'admin' || S.usuario.rol === 'coordinador');
  const editable = (r) => !S.viendo && (r.estado !== 'aprobado' || S.usuario.rol === 'admin');
  const ROLES = { admin: 'Admin', coordinador: 'Coordinador', miembro: 'Miembro' };
  const rolDe = (id) => { const m = S.equipo.find((x) => x.id === id); return m ? m.rol : 'miembro'; };

  function leerPrefs() { try { return JSON.parse(localStorage.getItem(CLAVE_PREFS) || '{}'); } catch (e) { return {}; } }
  function guardarPref(k, v) { prefs[k] = v; try { localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs)); } catch (e) { /* nada */ } }

  const ICONOS = {
    reloj: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    etiqueta: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    enlace: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>',
    texto: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    persona: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
    comentario: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4z"/></svg>',
    lapiz: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    basura: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    cerrar: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    izq: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    der: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  };

  let temporizadorAviso;
  function aviso(msg, error) {
    const el = $('#aviso');
    el.textContent = msg;
    el.className = 'aviso' + (error ? ' error' : '');
    el.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { el.hidden = true; }, error ? 6000 : 3500);
  }

  async function api(accion, datos) {
    const cuerpo = Object.assign({ accion, codigo: S.codigo }, datos || {});
    let j;
    if (DEMO) {
      j = await window.MS_HORAS_DEMO.llamar(accion, cuerpo);
    } else {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita el preflight CORS
        body: JSON.stringify(cuerpo),
        redirect: 'follow',
      });
      if (!r.ok) throw new Error('No se pudo conectar con el servidor (' + r.status + ').');
      j = await r.json();
    }
    if (!j.ok) throw new Error(j.error || 'Error desconocido.');
    return j;
  }

  /* =================================================================
   * Sesión
   * ================================================================= */

  async function entrar(codigo) {
    S.codigo = codigo;
    try {
      const j = await api('login');
      S.usuario = j.usuario;
      S.areas = j.areas;
    } catch (e) {
      S.codigo = '';
      throw e;
    }
    try { sessionStorage.setItem(CLAVE_SESION, codigo); } catch (e) { /* nada */ }
    S.ancla = hoy();
    S.miniMes = new Date(S.ancla.getFullYear(), S.ancla.getMonth(), 1);
    iniciarApp();
  }

  function salir() {
    try { sessionStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ }
    S.codigo = ''; S.usuario = null; S.viendo = null; S.registros = []; S.equipo = [];
    cerrarPopover();
    $('#menu-usuario').hidden = true;
    $('#app').hidden = true;
    $('#btn-crear-flotante').hidden = true;
    $('#vista-login').hidden = false;
    $('#login-codigo').value = '';
  }

  function iniciarApp() {
    const u = S.usuario;
    $('#vista-login').hidden = true;
    $('#app').hidden = false;
    const rolTxt = { admin: 'Administrador', coordinador: 'Coordinador · ' + (u.coordina.join(', ') || '—'), miembro: 'Miembro' }[u.rol];
    $('#btn-usuario').textContent = iniciales(u.nombre);
    $('#btn-usuario').title = u.nombre;
    $('#menu-avatar').textContent = iniciales(u.nombre);
    $('#menu-nombre').textContent = u.nombre;
    $('#menu-rol').textContent = `${rolTxt} · Área ${u.area}`;
    $$('[data-solo-revisor]').forEach((el) => { el.hidden = !esRevisor(); });
    $('#bloque-ver').hidden = !esRevisor();
    if (window.innerWidth <= 900) $('#lateral').classList.add('oculto');
    else if (prefs.lateralOculto) $('#lateral').classList.add('oculto');

    $('#res-alcance').textContent = 'Alcance: ' + (u.rol === 'admin' ? 'todo el grupo.'
      : u.rol === 'coordinador' ? 'tus horas y las de tu área (' + (u.coordina.join(', ') || '—') + ').' : 'solo tus horas.');
    $('#rev-alcance').textContent = u.rol === 'admin'
      ? 'Horas de los coordinadores (y de quien esté en un área sin coordinador). Las del resto las aprueba el coordinador de cada área.'
      : 'Horas de los miembros de tu área: ' + (u.coordina.join(', ') || '—') + '. Tus propias horas las aprueba el administrador.';
    if (u.rol === 'coordinador') { const o = $('#res-rol option[value="admin"]'); if (o) o.remove(); }
    $('#bloque-ver h2').textContent = u.rol === 'admin' ? 'Calendario de un coordinador' : 'Calendario de';

    if (esRevisor()) {
      api('miembrosEquipo').then((j) => {
        S.equipo = j.miembros;
        const opciones = j.miembros.map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)} · ${esc(m.area)}${m.rol === 'miembro' && u.rol === 'admin' ? ' (sin coordinador)' : ''}</option>`).join('');
        $('#sel-persona').innerHTML = `<option value="">Mis horas</option>${opciones}`;
        $('#rev-persona').innerHTML = `<option value="">${u.rol === 'admin' ? 'Todos los coordinadores' : 'Toda mi área'}</option>${opciones}`;
      }).catch((e) => aviso(e.message, true));
      actualizarCuentaPendientes();
    }
    irAPagina(paginaDeHash());
  }

  /* =================================================================
   * Navegación entre páginas
   * ================================================================= */

  function paginaDeHash() {
    const h = location.hash.slice(1);
    return ['calendario', 'por-aprobar', 'totales'].includes(h) ? h : 'calendario';
  }

  function irAPagina(p) {
    if (p === 'por-aprobar' && !esRevisor()) p = 'calendario';
    S.pagina = p;
    cerrarPopover();
    $$('.pagina').forEach((el) => { el.hidden = el.id !== 'pagina-' + p; });
    $$('[data-pagina]').forEach((el) => { el.hidden = el.dataset.pagina !== p; });
    $('#btn-crear-flotante').hidden = p !== 'calendario';
    $$('[data-pagina-link]').forEach((a) => a.classList.toggle('activa', a.dataset.paginaLink === p));
    if (location.hash.slice(1) !== p) history.replaceState(null, '', '#' + p);
    renderViendo();
    if (p === 'calendario') cargarCalendario();
    if (p === 'por-aprobar') cargarRevision();
    if (p === 'totales') cargarTotales();
  }

  /* =================================================================
   * Calendario: rango y carga de datos
   * ================================================================= */

  function rango() {
    const a = S.ancla;
    if (S.vista === 'dia') return { dias: [a], desde: a, hasta: a };
    if (S.vista === 'semana') {
      const ini = inicioSemana(a);
      const dias = Array.from({ length: 7 }, (_, i) => sumarDias(ini, i));
      return { dias, desde: dias[0], hasta: dias[6] };
    }
    const primero = new Date(a.getFullYear(), a.getMonth(), 1);
    const ultimo = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    const ini = inicioSemana(primero);
    const semanas = Math.ceil((((ultimo - ini) / 864e5) + 1) / 7);
    const dias = Array.from({ length: semanas * 7 }, (_, i) => sumarDias(ini, i));
    return { dias, desde: dias[0], hasta: dias[dias.length - 1] };
  }

  function tituloRango() {
    const r = rango(), a = S.ancla;
    const angosto = window.innerWidth <= 640;
    if (S.vista === 'dia') return angosto ? `${a.getDate()} ${MESES[a.getMonth()].slice(0, 3)} ${a.getFullYear()}` : `${a.getDate()} de ${MESES[a.getMonth()]} de ${a.getFullYear()}`;
    if (angosto && S.vista === 'mes') return `${cap(MESES[a.getMonth()].slice(0, 3))} ${a.getFullYear()}`;
    if (S.vista === 'mes') return `${cap(MESES[a.getMonth()])} de ${a.getFullYear()}`;
    const d = r.desde, h = r.hasta;
    if (d.getMonth() === h.getMonth()) return `${cap(MESES[d.getMonth()])} de ${d.getFullYear()}`;
    if (d.getFullYear() === h.getFullYear()) return `${cap(MESES[d.getMonth()].slice(0, 3))} – ${MESES[h.getMonth()].slice(0, 3)} de ${h.getFullYear()}`;
    return `${cap(MESES[d.getMonth()].slice(0, 3))} ${d.getFullYear()} – ${MESES[h.getMonth()].slice(0, 3)} ${h.getFullYear()}`;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  async function cargarCalendario() {
    const r = rango();
    const n = ++S.peticion;
    renderCalendario(); // pinta la cuadrícula ya, con lo que haya
    try {
      const datos = { desde: ymd(r.desde), hasta: ymd(r.hasta) };
      const j = S.viendo
        ? await api('porRevisar', Object.assign({ miembro_id: S.viendo.id, estado: '' }, datos))
        : await api('misHoras', datos);
      if (n !== S.peticion) return;
      S.registros = j.registros;
      renderCalendario();
    } catch (e) {
      if (n === S.peticion) aviso(e.message, true);
    }
  }

  function moverAncla(dir) {
    const a = S.ancla;
    if (S.vista === 'dia') S.ancla = sumarDias(a, dir);
    else if (S.vista === 'semana') S.ancla = sumarDias(a, 7 * dir);
    else S.ancla = new Date(a.getFullYear(), a.getMonth() + dir, 1);
    S.miniMes = new Date(S.ancla.getFullYear(), S.ancla.getMonth(), 1);
    S.scroll = null;
    cargarCalendario();
  }

  function cambiarVista(v) {
    S.vista = v;
    guardarPref('vista', v);
    $('#sel-vista').value = v;
    cargarCalendario();
  }

  function irAFecha(fecha, vista) {
    S.ancla = fecha;
    S.miniMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    if (vista) { S.vista = vista; $('#sel-vista').value = vista; }
    if (S.pagina !== 'calendario') irAPagina('calendario'); else cargarCalendario();
  }

  const visibles = () => S.registros.filter((r) => S.estados[r.estado]);

  /* =================================================================
   * Calendario: dibujo
   * ================================================================= */

  function renderCalendario() {
    $('#titulo-rango').textContent = tituloRango();
    $('#sel-vista').value = S.vista;
    renderMini();
    renderResumenLateral();
    if (S.vista === 'mes') renderMes(); else renderTiempo();
  }

  function renderTiempo() {
    const cal = $('#cal');
    const prevScroll = $('.sem-scroll', cal);
    if (prevScroll && S.scroll !== null) S.scroll = prevScroll.scrollTop;
    const { dias } = rango();
    const hs = hoyStr();
    const regs = visibles();
    const porDia = {};
    regs.forEach((r) => { (porDia[r.fecha] = porDia[r.fecha] || []).push(r); });

    const cab = dias.map((d) => {
      const f = ymd(d);
      const total = (porDia[f] || []).filter((r) => r.estado !== 'rechazado').reduce((s, r) => s + r.horas, 0);
      return `<div class="dia-cab${f === hs ? ' hoy' : ''}">
        <span class="dow">${DOW_CORTO[(d.getDay() + 6) % 7]}</span>
        <button class="num" type="button" data-ir-dia="${f}" aria-label="Ver ${fmtFechaLarga(f)}">${d.getDate()}</button>
        <span class="tot">${total ? `<b>${fmtH(total)}</b> h` : ''}</span>
      </div>`;
    }).join('');

    const horas = Array.from({ length: 23 }, (_, i) =>
      `<span style="top:calc(var(--h) * ${i + 1})">${i + 1}:00</span>`).join('');

    const cols = dias.map((d) => {
      const f = ymd(d);
      const clases = ['col'];
      if (f > hs) clases.push('futuro');
      if (f === hs) clases.push('hoy-col');
      const evs = distribuir((porDia[f] || []).filter((r) => r.inicio && r.fin)).map(htmlEvento).join('');
      const ahora = f === hs ? `<div class="ahora" style="top:${minutosAhoraLima() / 60 * alturaHora()}px"></div>` : '';
      return `<div class="${clases.join(' ')}" data-fecha="${f}">${evs}${ahora}</div>`;
    }).join('');

    cal.innerHTML = `
      <div class="sem-cab" style="--dias:${dias.length}"><div class="zona">GMT−05</div>${cab}</div>
      <div class="sem-scroll"><div class="sem-grid" style="--dias:${dias.length}">
        <div class="horas">${horas}</div>${cols}
      </div></div>`;

    const sc = $('.sem-scroll', cal);
    const barra = sc.offsetWidth - sc.clientWidth;
    $('.sem-cab', cal).style.setProperty('--barra', barra + 'px');
    if (S.scroll === null) {
      const primeras = regs.filter((r) => r.inicio).map((r) => aMin(r.inicio));
      const desde = primeras.length ? Math.min(7 * 60, Math.min(...primeras) - 30) : 7 * 60;
      S.scroll = Math.max(0, desde / 60 * alturaHora());
    }
    sc.scrollTop = S.scroll;
    sc.addEventListener('scroll', () => { S.scroll = sc.scrollTop; }, { passive: true });
  }

  function alturaHora() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--h')) || 48;
  }

  /** Reparte los bloques que se cruzan en columnas, como en un calendario. */
  function distribuir(evs) {
    const lista = evs.map((r) => ({ r, a: aMin(r.inicio), b: aMin(r.fin) }))
      .sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a));
    let grupo = [], finGrupo = -1, columnas = [];
    const cerrar = () => { grupo.forEach((e) => { e.n = columnas.length; }); grupo = []; columnas = []; };
    lista.forEach((e) => {
      if (e.a >= finGrupo) { cerrar(); finGrupo = -1; }
      let c = columnas.findIndex((fin) => fin <= e.a);
      if (c === -1) { c = columnas.length; columnas.push(e.b); } else columnas[c] = e.b;
      e.c = c;
      grupo.push(e);
      finGrupo = Math.max(finGrupo, e.b);
    });
    cerrar();
    return lista;
  }

  function htmlEvento(e) {
    const r = e.r, H = alturaHora();
    const top = e.a / 60 * H, alto = Math.max((e.b - e.a) / 60 * H - 2, 18);
    const ancho = 100 / e.n;
    const corto = alto < 34;
    const medio = !corto && alto < 64;
    const horario = `${horaCorta(r.inicio)} – ${horaCorta(r.fin)}`;
    return `<div class="ev ${esc(r.estado)}${corto ? ' corto' : medio ? ' medio' : ''}" data-id="${esc(r.id)}" tabindex="0" role="button"
      aria-label="${esc(r.descripcion)}, ${horario}, ${esc(r.area)}, ${esc(r.estado)}"
      style="--c:${colorArea(r.area)};top:${top}px;height:${alto}px;left:calc(${e.c * ancho}% + 1px);width:calc(${ancho}% - 4px)">
      <div class="t">${esc(r.descripcion)}${corto ? ',' : ''}</div>
      <div class="h">${horario}</div>
      ${!corto && alto > 58 ? `<div class="a">${esc(r.area)}</div>` : ''}
      ${editable(r) ? '<div class="tirador" data-tirador></div>' : ''}
    </div>`;
  }

  function renderMes() {
    const { dias } = rango();
    const hs = hoyStr();
    const mesActual = S.ancla.getMonth();
    const porDia = {};
    visibles().forEach((r) => { (porDia[r.fecha] = porDia[r.fecha] || []).push(r); });
    const celdas = dias.map((d) => {
      const f = ymd(d);
      const rs = (porDia[f] || []).sort((a, b) => (a.inicio || '').localeCompare(b.inicio || ''));
      const total = rs.filter((r) => r.estado !== 'rechazado').reduce((s, r) => s + r.horas, 0);
      const max = rs.length > 4 ? 3 : 4;
      const chips = rs.slice(0, max).map((r) => `
        <button class="chip ${esc(r.estado)}" type="button" data-id="${esc(r.id)}" style="--c:${colorArea(r.area)}" title="${esc(r.descripcion)}">
          <i></i><span class="h">${r.inicio ? horaCorta(r.inicio) : ''}</span><span>${esc(r.descripcion)}</span>
        </button>`).join('');
      const mas = rs.length > max ? `<button class="mas" type="button" data-ir-dia="${f}">${rs.length - max} más</button>` : '';
      const clases = ['celda'];
      if (d.getMonth() !== mesActual) clases.push('fuera');
      if (f === hs) clases.push('hoy');
      if (f > hs) clases.push('futuro');
      return `<div class="${clases.join(' ')}" data-fecha="${f}">
        <div class="celda-cab"><button class="celda-num" type="button" data-ir-dia="${f}">${d.getDate()}</button>
        <span class="celda-tot">${total ? fmtH(total) + ' h' : ''}</span></div>${chips}${mas}</div>`;
    }).join('');
    $('#cal').innerHTML = `<div class="mes">
      <div class="mes-dows">${DOW_CORTO.map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="mes-grid">${celdas}</div></div>`;
  }

  function renderMini() {
    const m = S.miniMes;
    const primero = new Date(m.getFullYear(), m.getMonth(), 1);
    const ini = inicioSemana(primero);
    const r = rango();
    const desde = ymd(r.desde), hasta = ymd(r.hasta), hs = hoyStr();
    const enRango = S.vista !== 'mes';
    let html = `<div class="mini-cab"><b>${cap(MESES[m.getMonth()])} de ${m.getFullYear()}</b><div>
      <button class="icono chico" type="button" data-mini="-1" aria-label="Mes anterior">${ICONOS.izq}</button>
      <button class="icono chico" type="button" data-mini="1" aria-label="Mes siguiente">${ICONOS.der}</button></div></div>
      <div class="mini-grid">${DOW_LETRA.map((l) => `<span class="dow">${l}</span>`).join('')}`;
    for (let i = 0; i < 42; i++) {
      const d = sumarDias(ini, i), f = ymd(d);
      const c = [];
      if (d.getMonth() !== m.getMonth()) c.push('fuera');
      if (f === hs) c.push('hoy');
      else if (enRango && f >= desde && f <= hasta) c.push('en-rango');
      html += `<button type="button" class="${c.join(' ')}" data-mini-dia="${f}">${d.getDate()}</button>`;
    }
    $('#mini').innerHTML = html + '</div>';
  }

  function renderResumenLateral() {
    const etiqueta = S.vista === 'dia' ? 'Este día' : S.vista === 'semana' ? 'Esta semana' : 'Este mes';
    $('#resumen-titulo').textContent = (S.viendo ? S.viendo.nombre.split(' ')[0] + ' · ' : '') + etiqueta;
    const enArea = S.registros.filter((r) => S.vista !== 'mes' || r.fecha.slice(0, 7) === ymd(S.ancla).slice(0, 7));
    const suma = (e) => enArea.filter((r) => r.estado === e).reduce((s, r) => s + r.horas, 0);
    const v = { aprobado: suma('aprobado'), pendiente: suma('pendiente'), rechazado: suma('rechazado') };
    const total = v.aprobado + v.pendiente;
    $('#resumen-total').textContent = fmtH(total) + ' h';
    const base = total + v.rechazado || 1;
    $('#barra-estados').innerHTML = ESTADOS.map((e) => `<span style="width:${v[e.id] / base * 100}%;background:${e.color}"></span>`).join('');
    $('#filtros-estado').innerHTML = ESTADOS.map((e) => `<li><label>
      <input type="checkbox" data-estado="${e.id}" ${S.estados[e.id] ? 'checked' : ''}>
      <span class="caja" style="--c:${e.color}"></span><span class="nombre">${e.nombre}</span>
      <span class="valor">${fmtH(v[e.id])} h</span></label></li>`).join('');
  }

  function renderViendo() {
    const el = $('#viendo');
    if (!S.viendo || S.pagina !== 'calendario') { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>Estás viendo el calendario de <b>${esc(S.viendo.nombre)}</b> (${S.viendo.rol === 'coordinador' ? 'coordinador de ' : ''}${esc(S.viendo.area)}). Haz clic en un bloque para aprobarlo o rechazarlo.</span>
      <span class="espacio"></span>
      <button class="btn primario chico" type="button" id="aprobar-visibles">Aprobar pendientes de este periodo</button>
      <button class="btn texto chico" type="button" id="volver-mias">Volver a mis horas</button>`;
  }

  /* =================================================================
   * Interacción con la cuadrícula: crear, mover y estirar bloques
   * ================================================================= */

  let arrastre = null;
  const SNAP = 15;

  function minutoEn(col, clientY) {
    const y = clientY - col.getBoundingClientRect().top;
    return Math.max(0, Math.min(24 * 60, y / alturaHora() * 60));
  }
  const redondear = (m) => Math.round(m / SNAP) * SNAP;
  const bajar = (m) => Math.floor(m / SNAP) * SNAP;

  function colBajo(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest('.col');
  }

  function alPresionar(ev) {
    if (ev.button !== 0) return;
    const col = ev.target.closest('.col');
    if (!col) return;
    const evEl = ev.target.closest('.ev');
    if (evEl) {
      const r = S.registros.find((x) => x.id === evEl.dataset.id);
      if (!r) return;
      ev.preventDefault();
      arrastre = {
        tipo: ev.target.closest('[data-tirador]') ? 'estirar' : 'mover',
        r, el: evEl, col, x0: ev.clientX, y0: ev.clientY, movido: false,
        ini: aMin(r.inicio), fin: aMin(r.fin), fecha: r.fecha,
        desfase: minutoEn(col, ev.clientY) - aMin(r.inicio),
        puede: editable(r),
      };
    } else {
      if (S.viendo) return;
      if (col.dataset.fecha > hoyStr()) { aviso('No puedes registrar horas en días futuros.'); return; }
      ev.preventDefault();
      cerrarPopover();
      const m = bajar(minutoEn(col, ev.clientY));
      const fantasma = document.createElement('div');
      fantasma.className = 'ev fantasma';
      col.appendChild(fantasma);
      arrastre = { tipo: 'crear', col, fecha: col.dataset.fecha, base: m, ini: m, fin: Math.min(m + 60, 1440), y0: ev.clientY, movido: false, el: fantasma };
      pintarFantasma(arrastre);
    }
    document.addEventListener('pointermove', alMover);
    document.addEventListener('pointerup', alSoltar, { once: true });
  }

  function pintarFantasma(a) {
    const H = alturaHora();
    a.el.style.cssText = `top:${a.ini / 60 * H}px;height:${Math.max((a.fin - a.ini) / 60 * H - 2, 16)}px;left:1px;width:calc(100% - 4px)`;
    a.el.innerHTML = `<div class="t">(Sin descripción)</div><div class="h">${horaCorta(deMin(a.ini))} – ${horaCorta(deMin(a.fin))}</div>`;
  }

  function alMover(ev) {
    const a = arrastre;
    if (!a) return;
    if (!a.movido && Math.abs(ev.clientY - a.y0) < 4 && Math.abs(ev.clientX - (a.x0 || ev.clientX)) < 4) return;
    a.movido = true;
    if (a.tipo === 'crear') {
      const m = redondear(minutoEn(a.col, ev.clientY));
      if (m >= a.base) { a.ini = a.base; a.fin = Math.max(a.base + SNAP, m); } else { a.ini = m; a.fin = a.base + SNAP; }
      pintarFantasma(a);
      return;
    }
    if (!a.puede) return;
    a.el.classList.add('arrastrando');
    const H = alturaHora();
    if (a.tipo === 'estirar') {
      a.fin = Math.max(a.ini + SNAP, Math.min(1440, redondear(minutoEn(a.col, ev.clientY))));
      a.el.style.height = Math.max((a.fin - a.ini) / 60 * H - 2, 16) + 'px';
    } else {
      const col = colBajo(ev.clientX, ev.clientY) || a.col;
      const dur = aMin(a.r.fin) - aMin(a.r.inicio);
      a.ini = Math.max(0, Math.min(1440 - dur, redondear(minutoEn(col, ev.clientY) - a.desfase)));
      a.fin = a.ini + dur;
      if (col !== a.el.parentElement) {
        col.appendChild(a.el);
        a.el.style.left = '1px'; a.el.style.width = 'calc(100% - 4px)';
      }
      a.fecha = col.dataset.fecha;
      a.el.style.top = a.ini / 60 * H + 'px';
    }
    const h = $('.h', a.el);
    if (h) h.textContent = `${horaCorta(deMin(a.ini))} – ${horaCorta(deMin(a.fin))}`;
  }

  function alSoltar() {
    document.removeEventListener('pointermove', alMover);
    const a = arrastre;
    arrastre = null;
    if (!a) return;
    if (a.tipo === 'crear') {
      abrirFormulario({ fecha: a.fecha, inicio: deMin(a.ini), fin: deMin(Math.min(a.fin, 1440)) }, a.el);
      return;
    }
    if (!a.movido || !a.puede) { abrirDetalle(a.r, a.el); return; }
    a.el.classList.remove('arrastrando');
    const cambio = { fecha: a.fecha, inicio: deMin(a.ini), fin: deMin(a.fin) };
    if (cambio.fecha === a.r.fecha && cambio.inicio === a.r.inicio && cambio.fin === a.r.fin) { renderCalendario(); return; }
    if (cambio.fecha > hoyStr()) { aviso('No puedes mover horas a un día futuro.', true); renderCalendario(); return; }
    guardarEdicion(a.r, cambio);
  }

  async function guardarEdicion(r, cambio) {
    const previo = Object.assign({}, r);
    Object.assign(r, cambio);
    renderCalendario();
    try {
      await api('editar', Object.assign({}, previo, cambio));
      aviso(previo.estado === 'rechazado' ? 'Horas corregidas. Vuelven a quedar pendientes de aprobación.' : 'Horas actualizadas.');
    } catch (e) {
      Object.assign(r, previo);
      aviso(e.message, true);
    }
    cargarCalendario();
  }

  /* =================================================================
   * Popover: formulario y detalle
   * ================================================================= */

  let popCierre = null;

  function abrirPopover(html, ancla, alCerrar) {
    cerrarPopover();
    const p = $('#popover');
    p.innerHTML = html;
    p.hidden = false;
    $('#velo').hidden = false;
    popCierre = alCerrar || null;
    posicionar(p, ancla);
    return p;
  }

  function posicionar(p, ancla) {
    if (window.innerWidth <= 640) { p.style.left = ''; p.style.top = ''; return; }
    const ar = ancla ? ancla.getBoundingClientRect() : { left: innerWidth / 2 - 210, right: innerWidth / 2 + 210, top: 120, bottom: 120 };
    const pw = p.offsetWidth, ph = p.offsetHeight, m = 12;
    let left = ar.right + m;
    if (left + pw > innerWidth - m) left = ar.left - pw - m;
    if (left < m) left = Math.max(m, Math.min(innerWidth - pw - m, ar.left + (ar.right - ar.left) / 2 - pw / 2));
    let top = Math.min(Math.max(m, ar.top), innerHeight - ph - m);
    if (left === Math.max(m, Math.min(innerWidth - pw - m, ar.left + (ar.right - ar.left) / 2 - pw / 2)) && ancla) {
      top = ar.bottom + m + ph < innerHeight ? ar.bottom + m : Math.max(m, ar.top - ph - m);
    }
    p.style.left = left + 'px';
    p.style.top = Math.max(m, top) + 'px';
  }

  function cerrarPopover() {
    const p = $('#popover');
    if (p.hidden) return;
    p.hidden = true;
    p.innerHTML = '';
    $('#velo').hidden = true;
    $$('.ev.seleccionado').forEach((e) => e.classList.remove('seleccionado'));
    const fn = popCierre; popCierre = null;
    if (fn) fn();
  }

  function opcionesHora(desde, hasta, sel, base) {
    let html = '';
    for (let m = desde; m <= hasta; m += SNAP) {
      const etiqueta = base !== undefined ? `${horaCorta(deMin(m))}  (${fmtDur(m - base)})` : horaCorta(deMin(m));
      html += `<option value="${deMin(m)}"${deMin(m) === sel ? ' selected' : ''}>${etiqueta}</option>`;
    }
    return html;
  }

  /** Formulario para registrar (sin r) o editar (con r) un bloque de horas. */
  function abrirFormulario(valores, ancla, r) {
    const v = Object.assign({ descripcion: '', enlace: '' }, valores);
    const ini = aMin(v.inicio);
    const fantasma = !r && ancla && ancla.classList.contains('fantasma') ? ancla : null;
    const p = abrirPopover(`
      <form id="pf" novalidate>
        <div class="pop-barra"><button type="button" class="icono chico" data-cerrar aria-label="Cerrar">${ICONOS.cerrar}</button></div>
        <div class="pop-cuerpo">
          <textarea id="pf-desc" class="pop-titulo" rows="1" maxlength="1000" placeholder="¿En qué trabajaste?">${esc(v.descripcion)}</textarea>
          <div class="pop-fila">${ICONOS.reloj}<div class="contenido">
            <input id="pf-fecha" class="campo" type="date" value="${v.fecha}" max="${hoyStr()}" aria-label="Fecha">
            <select id="pf-ini" class="campo" aria-label="Hora de inicio">${opcionesHora(0, 1440 - SNAP, v.inicio)}</select>
            <span>–</span>
            <select id="pf-fin" class="campo" aria-label="Hora de fin">${opcionesHora(ini + SNAP, 1440, v.fin, ini)}</select>
          </div></div>
          <div class="pop-fila">${ICONOS.etiqueta}<div class="det-texto"><span class="punto" style="--c:${colorArea(S.usuario.area)}"></span> ${esc(S.usuario.area)}</div></div>
          <div class="pop-fila">${ICONOS.enlace}<div class="contenido">
            <input id="pf-enlace" class="campo ancho" type="url" maxlength="500" placeholder="Agregar enlace (opcional)" value="${esc(v.enlace)}">
          </div></div>
          ${r && r.estado === 'rechazado' ? `<div class="nota"><b>Rechazado${r.revisado_por ? ' por ' + esc(r.revisado_por) : ''}:</b> ${esc(r.comentario)}<br>Al guardar, vuelve a quedar pendiente de aprobación.</div>` : ''}
          ${!r ? `<div class="nota info">${{ admin: 'Tus horas se aprueban automáticamente.', coordinador: 'Quedará pendiente hasta que el administrador lo apruebe.', miembro: 'Quedará pendiente hasta que tu coordinador lo apruebe.' }[S.usuario.rol]}</div>` : ''}
        </div>
        <div class="pop-pie">
          ${r ? `<button type="button" class="btn peligro" data-eliminar>Eliminar</button>` : ''}
          <span class="espacio"></span>
          <button type="submit" class="btn primario">Guardar</button>
        </div>
      </form>`, ancla, () => { if (fantasma) fantasma.remove(); });

    const desc = $('#pf-desc', p);
    const autoAlto = () => { desc.style.height = 'auto'; desc.style.height = desc.scrollHeight + 'px'; };
    desc.addEventListener('input', autoAlto);
    autoAlto();
    setTimeout(() => desc.focus(), 30);

    const actualizar = () => {
      const i = aMin($('#pf-ini', p).value);
      let f = aMin($('#pf-fin', p).value);
      if (f <= i) f = Math.min(i + 60, 1440);
      $('#pf-fin', p).innerHTML = opcionesHora(i + SNAP, 1440, deMin(f), i);
      if (fantasma) {
        const col = $(`.col[data-fecha="${$('#pf-fecha', p).value}"]`);
        if (col && col !== fantasma.parentElement) col.appendChild(fantasma);
        const a = { el: fantasma, ini: i, fin: f };
        pintarFantasma(a);
        fantasma.hidden = !col;
      }
    };
    $('#pf-ini', p).addEventListener('change', () => {
      // al cambiar el inicio, mantener la duración
      const durPrev = aMin($('#pf-fin', p).value) - aMin(valores.inicio);
      const i = aMin($('#pf-ini', p).value);
      $('#pf-fin', p).innerHTML = opcionesHora(i + SNAP, 1440, deMin(Math.min(i + Math.max(durPrev, SNAP), 1440)), i);
      valores.inicio = $('#pf-ini', p).value;
      actualizar();
    });
    $('#pf-fin', p).addEventListener('change', actualizar);
    $('#pf-fecha', p).addEventListener('change', actualizar);

    p.querySelector('[data-cerrar]').addEventListener('click', cerrarPopover);
    const btnEl = p.querySelector('[data-eliminar]');
    if (btnEl) btnEl.addEventListener('click', () => confirmarEliminar(btnEl, r));

    $('#pf', p).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = {
        fecha: $('#pf-fecha', p).value, inicio: $('#pf-ini', p).value, fin: $('#pf-fin', p).value,
        descripcion: desc.value.trim(), enlace: $('#pf-enlace', p).value.trim(),
      };
      if (!d.descripcion) { aviso('Escribe en qué trabajaste.', true); desc.focus(); return; }
      if (d.fecha > hoyStr()) { aviso('No puedes registrar horas en una fecha futura.', true); return; }
      const btn = p.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        if (r) await api('editar', Object.assign({ id: r.id }, d));
        else await api('registrar', d);
        cerrarPopover();
        const dur = fmtDur(aMin(d.fin) - aMin(d.inicio));
        aviso(r ? 'Registro actualizado.' : S.usuario.rol === 'admin' ? `${dur} registradas y aprobadas.` : `${dur} registradas. Quedan pendientes de aprobación.`);
        const f = aFecha(d.fecha);
        const { desde, hasta } = rango();
        if (f < desde || f > hasta) irAFecha(f); else cargarCalendario();
      } catch (e) {
        aviso(e.message, true);
        btn.disabled = false; btn.textContent = 'Guardar';
      }
    });
  }

  function confirmarEliminar(btn, r) {
    if (btn.dataset.confirmar) {
      btn.disabled = true;
      api('eliminar', { id: r.id }).then(() => {
        cerrarPopover();
        aviso('Registro eliminado.');
        cargarCalendario();
      }).catch((e) => { aviso(e.message, true); btn.disabled = false; });
      return;
    }
    btn.dataset.confirmar = '1';
    btn.textContent = '¿Eliminar? Confirmar';
  }

  function abrirDetalle(r, ancla) {
    if (ancla) ancla.classList.add('seleccionado');
    const min = aMin(r.fin) - aMin(r.inicio);
    const puedeAprobar = S.viendo || (esRevisor() && r.miembro_id !== S.usuario.id);
    const p = abrirPopover(`
      <div class="pop-barra">
        ${editable(r) ? `<button type="button" class="icono chico" data-editar title="Editar" aria-label="Editar">${ICONOS.lapiz}</button>
          <button type="button" class="icono chico" data-eliminar title="Eliminar" aria-label="Eliminar">${ICONOS.basura}</button>` : ''}
        <button type="button" class="icono chico" data-cerrar aria-label="Cerrar">${ICONOS.cerrar}</button>
      </div>
      <div class="pop-cuerpo">
        <div class="det-titulo ${esc(r.estado)}" style="--c:${colorArea(r.area)}"><span class="cuadro"></span><div>
          <h3>${esc(r.descripcion)}</h3>
          <p>${cap(fmtFechaLarga(r.fecha))} · ${horaCorta(r.inicio)} – ${horaCorta(r.fin)} · ${fmtDur(min)}</p>
        </div></div>
        ${S.viendo ? `<div class="pop-fila">${ICONOS.persona}<div class="det-texto">${esc(r.miembro)} · ${esc(r.area)}</div></div>` : ''}
        <div class="pop-fila">${ICONOS.etiqueta}<div class="det-texto">${esc(r.area)}</div></div>
        ${r.enlace ? `<div class="pop-fila">${ICONOS.enlace}<div class="det-texto">${enlaceSeguro(r.enlace)}</div></div>` : ''}
        <div class="pop-fila">${ICONOS.check}<div class="det-texto">${etiquetaEstado(r.estado)}
          ${r.revisado_por ? `<span class="sutil"> por ${esc(r.revisado_por)}</span>` : r.estado === 'pendiente' ? '<span class="sutil"> de aprobación</span>' : ''}</div></div>
        ${r.comentario ? `<div class="pop-fila">${ICONOS.comentario}<div class="det-texto">${esc(r.comentario)}</div></div>` : ''}
        ${r.estado === 'aprobado' && !S.viendo && S.usuario.rol !== 'admin' ? '<div class="nota info">Las horas aprobadas ya no se pueden cambiar. Si hay un error, pide a tu coordinador que las devuelva a pendiente.</div>' : ''}
      </div>
      ${puedeAprobar ? `<div class="pop-pie">
        ${r.estado !== 'pendiente' ? '<button type="button" class="btn texto" data-revisar="pendiente">Devolver a pendiente</button>' : ''}
        <span class="espacio"></span>
        ${r.estado !== 'rechazado' ? '<button type="button" class="btn peligro" data-revisar="rechazado">Rechazar</button>' : ''}
        ${r.estado !== 'aprobado' ? '<button type="button" class="btn primario" data-revisar="aprobado">Aprobar</button>' : ''}
      </div>` : ''}`, ancla);

    p.querySelector('[data-cerrar]').addEventListener('click', cerrarPopover);
    const ed = p.querySelector('[data-editar]');
    if (ed) ed.addEventListener('click', () => abrirFormulario({ fecha: r.fecha, inicio: r.inicio, fin: r.fin, area: r.area, descripcion: r.descripcion, enlace: r.enlace }, ancla, r));
    const el = p.querySelector('[data-eliminar]');
    if (el) el.addEventListener('click', () => {
      if (!el.dataset.confirmar) { el.dataset.confirmar = '1'; el.title = 'Haz clic otra vez para eliminar'; el.style.color = 'var(--rech)'; aviso('Haz clic otra vez en la papelera para eliminar.'); return; }
      confirmarEliminar(el, r);
    });
    $$('[data-revisar]', p).forEach((b) => b.addEventListener('click', async () => {
      const ok = await revisar([r.id], b.dataset.revisar);
      if (ok) { cerrarPopover(); cargarCalendario(); }
    }));
  }

  /* =================================================================
   * Revisión (coordinadores y admin)
   * ================================================================= */

  function pedirTexto(titulo, texto, boton) {
    return new Promise((resolver) => {
      const fondo = $('#dialogo');
      $('#dialogo-titulo').textContent = titulo;
      $('#dialogo-texto').textContent = texto;
      $('#dialogo-ok').textContent = boton;
      const campo = $('#dialogo-campo');
      campo.value = '';
      fondo.hidden = false;
      setTimeout(() => campo.focus(), 20);
      const fin = (v) => {
        fondo.hidden = true;
        $('#dialogo-form').onsubmit = null; $('#dialogo-cancelar').onclick = null;
        resolver(v);
      };
      $('#dialogo-form').onsubmit = (e) => { e.preventDefault(); if (campo.value.trim()) fin(campo.value.trim()); else campo.focus(); };
      $('#dialogo-cancelar').onclick = () => fin(null);
    });
  }

  async function revisar(ids, estado) {
    let comentario = '';
    if (estado === 'rechazado') {
      comentario = await pedirTexto('Rechazar horas', 'Explica el motivo. El miembro lo verá y podrá corregir el registro.', 'Rechazar');
      if (!comentario) return false;
    }
    try {
      const j = await api('revisar', { ids, estado, comentario });
      const txt = { aprobado: 'aprobado', rechazado: 'rechazado', pendiente: 'devuelto a pendiente' }[estado];
      aviso(j.actualizados === 1 ? `Registro ${txt}.` : `${j.actualizados} registros: ${txt}.`);
      actualizarCuentaPendientes();
      return true;
    } catch (e) {
      aviso(e.message, true);
      return false;
    }
  }

  function actualizarCuentaPendientes() {
    if (!esRevisor()) return;
    api('porRevisar', { estado: 'pendiente' }).then((j) => {
      const b = $('#cuenta-pendientes');
      b.textContent = j.registros.length;
      b.hidden = !j.registros.length;
    }).catch(() => {});
  }

  async function cargarRevision() {
    const tb = $('#rev-tabla');
    tb.innerHTML = '<tr><td colspan="9" class="vacio">Cargando…</td></tr>';
    $('#rev-todas').checked = false;
    actualizarLote();
    try {
      const { registros } = await api('porRevisar', {
        estado: $('#rev-estado').value, mes: $('#rev-mes').value, miembro_id: $('#rev-persona').value,
      });
      tb.innerHTML = registros.length ? registros.map((r) => `
        <tr>
          <td>${r.estado === 'pendiente' ? `<input type="checkbox" class="rev-sel" value="${esc(r.id)}" aria-label="Seleccionar">` : ''}</td>
          <td>${esc(r.miembro)}<span class="sub">${S.usuario.rol === 'admin' ? (rolDe(r.miembro_id) === 'coordinador' ? 'Coordinador' : 'Área sin coordinador') : 'Miembro'}</span></td>
          <td>${fmtFechaCorta(r.fecha)}</td>
          <td class="num">${r.inicio ? `${horaCorta(r.inicio)}–${horaCorta(r.fin)}` : '—'}</td>
          <td class="num">${fmtH(r.horas)}</td>
          <td><span class="punto" style="--c:${colorArea(r.area)}"></span> ${esc(r.area)}</td>
          <td class="desc">${esc(r.descripcion)}${r.enlace ? `<span class="sub">${enlaceSeguro(r.enlace)}</span>` : ''}</td>
          <td>${etiquetaEstado(r.estado)}${r.comentario ? `<span class="sub">${esc(r.comentario)}</span>` : ''}</td>
          <td><div class="celda-acciones">
            ${r.estado !== 'aprobado' ? `<button class="btn primario chico" data-revisar="aprobado" data-id="${esc(r.id)}" type="button">Aprobar</button>` : ''}
            ${r.estado !== 'rechazado' ? `<button class="btn peligro chico" data-revisar="rechazado" data-id="${esc(r.id)}" type="button">Rechazar</button>` : ''}
            ${r.estado !== 'pendiente' ? `<button class="btn texto chico" data-revisar="pendiente" data-id="${esc(r.id)}" type="button">Deshacer</button>` : ''}
            <button class="btn texto chico" data-ver-cal="${esc(r.miembro_id)}" data-fecha="${esc(r.fecha)}" type="button">Ver en calendario</button>
          </div></td>
        </tr>`).join('') : '<tr><td colspan="9" class="vacio">No hay registros con este filtro.</td></tr>';
    } catch (e) {
      tb.innerHTML = '';
      aviso(e.message, true);
    }
  }

  function actualizarLote() {
    const n = $$('.rev-sel:checked').length;
    const b = $('#rev-aprobar-sel');
    b.disabled = n === 0;
    b.textContent = n ? `Aprobar seleccionadas (${n})` : 'Aprobar seleccionadas';
  }

  function verCalendarioDe(id, fecha) {
    const m = S.equipo.find((x) => x.id === id);
    if (!m) return;
    S.viendo = m;
    $('#sel-persona').value = id;
    S.scroll = null;
    irAFecha(fecha ? aFecha(fecha) : S.ancla || hoy(), S.vista === 'mes' ? 'semana' : S.vista);
    renderViendo();
  }

  function dejarDeVer() {
    S.viendo = null;
    $('#sel-persona').value = '';
    renderViendo();
    cargarCalendario();
  }

  /* =================================================================
   * Totales
   * ================================================================= */

  async function cargarTotales() {
    ['#res-persona', '#res-area'].forEach((s) => { $(s).innerHTML = '<tr><td colspan="7" class="vacio">Cargando…</td></tr>'; });
    try {
      const j = await api('resumen', filtrosTotales());
      const t = j.totales;
      $('#res-cifras').innerHTML = [
        [fmtH(t.total) + ' h', 'en total'], [fmtH(t.aprobadas) + ' h', 'aprobadas'], [fmtH(t.pendientes) + ' h', 'pendientes'], [t.registros, 'registros'],
      ].map(([v, txt]) => `<div class="cifra"><b>${v}</b><span>${txt}</span></div>`).join('');
      const tot = (x) => x.aprobadas + x.pendientes;
      const vacio = (n) => `<tr><td colspan="${n}" class="vacio">Sin horas en este periodo.</td></tr>`;
      $('#res-persona').innerHTML = j.porPersonaMes.length ? j.porPersonaMes.map((x) => `<tr>
        <td>${cap(fmtMes(x.mes))}</td><td>${esc(x.miembro)}</td><td><span class="rol ${esc(x.rol)}">${ROLES[x.rol] || esc(x.rol)}</span></td><td><span class="punto" style="--c:${colorArea(x.area)}"></span> ${esc(x.area)}</td>
        <td class="num">${fmtH(x.aprobadas)}</td><td class="num">${fmtH(x.pendientes)}</td><td class="num"><b>${fmtH(tot(x))}</b></td></tr>`).join('') : vacio(7);
      const maxArea = Math.max(1, ...j.porArea.map(tot));
      $('#res-area').innerHTML = j.porArea.length ? j.porArea.map((x) => `<tr>
        <td><span class="punto" style="--c:${colorArea(x.area)}"></span> ${esc(x.area)}</td>
        <td class="barra-celda"><div class="barra-area" style="--c:${colorArea(x.area)};width:${tot(x) / maxArea * 100}%"></div></td>
        <td class="num">${fmtH(x.aprobadas)}</td><td class="num">${fmtH(x.pendientes)}</td>
        <td class="num"><b>${fmtH(tot(x))}</b></td></tr>`).join('') : vacio(5);
    } catch (e) {
      aviso(e.message, true);
    }
  }

  function filtrosTotales() {
    return {
      desde: $('#res-desde').value, hasta: $('#res-hasta').value,
      soloAprobadas: $('#res-aprobadas').checked, rol: esRevisor() ? $('#res-rol').value : '',
    };
  }

  /** Carga SheetJS (la librería que arma el Excel) solo cuando hace falta. */
  let promesaXLSX = null;
  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (promesaXLSX) return promesaXLSX;
    const fuentes = [
      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    ];
    const probar = (i) => new Promise((ok, mal) => {
      const sc = document.createElement('script');
      sc.src = fuentes[i];
      sc.onload = () => (window.XLSX ? ok(window.XLSX) : mal());
      sc.onerror = mal;
      document.head.appendChild(sc);
    }).catch(() => {
      if (i + 1 < fuentes.length) return probar(i + 1);
      throw new Error('No se pudo cargar el generador de Excel. Revisa tu conexión e intenta de nuevo.');
    });
    promesaXLSX = probar(0).catch((e) => { promesaXLSX = null; throw e; });
    return promesaXLSX;
  }

  /** Crea una hoja con encabezados, anchos de columna y filtros en cada columna. */
  function hojaConFiltros(XLSX, encabezados, filas, anchos) {
    const ws = XLSX.utils.aoa_to_sheet([encabezados].concat(filas), { cellDates: true, dateNF: 'dd/mm/yyyy' });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: encabezados.length - 1 } }) };
    ws['!cols'] = anchos.map((w) => ({ wch: w }));
    return ws;
  }

  async function descargarExcel(boton) {
    const texto = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Preparando…';
    try {
      const [XLSX, j] = await Promise.all([cargarXLSX(), api('resumen', Object.assign(filtrosTotales(), { detalle: true }))]);
      const rol = (r) => ROLES[r] || r;
      const estado = (e) => ({ aprobado: 'Aprobado', pendiente: 'Pendiente', rechazado: 'Rechazado' }[e] || e);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, hojaConFiltros(XLSX,
        ['Mes', 'Miembro', 'Rol', 'Área', 'Horas aprobadas', 'Horas pendientes', 'Horas en total'],
        j.porPersonaMes.map((x) => [x.mes, x.miembro, rol(x.rol), x.area, x.aprobadas, x.pendientes, x.aprobadas + x.pendientes]),
        [10, 24, 14, 18, 16, 16, 15]), 'Por persona y mes');
      XLSX.utils.book_append_sheet(wb, hojaConFiltros(XLSX,
        ['Área', 'Horas aprobadas', 'Horas pendientes', 'Horas en total'],
        j.porArea.map((x) => [x.area, x.aprobadas, x.pendientes, x.aprobadas + x.pendientes]),
        [20, 16, 16, 15]), 'Por área');
      XLSX.utils.book_append_sheet(wb, hojaConFiltros(XLSX,
        ['Fecha', 'Inicio', 'Fin', 'Horas', 'Miembro', 'Rol', 'Área', 'Descripción', 'Enlace', 'Estado', 'Revisado por', 'Comentario'],
        j.detalle.map((r) => [aFecha(r.fecha), r.inicio, r.fin, r.horas, r.miembro, rol(r.rol), r.area, r.descripcion,
          r.enlace, estado(r.estado), r.revisado_por, r.comentario]),
        [11, 7, 7, 7, 22, 13, 16, 50, 30, 11, 22, 30]), 'Detalle');
      const f = filtrosTotales();
      const periodo = f.desde === f.hasta ? f.desde : `${f.desde || 'inicio'}_a_${f.hasta || 'hoy'}`;
      XLSX.writeFile(wb, `horas-mundo-social-${periodo}${f.rol ? '-' + f.rol : ''}.xlsx`);
      aviso('Excel descargado.');
    } catch (e) {
      aviso(e.message, true);
    } finally {
      boton.disabled = false;
      boton.textContent = texto;
    }
  }

  /* =================================================================
   * Eventos
   * ================================================================= */

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    try { await entrar($('#login-codigo').value.trim()); } catch (e) { aviso(e.message, true); }
    btn.disabled = false;
  });
  if (DEMO) {
    $('#banner-demo').hidden = false;
    $('#login-demo').hidden = false;
    $('#login-demo-botones').innerHTML = window.MS_HORAS_DEMO.codigos.map((c) =>
      `<button type="button" data-demo="${c.codigo}"><b>${c.etiqueta}</b><span>${c.quien}</span></button>`).join('');
    $('#login-demo-botones').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-demo]');
      if (b) entrar(b.dataset.demo).catch((e) => aviso(e.message, true));
    });
  }

  $('#btn-salir').addEventListener('click', salir);
  $('#btn-usuario').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const m = $('#menu-usuario');
    m.hidden = !m.hidden;
    $('#btn-usuario').setAttribute('aria-expanded', String(!m.hidden));
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.usuario')) $('#menu-usuario').hidden = true;
    if (window.innerWidth <= 900 && !ev.target.closest('#lateral') && !ev.target.closest('#btn-menu')) $('#lateral').classList.add('oculto');
  });
  $('#btn-menu').addEventListener('click', () => {
    const l = $('#lateral');
    l.classList.toggle('oculto');
    if (window.innerWidth > 900) { guardarPref('lateralOculto', l.classList.contains('oculto')); setTimeout(renderCalendario, 0); }
  });
  window.addEventListener('hashchange', () => { if (S.usuario) irAPagina(paginaDeHash()); });

  $('#btn-hoy').addEventListener('click', () => { S.scroll = null; irAFecha(hoy()); });
  $('#btn-prev').addEventListener('click', () => moverAncla(-1));
  $('#btn-next').addEventListener('click', () => moverAncla(1));
  $('#sel-vista').addEventListener('change', (ev) => cambiarVista(ev.target.value));
  $('#btn-crear-flotante').addEventListener('click', () => $('#btn-crear').click());
  $('#btn-crear').addEventListener('click', (ev) => {
    if (S.viendo) dejarDeVer();
    const ahora = minutosAhoraLima();
    const ini = Math.max(0, Math.min(1380, bajar(ahora) - 60));
    abrirFormulario({ fecha: hoyStr(), inicio: deMin(ini), fin: deMin(ini + 60) }, ev.currentTarget);
  });

  $('#mini').addEventListener('click', (ev) => {
    const nav = ev.target.closest('[data-mini]');
    if (nav) { S.miniMes = new Date(S.miniMes.getFullYear(), S.miniMes.getMonth() + Number(nav.dataset.mini), 1); renderMini(); return; }
    const d = ev.target.closest('[data-mini-dia]');
    if (d) irAFecha(aFecha(d.dataset.miniDia));
  });

  $('#filtros-estado').addEventListener('change', (ev) => {
    const e = ev.target.dataset.estado;
    if (e) { S.estados[e] = ev.target.checked; renderCalendario(); }
  });
  $('#sel-persona').addEventListener('change', (ev) => {
    if (ev.target.value) verCalendarioDe(ev.target.value); else dejarDeVer();
  });
  $('#viendo').addEventListener('click', async (ev) => {
    if (ev.target.id === 'volver-mias') dejarDeVer();
    if (ev.target.id === 'aprobar-visibles') {
      const ids = S.registros.filter((r) => r.estado === 'pendiente').map((r) => r.id);
      if (!ids.length) { aviso('No hay horas pendientes en este periodo.'); return; }
      if (await revisar(ids, 'aprobado')) cargarCalendario();
    }
  });

  const cal = $('#cal');
  cal.addEventListener('pointerdown', alPresionar);
  cal.addEventListener('click', (ev) => {
    const ir = ev.target.closest('[data-ir-dia]');
    if (ir) { irAFecha(aFecha(ir.dataset.irDia), 'dia'); return; }
    const chip = ev.target.closest('.chip');
    if (chip) {
      const r = S.registros.find((x) => x.id === chip.dataset.id);
      if (r) abrirDetalle(r, chip);
      return;
    }
    const celda = ev.target.closest('.celda');
    if (celda && !S.viendo) {
      if (celda.dataset.fecha > hoyStr()) { aviso('No puedes registrar horas en días futuros.'); return; }
      abrirFormulario({ fecha: celda.dataset.fecha, inicio: '09:00', fin: '10:00' }, celda);
    }
  });
  cal.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('ev')) {
      ev.preventDefault();
      const r = S.registros.find((x) => x.id === ev.target.dataset.id);
      if (r) abrirDetalle(r, ev.target);
    }
  });
  $('#velo').addEventListener('pointerdown', cerrarPopover);

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { cerrarPopover(); $('#menu-usuario').hidden = true; return; }
    if (!S.usuario || S.pagina !== 'calendario' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.target.closest('input, textarea, select') || !$('#popover').hidden || !$('#dialogo').hidden) return;
    const k = ev.key.toLowerCase();
    const acciones = {
      t: () => irAFecha(hoy()), d: () => cambiarVista('dia'), s: () => cambiarVista('semana'), w: () => cambiarVista('semana'),
      m: () => cambiarVista('mes'), j: () => moverAncla(1), n: () => moverAncla(1), k: () => moverAncla(-1), p: () => moverAncla(-1),
      c: () => $('#btn-crear').click(),
    };
    if (acciones[k]) { ev.preventDefault(); acciones[k](); }
  });

  $('#rev-estado').addEventListener('change', cargarRevision);
  $('#rev-mes').addEventListener('change', cargarRevision);
  $('#rev-persona').addEventListener('change', cargarRevision);
  $('#rev-tabla').addEventListener('click', async (ev) => {
    const ver = ev.target.closest('[data-ver-cal]');
    if (ver) { verCalendarioDe(ver.dataset.verCal, ver.dataset.fecha); return; }
    const b = ev.target.closest('[data-revisar]');
    if (b && await revisar([b.dataset.id], b.dataset.revisar)) cargarRevision();
  });
  $('#rev-tabla').addEventListener('change', (ev) => { if (ev.target.classList.contains('rev-sel')) actualizarLote(); });
  $('#rev-todas').addEventListener('change', (ev) => { $$('.rev-sel').forEach((c) => { c.checked = ev.target.checked; }); actualizarLote(); });
  $('#rev-aprobar-sel').addEventListener('click', async () => {
    const ids = $$('.rev-sel:checked').map((c) => c.value);
    if (ids.length && await revisar(ids, 'aprobado')) cargarRevision();
  });

  const mesHoy = hoyStr().slice(0, 7);
  $('#res-desde').value = mesHoy;
  $('#res-hasta').value = mesHoy;
  ['#res-desde', '#res-hasta', '#res-aprobadas', '#res-rol'].forEach((s) => $(s).addEventListener('change', cargarTotales));
  $('#res-excel').addEventListener('click', (ev) => descargarExcel(ev.currentTarget));

  // Mantener la línea de "ahora" al día.
  setInterval(() => { if (S.usuario && S.pagina === 'calendario' && S.vista !== 'mes' && !arrastre && $('#popover').hidden) renderTiempo(); }, 60000);
  let temporizadorResize;
  window.addEventListener('resize', () => { clearTimeout(temporizadorResize); temporizadorResize = setTimeout(() => { if (S.usuario && S.pagina === 'calendario') renderCalendario(); }, 150); });

  // Reanudar la sesión dentro de la misma pestaña.
  let guardado = '';
  try { guardado = sessionStorage.getItem(CLAVE_SESION) || ''; } catch (e) { /* nada */ }
  if (guardado) entrar(guardado).catch(() => salir());
})();
