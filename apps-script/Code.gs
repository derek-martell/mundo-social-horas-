/**
 * Mundo Social · Registro de horas
 * Backend en Google Apps Script sobre un Google Sheet.
 *
 * Hojas que usa (las crea la función `configurar`):
 *   Miembros  : id | nombre | email | area | rol | coordina | codigo | activo
 *   Registros : id | creado | miembro_id | miembro | area | fecha | inicio | fin | horas |
 *               descripcion | enlace | estado | revisado_por | revisado_en | comentario
 *
 * Cada persona pertenece a un área (Redacción, Redes sociales, Diseño…).
 *
 * Roles y quién aprueba a quién:
 *   miembro      -> registra y ve solo sus horas. Las aprueba el coordinador de su área.
 *   coordinador  -> además ve y aprueba las horas de los miembros de las áreas listadas en
 *                   "coordina" (separadas por comas). Sus propias horas las aprueba el admin.
 *   admin        -> aprueba las horas de los coordinadores (y de los miembros de un área que
 *                   no tenga coordinador activo). En Totales ve el resumen de todo el grupo.
 *                   Sus propias horas se aprueban solas al registrarlas, porque nadie está
 *                   por encima para aprobarlas.
 *   Nadie aprueba sus propias horas.
 *
 * Todas las peticiones llegan por POST con un cuerpo JSON: { accion, codigo, ... }.
 * El frontend envía el cuerpo como text/plain para evitar el preflight CORS.
 */

const HOJA_MIEMBROS = 'Miembros';
const HOJA_REGISTROS = 'Registros';

