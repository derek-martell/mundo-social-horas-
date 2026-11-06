/**
 * Mundo Social · Registro de horas
 * Backend en Google Apps Script sobre un Google Sheet.
 *
 * Hojas que usa (las crea la función `configurar`):
 *   Miembros  : id | nombre | email | equipo | rol | coordina | codigo | activo
 *   Registros : id | creado | miembro_id | miembro | equipo | fecha | horas | area |
 *               descripcion | enlace | estado | revisado_por | revisado_en | comentario
 *   Areas     : area
 *
 * Roles:
 *   miembro      -> registra y ve solo sus horas.
 *   coordinador  -> además ve y aprueba las horas de los equipos listados en "coordina"
 *                   (separados por comas). No puede aprobar sus propias horas.
 *   admin        -> ve y aprueba todo, y ve los totales de todo el grupo.
 *
 * Todas las peticiones llegan por POST con un cuerpo JSON: { accion, codigo, ... }.
 * El frontend envía el cuerpo como text/plain para evitar el preflight CORS.
 */

const HOJA_MIEMBROS = 'Miembros';
const HOJA_REGISTROS = 'Registros';
const HOJA_AREAS = 'Areas';

const COLS_MIEMBROS = ['id', 'nombre', 'email', 'equipo', 'rol', 'coordina', 'codigo', 'activo'];
const COLS_REGISTROS = ['id', 'creado', 'miembro_id', 'miembro', 'equipo', 'fecha', 'horas', 'area',
  'descripcion', 'enlace', 'estado', 'revisado_por', 'revisado_en', 'comentario'];

const ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
const MAX_INTENTOS_FALLIDOS = 20;      // por ventana de 10 minutos, en todo el Web App
const ZONA = 'America/Lima';

/* ------------------------------------------------------------------ */
/* Entrada HTTP                                                        */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, servicio: 'Mundo Social · Registro de horas' });
}

function doPost(e) {
  try {
    const datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const usuario = autenticar_(datos.codigo);
    const acciones = {
      login: () => ({ usuario: perfilPublico_(usuario), areas: listarAreas_() }),
      registrar: () => registrar_(usuario, datos),
      misHoras: () => ({ registros: registrosDe_(usuario, datos) }),
      eliminar: () => eliminar_(usuario, datos.id),
      porRevisar: () => ({ registros: registrosParaRevisar_(usuario, datos) }),
      revisar: () => revisar_(usuario, datos),
      resumen: () => resumen_(usuario, datos),
    };
    const fn = acciones[datos.accion];
    if (!fn) throw new ErrorApp('Acción desconocida.');
    return json_(Object.assign({ ok: true }, fn()));
  } catch (err) {
    const msg = err instanceof ErrorApp ? err.message : 'Error interno del servidor.';
    if (!(err instanceof ErrorApp)) console.error(err && err.stack || err);
    return json_({ ok: false, error: msg });
  }
}

class ErrorApp extends Error {}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Autenticación                                                       */
/* ------------------------------------------------------------------ */

function autenticar_(codigo) {
  const cache = CacheService.getScriptCache();
  const fallidos = Number(cache.get('fallidos') || 0);
  if (fallidos >= MAX_INTENTOS_FALLIDOS) {
    throw new ErrorApp('Demasiados intentos fallidos. Espera unos minutos.');
  }
  codigo = String(codigo || '').trim();
  const m = codigo.length >= 6 && leerMiembros_().find(x => x.activo && x.codigo === codigo);
  if (!m) {
    cache.put('fallidos', String(fallidos + 1), 600);
    Utilities.sleep(800);
    throw new ErrorApp('Código de acceso inválido.');
  }
  return m;
}

function perfilPublico_(m) {
  return { id: m.id, nombre: m.nombre, equipo: m.equipo, rol: m.rol, coordina: m.coordinaNombres };
}

function esAdmin_(u) { return u.rol === 'admin'; }
function esRevisor_(u) { return u.rol === 'admin' || u.rol === 'coordinador'; }

