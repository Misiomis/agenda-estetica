// Boxes de la Grilla: identidad, nombre visible, orden y alta de boxes nuevos.
// Lógica pura (sin DOM ni Firestore) — se prueba sola en tests/boxes-grilla.
//
// La IDENTIDAD de un box es su id (b1…b4 y los que se agreguen). A ese id
// apuntan reservas (r.box), bloqueos (boxId), servicios por box y
// predeterminados: nunca cambia. Lo que se edita es el nombre visible, la
// descripción, el ícono y el orden. Se guarda en configuracion/boxesGrilla.
//
// Correspondencia vigente (sin renombres encadenados):
//   b1 (General Corporal) → «Box 4»   1.º
//   b4 (Relax · Drenaje)  → «Box 2»   2.º
//   b3 (Facial)           → «Box 3»   3.º
//   b2 (Corporal)         → «Box 5»   4.º
// DESDE EL 1/12/2026 (FECHA_BOXES_NUEVOS) se suma «Box 1» (id b6) y la
// Grilla muestra los boxes ordenados por número: Box 1, 2, 3, 4, 5. Los días
// anteriores siguen con los 4 boxes y el orden de siempre, para no mezclar
// datos de noviembre (ver boxesParaFecha).
// Un box viejo que no esté en la lista (ej. un «b5» histórico) no se muestra
// ni se borra: sus datos quedan como estaban.

const VISUAL = { bg: '#C4D5C1', border: '#78967C' };
export const BOXES_POR_DEFECTO = [
  { id: 'b1', num: 1, title: 'Box 4', sub: 'General Corporal', icon: '⬜', accent: '#844578' },
  { id: 'b4', num: 4, title: 'Box 2', sub: 'Relax Corporal', icon: '🌿', accent: '#2F7050' },
  { id: 'b3', num: 3, title: 'Box 3', sub: 'Facial', icon: '✨', accent: '#665096' },
  { id: 'b2', num: 2, title: 'Box 5', sub: 'Corporal', icon: '💎', accent: '#315E95' },
];
export const FECHA_BOXES_NUEVOS = '2026-12-01';
export const BOX_1_NUEVO = { id: 'b6', num: 6, title: 'Box 1', sub: 'General', icon: '🌸', accent: '#9A6B2F' };
// Ids que nunca se reutilizan para un box nuevo (históricos o reservados).
export const IDS_RESERVADOS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'bv'];
export const MAX_LARGO_NOMBRE = 24;

const limpiar = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const conVisual = (b) => ({ ...VISUAL, ...b, label: b.title });

// Lista final a partir de la configuración guardada (o la de siempre).
// Garantiza que los 4 boxes base existan una sola vez y en un orden válido.
export function normalizarBoxes(config) {
  const guardados = Array.isArray(config && config.boxes) ? config.boxes : null;
  if (!guardados || !guardados.length) return BOXES_POR_DEFECTO.map(conVisual);
  const vistos = new Set();
  const out = [];
  for (const g of guardados) {
    const id = String(g && g.id || '').trim();
    if (!/^[a-z][a-z0-9_]{0,15}$/.test(id) || vistos.has(id)) continue;
    if (id === BOX_1_NUEVO.id) continue; // Box 1: lo agrega boxesParaFecha según la fecha
    const base = BOXES_POR_DEFECTO.find((b) => b.id === id);
    if (!base && !/^bx\d+$/.test(id)) continue; // solo base o agregados desde el panel
    vistos.add(id);
    out.push(conVisual({
      id,
      num: base ? base.num : (Number(g.num) > 100 ? Number(g.num) : 100 + Number(id.slice(2))),
      title: limpiar(g.title, MAX_LARGO_NOMBRE) || (base ? base.title : id),
      sub: limpiar(g.sub, 40) || (base ? base.sub : ''),
      icon: limpiar(g.icon, 4) || (base ? base.icon : '▫️'),
      accent: /^#[0-9a-f]{6}$/i.test(g.accent || '') ? g.accent : (base ? base.accent : '#475569'),
    }));
  }
  // Un box base que faltara en lo guardado vuelve al final (nunca se pierde).
  for (const b of BOXES_POR_DEFECTO) if (!vistos.has(b.id)) out.push(conVisual(b));
  return out;
}

