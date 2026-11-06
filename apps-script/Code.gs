/**
 * Mundo Social · Registro de horas
 * Backend en Google Apps Script sobre un Google Sheet.
 *
 * Hojas que usa (las crea la función `configurar`):
 *   Miembros  : id | nombre | email | area | rol | coordina | codigo | activo
 *   Registros : id | creado | miembro_id | miembro | area | fecha | inicio | fin | horas |
 *               descripcion | enlace | estado | revisado_por | revisado_en | comentario | tarea_id
 *   Tareas    : id | creada | asignada_por_id | asignada_por | asignada_a_id | asignada_a | area |
 *               titulo | descripcion | plazo | tipo_plazo | prioridad | estado | completada_en | nota
 *               (metas con plazo; plazo 'yyyy-MM-dd'; tipo_plazo semana|mes|fecha; prioridad
 *               alta|normal; estado pendiente|en_progreso|hecha|cancelada)
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
 * Tareas: quien puede revisar a una persona (misma jerarquía de arriba) puede asignarle tareas,
 * editarlas, cancelarlas y borrarlas (solo las que creó). La persona asignada las ve, cambia su
 * estado (pendiente / en_progreso / hecha), deja una nota y puede ligar sus horas a la tarea
 * con `tarea_id` en Registros. El admin ve todas las tareas.
 *
 * Planilla: la gente se gestiona desde la app, sin tocar el Sheet. El admin gestiona a todos; un
 * coordinador, solo a los miembros (rol 'miembro') de las áreas que coordina. Puede ver la planilla
 * (`planilla`), agregar personas (`agregarPersona`, con código de acceso nuevo que se devuelve una
 * sola vez), editarlas o desactivarlas (`actualizarPersona`) y regenerar su código (`nuevoCodigo`).
 * No hay borrado: "quitar" a alguien es desactivarlo, para conservar su historial. El coordinador
 * no cambia roles ni gestiona a otros coordinadores; el admin no puede desactivarse ni cambiarse
 * el rol a sí mismo. La planilla nunca devuelve los códigos de acceso.
 *
 * Todas las peticiones llegan por POST con un cuerpo JSON: { accion, codigo, ... }.
 * El frontend envía el cuerpo como text/plain para evitar el preflight CORS.
 */

const HOJA_MIEMBROS = 'Miembros';
const HOJA_REGISTROS = 'Registros';
const HOJA_TAREAS = 'Tareas';

const COLS_MIEMBROS = ['id', 'nombre', 'email', 'area', 'rol', 'coordina', 'codigo', 'activo'];
const COLS_REGISTROS = ['id', 'creado', 'miembro_id', 'miembro', 'area', 'fecha', 'inicio', 'fin', 'horas',
  'descripcion', 'enlace', 'estado', 'revisado_por', 'revisado_en', 'comentario', 'tarea_id'];
const COLS_TAREAS = ['id', 'creada', 'asignada_por_id', 'asignada_por', 'asignada_a_id', 'asignada_a', 'area',
  'titulo', 'descripcion', 'plazo', 'tipo_plazo', 'prioridad', 'estado', 'completada_en', 'nota'];

const ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
const ESTADOS_TAREA = ['pendiente', 'en_progreso', 'hecha', 'cancelada'];
const TIPOS_PLAZO = ['semana', 'mes', 'fecha'];
const PRIORIDADES = ['alta', 'normal'];
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
      tareas: () => tareas_(usuario, datos),
      crearTarea: () => crearTarea_(usuario, datos, ctx),
      editarTarea: () => editarTarea_(usuario, datos),
      actualizarTarea: () => actualizarTarea_(usuario, datos),
      eliminarTarea: () => eliminarTarea_(usuario, datos),
      planilla: () => planilla_(usuario, ctx),
      agregarPersona: () => agregarPersona_(usuario, datos),
      actualizarPersona: () => actualizarPersona_(usuario, datos),
      nuevoCodigo: () => regenerarCodigo_(usuario, datos),
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