const COLS_MIEMBROS = ['id', 'nombre', 'email', 'area', 'rol', 'coordina', 'codigo', 'activo'];
const COLS_REGISTROS = ['id', 'creado', 'miembro_id', 'miembro', 'area', 'fecha', 'inicio', 'fin', 'horas',
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
    const ctx = contexto_();
    const usuario = autenticar_(datos.codigo, ctx);
    const acciones = {
      login: () => ({ usuario: perfilPublico_(usuario), areas: ctx.areas }),
      registrar: () => registrar_(usuario, datos),
      editar: () => editar_(usuario, datos),
      misHoras: () => ({ registros: registrosDe_(usuario, datos) }),
      eliminar: () => eliminar_(usuario, datos.id),
      porRevisar: () => ({ registros: registrosParaRevisar_(usuario, datos, ctx) }),
      miembrosEquipo: () => ({ miembros: miembrosEquipo_(usuario, ctx) }),
      revisar: () => revisar_(usuario, datos, ctx),
      resumen: () => resumen_(usuario, datos, ctx),
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
/* Miembros, autenticación y permisos                                  */
/* ------------------------------------------------------------------ */

/** Lee los miembros una vez por petición y precalcula qué áreas tienen coordinador. */
function contexto_() {
  const miembros = leerMiembros_();
  const porId = {};
  miembros.forEach(m => { porId[m.id] = m; });
  const areasConCoordinador = {};
  miembros.filter(m => m.activo && m.rol === 'coordinador')
    .forEach(m => m.coordina.forEach(a => { areasConCoordinador[a] = true; }));
  const areas = [];
  miembros.filter(m => m.activo && m.area).forEach(m => { if (areas.indexOf(m.area) === -1) areas.push(m.area); });
  areas.sort((a, b) => a.localeCompare(b));
  return { miembros, porId, areasConCoordinador, areas };
}

function autenticar_(codigo, ctx) {
  const cache = CacheService.getScriptCache();
  const fallidos = Number(cache.get('fallidos') || 0);
  if (fallidos >= MAX_INTENTOS_FALLIDOS) {
    throw new ErrorApp('Demasiados intentos fallidos. Espera unos minutos.');
  }
  codigo = String(codigo || '').replace(/\s+/g, ''); // acepta "1234 5678"
  const m = codigo.length >= 6 && ctx.miembros.find(x => x.activo && x.codigo === codigo);
  if (!m) {
    cache.put('fallidos', String(fallidos + 1), 600);
    Utilities.sleep(800);
    throw new ErrorApp('Código de acceso inválido.');
  }
  if (!m.area) throw new ErrorApp('Tu usuario no tiene un área asignada. Pídele al administrador que la agregue.');
  return m;
}

function perfilPublico_(m) {
  return { id: m.id, nombre: m.nombre, area: m.area, rol: m.rol, coordina: m.coordinaNombres };
}

function esAdmin_(u) { return u.rol === 'admin'; }
function esRevisor_(u) { return u.rol === 'admin' || u.rol === 'coordinador'; }

/**
 * ¿Puede `u` revisar las horas de la persona `miembroId`, registradas en el área `area`?
 * El coordinador revisa a los miembros de sus áreas; el admin, a los coordinadores
 * (y a quien esté en un área sin coordinador).
 */
function puedeRevisar_(u, miembroId, area, ctx) {
  if (miembroId === u.id) return false;            // nadie aprueba sus propias horas
  const m = ctx.porId[miembroId] || { id: miembroId, rol: 'miembro', area: area };
  const a = normalizar_(area || m.area);
  if (u.rol === 'coordinador') return m.rol === 'miembro' && u.coordina.indexOf(a) !== -1;
  if (esAdmin_(u)) return m.rol !== 'miembro' || !ctx.areasConCoordinador[a];
  return false;
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

/** Valida y normaliza los campos de un registro. Devuelve los campos limpios. */
function validarCampos_(d) {
  const fecha = String(d.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorApp('Fecha inválida.');
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  if (fecha > hoy) throw new ErrorApp('No puedes registrar horas en una fecha futura.');

  const inicio = String(d.inicio || ''), fin = String(d.fin || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(inicio) || !/^([01]\d|2[0-4]):[0-5]\d$/.test(fin)) {
    throw new ErrorApp('Indica la hora de inicio y de fin.');
  }
  const minutos = aMinutos_(fin) - aMinutos_(inicio);
  if (minutos < 15) throw new ErrorApp('La hora de fin debe ser al menos 15 minutos después del inicio.');
  if (aMinutos_(fin) > 24 * 60) throw new ErrorApp('Hora de fin inválida.');
  const horas = Math.round(minutos / 15) / 4; // múltiplos de 15 minutos

  const descripcion = String(d.descripcion || '').trim();
  if (descripcion.length < 3) throw new ErrorApp('Agrega una descripción.');
  if (descripcion.length > 1000) throw new ErrorApp('La descripción es muy larga (máx. 1000).');

  const enlace = String(d.enlace || '').trim();
  if (enlace && !/^https?:\/\/\S+$/i.test(enlace)) throw new ErrorApp('El enlace debe empezar con http:// o https://');
  if (enlace.length > 500) throw new ErrorApp('El enlace es muy largo.');

  return { fecha, inicio, fin, horas, descripcion, enlace };
}

/** Lanza un error si el tramo se cruza con otro registro (no rechazado) del mismo miembro. */
function verificarCruce_(filas, miembroId, c, ignorarId) {
  const a = aMinutos_(c.inicio), b = aMinutos_(c.fin);
  const choque = filas.find(r => r.miembro_id === miembroId && r.id !== ignorarId &&
    r.fecha === c.fecha && r.estado !== 'rechazado' && r.inicio && r.fin &&
    aMinutos_(r.inicio) < b && a < aMinutos_(r.fin));
  if (choque) {
    throw new ErrorApp('Se cruza con otro registro tuyo de ' + choque.inicio + ' a ' + choque.fin + '.');
  }
}

const APROBACION_AUTOMATICA = 'Aprobación automática (admin)';

/** Estado inicial de un registro: el del admin queda aprobado; el resto, pendiente. */
function estadoInicial_(u) {
  return esAdmin_(u)
    ? { estado: 'aprobado', revisado_por: APROBACION_AUTOMATICA, revisado_en: new Date().toISOString(), comentario: '' }
    : { estado: 'pendiente', revisado_por: '', revisado_en: '', comentario: '' };
}

function registrar_(u, d) {
  const c = validarCampos_(d);
  return conBloqueo_(() => {
    verificarCruce_(leerRegistros_(), u.id, c, null);
    const fila = Object.assign({
      id: Utilities.getUuid(), creado: new Date().toISOString(), miembro_id: u.id, miembro: u.nombre,
      area: u.area,
    }, estadoInicial_(u), c);
    hoja_(HOJA_REGISTROS).appendRow(COLS_REGISTROS.map(col => seguro_(fila[col])));
    return { registro: fila };
  });
}

/** Edita un registro propio no aprobado (el admin puede editar los suyos aunque estén aprobados).
 *  Vuelve a quedar pendiente de aprobación, salvo los del admin. */
function editar_(u, d) {
  const c = validarCampos_(d);
  return conBloqueo_(() => {
    const { hoja, filas } = filasRegistros_();
    const i = filas.findIndex(r => r.id === String(d.id || ''));
    if (i === -1) throw new ErrorApp('Registro no encontrado.');
    const r = filas[i];
    if (r.miembro_id !== u.id) throw new ErrorApp('Solo puedes editar tus propios registros.');
    if (r.estado === 'aprobado' && !esAdmin_(u)) throw new ErrorApp('No se puede editar un registro aprobado.');
    verificarCruce_(filas, u.id, c, r.id);
    const nuevo = Object.assign({}, r, c, estadoInicial_(u));
    hoja.getRange(i + 2, 1, 1, COLS_REGISTROS.length)
      .setValues([COLS_REGISTROS.map(col => seguro_(nuevo[col]))]);
    return { registro: nuevo };
  });
}

function registrosDe_(u, d) {
  return filtrarRango_(leerRegistros_().filter(r => r.miembro_id === u.id), d).sort(porFechaDesc_);
}

function eliminar_(u, id) {
  return conBloqueo_(() => {
    const { hoja, filas } = filasRegistros_();
    const i = filas.findIndex(r => r.id === id);
    if (i === -1) throw new ErrorApp('Registro no encontrado.');
    const r = filas[i];
    if (r.miembro_id !== u.id) throw new ErrorApp('Solo puedes eliminar tus propios registros.');
    if (r.estado === 'aprobado' && !esAdmin_(u)) throw new ErrorApp('No se puede eliminar un registro aprobado.');
    hoja.deleteRow(i + 2);
    return { eliminado: id };
  });
}

function registrosParaRevisar_(u, d, ctx) {
  if (!esRevisor_(u)) throw new ErrorApp('No tienes permiso para revisar horas.');
  let rs = leerRegistros_().filter(r => puedeRevisar_(u, r.miembro_id, r.area, ctx));
  if (d.estado && ESTADOS.indexOf(d.estado) !== -1) rs = rs.filter(r => r.estado === d.estado);
  if (d.miembro_id) rs = rs.filter(r => r.miembro_id === String(d.miembro_id));
  return filtrarRango_(rs, d).sort(porFechaDesc_);
}

/** Personas activas cuyas horas puede revisar `u` (para ver su calendario). */
function miembrosEquipo_(u, ctx) {
  if (!esRevisor_(u)) throw new ErrorApp('No tienes permiso para ver otros calendarios.');
  return ctx.miembros
    .filter(m => m.activo && m.area && puedeRevisar_(u, m.id, m.area, ctx))
    .map(m => ({ id: m.id, nombre: m.nombre, area: m.area, rol: m.rol }))
    .sort((a, b) => a.area.localeCompare(b.area) || a.nombre.localeCompare(b.nombre));
}

function revisar_(u, d, ctx) {
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
      if (!puedeRevisar_(u, r.miembro_id, r.area, ctx)) return;
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
 * Totales. Admin: todo el grupo. Coordinador: sus áreas (incluye sus propias horas).
 * Miembro: solo él mismo.
 * d.desde / d.hasta: 'yyyy-MM' opcionales. d.soloAprobadas: boolean.
 * d.rol: 'admin' | 'coordinador' | 'miembro' para filtrar por rol (opcional).
 * d.detalle: true para devolver también cada registro (para exportar a Excel).
 */
function resumen_(u, d, ctx) {
  const rolDe = id => (ctx.porId[id] && ctx.porId[id].rol) || 'miembro';
  let base = leerRegistros_().map(r => Object.assign(r, { rol: rolDe(r.miembro_id) }));
  if (!esAdmin_(u)) {
    base = base.filter(r => r.miembro_id === u.id ||
      (u.rol === 'coordinador' && u.coordina.indexOf(normalizar_(r.area)) !== -1));
  }
  const desde = /^\d{4}-\d{2}$/.test(d.desde || '') ? d.desde : '';
  const hasta = /^\d{4}-\d{2}$/.test(d.hasta || '') ? d.hasta : '';
  const rol = ['admin', 'coordinador', 'miembro'].indexOf(d.rol) !== -1 ? d.rol : '';
  base = base.filter(r => !d.soloAprobadas || r.estado === 'aprobado')
    .filter(r => !rol || r.rol === rol)
    .filter(r => (!desde || r.fecha.slice(0, 7) >= desde) && (!hasta || r.fecha.slice(0, 7) <= hasta));
  const rs = base.filter(r => r.estado !== 'rechazado'); // los rechazados no suman horas

  const porPersonaMes = {}, porArea = {};
  let total = 0, aprobadas = 0, pendientes = 0;
  rs.forEach(r => {
    const mes = r.fecha.slice(0, 7);
    const k = r.miembro_id + '|' + mes;
    const pm = porPersonaMes[k] || (porPersonaMes[k] = { miembro: r.miembro, rol: r.rol, area: r.area, mes, aprobadas: 0, pendientes: 0 });
    const a = porArea[r.area] || (porArea[r.area] = { area: r.area, aprobadas: 0, pendientes: 0 });
    const campo = r.estado === 'aprobado' ? 'aprobadas' : 'pendientes';
    pm[campo] += r.horas; a[campo] += r.horas;
    total += r.horas;
    if (campo === 'aprobadas') aprobadas += r.horas; else pendientes += r.horas;
  });
  const salida = {
    totales: { total, aprobadas, pendientes, registros: rs.length },
    porPersonaMes: Object.values(porPersonaMes)
      .sort((x, y) => y.mes.localeCompare(x.mes) || x.area.localeCompare(y.area) || x.miembro.localeCompare(y.miembro)),
    porArea: Object.values(porArea).sort((x, y) => (y.aprobadas + y.pendientes) - (x.aprobadas + x.pendientes)),
  };
  if (d.detalle) {
    // Incluye los rechazados, con su estado, para poder filtrarlos en Excel.
    salida.detalle = base
      .sort((x, y) => x.fecha.localeCompare(y.fecha) || x.miembro.localeCompare(y.miembro) || x.inicio.localeCompare(y.inicio))
      .map(r => ({ fecha: r.fecha, inicio: r.inicio, fin: r.fin, horas: r.horas, miembro: r.miembro, rol: r.rol,
        area: r.area, descripcion: r.descripcion, enlace: r.enlace, estado: r.estado,
        revisado_por: r.revisado_por, comentario: r.comentario }));
  }
  return salida;
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
      area: String(m.area).trim(),
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
    miembro: String(r.miembro), area: String(r.area), fecha,
    inicio: hora_(r.inicio), fin: hora_(r.fin), horas: Number(r.horas) || 0,
    descripcion: String(r.descripcion), enlace: String(r.enlace), estado: String(r.estado || 'pendiente'),
    revisado_por: String(r.revisado_por), revisado_en: String(r.revisado_en), comentario: String(r.comentario),
  };
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Sheets puede convertir "08:30" en una hora; la devolvemos siempre como texto HH:mm. */
function hora_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'HH:mm');
  return String(v || '').trim();
}

function aMinutos_(hhmm) {
  const p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function normalizar_(s) { return String(s || '').trim().toLowerCase(); }

/** Filtra por d.mes ('yyyy-MM') y por d.desde / d.hasta ('yyyy-MM-dd'), si vienen. */
function filtrarRango_(rs, d) {
  if (/^\d{4}-\d{2}$/.test(d.mes || '')) rs = rs.filter(r => r.fecha.slice(0, 7) === d.mes);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.desde || '')) rs = rs.filter(r => r.fecha >= d.desde);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.hasta || '')) rs = rs.filter(r => r.fecha <= d.hasta);
  return rs;
}

