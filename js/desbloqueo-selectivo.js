// Desbloqueo selectivo (Admin → Agenda): ver todos los días y horarios
// bloqueados como una grilla (hora × box) y liberar SOLO lo que se elige.
// Lógica pura (sin DOM ni Firestore) — se prueba sola en tests/desbloqueo-selectivo.
//
// Tipos de bloqueo (todos en calendarExceptions):
//   · 'dia'     — cierre del día completo: { fecha, blocked/type, sin hora }.
//                 Cubre todos los horarios y todos los boxes.
//   · 'horario' — bloqueo de un horario para todos los boxes: { fecha, hora, blocked: true }
//                 (lo que crean «🔒 Día / Semana / Mes» y la gestión de horarios).
//   · 'box'     — bloqueo de un box en un horario (Grilla): { fecha, hora, boxId, source: 'admin' }.
// Los documentos que solo reflejan una reserva (reserva_admin_…, ext_…) NO
// son bloqueos manuales: quedan fuera y una reserva nunca se toca.
//
// Al desbloquear una selección:
//   · celda de un cierre de día → se borra el cierre y se recrea el bloqueo
//     de TODO lo no elegido (por horario si sigue completo, por box si se
//     liberó solo algún box de ese horario). Nada más cambia.
//   · celda de un bloqueo de horario → si se liberan todos los boxes de ese
//     horario se borra; si solo algunos, se reemplaza por bloqueos por box de
//     los que quedan.
//   · celda de un bloqueo por box → se borra ese bloqueo.

export const DURACION_BLOQUEO_HORARIO = 30; // un horario de la agenda pública = 30 min

const clave = (hora, boxId) => `${hora}|${boxId}`;
export const idBloqueoHorario = (fecha, hora) => `block_${fecha}_${hora.replace(':', '-')}`;
export const idBloqueoBox = (fecha, hora, boxId) => `adm_${fecha}_${hora.replace(':', '-')}_${boxId}`;

// → [{ fecha, cierre, filas: [{ hora, celdas: { [boxId]: { fuentes, idsHorario, idsBox } } }], bloqueadas }]
//   cierres: [{ fecha, id, reason }] · horarios: [{ fecha, hora, id, reason? }]
//   porBox: [{ fecha, hora, boxId, id, duracionMinutos? }] · boxes: ids en orden visible
//   horasBase(fecha): horarios del día (para un cierre de día completo)
//   desde: 'AAAA-MM-DD' (no lista días anteriores, salvo `incluir`)
export function armarDiasBloqueados({ cierres = [], horarios = [], porBox = [], boxes, horasBase, desde = '', incluir = '' }) {
  const fechas = new Set([...cierres, ...horarios, ...porBox].map((x) => x.fecha).filter((f) => f && (f >= desde || f === incluir)));
  return [...fechas].sort().map((fecha) => {
    const cierre = cierres.find((c) => c.fecha === fecha) || null;
    const hDia = horarios.filter((h) => h.fecha === fecha);
    const bDia = porBox.filter((b) => b.fecha === fecha && boxes.includes(b.boxId));
    const horas = new Set([...(cierre ? horasBase(fecha) : []), ...hDia.map((h) => h.hora), ...bDia.map((b) => b.hora)]);
    let bloqueadas = 0;
    const filas = [...horas].sort().map((hora) => {
      const celdas = {};
      const hs = hDia.filter((h) => h.hora === hora);
      for (const boxId of boxes) {
        const fuentes = [];
        if (cierre) fuentes.push('dia');
        if (hs.length) fuentes.push('horario');
        const bs = bDia.filter((b) => b.hora === hora && b.boxId === boxId);
        if (bs.length) fuentes.push('box');
        if (fuentes.length) bloqueadas++;
        celdas[boxId] = { fuentes, idsHorario: hs.map((h) => h.id), idsBox: bs.map((b) => b.id) };
      }
      return { hora, celdas };
    });
    return { fecha, cierre, filas, bloqueadas };
  });
}

// Plan de escritura para desbloquear la selección de UN día.
//   seleccion: Set de 'HH:MM|boxId'
// → { borrar: [docId], crear: [{ id, data }] }
export function planDesbloqueo(dia, seleccion, { boxes, motivo = '' } = {}) {
  const sel = (hora, boxId) => seleccion.has(clave(hora, boxId));
  const borrar = new Set();
  const crear = new Map();
  const tocaDia = dia.filas.some((f) => boxes.some((b) => sel(f.hora, b) && f.celdas[b].fuentes.length));
  if (!tocaDia) return { borrar: [], crear: [] };
  const motivoDia = (dia.cierre && dia.cierre.reason) || motivo || '';
  const recrearDia = !!dia.cierre;
  if (recrearDia) borrar.add(dia.cierre.id);
  for (const fila of dia.filas) {
    const { hora, celdas } = fila;
    const elegidos = boxes.filter((b) => sel(hora, b) && celdas[b].fuentes.length);
    // El cierre del día y el bloqueo de horario valen para TODOS los boxes.
    const general = boxes.some((b) => celdas[b].fuentes.includes('dia') || celdas[b].fuentes.includes('horario'));
    const idsHorario = [...new Set(boxes.flatMap((b) => celdas[b].idsHorario))];
    if (general && elegidos.length) {
      // Se libera solo lo elegido: el bloqueo general de la hora se reemplaza
      // por bloqueos por box de los que no se eligieron.
      idsHorario.forEach((id) => borrar.add(id));
      for (const b of boxes.filter((x) => !elegidos.includes(x))) {
        if (celdas[b].idsBox.length) continue; // ya tiene su propio bloqueo por box
        const id = idBloqueoBox(dia.fecha, hora, b);
        crear.set(id, { fecha: dia.fecha, hora, boxId: b, duracionMinutos: DURACION_BLOQUEO_HORARIO, adminBlocked: true, source: 'admin', motivo: motivoDia, origen: 'desbloqueo_parcial' });
      }
    } else if (general && recrearDia && !idsHorario.length) {
      // Hora sin elegir dentro de un cierre de día: sigue bloqueada para todos.
      const id = idBloqueoHorario(dia.fecha, hora);
      crear.set(id, { fecha: dia.fecha, hora, blocked: true, active: true, reason: motivoDia, origen: 'desbloqueo_parcial' });
    }
    // Bloqueos propios de cada box elegido: se borran.
    for (const b of elegidos) celdas[b].idsBox.forEach((id) => borrar.add(id));
  }
  // Nunca se crea y se borra el mismo documento a la vez.
  for (const id of crear.keys()) borrar.delete(id);
  return { borrar: [...borrar], crear: [...crear.entries()].map(([id, data]) => ({ id, data })) };
}

// Aplica (en memoria) un plan sobre las listas de bloqueos: sirve para
// verificar el resultado y para refrescar la vista sin recargar todo.
export function aplicarPlan({ cierres, horarios, porBox }, plan) {
  const borrar = new Set(plan.borrar);
  const c = cierres.filter((x) => !borrar.has(x.id));
  const h = horarios.filter((x) => !borrar.has(x.id));
  const p = porBox.filter((x) => !borrar.has(x.id));
  for (const { id, data } of plan.crear) {
    if (data.boxId) p.push({ id, fecha: data.fecha, hora: data.hora, boxId: data.boxId, duracionMinutos: data.duracionMinutos });
    else h.push({ id, fecha: data.fecha, hora: data.hora, reason: data.reason });
  }
  return { cierres: c, horarios: h, porBox: p };
}