/** ¿Puede `u` revisar un registro de alguien del equipo `equipo` con id `miembroId`? */
function puedeRevisar_(u, miembroId, equipo) {
  if (miembroId === u.id) return false;            // nadie aprueba sus propias horas
  if (esAdmin_(u)) return true;
  if (u.rol !== 'coordinador') return false;
  return u.coordina.indexOf(normalizar_(equipo)) !== -1;
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

function registrar_(u, d) {
  const fecha = String(d.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorApp('Fecha inválida.');
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  if (fecha > hoy) throw new ErrorApp('No puedes registrar horas en una fecha futura.');

  const horas = Math.round(Number(d.horas) * 4) / 4; // múltiplos de 15 minutos
  if (!(horas > 0 && horas <= 24)) throw new ErrorApp('Las horas deben estar entre 0.25 y 24.');

  const area = String(d.area || '').trim();
  if (listarAreas_().indexOf(area) === -1) throw new ErrorApp('Área o proyecto inválido.');

  const descripcion = String(d.descripcion || '').trim();
  if (descripcion.length < 3) throw new ErrorApp('Agrega una descripción.');
  if (descripcion.length > 1000) throw new ErrorApp('La descripción es muy larga (máx. 1000).');

  const enlace = String(d.enlace || '').trim();
  if (enlace && !/^https?:\/\/\S+$/i.test(enlace)) throw new ErrorApp('El enlace debe empezar con http:// o https://');
  if (enlace.length > 500) throw new ErrorApp('El enlace es muy largo.');

  const id = Utilities.getUuid();
  const fila = {
    id, creado: new Date().toISOString(), miembro_id: u.id, miembro: u.nombre, equipo: u.equipo,
    fecha, horas, area, descripcion, enlace, estado: 'pendiente',
    revisado_por: '', revisado_en: '', comentario: '',
  };
  conBloqueo_(() => {
    hoja_(HOJA_REGISTROS).appendRow(COLS_REGISTROS.map(c => seguro_(fila[c])));
  });
  return { registro: fila };
}

function registrosDe_(u, d) {
  return filtrarPorMes_(leerRegistros_().filter(r => r.miembro_id === u.id), d.mes)
    .sort(porFechaDesc_);
}

function eliminar_(u, id) {
  return conBloqueo_(() => {
    const { hoja, filas } = filasRegistros_();
    const i = filas.findIndex(r => r.id === id);
    if (i === -1) throw new ErrorApp('Registro no encontrado.');
    const r = filas[i];
    if (r.miembro_id !== u.id) throw new ErrorApp('Solo puedes eliminar tus propios registros.');
    if (r.estado === 'aprobado') throw new ErrorApp('No se puede eliminar un registro aprobado.');
    hoja.deleteRow(i + 2);
    return { eliminado: id };
  });
}

function registrosParaRevisar_(u, d) {
  if (!esRevisor_(u)) throw new ErrorApp('No tienes permiso para revisar horas.');
  let rs = leerRegistros_().filter(r => puedeRevisar_(u, r.miembro_id, r.equipo));
  if (d.estado && ESTADOS.indexOf(d.estado) !== -1) rs = rs.filter(r => r.estado === d.estado);
  return filtrarPorMes_(rs, d.mes).sort(porFechaDesc_);
}

function revisar_(u, d) {
  if (!esRevisor_(u)) throw new ErrorApp('No tienes permiso para revisar horas.');
  const estado = String(d.estado || '');
  if (ESTADOS.indexOf(estado) === -1) throw new ErrorApp('Estado inválido.');
  const ids = Array.isArray(d.ids) ? d.ids.map(String) : [String(d.id || '')];
  const comentario = String(d.comentario || '').trim().slice(0, 500);
  if (estado === 'rechazado' && !comentario) throw new ErrorApp('Indica el motivo del rechazo.');

  return conBloqueo_(() => {
    const { hoja, filas } = filasRegistros_();
    const colEstado = COLS_REGISTROS.indexOf('estado') + 1;
    const ahora = new Date().toISOString();
    let n = 0;
    ids.forEach(id => {
      const i = filas.findIndex(r => r.id === id);
      if (i === -1) return;
      const r = filas[i];
      if (!puedeRevisar_(u, r.miembro_id, r.equipo)) return;
      hoja.getRange(i + 2, colEstado, 1, 4).setValues([[
        estado,
        estado === 'pendiente' ? '' : seguro_(u.nombre),
        estado === 'pendiente' ? '' : ahora,
        seguro_(comentario),
      ]]);
      n++;
    });
    if (!n) throw new ErrorApp('No se actualizó ningún registro (¿permiso o id inválido?).');
    return { actualizados: n };
  });
}

/**
 * Totales. Admin: todo el grupo. Coordinador: sus equipos (incluye sus propias horas).
 * Miembro: solo él mismo.
 * d.desde / d.hasta: 'yyyy-MM' opcionales. d.soloAprobadas: boolean.
 */
function resumen_(u, d) {
  let rs = leerRegistros_();
  if (!esAdmin_(u)) {
    rs = rs.filter(r => r.miembro_id === u.id ||
      (u.rol === 'coordinador' && u.coordina.indexOf(normalizar_(r.equipo)) !== -1));
  }
  const desde = /^\d{4}-\d{2}$/.test(d.desde || '') ? d.desde : '';
  const hasta = /^\d{4}-\d{2}$/.test(d.hasta || '') ? d.hasta : '';
  rs = rs.filter(r => r.estado !== 'rechazado')
    .filter(r => !d.soloAprobadas || r.estado === 'aprobado')
    .filter(r => (!desde || r.fecha.slice(0, 7) >= desde) && (!hasta || r.fecha.slice(0, 7) <= hasta));

  const porPersonaMes = {}, porArea = {}, porEquipo = {};
  let total = 0, aprobadas = 0, pendientes = 0;
  rs.forEach(r => {
    const mes = r.fecha.slice(0, 7);
    const k = r.miembro_id + '|' + mes;
    const pm = porPersonaMes[k] || (porPersonaMes[k] = { miembro: r.miembro, equipo: r.equipo, mes, aprobadas: 0, pendientes: 0 });
    const a = porArea[r.area] || (porArea[r.area] = { area: r.area, aprobadas: 0, pendientes: 0 });
    const e = porEquipo[r.equipo] || (porEquipo[r.equipo] = { equipo: r.equipo, aprobadas: 0, pendientes: 0 });
    const campo = r.estado === 'aprobado' ? 'aprobadas' : 'pendientes';
    pm[campo] += r.horas; a[campo] += r.horas; e[campo] += r.horas;
    total += r.horas;
    if (campo === 'aprobadas') aprobadas += r.horas; else pendientes += r.horas;
  });
  return {
    totales: { total, aprobadas, pendientes, registros: rs.length },
    porPersonaMes: Object.values(porPersonaMes)
      .sort((x, y) => y.mes.localeCompare(x.mes) || x.miembro.localeCompare(y.miembro)),
    porArea: Object.values(porArea).sort((x, y) => (y.aprobadas + y.pendientes) - (x.aprobadas + x.pendientes)),
    porEquipo: Object.values(porEquipo).sort((x, y) => x.equipo.localeCompare(y.equipo)),
  };
}

/* ------------------------------------------------------------------ */
/* Lectura del Sheet                                                   */
/* ------------------------------------------------------------------ */

function hoja_(nombre) {
  const h = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!h) throw new ErrorApp('Falta la hoja "' + nombre + '". Ejecuta la función configurar.');
  return h;
}

function leerTabla_(nombre, cols) {
  const h = hoja_(nombre);
  const n = h.getLastRow() - 1;
  if (n < 1) return { hoja: h, filas: [] };
  const vals = h.getRange(2, 1, n, cols.length).getValues();
  return { hoja: h, filas: vals.map(v => Object.fromEntries(cols.map((c, i) => [c, v[i]]))) };
}

function leerMiembros_() {
  return leerTabla_(HOJA_MIEMBROS, COLS_MIEMBROS).filas
    .filter(m => String(m.id).trim())
    .map(m => ({
      id: String(m.id).trim(),
      nombre: String(m.nombre).trim(),
      equipo: String(m.equipo).trim(),
      rol: ['admin', 'coordinador'].indexOf(normalizar_(m.rol)) !== -1 ? normalizar_(m.rol) : 'miembro',
      coordina: String(m.coordina || '').split(',').map(normalizar_).filter(Boolean),
      coordinaNombres: String(m.coordina || '').split(',').map(x => x.trim()).filter(Boolean),
      codigo: String(m.codigo).trim(),
      activo: m.activo === true || /^(si|sí|true|1|x)$/i.test(String(m.activo).trim()),
    }));
}

function filasRegistros_() {
  const t = leerTabla_(HOJA_REGISTROS, COLS_REGISTROS);
  t.filas = t.filas.map(limpiarRegistro_);
  return t;
}

function leerRegistros_() { return filasRegistros_().filas; }

function limpiarRegistro_(r) {
  const fecha = r.fecha instanceof Date
    ? Utilities.formatDate(r.fecha, ZONA, 'yyyy-MM-dd') : String(r.fecha);
  return {
    id: String(r.id), creado: String(r.creado), miembro_id: String(r.miembro_id),
    miembro: String(r.miembro), equipo: String(r.equipo), fecha,
    horas: Number(r.horas) || 0, area: String(r.area), descripcion: String(r.descripcion),
    enlace: String(r.enlace), estado: String(r.estado || 'pendiente'),
    revisado_por: String(r.revisado_por), revisado_en: String(r.revisado_en),
    comentario: String(r.comentario),
  };
}

function listarAreas_() {
  const h = hoja_(HOJA_AREAS);
  const n = h.getLastRow() - 1;
  if (n < 1) return [];
  return h.getRange(2, 1, n, 1).getValues().map(v => String(v[0]).trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function normalizar_(s) { return String(s || '').trim().toLowerCase(); }

function filtrarPorMes_(rs, mes) {
  return /^\d{4}-\d{2}$/.test(mes || '') ? rs.filter(r => r.fecha.slice(0, 7) === mes) : rs;
}

function porFechaDesc_(a, b) { return b.fecha.localeCompare(a.fecha) || b.creado.localeCompare(a.creado); }

/** Evita inyección de fórmulas: un texto que empieza con = + - @ se guarda como texto. */
function seguro_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function conBloqueo_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new ErrorApp('El servidor está ocupado, intenta de nuevo.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ */
/* Configuración y menú del Sheet                                      */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Registro de horas')
    .addItem('Configurar hojas', 'configurar')
    .addItem('Generar códigos faltantes', 'generarCodigos')
    .addToUi();
}

/** Crea las hojas con sus encabezados si no existen. Se puede ejecutar varias veces. */
function configurar() {
  const ss = SpreadsheetApp.getActive();
  const crear = (nombre, cols, ejemplo) => {
    let h = ss.getSheetByName(nombre);
    if (!h) h = ss.insertSheet(nombre);
    if (h.getLastRow() === 0) {
      h.appendRow(cols);
      h.setFrozenRows(1);
      h.getRange(1, 1, 1, cols.length).setFontWeight('bold');
      (ejemplo || []).forEach(f => h.appendRow(f));
    }
    return h;
  };
  crear(HOJA_MIEMBROS, COLS_MIEMBROS, [
    ['m01', 'Admin de ejemplo', 'admin@ejemplo.com', 'Dirección', 'admin', '', '', 'sí'],
    ['m02', 'Coordinadora de ejemplo', 'coord@ejemplo.com', 'Redacción', 'coordinador', 'Redacción', '', 'sí'],
    ['m03', 'Miembro de ejemplo', 'miembro@ejemplo.com', 'Redacción', 'miembro', '', '', 'sí'],
  ]);
  const reg = crear(HOJA_REGISTROS, COLS_REGISTROS);
  reg.getRange('F:F').setNumberFormat('@'); // fecha como texto yyyy-MM-dd
  crear(HOJA_AREAS, ['area'], [['Redacción'], ['Edición'], ['Investigación'], ['Redes sociales'],
    ['Diseño'], ['Web'], ['Coordinación'], ['Otro']]);
  generarCodigos();
}

/** Genera un código aleatorio para cada miembro que no tenga uno. */
function generarCodigos() {
  const { hoja, filas } = leerTabla_(HOJA_MIEMBROS, COLS_MIEMBROS);
  const col = COLS_MIEMBROS.indexOf('codigo') + 1;
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let n = 0;
  filas.forEach((m, i) => {
    if (String(m.id).trim() && !String(m.codigo).trim()) {
      let c = '';
      for (let k = 0; k < 10; k++) c += alfabeto[Math.floor(Math.random() * alfabeto.length)];
      hoja.getRange(i + 2, col).setValue(c);
      n++;
    }
  });
  try { SpreadsheetApp.getUi().alert(n + ' código(s) generado(s).'); } catch (e) { /* sin UI */ }
}