function porFechaDesc_(a, b) {
  return b.fecha.localeCompare(a.fecha) || (b.inicio || '').localeCompare(a.inicio || '') ||
    b.creado.localeCompare(a.creado);
}

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
  reg.getRange('F:H').setNumberFormat('@'); // fecha, inicio y fin como texto
  ss.getSheetByName(HOJA_MIEMBROS).getRange('G:G').setNumberFormat('@'); // código como texto
  generarCodigos();
}

/**
 * Genera un código numérico de 8 dígitos, distinto para cada persona, a quien no tenga uno.
 * No empieza con 0, para que Sheets no lo recorte si la celda se vuelve número.
 */
function generarCodigos() {
  const { hoja, filas } = leerTabla_(HOJA_MIEMBROS, COLS_MIEMBROS);
  const col = COLS_MIEMBROS.indexOf('codigo') + 1;
  const usados = {};
  filas.forEach(m => { usados[String(m.codigo).trim()] = true; });
  let n = 0;
  filas.forEach((m, i) => {
    if (String(m.id).trim() && !String(m.codigo).trim()) {
      let c;
      do {
        c = String(1 + Math.floor(Math.random() * 9));
        for (let k = 0; k < 7; k++) c += Math.floor(Math.random() * 10);
      } while (usados[c]);
      usados[c] = true;
      hoja.getRange(i + 2, col).setNumberFormat('@').setValue(c);
      n++;
    }
  });
  try { SpreadsheetApp.getUi().alert(n + ' código(s) generado(s).'); } catch (e) { /* sin UI */ }
}
