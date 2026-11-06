(function () {
  'use strict';

  const API = (window.MS_HORAS_CONFIG || {}).API_URL || '';
  const CLAVE = 'msHorasCodigo';
  const $ = (s) => document.querySelector(s);
  const estado = { codigo: '', usuario: null, areas: [], resumen: null };

  /* ---------- utilidades ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  const fmtH = (n) => (Math.round(n * 100) / 100).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const mesActual = () => hoy().slice(0, 7);
  const fmtFecha = (f) => { const [a, m, d] = f.split('-'); return `${d}/${m}/${a}`; };
  const fmtMes = (m) => {
    const [a, mm] = m.split('-');
    return new Date(Number(a), Number(mm) - 1, 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
  };
  const etiquetaEstado = (e) => `<span class="estado ${esc(e)}">${esc(e)}</span>`;
  const enlaceSeguro = (u) => /^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">enlace</a>` : '';

  let temporizador;
  function aviso(msg, error) {
    const el = $('#aviso');
    el.textContent = msg;
    el.className = 'aviso' + (error ? ' error' : '');
    el.hidden = false;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { el.hidden = true; }, error ? 6000 : 3000);
  }

  async function api(accion, datos) {
    if (!API || API.indexOf('PEGA_AQUI') === 0) {
      throw new Error('Falta configurar API_URL en config.js (ver README).');
    }
    const r = await fetch(API, {
      method: 'POST',
      // text/plain evita el preflight CORS que Apps Script no soporta.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ accion, codigo: estado.codigo }, datos || {})),
      redirect: 'follow',
    });
    if (!r.ok) throw new Error('Error de red (' + r.status + ').');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Error desconocido.');
    return j;
  }

  async function conBoton(boton, fn) {
    const texto = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Un momento…';
    try { return await fn(); }
    catch (e) { aviso(e.message, true); }
    finally { boton.disabled = false; boton.textContent = texto; }
  }

  /* ---------- sesión ---------- */

  async function entrar(codigo) {
    estado.codigo = codigo;
    const j = await api('login');
    estado.usuario = j.usuario;
    estado.areas = j.areas;
    try { sessionStorage.setItem(CLAVE, codigo); } catch (e) { /* sin almacenamiento */ }
    mostrarApp();
  }

  function salir() {
    try { sessionStorage.removeItem(CLAVE); } catch (e) { /* nada */ }
    estado.codigo = ''; estado.usuario = null;
    $('#app').hidden = true;
    $('#sesion').hidden = true;
    $('#vista-login').hidden = false;
    $('#login-codigo').value = '';
  }

  function esRevisor() { return ['admin', 'coordinador'].includes(estado.usuario.rol); }

  function mostrarApp() {
    const u = estado.usuario;
    $('#vista-login').hidden = true;
    $('#app').hidden = false;
    $('#sesion').hidden = false;
    const rol = { admin: 'admin', coordinador: 'coordinador', miembro: '' }[u.rol];
    $('#sesion-nombre').textContent = u.nombre + (rol ? ` (${rol})` : '');

    document.querySelectorAll('[data-rol="revisor"]').forEach((el) => { el.hidden = !esRevisor(); });

    const alcance = u.rol === 'admin' ? 'Todo el grupo.'
      : u.rol === 'coordinador' ? 'Equipos que coordinas: ' + (u.coordina.join(', ') || '—') + '.'
      : 'Solo tus horas.';
    $('#res-alcance').textContent = 'Alcance: ' + alcance;
    $('#rev-alcance').textContent = u.rol === 'admin'
      ? 'Ves las horas de todo el grupo (excepto las tuyas, que no puedes aprobar).'
      : 'Ves las horas de los equipos que coordinas: ' + (u.coordina.join(', ') || '—') + '. Tus propias horas las aprueba el admin.';

    const sel = $('#form-registro [name=area]');
    sel.innerHTML = '<option value="">Elige…</option>' +
      estado.areas.map((a) => `<option>${esc(a)}</option>`).join('');
    const f = $('#form-registro [name=fecha]');
    f.max = hoy();
    if (!f.value) f.value = hoy();

    const vista = (location.hash || '').slice(1);
    irA(['registrar', 'mis-horas', 'revisar', 'resumen'].includes(vista) ? vista : 'registrar');
  }

  /* ---------- navegación ---------- */

  function irA(vista) {
    if (vista === 'revisar' && !esRevisor()) vista = 'registrar';
    document.querySelectorAll('.vista').forEach((s) => { s.hidden = s.id !== 'vista-' + vista; });
    document.querySelectorAll('#pestanas button').forEach((b) => b.classList.toggle('activa', b.dataset.vista === vista));
    history.replaceState(null, '', '#' + vista);
    if (vista === 'mis-horas') cargarMisHoras();
    if (vista === 'revisar') cargarRevision();
    if (vista === 'resumen') cargarResumen();
  }

  /* ---------- registrar ---------- */

  async function guardarRegistro(ev) {
    ev.preventDefault();
    const form = ev.target;
    const d = Object.fromEntries(new FormData(form));
    await conBoton(form.querySelector('button'), async () => {
      await api('registrar', d);
      aviso('Horas registradas. Quedan pendientes de aprobación.');
      const fecha = form.fecha.value, area = form.area.value;
      form.reset();
      form.fecha.value = fecha; form.area.value = area; // se suelen repetir
    });
  }

  /* ---------- mis horas ---------- */

  async function cargarMisHoras() {
    const tb = $('#mis-tabla');
    tb.innerHTML = '<tr><td colspan="6" class="vacio">Cargando…</td></tr>';
    try {
      const { registros } = await api('misHoras', { mes: $('#mis-mes').value });
      const suma = (e) => registros.filter((r) => !e || r.estado === e).reduce((s, r) => s + r.horas, 0);
      $('#mis-totales').innerHTML = [
        ['Aprobadas', suma('aprobado')], ['Pendientes', suma('pendiente')], ['Rechazadas', suma('rechazado')],
      ].map(([t, v]) => `<div class="cifra"><b>${fmtH(v)}</b><span>horas ${t.toLowerCase()}</span></div>`).join('');
      tb.innerHTML = registros.length ? registros.map((r) => `
        <tr>
          <td>${fmtFecha(r.fecha)}</td>
          <td class="num">${fmtH(r.horas)}</td>
          <td>${esc(r.area)}</td>
          <td class="desc">${esc(r.descripcion)} ${enlaceSeguro(r.enlace)}</td>
          <td>${etiquetaEstado(r.estado)}${r.revisado_por ? `<span class="comentario">por ${esc(r.revisado_por)}</span>` : ''}${r.comentario ? `<span class="comentario">${esc(r.comentario)}</span>` : ''}</td>
          <td>${r.estado !== 'aprobado' ? `<button class="btn-texto" data-eliminar="${esc(r.id)}" type="button">Eliminar</button>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="vacio">No hay registros en este periodo.</td></tr>';
    } catch (e) {
      tb.innerHTML = '';
      aviso(e.message, true);
    }
  }

  async function eliminar(id, boton) {
    if (!confirm('¿Eliminar este registro?')) return;
    await conBoton(boton, async () => {
      await api('eliminar', { id });
      aviso('Registro eliminado.');
      cargarMisHoras();
    });
  }

  /* ---------- revisión (coordinadores y admin) ---------- */

  async function cargarRevision() {
    const tb = $('#rev-tabla');
    tb.innerHTML = '<tr><td colspan="8" class="vacio">Cargando…</td></tr>';
    $('#rev-todas').checked = false;
    actualizarLote();
    try {
      const { registros } = await api('porRevisar', { estado: $('#rev-estado').value, mes: $('#rev-mes').value });
      tb.innerHTML = registros.length ? registros.map((r) => `
        <tr>
          <td>${r.estado === 'pendiente' ? `<input type="checkbox" class="rev-sel" value="${esc(r.id)}" aria-label="Seleccionar">` : ''}</td>
          <td>${esc(r.miembro)}<span class="comentario">${esc(r.equipo)}</span></td>
          <td>${fmtFecha(r.fecha)}</td>
          <td class="num">${fmtH(r.horas)}</td>
          <td>${esc(r.area)}</td>
          <td class="desc">${esc(r.descripcion)} ${enlaceSeguro(r.enlace)}</td>
          <td>${etiquetaEstado(r.estado)}${r.revisado_por ? `<span class="comentario">por ${esc(r.revisado_por)}</span>` : ''}${r.comentario ? `<span class="comentario">${esc(r.comentario)}</span>` : ''}</td>
          <td><div class="acciones">
            ${r.estado !== 'aprobado' ? `<button class="btn chico" data-revisar="aprobado" data-id="${esc(r.id)}" type="button">Aprobar</button>` : ''}
            ${r.estado !== 'rechazado' ? `<button class="btn chico peligro" data-revisar="rechazado" data-id="${esc(r.id)}" type="button">Rechazar</button>` : ''}
            ${r.estado !== 'pendiente' ? `<button class="btn-texto" data-revisar="pendiente" data-id="${esc(r.id)}" type="button">Deshacer</button>` : ''}
          </div></td>
        </tr>`).join('') : '<tr><td colspan="8" class="vacio">No hay registros con este filtro.</td></tr>';
    } catch (e) {
      tb.innerHTML = '';
      aviso(e.message, true);
    }
  }

  function actualizarLote() {
    const n = document.querySelectorAll('.rev-sel:checked').length;
    const b = $('#rev-aprobar-sel');
    b.disabled = n === 0;
    b.textContent = n ? `Aprobar seleccionadas (${n})` : 'Aprobar seleccionadas';
  }

  async function revisar(ids, nuevoEstado, boton) {
    let comentario = '';
    if (nuevoEstado === 'rechazado') {
      comentario = prompt('Motivo del rechazo (lo verá el miembro):') || '';
      if (!comentario.trim()) return;
    }
    await conBoton(boton, async () => {
      const j = await api('revisar', { ids, estado: nuevoEstado, comentario });
      aviso(`${j.actualizados} registro(s) actualizado(s).`);
      cargarRevision();
    });
  }

  /* ---------- totales ---------- */

  async function cargarResumen() {
    ['#res-persona', '#res-area', '#res-equipo'].forEach((s) => { $(s).innerHTML = '<tr><td colspan="6" class="vacio">Cargando…</td></tr>'; });
    try {
      const j = await api('resumen', {
        desde: $('#res-desde').value, hasta: $('#res-hasta').value, soloAprobadas: $('#res-aprobadas').checked,
      });
      estado.resumen = j;
      const t = j.totales;
      $('#res-cifras').innerHTML = [
        ['horas en total', t.total], ['horas aprobadas', t.aprobadas], ['horas pendientes', t.pendientes], ['registros', t.registros],
      ].map(([txt, v]) => `<div class="cifra"><b>${fmtH(v)}</b><span>${txt}</span></div>`).join('');
      const filas = (arr, cols, vacio) => arr.length ? arr.map((x) => `<tr>${cols(x)}<td class="num">${fmtH(x.aprobadas)}</td><td class="num">${fmtH(x.pendientes)}</td><td class="num"><b>${fmtH(x.aprobadas + x.pendientes)}</b></td></tr>`).join('')
        : `<tr><td colspan="${vacio}" class="vacio">Sin datos en este periodo.</td></tr>`;
      $('#res-persona').innerHTML = filas(j.porPersonaMes, (x) => `<td>${esc(fmtMes(x.mes))}</td><td>${esc(x.miembro)}</td><td>${esc(x.equipo)}</td>`, 6);
      $('#res-area').innerHTML = filas(j.porArea, (x) => `<td>${esc(x.area)}</td>`, 4);
      $('#res-equipo').innerHTML = filas(j.porEquipo, (x) => `<td>${esc(x.equipo)}</td>`, 4);
    } catch (e) {
      aviso(e.message, true);
    }
  }

  function descargarCSV() {
    const r = estado.resumen;
    if (!r) return;
    const q = (v) => {
      let s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas al abrir en Excel/Sheets
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lineas = [['mes', 'miembro', 'equipo', 'aprobadas', 'pendientes', 'total']]
      .concat(r.porPersonaMes.map((x) => [x.mes, x.miembro, x.equipo, x.aprobadas, x.pendientes, x.aprobadas + x.pendientes]));
    const blob = new Blob(['﻿' + lineas.map((l) => l.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `horas-mundo-social-${hoy()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- eventos ---------- */

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const codigo = $('#login-codigo').value.trim();
    await conBoton(ev.target.querySelector('button'), () => entrar(codigo).catch((e) => { estado.codigo = ''; throw e; }));
  });
  $('#btn-salir').addEventListener('click', salir);
  $('#pestanas').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) irA(b.dataset.vista); });
  $('#form-registro').addEventListener('submit', guardarRegistro);

  $('#mis-mes').value = mesActual();
  $('#mis-mes').addEventListener('change', cargarMisHoras);
  $('#mis-tabla').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-eliminar]');
    if (b) eliminar(b.dataset.eliminar, b);
  });

  $('#rev-estado').addEventListener('change', cargarRevision);
  $('#rev-mes').addEventListener('change', cargarRevision);
  $('#rev-tabla').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-revisar]');
    if (b) revisar([b.dataset.id], b.dataset.revisar, b);
  });
  $('#rev-tabla').addEventListener('change', (ev) => { if (ev.target.classList.contains('rev-sel')) actualizarLote(); });
  $('#rev-todas').addEventListener('change', (ev) => {
    document.querySelectorAll('.rev-sel').forEach((c) => { c.checked = ev.target.checked; });
    actualizarLote();
  });
  $('#rev-aprobar-sel').addEventListener('click', (ev) => {
    const ids = [...document.querySelectorAll('.rev-sel:checked')].map((c) => c.value);
    if (ids.length) revisar(ids, 'aprobado', ev.target);
  });

  $('#res-desde').value = mesActual();
  $('#res-hasta').value = mesActual();
  ['#res-desde', '#res-hasta', '#res-aprobadas'].forEach((s) => $(s).addEventListener('change', cargarResumen));
  $('#res-csv').addEventListener('click', descargarCSV);

  // Reanudar sesión dentro de la misma pestaña.
  let guardado = '';
  try { guardado = sessionStorage.getItem(CLAVE) || ''; } catch (e) { /* nada */ }
  if (guardado) entrar(guardado).catch(() => salir());
})();
