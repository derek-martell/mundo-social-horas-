/**
 * Modo demostración: un backend simulado en memoria, con datos de ejemplo.
 * Se activa cuando config.js no tiene una URL configurada, o con ?demo=1 en la dirección.
 * Nada de lo que se haga en este modo se guarda: al recargar la página vuelve al estado inicial.
 */
(function () {
  'use strict';

  const AREAS = ['Redacción', 'Edición', 'Investigación', 'Redes sociales', 'Diseño', 'Web', 'Coordinación'];
  const MIEMBROS = [
    { id: 'm01', nombre: 'Lucía Ramos', equipo: 'Dirección', rol: 'admin', coordina: [] },
    { id: 'm02', nombre: 'Diego Salazar', equipo: 'Redacción', rol: 'coordinador', coordina: ['Redacción'] },
    { id: 'm03', nombre: 'Valeria Quispe', equipo: 'Redacción', rol: 'miembro', coordina: [] },
    { id: 'm04', nombre: 'Andrés Huamán', equipo: 'Redacción', rol: 'miembro', coordina: [] },
    { id: 'm05', nombre: 'Camila Torres', equipo: 'Redes', rol: 'coordinador', coordina: ['Redes'] },
    { id: 'm06', nombre: 'Jorge Mendoza', equipo: 'Redes', rol: 'miembro', coordina: [] },
  ];
  const CODIGOS = { 'DEMO-ADMIN': 'm01', 'DEMO-COORD': 'm02', 'DEMO-MIEMBRO': 'm03' };

  const TAREAS = {
    'Redacción': ['Nota sobre la inflación en Lima Metropolitana (dato del INEI)', 'Borrador: informalidad laboral juvenil',
      'Explicador del tipo de cambio y las intervenciones del BCRP', 'Nota sobre el PBI de setiembre'],
    'Edición': ['Edición del artículo de pensiones', 'Corrección de estilo de 3 notas', 'Revisión de cifras con fuentes'],
    'Investigación': ['Procesamiento de la ENAHO: pobreza por región', 'Búsqueda de series del BCRP', 'Entrevista a economista de la PUCP'],
    'Redes sociales': ['Hilo sobre precios de alimentos', 'Programación de publicaciones de la semana', 'Video corto sobre el sol peruano'],
    'Diseño': ['Infografía de empleo formal', 'Gráficos del artículo de exportaciones'],
    'Web': ['Carga de artículos al sitio', 'Arreglo del buscador del sitio'],
    'Coordinación': ['Reunión semanal del equipo', 'Revisión del calendario editorial'],
  };
  const AREAS_DE = {
    m01: ['Coordinación', 'Edición', 'Web'], m02: ['Coordinación', 'Edición', 'Redacción'],
    m03: ['Redacción', 'Investigación'], m04: ['Redacción', 'Investigación', 'Diseño'],
    m05: ['Coordinación', 'Redes sociales'], m06: ['Redes sociales', 'Diseño'],
  };

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const aMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hoyStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const uuid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  // Generador pseudoaleatorio con semilla, para que la demo sea igual en cada carga.
  let semilla = 42;
  const rnd = () => { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; };
  const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];

  const registros = [];
  (function sembrar() {
    const [y, m, d] = hoyStr().split('-').map(Number);
    const hoy = new Date(y, m - 1, d);
    for (let k = 34; k >= 0; k--) {
      const dia = new Date(y, m - 1, d - k);
      const dow = dia.getDay();
      if (dow === 0) continue;
      MIEMBROS.forEach((mi) => {
        if (dow === 6 && rnd() > 0.25) return;
        if (rnd() < 0.15) return;
        let t = elegir([8 * 60, 8 * 60 + 30, 9 * 60, 10 * 60, 14 * 60]);
        const bloques = 1 + Math.floor(rnd() * 3);
        for (let b = 0; b < bloques && t < 20 * 60; b++) {
          const dur = elegir([45, 60, 90, 120, 150, 180]);
          const area = elegir(AREAS_DE[mi.id]);
          const reciente = k <= 6;
          let estado = reciente ? (rnd() < 0.3 ? 'aprobado' : 'pendiente') : (rnd() < 0.94 ? 'aprobado' : 'rechazado');
          if (k === 0) estado = 'pendiente';
          const revisor = mi.rol === 'miembro' ? MIEMBROS.find((x) => x.coordina.includes(mi.equipo)) : MIEMBROS[0];
          registros.push({
            id: uuid(), creado: dia.toISOString() + b, miembro_id: mi.id, miembro: mi.nombre, equipo: mi.equipo,
            fecha: ymd(dia), inicio: hhmm(t), fin: hhmm(t + dur), horas: dur / 60, area,
            descripcion: elegir(TAREAS[area]), enlace: area === 'Redacción' && rnd() < 0.4 ? 'https://example.com/borrador' : '',
            estado, revisado_por: estado === 'pendiente' ? '' : revisor.nombre, revisado_en: '',
            comentario: estado === 'rechazado' ? 'Ese día no hubo reunión; revisa la fecha.' : '',
          });
          t += dur + elegir([0, 15, 30, 60]);
        }
      });
      void hoy;
    }
  })();

  class ErrorDemo extends Error {}
  const norm = (s) => String(s || '').trim().toLowerCase();
  const puedeRevisar = (u, r) => r.miembro_id !== u.id &&
    (u.rol === 'admin' || (u.rol === 'coordinador' && u.coordina.map(norm).includes(norm(r.equipo))));
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const ordenar = (a, b) => b.fecha.localeCompare(a.fecha) || b.inicio.localeCompare(a.inicio);

  function validar(d) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) throw new ErrorDemo('Fecha inválida.');
    if (d.fecha > hoyStr()) throw new ErrorDemo('No puedes registrar horas en una fecha futura.');
    if (!/^\d{2}:\d{2}$/.test(d.inicio || '') || !/^\d{2}:\d{2}$/.test(d.fin || '')) throw new ErrorDemo('Indica la hora de inicio y de fin.');
    const min = aMin(d.fin) - aMin(d.inicio);
    if (min < 15) throw new ErrorDemo('La hora de fin debe ser al menos 15 minutos después del inicio.');
    if (!AREAS.includes(d.area)) throw new ErrorDemo('Área o proyecto inválido.');
    if (String(d.descripcion || '').trim().length < 3) throw new ErrorDemo('Agrega una descripción.');
    const enlace = String(d.enlace || '').trim();
    if (enlace && !/^https?:\/\/\S+$/i.test(enlace)) throw new ErrorDemo('El enlace debe empezar con http:// o https://');
    return { fecha: d.fecha, inicio: d.inicio, fin: d.fin, horas: Math.round(min / 15) / 4, area: d.area,
      descripcion: String(d.descripcion).trim(), enlace };
  }
  function cruce(uid, c, ignorar) {
    const x = registros.find((r) => r.miembro_id === uid && r.id !== ignorar && r.fecha === c.fecha &&
      r.estado !== 'rechazado' && aMin(r.inicio) < aMin(c.fin) && aMin(c.inicio) < aMin(r.fin));
    if (x) throw new ErrorDemo(`Se cruza con otro registro tuyo de ${x.inicio} a ${x.fin}.`);
  }

  const acciones = {
    login: (u) => ({ usuario: { id: u.id, nombre: u.nombre, equipo: u.equipo, rol: u.rol, coordina: u.coordina }, areas: AREAS }),
    registrar(u, d) {
      const c = validar(d); cruce(u.id, c);
      const r = Object.assign({ id: uuid(), creado: new Date().toISOString(), miembro_id: u.id, miembro: u.nombre,
        equipo: u.equipo, estado: 'pendiente', revisado_por: '', revisado_en: '', comentario: '' }, c);
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
    misHoras: (u, d) => ({ registros: copia(registros.filter((r) => r.miembro_id === u.id &&
      (!d.desde || r.fecha >= d.desde) && (!d.hasta || r.fecha <= d.hasta) &&
      (!d.mes || r.fecha.slice(0, 7) === d.mes)).sort(ordenar)) }),
    eliminar(u, d) {
      const i = registros.findIndex((x) => x.id === d.id);
      if (i === -1 || registros[i].miembro_id !== u.id) throw new ErrorDemo('Registro no encontrado.');
      if (registros[i].estado === 'aprobado') throw new ErrorDemo('No se puede eliminar un registro aprobado.');
      registros.splice(i, 1);
      return { eliminado: d.id };
    },
    porRevisar(u, d) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para revisar horas.');
      return { registros: copia(registros.filter((r) => puedeRevisar(u, r) && (!d.estado || r.estado === d.estado) &&
        (!d.miembro_id || r.miembro_id === d.miembro_id) && (!d.desde || r.fecha >= d.desde) &&
        (!d.hasta || r.fecha <= d.hasta) && (!d.mes || r.fecha.slice(0, 7) === d.mes)).sort(ordenar)) };
    },
    miembrosEquipo(u) {
      if (u.rol === 'miembro') throw new ErrorDemo('No tienes permiso para ver otros calendarios.');
      return { miembros: MIEMBROS.filter((m) => puedeRevisar(u, { miembro_id: m.id, equipo: m.equipo }))
        .map((m) => ({ id: m.id, nombre: m.nombre, equipo: m.equipo })) };
    },
    revisar(u, d) {
      if (d.estado === 'rechazado' && !String(d.comentario || '').trim()) throw new ErrorDemo('Indica el motivo del rechazo.');
      let n = 0;
      registros.forEach((r) => {
        if (d.ids.includes(r.id) && puedeRevisar(u, r)) {
          r.estado = d.estado; r.revisado_por = d.estado === 'pendiente' ? '' : u.nombre;
          r.comentario = String(d.comentario || ''); n++;
        }
      });
      if (!n) throw new ErrorDemo('No se actualizó ningún registro.');
      return { actualizados: n };
    },
    resumen(u, d) {
      const rs = registros.filter((r) => (u.rol === 'admin' || r.miembro_id === u.id ||
        (u.rol === 'coordinador' && u.coordina.map(norm).includes(norm(r.equipo)))) &&
        r.estado !== 'rechazado' && (!d.soloAprobadas || r.estado === 'aprobado') &&
        (!d.desde || r.fecha.slice(0, 7) >= d.desde) && (!d.hasta || r.fecha.slice(0, 7) <= d.hasta));
      const pm = {}, pa = {}, pe = {}; const t = { total: 0, aprobadas: 0, pendientes: 0, registros: rs.length };
      rs.forEach((r) => {
        const mes = r.fecha.slice(0, 7); const c = r.estado === 'aprobado' ? 'aprobadas' : 'pendientes';
        const k = r.miembro_id + mes;
        (pm[k] = pm[k] || { miembro: r.miembro, equipo: r.equipo, mes, aprobadas: 0, pendientes: 0 })[c] += r.horas;
        (pa[r.area] = pa[r.area] || { area: r.area, aprobadas: 0, pendientes: 0 })[c] += r.horas;
        (pe[r.equipo] = pe[r.equipo] || { equipo: r.equipo, aprobadas: 0, pendientes: 0 })[c] += r.horas;
        t.total += r.horas; t[c] += r.horas;
      });
      const tot = (x) => x.aprobadas + x.pendientes;
      return { totales: t,
        porPersonaMes: Object.values(pm).sort((a, b) => b.mes.localeCompare(a.mes) || a.miembro.localeCompare(b.miembro)),
        porArea: Object.values(pa).sort((a, b) => tot(b) - tot(a)),
        porEquipo: Object.values(pe).sort((a, b) => a.equipo.localeCompare(b.equipo)) };
    },
  };

  window.MS_HORAS_DEMO = {
    codigos: [
      { codigo: 'DEMO-MIEMBRO', etiqueta: 'Miembro', quien: 'Valeria Quispe · Redacción' },
      { codigo: 'DEMO-COORD', etiqueta: 'Coordinador', quien: 'Diego Salazar · coordina Redacción' },
      { codigo: 'DEMO-ADMIN', etiqueta: 'Admin', quien: 'Lucía Ramos · ve todo el grupo' },
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