/** Valida la tarea a la que se liga un registro: debe ser del usuario y no estar cancelada. '' si no hay. */
function validarTareaLigada_(u, tareaId) {
  const id = String(tareaId || '').trim();
  if (!id) return '';
  const t = leerTareas_().find(x => x.id === id);
  if (!t || t.asignada_a_id !== u.id || t.estado === 'cancelada') throw new ErrorApp('Tarea inválida.');
  return id;
}

function registrar_(u, d) {
  const c = validarCampos_(d);
  return conBloqueo_(() => {
    verificarCruce_(leerRegistros_(), u.id, c, null);
    const tarea_id = validarTareaLigada_(u, d.tarea_id);
    const fila = Object.assign({
      id: Utilities.getUuid(), creado: new Date().toISOString(), miembro_id: u.id, miembro: u.nombre,
      area: u.area, tarea_id,
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
    const tarea_id = validarTareaLigada_(u, d.tarea_id);
    const nuevo = Object.assign({}, r, c, estadoInicial_(u), { tarea_id });
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
    const titulos = {};
    leerTareas_().forEach(t => { titulos[t.id] = t.titulo; });
    // Incluye los rechazados, con su estado, para poder filtrarlos en Excel.
    salida.detalle = base
      .sort((x, y) => x.fecha.localeCompare(y.fecha) || x.miembro.localeCompare(y.miembro) || x.inicio.localeCompare(y.inicio))
      .map(r => ({ fecha: r.fecha, inicio: r.inicio, fin: r.fin, horas: r.horas, miembro: r.miembro, rol: r.rol,
        area: r.area, descripcion: r.descripcion, enlace: r.enlace, estado: r.estado,
        revisado_por: r.revisado_por, comentario: r.comentario, tarea: titulos[r.tarea_id] || '' }));
  }
  return salida;
}

/* ------------------------------------------------------------------ */
/* Tareas (metas con plazo)                                            */
/* ------------------------------------------------------------------ */

/** Valida y normaliza los campos editables de una tarea. `plazoActual`: plazo vigente (si se edita). */
function validarCamposTarea_(d, plazoActual) {
  const titulo = String(d.titulo || '').trim();
  if (titulo.length < 3) throw new ErrorApp('Escribe un título (mín. 3 caracteres).');
  if (titulo.length > 150) throw new ErrorApp('El título es muy largo (máx. 150).');
  const descripcion = String(d.descripcion || '').trim();
  if (descripcion.length > 1000) throw new ErrorApp('La descripción es muy larga (máx. 1000).');

  const plazo = String(d.plazo || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plazo)) throw new ErrorApp('Plazo inválido.');
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  if (plazo < hoy && plazo !== plazoActual) throw new ErrorApp('El plazo no puede estar en el pasado.');

  const tipo_plazo = d.tipo_plazo ? String(d.tipo_plazo) : 'fecha';
  if (TIPOS_PLAZO.indexOf(tipo_plazo) === -1) throw new ErrorApp('Tipo de plazo inválido.');
  const prioridad = d.prioridad ? String(d.prioridad) : 'normal';
  if (PRIORIDADES.indexOf(prioridad) === -1) throw new ErrorApp('Prioridad inválida.');
  return { titulo, descripcion, plazo, tipo_plazo, prioridad };
}

/** Suma de horas (no rechazadas) de los registros ligados a cada tarea: { tarea_id: horas }. */
function horasPorTarea_() {
  const h = {};
  leerRegistros_().forEach(r => {
    if (r.tarea_id && r.estado !== 'rechazado') h[r.tarea_id] = (h[r.tarea_id] || 0) + r.horas;
  });
  return h;
}

function tareas_(u, d) {
  const vista = String(d.vista || 'mias');
  let ts = leerTareas_();
  if (vista === 'mias') ts = ts.filter(t => t.asignada_a_id === u.id);
  else if (vista === 'asignadas') {
    if (!esRevisor_(u)) throw new ErrorApp('No tienes permiso para asignar tareas.');
    ts = ts.filter(t => t.asignada_por_id === u.id);
  } else if (vista === 'todas') {
    if (!esAdmin_(u)) throw new ErrorApp('Solo el administrador ve todas las tareas.');
  } else throw new ErrorApp('Vista inválida.');
  if (d.estado && ESTADOS_TAREA.indexOf(d.estado) !== -1) ts = ts.filter(t => t.estado === d.estado);

  const horas = horasPorTarea_();
  const abierta = t => t.estado === 'pendiente' || t.estado === 'en_progreso';
  const abiertas = ts.filter(abierta).sort((a, b) => a.plazo.localeCompare(b.plazo));
  const cerradas = ts.filter(t => !abierta(t)).sort((a, b) => b.plazo.localeCompare(a.plazo));
  return { tareas: abiertas.concat(cerradas).map(t => Object.assign({}, t, { horas: horas[t.id] || 0 })) };
}

function crearTarea_(u, d, ctx) {
  const p = ctx.porId[String(d.asignada_a_id || '')];
  if (!p || !p.activo || !p.area || !puedeRevisar_(u, p.id, p.area, ctx)) {
    throw new ErrorApp('No puedes asignar tareas a esa persona.');
  }
  const c = validarCamposTarea_(d, null);
  return conBloqueo_(() => {
    const fila = Object.assign({
      id: Utilities.getUuid(), creada: new Date().toISOString(),
      asignada_por_id: u.id, asignada_por: u.nombre,
      asignada_a_id: p.id, asignada_a: p.nombre, area: p.area,
    }, c, { estado: 'pendiente', completada_en: '', nota: '' });
    hoja_(HOJA_TAREAS).appendRow(COLS_TAREAS.map(col => seguro_(fila[col])));
    return { tarea: fila };
  });
}

function escribirTarea_(hoja, i, t) {
  hoja.getRange(i + 2, 1, 1, COLS_TAREAS.length).setValues([COLS_TAREAS.map(col => seguro_(t[col]))]);
}

function editarTarea_(u, d) {
  return conBloqueo_(() => {
    const { hoja, filas } = filasTareas_();
    const i = filas.findIndex(t => t.id === String(d.id || ''));
    if (i === -1) throw new ErrorApp('Tarea no encontrada.');
    const t = filas[i];
    if (t.asignada_por_id !== u.id) throw new ErrorApp('Solo quien creó la tarea puede editarla.');
    const nueva = Object.assign({}, t, validarCamposTarea_(d, t.plazo));
    escribirTarea_(hoja, i, nueva);
    return { tarea: nueva };
  });
}

function actualizarTarea_(u, d) {
  const estado = String(d.estado || '');
  if (ESTADOS_TAREA.indexOf(estado) === -1) throw new ErrorApp('Estado inválido.');
  return conBloqueo_(() => {
    const { hoja, filas } = filasTareas_();
    const i = filas.findIndex(t => t.id === String(d.id || ''));
    if (i === -1) throw new ErrorApp('Tarea no encontrada.');
    const t = filas[i];
    const creador = t.asignada_por_id === u.id, asignado = t.asignada_a_id === u.id;
    if (!creador && !asignado) throw new ErrorApp('No tienes permiso sobre esta tarea.');
    if (!creador && estado === 'cancelada') throw new ErrorApp('Solo quien creó la tarea puede cancelarla.');
    const nueva = Object.assign({}, t, { estado });
    if (asignado && d.nota !== undefined) {
      nueva.nota = String(d.nota || '').trim();
      if (nueva.nota.length > 500) throw new ErrorApp('La nota es muy larga (máx. 500).');
    }
    if (estado === 'hecha') {
      if (t.estado !== 'hecha') nueva.completada_en = new Date().toISOString();
    } else nueva.completada_en = '';
    escribirTarea_(hoja, i, nueva);
    return { tarea: nueva };
  });
}

function eliminarTarea_(u, d) {
  return conBloqueo_(() => {
    const { hoja, filas } = filasTareas_();
    const id = String(d.id || '');
    const i = filas.findIndex(t => t.id === id);
    if (i === -1) throw new ErrorApp('Tarea no encontrada.');
    if (filas[i].asignada_por_id !== u.id) throw new ErrorApp('Solo quien creó la tarea puede eliminarla.');
    hoja.deleteRow(i + 2);
    return { eliminada: id };
  });
}

/* ------------------------------------------------------------------ */
/* Planilla (gestión de personas)                                      */
/* ------------------------------------------------------------------ */

const ROLES = ['miembro', 'coordinador', 'admin'];
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ¿Puede `u` modificar a la persona `p`? Admin: a todos. Coordinador: miembros de sus áreas. */
function puedeGestionar_(u, p) {
  if (esAdmin_(u)) return true;
  if (u.rol === 'coordinador') return p.rol === 'miembro' && u.coordina.indexOf(normalizar_(p.area)) !== -1;
  return false;
}

/** Persona tal como la ve la planilla. NUNCA incluye el código de acceso. */
function personaPlanilla_(m, u) {
  return {
    id: m.id, nombre: m.nombre, email: m.email, area: m.area, rol: m.rol,
    coordina: m.coordinaNombres, activo: m.activo, tiene_codigo: !!m.codigo,
    editable: puedeGestionar_(u, m),
  };
}

function planilla_(u, ctx) {
  if (!esRevisor_(u)) throw new ErrorApp('No tienes permiso para gestionar la planilla.');
  const visibles = ctx.miembros.filter(m => esAdmin_(u) || u.coordina.indexOf(normalizar_(m.area)) !== -1);
  const personas = visibles.map(m => personaPlanilla_(m, u))
    .sort((a, b) => a.area.localeCompare(b.area) || a.nombre.localeCompare(b.nombre));
  let areas;
  if (esAdmin_(u)) {
    areas = ctx.areas.slice();
    ctx.miembros.forEach(m => { if (m.area && areas.indexOf(m.area) === -1) areas.push(m.area); });
    areas.sort((a, b) => a.localeCompare(b));
  } else areas = u.coordinaNombres.slice();
  return { personas, areas };
}

function validarNombrePersona_(v) {
  const nombre = String(v === undefined || v === null ? '' : v).trim();
  if (nombre.length < 3) throw new ErrorApp('Escribe el nombre (mín. 3 caracteres).');
  if (nombre.length > 100) throw new ErrorApp('El nombre es muy largo (máx. 100).');
  return nombre;
}

/** Email opcional; si viene, con formato válido y sin repetir entre `miembros` (salvo `ignorarId`). */
function validarEmailPersona_(v, miembros, ignorarId) {
  const email = String(v === undefined || v === null ? '' : v).trim();
  if (!email) return '';
  if (email.length > 150 || !RE_EMAIL.test(email)) throw new ErrorApp('El email no es válido.');
  if (miembros.some(m => m.id !== ignorarId && normalizar_(m.email) === normalizar_(email))) {
    throw new ErrorApp('Ya hay otra persona con ese email.');
  }
  return email;
}

/** Área permitida para `u`: el coordinador, solo las suyas (devuelve el nombre como él lo tiene). */
function validarAreaPersona_(u, v) {
  const area = String(v === undefined || v === null ? '' : v).trim();
  if (!area) throw new ErrorApp('Indica el área.');
  if (area.length > 100) throw new ErrorApp('El área es muy larga (máx. 100).');
  if (esAdmin_(u)) return area;
  const i = u.coordina.indexOf(normalizar_(area));
  if (i === -1) throw new ErrorApp('Solo puedes gestionar personas de las áreas que coordinas.');
  return u.coordinaNombres[i];
}

function validarRolPersona_(v) {
  const rol = normalizar_(v);
  if (ROLES.indexOf(rol) === -1) throw new ErrorApp('Rol inválido.');
  return rol;
}

/** Texto "A, B" (o arreglo) de áreas que coordina -> "A, B" limpio. */
function textoCoordina_(v) {
  const lista = Array.isArray(v) ? v : String(v === undefined || v === null ? '' : v).split(',');
  const limpia = [];
  lista.map(x => String(x).trim()).filter(Boolean).forEach(x => {
    if (limpia.some(y => normalizar_(y) === normalizar_(x))) return;
    limpia.push(x);
  });
  const texto = limpia.join(', ');
  if (texto.length > 300) throw new ErrorApp('La lista de áreas que coordina es muy larga.');
  return texto;
}

function aBooleano_(v) {
  if (v === true || v === false) return v;
  const t = normalizar_(v);
  if (/^(si|sí|true|1)$/.test(t)) return true;
  if (/^(no|false|0)$/.test(t)) return false;
  throw new ErrorApp('Valor de "activo" inválido.');
}

function exigirRevisor_(u) {
  if (!esRevisor_(u)) throw new ErrorApp('No tienes permiso para gestionar la planilla.');
}

/** Agrega una persona con un código de acceso nuevo, que se devuelve esta única vez. */
function agregarPersona_(u, d) {
  exigirRevisor_(u);
  return conBloqueo_(() => {
    const miembros = leerMiembros_();
    const nombre = validarNombrePersona_(d.nombre);
    const email = validarEmailPersona_(d.email, miembros, null);
    const area = validarAreaPersona_(u, d.area);
    let rol = 'miembro', coordina = '';
    if (esAdmin_(u)) {
      if (d.rol !== undefined && d.rol !== null && d.rol !== '') rol = validarRolPersona_(d.rol);
      if (rol === 'coordinador') coordina = textoCoordina_(d.coordina);
    }
    let mayor = 0;
    miembros.forEach(m => { const x = /^m(\d+)$/.exec(m.id); if (x) mayor = Math.max(mayor, Number(x[1])); });
    const id = 'm' + String(mayor + 1).padStart(3, '0');
    const usados = {};
    miembros.forEach(m => { usados[m.codigo] = true; });
    const codigo = nuevoCodigo_(usados);
    const fila = { id, nombre, email, area, rol, coordina, codigo, activo: 'sí' };
    hoja_(HOJA_MIEMBROS).appendRow(COLS_MIEMBROS.map(col => seguro_(fila[col])));
    const persona = leerMiembros_().find(m => m.id === id);
    return { persona: personaPlanilla_(persona, u), codigo };
  });
}

/** Busca la fila de una persona y verifica que `u` pueda gestionarla. */
function personaGestionable_(u, id) {
  const tabla = leerTabla_(HOJA_MIEMBROS, COLS_MIEMBROS);
  const i = tabla.filas.findIndex(f => String(f.id).trim() === id);
  const persona = i === -1 ? null : leerMiembros_().find(m => m.id === id);
  if (!persona) throw new ErrorApp('Persona no encontrada.');
  if (!puedeGestionar_(u, persona)) {
    throw new ErrorApp(u.rol === 'coordinador'
      ? 'Solo puedes gestionar a los miembros de las áreas que coordinas.'
      : 'No tienes permiso para gestionar la planilla.');
  }
  return { hoja: tabla.hoja, fila: tabla.filas[i], i, persona };
}

/** Cambia solo los campos que vienen. El coordinador no toca rol ni coordina. */
function actualizarPersona_(u, d) {
  exigirRevisor_(u);
  const id = String(d.id || '').trim();
  return conBloqueo_(() => {
    const { hoja, fila, i, persona } = personaGestionable_(u, id);
    const hay = k => d[k] !== undefined;
    if (u.rol === 'coordinador' && (hay('rol') || hay('coordina'))) {
      throw new ErrorApp('Solo el administrador puede cambiar el rol o las áreas que coordina.');
    }
    const cambios = {};
    if (hay('nombre')) cambios.nombre = validarNombrePersona_(d.nombre);
    if (hay('email')) cambios.email = validarEmailPersona_(d.email, leerMiembros_(), id);
    if (hay('area')) cambios.area = validarAreaPersona_(u, d.area);
    if (hay('activo')) {
      const activo = aBooleano_(d.activo);
      if (!activo && persona.id === u.id) throw new ErrorApp('No puedes desactivarte a ti mismo.');
      cambios.activo = activo ? 'sí' : 'no';
    }
    let rol = persona.rol;
    if (esAdmin_(u) && hay('rol')) {
      rol = validarRolPersona_(d.rol);
      if (persona.id === u.id && rol !== persona.rol) throw new ErrorApp('No puedes cambiar tu propio rol.');
      cambios.rol = rol;
    }
    if (rol !== 'coordinador') cambios.coordina = '';
    else if (esAdmin_(u) && hay('coordina')) cambios.coordina = textoCoordina_(d.coordina);
    const nueva = Object.assign({}, fila, cambios);
    hoja.getRange(i + 2, 1, 1, COLS_MIEMBROS.length)
      .setValues([COLS_MIEMBROS.map(col => seguro_(nueva[col]))]);
    return { persona: personaPlanilla_(leerMiembros_().find(m => m.id === id), u) };
  });
}

/** Genera un código nuevo (el anterior deja de servir) y lo devuelve esta única vez. */
function regenerarCodigo_(u, d) {
  exigirRevisor_(u);
  const id = String(d.id || '').trim();
  return conBloqueo_(() => {
    const { hoja } = personaGestionable_(u, id);
    const miembros = leerMiembros_();
    const usados = {};
    miembros.forEach(m => { usados[m.codigo] = true; });
    const codigo = nuevoCodigo_(usados);
    const i = leerTabla_(HOJA_MIEMBROS, COLS_MIEMBROS).filas.findIndex(f => String(f.id).trim() === id);
    hoja.getRange(i + 2, COLS_MIEMBROS.indexOf('codigo') + 1).setNumberFormat('@').setValue(codigo);
    return { codigo };
  });
}

/** Código de 8 dígitos, sin 0 inicial (para que Sheets no lo recorte), que no esté en `usados`. */
function nuevoCodigo_(usados) {
  let c;
  do {
    c = String(1 + Math.floor(Math.random() * 9));
    for (let k = 0; k < 7; k++) c += Math.floor(Math.random() * 10);
  } while (usados[c]);
  return c;
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
      email: String(m.email || '').trim(),
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
    tarea_id: String(r.tarea_id || ''),
  };
}

function limpiarTarea_(r) {
  const plazo = r.plazo instanceof Date
    ? Utilities.formatDate(r.plazo, ZONA, 'yyyy-MM-dd') : String(r.plazo || '').trim();
  return {
    id: String(r.id), creada: String(r.creada), asignada_por_id: String(r.asignada_por_id),
    asignada_por: String(r.asignada_por), asignada_a_id: String(r.asignada_a_id),
    asignada_a: String(r.asignada_a), area: String(r.area), titulo: String(r.titulo),
    descripcion: String(r.descripcion), plazo,
    tipo_plazo: TIPOS_PLAZO.indexOf(String(r.tipo_plazo)) !== -1 ? String(r.tipo_plazo) : 'fecha',
    prioridad: PRIORIDADES.indexOf(String(r.prioridad)) !== -1 ? String(r.prioridad) : 'normal',
    estado: ESTADOS_TAREA.indexOf(String(r.estado)) !== -1 ? String(r.estado) : 'pendiente',
    completada_en: String(r.completada_en || ''), nota: String(r.nota || ''),
  };
}

function filasTareas_() {
  const t = leerTabla_(HOJA_TAREAS, COLS_TAREAS);
  t.filas = t.filas.filter(f => String(f.id).trim()).map(limpiarTarea_);
  return t;
}

function leerTareas_() { return filasTareas_().filas; }

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
  // Hojas ya existentes: agrega el encabezado de tarea_id si falta.
  const colTarea = COLS_REGISTROS.indexOf('tarea_id') + 1;
  if (reg.getLastRow() > 0 && !String(reg.getRange(1, colTarea).getValues()[0][0] || '').trim()) {
    reg.getRange(1, colTarea).setValue('tarea_id');
    reg.getRange(1, colTarea).setFontWeight('bold');
  }
  const tar = crear(HOJA_TAREAS, COLS_TAREAS);
  tar.getRange('J:J').setNumberFormat('@'); // plazo como texto
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
      const c = nuevoCodigo_(usados);
      usados[c] = true;
      hoja.getRange(i + 2, col).setNumberFormat('@').setValue(c);
      n++;
    }
  });
  try { SpreadsheetApp.getUi().alert(n + ' código(s) generado(s).'); } catch (e) { /* sin UI */ }
}
