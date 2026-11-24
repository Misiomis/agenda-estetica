// Notas y guías por turno para "Preparar jornada" e "Imprimir grilla del día".
// Lógica pura (sin DOM ni Firestore) — tests/notas-jornada.
//
// Hay dos notas por reserva y se mantienen SEPARADAS (decisión de la
// administradora): la "nota interna" (r.notaRapida, menú ⋮ de la Grilla, no se
// le envía a la paciente) y la "nota de la sesión" (r.detalleSesion, Agenda →
// Guardar Nota, la que se le envía a la paciente). Para un turno se muestran
// sus dos notas y, como "guías registradas", las notas de OTROS turnos de la
// misma persona (identificada por claveDe: DNI; sin DNI, nombre), con su fecha,
// de la más reciente a la más antigua, sin repetir el mismo texto.

export const TIPOS_NOTA = { interna: 'Nota interna', sesion: 'Nota de la sesión' };

export const limpiarNota = (t) => String(t ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const claveTexto = (t) => limpiarNota(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

// Notas propias de un turno (solo las que tienen texto).
export function notasDeTurno(r) {
  const out = [];
  const interna = limpiarNota(r && r.notaRapida);
  const sesion = limpiarNota(r && r.detalleSesion);
  if (interna) out.push({ tipo: 'interna', texto: interna });
  if (sesion && claveTexto(sesion) !== claveTexto(interna)) out.push({ tipo: 'sesion', texto: sesion });
  return out;
}

/**
 * Guías de un turno: notas de los demás turnos de la misma persona.
 *  r        — la reserva del día.
 *  todas    — todas las reservas conocidas (cualquier mes).
 *  claveDe  — identidad del paciente (la misma del resto del panel).
 *  esActiva — opcional: si se pasa, se ignoran las reservas canceladas.
 */
export function guiasDeTurno(r, todas, { claveDe, esActiva } = {}) {
  const k = claveDe(r);
  if (!k) return [];
  const propias = new Set(notasDeTurno(r).map((n) => claveTexto(n.texto)));
  const vistos = new Set(propias);
  const lista = [];
  (todas || [])
    .filter((x) => x && x.id !== r.id && x.fecha && claveDe(x) === k && (!esActiva || esActiva(x)))
    .sort((a, b) => `${b.fecha}T${b.hora || ''}`.localeCompare(`${a.fecha}T${a.hora || ''}`))
    .forEach((x) => {
      notasDeTurno(x).forEach((n) => {
        const c = claveTexto(n.texto);
        if (vistos.has(c)) return; // la misma nota recuperada por otra vía
        vistos.add(c);
        lista.push({ fecha: x.fecha, hora: x.hora || '', tipo: n.tipo, texto: n.texto, reservaId: x.id, servicio: x.servicio || '' });
      });
    });
  return lista;
}

// Filas para la tabla de notas del PDF: cada nota en su fila, repitiendo hora
// y paciente (así, si la tabla sigue en otra hoja, siempre se ve de quién es).
export function filasNotasDelDia(reservasDia, todas, { claveDe, esActiva, nombreDe, boxDe, fechaCorta } = {}) {
  const fc = fechaCorta || ((f) => f.split('-').reverse().join('/'));
  const filas = [];
  [...reservasDia].sort((a, b) => `${a.hora || ''}${nombreDe(a)}`.localeCompare(`${b.hora || ''}${nombreDe(b)}`)).forEach((r) => {
    const propias = notasDeTurno(r);
    const guias = guiasDeTurno(r, todas, { claveDe, esActiva });
    if (!propias.length && !guias.length) return; // turno sin notas: no se agrega nada
    const cab = { hora: r.hora || '', box: boxDe ? boxDe(r) : '', paciente: nombreDe(r), servicio: r.servicio || '', reservaId: r.id };
    propias.forEach((n) => filas.push({ ...cab, rotulo: `${TIPOS_NOTA[n.tipo]} (este turno)`, texto: n.texto, propia: true }));
    guias.forEach((g) => filas.push({ ...cab, rotulo: `Guía del ${fc(g.fecha)} — ${TIPOS_NOTA[g.tipo].toLowerCase()}`, texto: g.texto, propia: false }));
  });
  return filas;
}
