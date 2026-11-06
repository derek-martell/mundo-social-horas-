/**
 * Modo demostración: un backend simulado en memoria, con datos de ejemplo.
 * Sigue las mismas reglas que apps-script/Code.gs.
 * Se activa cuando config.js no tiene una URL configurada, o con ?demo=1 en la dirección.
 * Nada de lo que se haga en este modo se guarda: al recargar la página vuelve al estado inicial.
 */
(function () {
  'use strict';

  const MIEMBROS = [
    { id: 'm01', nombre: 'Lucía Ramos', email: 'lucia@ejemplo.org', activo: true, area: 'Dirección', rol: 'admin', coordina: [] },
    { id: 'm02', nombre: 'Diego Salazar', email: 'diego@ejemplo.org', activo: true, area: 'Redacción', rol: 'coordinador', coordina: ['Redacción'] },
    { id: 'm03', nombre: 'Valeria Quispe', email: 'valeria@ejemplo.org', activo: true, area: 'Redacción', rol: 'miembro', coordina: [] },
    { id: 'm04', nombre: 'Andrés Huamán', email: 'andres@ejemplo.org', activo: true, area: 'Redacción', rol: 'miembro', coordina: [] },
    { id: 'm05', nombre: 'Camila Torres', email: 'camila@ejemplo.org', activo: true, area: 'Redes sociales', rol: 'coordinador', coordina: ['Redes sociales'] },
    { id: 'm06', nombre: 'Jorge Mendoza', email: 'jorge@ejemplo.org', activo: true, area: 'Redes sociales', rol: 'miembro', coordina: [] },
    { id: 'm07', nombre: 'Rosa Paredes', email: 'rosa@ejemplo.org', activo: true, area: 'Diseño', rol: 'coordinador', coordina: ['Diseño'] },
    { id: 'm08', nombre: 'Luis Castro', email: 'luis@ejemplo.org', activo: true, area: 'Diseño', rol: 'miembro', coordina: [] },
    { id: 'm10', nombre: 'Pedro Ríos', email: 'pedro@ejemplo.org', activo: false, area: 'Redacción', rol: 'miembro', coordina: [] }, // ya no participa
    { id: 'm09', nombre: 'Sofía Vargas', email: 'sofia@ejemplo.org', activo: true, area: 'Investigación', rol: 'miembro', coordina: [] }, // área sin coordinador
  ];
  const CODIGOS = { 'DEMO-ADMIN': 'm01', 'DEMO-COORD': 'm02', 'DEMO-MIEMBRO': 'm03' };
  const AREAS = Array.from(new Set(MIEMBROS.map((m) => m.area))).sort((a, b) => a.localeCompare(b));

  const TAREAS = {
    'Dirección': ['Reunión con coordinadores', 'Revisión del calendario editorial', 'Planificación del mes'],
    'Redacción': ['Nota sobre la inflación en Lima Metropolitana (dato del INEI)', 'Borrador: informalidad laboral juvenil',
      'Explicador del tipo de cambio y las intervenciones del BCRP', 'Nota sobre el PBI de setiembre', 'Corrección de estilo de 3 notas'],
    'Redes sociales': ['Hilo sobre precios de alimentos', 'Programación de publicaciones de la semana', 'Video corto sobre el sol peruano'],
    'Diseño': ['Infografía de empleo formal', 'Gráficos del artículo de exportaciones', 'Plantillas para redes'],
    'Investigación': ['Procesamiento de la ENAHO: pobreza por región', 'Búsqueda de series del BCRP', 'Entrevista a un economista'],
  };

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const aMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hoyStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const norm = (s) => String(s || '').trim().toLowerCase();
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const ordenar = (a, b) => b.fecha.localeCompare(a.fecha) || b.inicio.localeCompare(a.inicio);

  const tieneCoordinador = (area) => MIEMBROS.some((m) => m.rol === 'coordinador' && m.coordina.map(norm).includes(norm(area)));
  function puedeRevisar(u, miembroId, area) {
    if (miembroId === u.id) return false;
    const m = MIEMBROS.find((x) => x.id === miembroId) || { rol: 'miembro', area };
    if (u.rol === 'coordinador') return m.rol === 'miembro' && u.coordina.map(norm).includes(norm(area || m.area));
    if (u.rol === 'admin') return m.rol !== 'miembro' || !tieneCoordinador(area || m.area);
    return false;
  }
  const AUTO = 'Aprobación automática (admin)';
  const revisorDe = (m) => (m.rol === 'admin' ? { nombre: AUTO } : MIEMBROS.find((x) => puedeRevisar(x, m.id, m.area)) || MIEMBROS[0]);
  const rolDe = (id) => (MIEMBROS.find((x) => x.id === id) || { rol: 'miembro' }).rol;
  const estadoInicial = (u) => (u.rol === 'admin'
    ? { estado: 'aprobado', revisado_por: AUTO, revisado_en: new Date().toISOString(), comentario: '' }
    : { estado: 'pendiente', revisado_por: '', revisado_en: '', comentario: '' });

  // Generador pseudoaleatorio con semilla, para que la demo sea igual en cada carga.
  let semilla = 42;
  const rnd = () => { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; };
  const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];

  const registros = [];
  (function sembrar() {
    const [y, mo, d] = hoyStr().split('-').map(Number);
    for (let k = 34; k >= 0; k--) {
      const dia = new Date(y, mo - 1, d - k);
      const dow = dia.getDay();
      if (dow === 0) continue;
      MIEMBROS.forEach((mi) => {
        if (dow === 6 && rnd() > 0.25) return;
        if (rnd() < 0.15) return;
        let t = elegir([8 * 60, 8 * 60 + 30, 9 * 60, 10 * 60, 14 * 60]);
        const bloques = 1 + Math.floor(rnd() * 3);
        for (let b = 0; b < bloques && t < 20 * 60; b++) {
          const dur = elegir([45, 60, 90, 120, 150, 180]);
          let estado = k <= 6 ? (rnd() < 0.3 ? 'aprobado' : 'pendiente') : (rnd() < 0.94 ? 'aprobado' : 'rechazado');
          if (k === 0) estado = 'pendiente';
          if (mi.rol === 'admin') estado = 'aprobado';
          registros.push({
            id: uuid(), creado: dia.toISOString() + b, miembro_id: mi.id, miembro: mi.nombre, area: mi.area,
            fecha: ymd(dia), inicio: hhmm(t), fin: hhmm(t + dur), horas: dur / 60,
            descripcion: elegir(TAREAS[mi.area]), enlace: mi.area === 'Redacción' && rnd() < 0.4 ? 'https://example.com/borrador' : '',
            estado, revisado_por: estado === 'pendiente' ? '' : revisorDe(mi).nombre, revisado_en: '',
            comentario: estado === 'rechazado' ? 'Ese día no hubo reunión; revisa la fecha.' : '',
          });
          t += dur + elegir([0, 15, 30, 60]);
        }
      });
    }
  })();

  // ---------- Tareas de ejemplo ----------
  const tareas = [];
  (function sembrarTareas() {
    const [y, mo, d] = hoyStr().split('-').map(Number);
    const hoy = new Date(y, mo - 1, d);
    const finSemana = ymd(new Date(y, mo - 1, d + ((7 - hoy.getDay()) % 7)));
    const finMes = ymd(new Date(y, mo, 0));
    const hace = (n) => ymd(new Date(y, mo - 1, d - n));
    const quien = (id) => MIEMBROS.find((m) => m.id === id);
    const nueva = (de, para, titulo, descripcion, tipo, prioridad, estado, plazoFijo) => {
      const a = quien(de), b = quien(para);
      const t = {
        id: uuid(), creada: new Date(y, mo - 1, d - 8).toISOString(), asignada_por_id: a.id, asignada_por: a.nombre,
        asignada_a_id: b.id, asignada_a: b.nombre, area: b.area, titulo, descripcion,
        plazo: plazoFijo || (tipo === 'semana' ? finSemana : finMes), tipo_plazo: plazoFijo ? 'fecha' : tipo,
        prioridad, estado, completada_en: estado === 'hecha' ? new Date(y, mo - 1, d - 1).toISOString() : '', nota: '',
      };
      tareas.push(t);
      // Liga algunas horas recientes de la persona a la tarea
      registros.filter((r) => r.miembro_id === b.id && !r.tarea_id && r.estado !== 'rechazado')
        .sort(ordenar).slice(0, estado === 'pendiente' ? 0 : 2).forEach((r) => { r.tarea_id = t.id; });
      return t;
    };
    nueva('m02', 'm03', 'Nota sobre la inflación de noviembre', 'Usar el dato del INEI que sale el día 1. Incluir gráfico de Lima Metropolitana.', 'semana', 'alta', 'en_progreso');
    nueva('m02', 'm03', 'Revisar cifras de empleo formal', 'Contrastar con la planilla electrónica antes de publicar.', 'semana', 'normal', 'pendiente');
    nueva('m02', 'm03', 'Explicador del tipo de cambio', '', 'mes', 'normal', 'hecha');
    nueva('m02', 'm04', 'Procesar la ENAHO: pobreza regional', 'Tabla por departamento con factores de expansión.', 'mes', 'alta', 'en_progreso');
    nueva('m02', 'm04', 'Borrador sobre informalidad juvenil', 'Primera versión para revisión.', 'fecha', 'normal', 'pendiente', hace(2));
    nueva('m05', 'm06', 'Calendario de publicaciones de diciembre', '', 'mes', 'normal', 'pendiente');
    nueva('m05', 'm06', 'Hilo sobre precios de alimentos', '', 'semana', 'normal', 'hecha');
    nueva('m07', 'm08', 'Infografía de empleo formal', 'Formato vertical para redes y horizontal para la web.', 'semana', 'alta', 'en_progreso');
    nueva('m01', 'm02', 'Cerrar la edición de noviembre', 'Todas las notas del mes revisadas y publicadas.', 'mes', 'alta', 'en_progreso');
    nueva('m01', 'm05', 'Reporte de alcance en redes', 'Alcance e interacciones de la semana.', 'semana', 'normal', 'pendiente');
    nueva('m01', 'm07', 'Plantillas nuevas para gráficos', '', 'mes', 'normal', 'hecha');
    nueva('m01', 'm09', 'Base de datos de pobreza por distrito', 'Investigación no tiene coordinador: me reportas a mí.', 'mes', 'normal', 'pendiente');
  })();

  class ErrorDemo extends Error {}

  // ---------- Planilla ----------
  function puedeGestionar(u, m) {
    if (u.rol === 'admin') return true;
    return u.rol === 'coordinador' && m.rol === 'miembro' && u.coordina.map(norm).includes(norm(m.area));
  }
  const persona = (u, m) => ({ id: m.id, nombre: m.nombre, email: m.email || '', area: m.area, rol: m.rol,
    coordina: m.coordina.slice(), activo: m.activo !== false, tiene_codigo: true, editable: puedeGestionar(u, m) });
  function nuevoCodigo() {
    let c;
    do { c = String(1 + Math.floor(Math.random() * 9)); for (let k = 0; k < 7; k++) c += Math.floor(Math.random() * 10); } while (CODIGOS[c]);
    return c;
  }
  function validarPersona(u, d, actual) {
    const nombre = String(d.nombre || '').trim();
    if (nombre.length < 3 || nombre.length > 100) throw new ErrorDemo('El nombre debe tener entre 3 y 100 caracteres.');
    const email = String(d.email || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorDemo('El correo no es válido.');
    if (email && MIEMBROS.some((m) => m !== actual && (m.email || '').toLowerCase() === email)) throw new ErrorDemo('Ya hay otra persona con ese correo.');
    let area = String(d.area || '').trim();
    if (!area) throw new ErrorDemo('Elige el área.');
    if (u.rol !== 'admin') {
      const propia = u.coordina.find((a) => norm(a) === norm(area));
      if (!propia) throw new ErrorDemo('Solo puedes gestionar personas de tu área.');
      area = propia;
      return { nombre, email, area };
    }
    const rol = ['miembro', 'coordinador', 'admin'].includes(d.rol) ? d.rol : 'miembro';
    const coordina = rol === 'coordinador' ? String(d.coordina || '').split(',').map((x) => x.trim()).filter(Boolean) : [];
    return { nombre, email, area, rol, coordina };
  }

  const ESTADOS_TAREA = ['pendiente', 'en_progreso', 'hecha', 'cancelada'];
  const horasDe = (id) => registros.filter((r) => r.tarea_id === id && r.estado !== 'rechazado').reduce((a, r) => a + r.horas, 0);
  const conHoras = (t) => Object.assign(copia(t), { horas: horasDe(t.id) });
  const abierta = (t) => t.estado !== 'hecha' && t.estado !== 'cancelada';
  const ordenTareas = (a, b) => (abierta(b) - abierta(a)) || (abierta(a) ? a.plazo.localeCompare(b.plazo) : b.plazo.localeCompare(a.plazo));
  function validarTarea(d, plazoAnterior) {
    const titulo = String(d.titulo || '').trim();
    if (titulo.length < 3 || titulo.length > 150) throw new ErrorDemo('El título debe tener entre 3 y 150 caracteres.');
    const descripcion = String(d.descripcion || '').trim().slice(0, 1000);
    const plazo = String(d.plazo || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plazo)) throw new ErrorDemo('Indica el plazo.');
    if (plazo < hoyStr() && plazo !== plazoAnterior) throw new ErrorDemo('El plazo no puede estar en el pasado.');
    return { titulo, descripcion, plazo,
      tipo_plazo: ['semana', 'mes', 'fecha'].includes(d.tipo_plazo) ? d.tipo_plazo : 'fecha',
      prioridad: d.prioridad === 'alta' ? 'alta' : 'normal' };
  }
  function tareaLigable(u, id) {
    if (!id) return '';
    const t = tareas.find((x) => x.id === id);
    if (!t || t.asignada_a_id !== u.id || t.estado === 'cancelada') throw new ErrorDemo('Tarea inválida.');
    return id;
  }

  function validar(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) throw new ErrorDemo('Fecha inválida.');
    if (d.fecha > hoyStr()) throw new ErrorDemo('No puedes registrar horas en una fecha futura.');
    if (!/^\d{2}:\d{2}$/.test(d.inicio || '') || !/^\d{2}:\d{2}$/.test(d.fin || '')) throw new ErrorDemo('Indica la hora de inicio y de fin.');
    const min = aMin(d.fin) - aMin(d.inicio);
    if (min < 15) throw new ErrorDemo('La hora de fin debe ser al menos 15 minutos después del inicio.');
    if (String(d.descripcion || '').trim().length < 3) throw new ErrorDemo('Agrega una descripción.');
    const enlace = String(d.enlace || '').trim();
    if (enlace && !/^https?:\/\/\S+$/i.test(enlace)) throw new ErrorDemo('El enlace debe empezar con http:// o https://');
    return { fecha: d.fecha, inicio: d.inicio, fin: d.fin, horas: Math.round(min / 15) / 4,
      descripcion: String(d.descripcion).trim(), enlace };
  }
  function cruce(uid, c, ignorar) {
    const x = registros.find((r) => r.miembro_id === uid && r.id !== ignorar && r.fecha === c.fecha &&
      r.estado !== 'rechazado' && aMin(r.inicio) < aMin(c.fin) && aMin(c.inicio) < aMin(r.fin));
    if (x) throw new ErrorDemo(`Se cruza con otro registro tuyo de ${x.inicio} a ${x.fin}.`);
  }
  const enRango = (r, d) => (!d.desde || r.fecha >= d.desde) && (!d.hasta || r.fecha <= d.hasta) &&
    (!d.mes || r.fecha.slice(0, 7) === d.mes);

  const acciones = {
    login: (u) => ({ usuario: { id: u.id, nombre: u.nombre, area: u.area, rol: u.rol, coordina: u.coordina }, areas: AREAS }),
    registrar(u, d) {
      const c = validar(d); cruce(u.id, c);
      const r = Object.assign({ id: uuid(), creado: new Date().toISOString(), miembro_id: u.id, miembro: u.nombre,
        area: u.area, tarea_id: tareaLigable(u, d.tarea_id) }, estadoInicial(u), c);
      registros.push(r);
      return { registro: copia(r) };
    },
    editar(u, d) {
      const r = registros.find((x) => x.id === d.id);
      if (!r || r.miembro_id !== u.id) throw new ErrorDemo('Registro no encontrado.');
      if (r.estado === 'aprobado' && u.rol !== 'admin') throw new ErrorDemo('No se puede editar un registro aprobado.');
      const c = validar(d); cruce(u.id, c, r.id);
      Object.assign(r, c, estadoInicial(u), { tarea_id: tareaLigable(u, d.tarea_id) });
      return { registro: copia(r) };
    },
    misHoras: (u, d) => ({ registros: copia(registros.filter((r) => r.miembro_id === u.id && enRango(r, d)).sort(ordenar)) }),
    eliminar(u, d) {
      const i = registros.findIndex((x) => x.id === d.id);
      if (i === -1 || registros[i].miembro_id !== u.id) throw new ErrorDemo('Registro no encontrado.');
      if (registros[i].estado === 'aprobado' && u.rol !== 'admin') throw new ErrorDemo('No se puede eliminar un registro aprobado.');
      registros.splice(i, 1);
      return { eliminado: d.id };
    },
    porRevisar(u, d) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para revisar horas.');
      return { registros: copia(registros.filter((r) => puedeRevisar(u, r.miembro_id, r.area) &&
        (!d.estado || r.estado === d.estado) && (!d.miembro_id || r.miembro_id === d.miembro_id) && enRango(r, d)).sort(ordenar)) };
    },
    tareas(u, d) {
      let ts;
      if (d.vista === 'asignadas') {
        if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para ver esas tareas.');
        ts = tareas.filter((t) => t.asignada_por_id === u.id);
      } else if (d.vista === 'todas') {
        if (u.rol !== 'admin') throw new ErrorDemo('No tienes permiso para ver esas tareas.');
        ts = tareas.slice();
      } else {
        ts = tareas.filter((t) => t.asignada_a_id === u.id);
      }
      if (ESTADOS_TAREA.includes(d.estado)) ts = ts.filter((t) => t.estado === d.estado);
      return { tareas: ts.sort(ordenTareas).map(conHoras) };
    },
    crearTarea(u, d) {
      const b = MIEMBROS.find((m) => m.id === d.asignada_a_id);
      const aSiMismo = b && b.id === u.id && u.rol === 'admin';
      if (!b || !(aSiMismo || puedeRevisar(u, b.id, b.area))) throw new ErrorDemo('No puedes asignar tareas a esa persona.');
      const t = Object.assign({ id: uuid(), creada: new Date().toISOString(), asignada_por_id: u.id, asignada_por: u.nombre,
        asignada_a_id: b.id, asignada_a: b.nombre, area: b.area, estado: 'pendiente', completada_en: '', nota: '' }, validarTarea(d));
      tareas.push(t);
      return { tarea: conHoras(t) };
    },
    editarTarea(u, d) {
      const t = tareas.find((x) => x.id === d.id);
      if (!t || t.asignada_por_id !== u.id) throw new ErrorDemo('Solo quien asignó la tarea puede editarla.');
      Object.assign(t, validarTarea(d, t.plazo));
      return { tarea: conHoras(t) };
    },
    actualizarTarea(u, d) {
      const t = tareas.find((x) => x.id === d.id);
      if (!t) throw new ErrorDemo('Tarea no encontrada.');
      const esCreador = t.asignada_por_id === u.id, esAsignado = t.asignada_a_id === u.id;
      const permitidos = esCreador ? ESTADOS_TAREA : esAsignado ? ['pendiente', 'en_progreso', 'hecha'] : [];
      if (!permitidos.includes(d.estado)) throw new ErrorDemo('No puedes cambiar esta tarea a ese estado.');
      if (t.estado !== 'hecha' && d.estado === 'hecha') t.completada_en = new Date().toISOString();
      if (d.estado !== 'hecha') t.completada_en = '';
      t.estado = d.estado;
      if (esAsignado && d.nota !== undefined) t.nota = String(d.nota).trim().slice(0, 500);
      return { tarea: conHoras(t) };
    },
    eliminarTarea(u, d) {
      const i = tareas.findIndex((x) => x.id === d.id);
      if (i === -1 || tareas[i].asignada_por_id !== u.id) throw new ErrorDemo('Solo quien asignó la tarea puede eliminarla.');
      tareas.splice(i, 1);
      return { eliminada: d.id };
    },
    planilla(u) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para ver la planilla.');
      const personas = MIEMBROS.filter((m) => u.rol === 'admin' || u.coordina.map(norm).includes(norm(m.area)))
        .map((m) => persona(u, m)).sort((a, b) => a.area.localeCompare(b.area) || a.nombre.localeCompare(b.nombre));
      const areas = u.rol === 'admin' ? Array.from(new Set(MIEMBROS.map((m) => m.area))).sort((a, b) => a.localeCompare(b)) : u.coordina.slice();
      return { personas, areas };
    },
    agregarPersona(u, d) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para gestionar la planilla.');
      const c = validarPersona(u, d, null);
      const n = Math.max(...MIEMBROS.map((m) => Number(m.id.slice(1)))) + 1;
      const m = Object.assign({ id: 'm' + String(n).padStart(2, '0'), activo: true }, c);
      if (u.rol !== 'admin') { m.rol = 'miembro'; m.coordina = []; }
      MIEMBROS.push(m);
      const codigo = nuevoCodigo();
      CODIGOS[codigo] = m.id;
      return { persona: persona(u, m), codigo };
    },
    actualizarPersona(u, d) {
      const m = MIEMBROS.find((x) => x.id === d.id);
      if (!m || !puedeGestionar(u, m)) throw new ErrorDemo('No puedes modificar a esta persona.');
      if (u.rol !== 'admin' && (d.rol !== undefined || d.coordina !== undefined)) throw new ErrorDemo('Solo el admin puede cambiar roles.');
      if (m.id === u.id && (d.activo === false || (d.rol && d.rol !== u.rol))) throw new ErrorDemo('No puedes desactivarte ni cambiar tu propio rol.');
      Object.assign(m, validarPersona(u, Object.assign({ nombre: m.nombre, email: m.email, area: m.area, rol: m.rol, coordina: m.coordina.join(', ') }, d), m));
      if (d.activo !== undefined) m.activo = !!d.activo;
      return { persona: persona(u, m) };
    },
    nuevoCodigo(u, d) {
      const m = MIEMBROS.find((x) => x.id === d.id);
      if (!m || !puedeGestionar(u, m)) throw new ErrorDemo('No puedes modificar a esta persona.');
      Object.keys(CODIGOS).forEach((k) => { if (CODIGOS[k] === m.id && !/^DEMO-/.test(k)) delete CODIGOS[k]; });
      const codigo = nuevoCodigo();
      CODIGOS[codigo] = m.id;
      return { codigo };
    },
    miembrosEquipo(u) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para ver otros calendarios.');
      return { miembros: MIEMBROS.filter((m) => m.activo !== false && puedeRevisar(u, m.id, m.area))
        .map((m) => ({ id: m.id, nombre: m.nombre, area: m.area, rol: m.rol }))
        .sort((a, b) => a.area.localeCompare(b.area) || a.nombre.localeCompare(b.nombre)) };
    },
    revisar(u, d) {
      if (d.estado === 'rechazado' && !String(d.comentario || '').trim()) throw new ErrorDemo('Indica el motivo del rechazo.');
      let n = 0;
      registros.forEach((r) => {
        if (d.ids.includes(r.id) && puedeRevisar(u, r.miembro_id, r.area)) {
          r.estado = d.estado; r.revisado_por = d.estado === 'pendiente' ? '' : u.nombre;
          r.comentario = String(d.comentario || ''); n++;
        }
      });
      if (!n) throw new ErrorDemo('No se actualizó ningún registro.');
      return { actualizados: n };
    },
    resumen(u, d) {
      const base = registros.map((r) => Object.assign({}, r, { rol: rolDe(r.miembro_id) })).filter((r) =>
        (u.rol === 'admin' || r.miembro_id === u.id || (u.rol === 'coordinador' && u.coordina.map(norm).includes(norm(r.area)))) &&
        (!d.soloAprobadas || r.estado === 'aprobado') && (!d.rol || r.rol === d.rol) &&
        (!d.desde || r.fecha.slice(0, 7) >= d.desde) && (!d.hasta || r.fecha.slice(0, 7) <= d.hasta));
      const rs = base.filter((r) => r.estado !== 'rechazado');
      const pm = {}, pa = {}; const t = { total: 0, aprobadas: 0, pendientes: 0, registros: rs.length };
      rs.forEach((r) => {
        const mes = r.fecha.slice(0, 7); const c = r.estado === 'aprobado' ? 'aprobadas' : 'pendientes';
        const k = r.miembro_id + mes;
        (pm[k] = pm[k] || { miembro: r.miembro, rol: r.rol, area: r.area, mes, aprobadas: 0, pendientes: 0 })[c] += r.horas;
        (pa[r.area] = pa[r.area] || { area: r.area, aprobadas: 0, pendientes: 0 })[c] += r.horas;
        t.total += r.horas; t[c] += r.horas;
      });
      const tot = (x) => x.aprobadas + x.pendientes;
      const salida = { totales: t,
        porPersonaMes: Object.values(pm).sort((a, b) => b.mes.localeCompare(a.mes) || a.area.localeCompare(b.area) || a.miembro.localeCompare(b.miembro)),
        porArea: Object.values(pa).sort((a, b) => tot(b) - tot(a)) };
      if (d.detalle) {
        salida.detalle = base.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.miembro.localeCompare(b.miembro) || a.inicio.localeCompare(b.inicio))
          .map((r) => ({ fecha: r.fecha, inicio: r.inicio, fin: r.fin, horas: r.horas, miembro: r.miembro, rol: r.rol, area: r.area,
            descripcion: r.descripcion, enlace: r.enlace, estado: r.estado, revisado_por: r.revisado_por, comentario: r.comentario,
            tarea: (tareas.find((t) => t.id === r.tarea_id) || {}).titulo || '' }));
      }
      return salida;
    },
  };

  window.MS_HORAS_DEMO = {
    codigos: [
      { codigo: 'DEMO-MIEMBRO', etiqueta: 'Miembro', quien: 'Valeria Quispe · Redacción' },
      { codigo: 'DEMO-COORD', etiqueta: 'Coordinador', quien: 'Diego Salazar · coordina Redacción' },
      { codigo: 'DEMO-ADMIN', etiqueta: 'Admin', quien: 'Lucía Ramos · aprueba a los coordinadores' },
    ],
    async llamar(accion, datos) {
      await new Promise((r) => setTimeout(r, 120));
      try {
        const u = MIEMBROS.find((m) => m.id === CODIGOS[String(datos.codigo || '').toUpperCase()]);
        if (!u || u.activo === false) throw new ErrorDemo('Código de acceso inválido.');
        const fn = acciones[accion];
        if (!fn) throw new ErrorDemo('Acción desconocida.');
        return Object.assign({ ok: true }, fn(u, datos));
      } catch (e) {
        return { ok: false, error: e instanceof ErrorDemo ? e.message : 'Error interno.' };
      }
    },
  };
})();
