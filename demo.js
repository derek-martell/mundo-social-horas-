/**
 * Modo demostración: un backend simulado en memoria, con datos de ejemplo.
 * Sigue las mismas reglas que apps-script/Code.gs.
 * Se activa cuando config.js no tiene una URL configurada, o con ?demo=1 en la dirección.
 * Nada de lo que se haga en este modo se guarda: al recargar la página vuelve al estado inicial.
 */
(function () {
  'use strict';

  const MIEMBROS = [
    { id: 'm01', nombre: 'Lucía Ramos', area: 'Dirección', rol: 'admin', coordina: [] },
    { id: 'm02', nombre: 'Diego Salazar', area: 'Redacción', rol: 'coordinador', coordina: ['Redacción'] },
    { id: 'm03', nombre: 'Valeria Quispe', area: 'Redacción', rol: 'miembro', coordina: [] },
    { id: 'm04', nombre: 'Andrés Huamán', area: 'Redacción', rol: 'miembro', coordina: [] },
    { id: 'm05', nombre: 'Camila Torres', area: 'Redes sociales', rol: 'coordinador', coordina: ['Redes sociales'] },
    { id: 'm06', nombre: 'Jorge Mendoza', area: 'Redes sociales', rol: 'miembro', coordina: [] },
    { id: 'm07', nombre: 'Rosa Paredes', area: 'Diseño', rol: 'coordinador', coordina: ['Diseño'] },
    { id: 'm08', nombre: 'Luis Castro', area: 'Diseño', rol: 'miembro', coordina: [] },
    { id: 'm09', nombre: 'Sofía Vargas', area: 'Investigación', rol: 'miembro', coordina: [] }, // área sin coordinador
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
  const revisorDe = (m) => MIEMBROS.find((x) => puedeRevisar(x, m.id, m.area)) || MIEMBROS[0];

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

  class ErrorDemo extends Error {}

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
        area: u.area, estado: 'pendiente', revisado_por: '', revisado_en: '', comentario: '' }, c);
      registros.push(r);
      return { registro: copia(r) };
    },
    editar(u, d) {
      const r = registros.find((x) => x.id === d.id);
      if (!r || r.miembro_id !== u.id) throw new ErrorDemo('Registro no encontrado.');
      if (r.estado === 'aprobado') throw new ErrorDemo('No se puede editar un registro aprobado.');
      const c = validar(d); cruce(u.id, c, r.id);
      Object.assign(r, c, { estado: 'pendiente', revisado_por: '', comentario: '' });
      return { registro: copia(r) };
    },
    misHoras: (u, d) => ({ registros: copia(registros.filter((r) => r.miembro_id === u.id && enRango(r, d)).sort(ordenar)) }),
    eliminar(u, d) {
      const i = registros.findIndex((x) => x.id === d.id);
      if (i === -1 || registros[i].miembro_id !== u.id) throw new ErrorDemo('Registro no encontrado.');
      if (registros[i].estado === 'aprobado') throw new ErrorDemo('No se puede eliminar un registro aprobado.');
      registros.splice(i, 1);
      return { eliminado: d.id };
    },
    porRevisar(u, d) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para revisar horas.');
      return { registros: copia(registros.filter((r) => puedeRevisar(u, r.miembro_id, r.area) &&
        (!d.estado || r.estado === d.estado) && (!d.miembro_id || r.miembro_id === d.miembro_id) && enRango(r, d)).sort(ordenar)) };
    },
    miembrosEquipo(u) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para ver otros calendarios.');
      return { miembros: MIEMBROS.filter((m) => puedeRevisar(u, m.id, m.area))
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
      const rs = registros.filter((r) => (u.rol === 'admin' || r.miembro_id === u.id ||
        (u.rol === 'coordinador' && u.coordina.map(norm).includes(norm(r.area)))) &&
        r.estado !== 'rechazado' && (!d.soloAprobadas || r.estado === 'aprobado') &&
        (!d.desde || r.fecha.slice(0, 7) >= d.desde) && (!d.hasta || r.fecha.slice(0, 7) <= d.hasta));
      const pm = {}, pa = {}; const t = { total: 0, aprobadas: 0, pendientes: 0, registros: rs.length };
      rs.forEach((r) => {
        const mes = r.fecha.slice(0, 7); const c = r.estado === 'aprobado' ? 'aprobadas' : 'pendientes';
        const k = r.miembro_id + mes;
        (pm[k] = pm[k] || { miembro: r.miembro, area: r.area, mes, aprobadas: 0, pendientes: 0 })[c] += r.horas;
        (pa[r.area] = pa[r.area] || { area: r.area, aprobadas: 0, pendientes: 0 })[c] += r.horas;
        t.total += r.horas; t[c] += r.horas;
      });
      const tot = (x) => x.aprobadas + x.pendientes;
      return { totales: t,
        porPersonaMes: Object.values(pm).sort((a, b) => b.mes.localeCompare(a.mes) || a.area.localeCompare(b.area) || a.miembro.localeCompare(b.miembro)),
        porArea: Object.values(pa).sort((a, b) => tot(b) - tot(a)) };
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
        if (!u) throw new ErrorDemo('Código de acceso inválido.');
        const fn = acciones[accion];
        if (!fn) throw new ErrorDemo('Acción desconocida.');
        return Object.assign({ ok: true }, fn(u, datos));
      } catch (e) {
        return { ok: false, error: e instanceof ErrorDemo ? e.message : 'Error interno.' };
      }
    },
  };
})();