// Para guardar en Firestore (sin colores de fondo ni campos derivados).
export const serializarBoxes = (lista) => ({ boxes: lista.map((b) => ({ id: b.id, num: b.num, title: b.title, sub: b.sub || '', icon: b.icon || '', accent: b.accent || '' })) });

export function validarNombre(lista, nombre, idActual = null) {
  const n = limpiar(nombre, 200);
  if (!n) return { ok: false, error: 'Escribí un nombre para el box.' };
  if (n.length > MAX_LARGO_NOMBRE) return { ok: false, error: `El nombre puede tener hasta ${MAX_LARGO_NOMBRE} caracteres.` };
  const igual = lista.find((b) => b.id !== idActual && b.title.toLowerCase() === n.toLowerCase());
  if (igual) return { ok: false, error: `Ya hay un box que se llama «${igual.title}».` };
  return { ok: true, nombre: n };
}

// Box nuevo: id propio (bx1, bx2…), nunca uno histórico; va al final.
export function nuevoBox(lista, { nombre, sub = '', icon = '▫️' }) {
  const v = validarNombre(lista, nombre);
  if (!v.ok) return v;
  let n = 1;
  while (lista.some((b) => b.id === `bx${n}`) || IDS_RESERVADOS.includes(`bx${n}`)) n++;
  const box = conVisual({ id: `bx${n}`, num: 100 + n, title: v.nombre, sub: limpiar(sub, 40), icon: limpiar(icon, 4) || '▫️', accent: '#475569' });
  return { ok: true, box, lista: [...lista, box] };
}

export function renombrar(lista, id, { nombre, sub, icon }) {
  const v = validarNombre(lista, nombre, id);
  if (!v.ok) return v;
  return { ok: true, lista: lista.map((b) => (b.id === id ? conVisual({ ...b, title: v.nombre, sub: sub === undefined ? b.sub : limpiar(sub, 40), icon: icon === undefined ? b.icon : (limpiar(icon, 4) || b.icon) }) : b)) };
}

export function mover(lista, id, delta) {
  const i = lista.findIndex((b) => b.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= lista.length) return lista;
  const out = [...lista];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// Etiqueta corta para columnas angostas y badges: «Box 4» → «B4», «Camilla» → «Cam».
export function nombreCorto(box) {
  const t = String(box && box.title || '');
  const m = /(\d+)\s*$/.exec(t);
  return m ? 'B' + m[1] : t.slice(0, 3);
}

// Orden por el número del nombre («Box 1» … «Box 5»); los que no tienen número
// quedan al final en el orden en que estaban.
const numeroDe = (b) => { const m = /(\d+)\s*$/.exec(String(b.title || '')); return m ? Number(m[1]) : Infinity; };
export const ordenarPorNumero = (lista) => lista.map((b, i) => ({ b, i })).sort((x, y) => (numeroDe(x.b) - numeroDe(y.b)) || (x.i - y.i)).map((x) => x.b);

// Boxes de la Grilla para un día. Antes de FECHA_BOXES_NUEVOS: exactamente los
// de siempre (normalizarBoxes). Desde esa fecha: se suma «Box 1» (con el
// nombre que tenga guardado, si se editó) y todo queda ordenado por número.
export function boxesParaFecha(config, fecha) {
  const base = normalizarBoxes(config);
  if (!fecha || fecha < FECHA_BOXES_NUEVOS) return base;
  const guardado = Array.isArray(config && config.boxes) ? config.boxes.find((g) => g && g.id === BOX_1_NUEVO.id) : null;
  const box1 = conVisual({ ...BOX_1_NUEVO, ...(guardado ? {
    title: limpiar(guardado.title, MAX_LARGO_NOMBRE) || BOX_1_NUEVO.title, sub: limpiar(guardado.sub, 40) || BOX_1_NUEVO.sub,
    icon: limpiar(guardado.icon, 4) || BOX_1_NUEVO.icon, accent: /^#[0-9a-f]{6}$/i.test(guardado.accent || '') ? guardado.accent : BOX_1_NUEVO.accent } : {}) });
  const yaHay = base.some((b) => b.title.toLowerCase() === box1.title.toLowerCase());
  return ordenarPorNumero(yaHay ? base : [...base, box1]);
}
