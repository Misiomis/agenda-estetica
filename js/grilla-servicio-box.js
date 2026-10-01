// Grilla de boxes — resolución del servicio al arrastrar un turno a otro box.
// Lógica pura (sin DOM, sin Firestore) para poder probarla sola.
//
// Regla del centro (explícita, no negociable): arrastrar un turno a otro box
// NUNCA "inventa" el servicio. El servicio premium/especializado de un box
// (p. ej. "Hi-Fu Facial") solo se asigna si la administradora lo elige a
// mano — jamás como resultado automático de un arrastre. Si el box destino
// tiene un servicio predeterminado configurado explícitamente (Servicios →
// Grilla de Servicios → "Servicio predeterminado por box"), se aplica ese;
// si no hay uno configurado, no se toca el servicio del turno.

// raw: lo guardado en configuracion/serviciosBox → { assignments, defaults }
// Devuelve dos Map: boxesPorServicio (nombre → [boxId,…]) y defaultPorBox
// (boxId → nombre del servicio predeterminado de ese box).
export function normalizarServiciosBox(raw) {
  const boxesPorServicio = new Map();
  const defaultPorBox = new Map();
  const a = (raw && raw.assignments) || {};
  Object.entries(a).forEach(([nombre, v]) => { if (nombre && v) boxesPorServicio.set(nombre, Array.isArray(v) ? v : [v]); });
  const d = (raw && raw.defaults) || {};
  Object.entries(d).forEach(([boxId, nombre]) => { if (boxId && nombre) defaultPorBox.set(boxId, nombre); });
  return { boxesPorServicio, defaultPorBox };
}

// Serializa los dos Map de vuelta al formato guardado en Firestore.
export function serializarServiciosBox(boxesPorServicio, defaultPorBox) {
  const out = { assignments: {}, defaults: {} };
  boxesPorServicio.forEach((v, k) => { const arr = Array.isArray(v) ? v : (v ? [v] : []); if (arr.length) out.assignments[k] = arr; });
  defaultPorBox.forEach((v, k) => { if (v) out.defaults[k] = v; });
  return out;
}

// Servicios asignados a un box, para poblar el selector de "predeterminado"
// (solo puede elegirse como predeterminado un servicio ya asignado al box).
export function serviciosDelBox(boxId, boxesPorServicio) {
  const out = [];
  boxesPorServicio.forEach((v, nombre) => {
    const arr = Array.isArray(v) ? v : (v ? [v] : []);
    if (arr.includes(boxId)) out.push(nombre);
  });
  return out.sort((a, b) => a.localeCompare(b, 'es'));
}

// La función que de verdad decide qué hacer al soltar un turno en otro box.
// Devuelve el nombre del nuevo servicio a aplicar, o null si no hay que
// tocar el servicio (caso por defecto: nunca se inventa nada).
export function resolverServicioAlArrastrar(boxDestinoId, servicioActual, boxesPorServicio, defaultPorBox) {
  const defecto = defaultPorBox.get(boxDestinoId);
  if (!defecto || defecto === servicioActual) return null;
  const raw = boxesPorServicio.get(servicioActual);
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  if (arr.includes(boxDestinoId)) return null; // el servicio actual ya es válido en el box destino
  return defecto;
}
