// Cobro rápido (panel admin): lógica pura del modal "💳 Precio y pagos" en 1
// solo paso, del botón de cobro con estado en vivo y de la carga rápida del
// Resumen mensual. Sin DOM ni Firestore — se prueba sola (tests/cobro-rapido).
//
// ESCALA: Firestore guarda los importes en MILES de pesos (ver
// js/precio-pagos.js, ESCALA_CANONICA = 'miles_ars'; 150 = $150.000). Acá la
// administradora escribe y ve PESOS COMPLETOS; la conversión es exacta y en
// los dos sentidos, así los registros históricos se leen igual que siempre.
// El modelo existente admite 1 decimal en miles (cientos de pesos: 45,5 =
// $45.500), así que un monto con decenas/unidades de pesos se rechaza con un
// mensaje claro en vez de redondearlo en silencio.

export const MEDIOS = [
  { v: 'efectivo', icono: '💵', label: 'Efectivo' },
  { v: 'transferencia', icono: '🏦', label: 'Transferencia' },
  { v: 'mercadopago', icono: '📱', label: 'Mercado Pago' },
  { v: 'tarjeta', icono: '💳', label: 'Tarjeta' },
];
const MEDIOS_LEGADO = { otro: 'Otro' };

export function etiquetaMedio(v) {
  const m = MEDIOS.find((x) => x.v === v);
  return m ? m.label : (MEDIOS_LEGADO[v] || (v ? String(v) : 'Sin medio'));
}
export function iconoMedio(v) { const m = MEDIOS.find((x) => x.v === v); return m ? m.icono : '•'; }

// ── Montos ──
// Texto escrito en pesos ("150000", "150.000", "$ 45.500", "45500,00").
// → { ok, vacio, pesos, miles, error, pareceMiles }
export function parsearPesos(texto) {
  let t = (texto == null ? '' : String(texto)).replace(/\$/g, '').replace(/\s+/g, '').trim();
  if (t === '') return { ok: true, vacio: true, pesos: null, miles: null };
  if (t.includes(',')) {
    const [ent, dec, ...resto] = t.split(',');
    if (resto.length || !/^\d{1,2}$/.test(dec)) return { ok: false, error: 'Monto inválido. Escribilo en pesos, por ejemplo 150000 o 150.000.' };
    if (Number(dec) !== 0) return { ok: false, error: 'Sin centavos: escribí el monto en pesos enteros.' };
    t = ent;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Monto inválido. Escribilo en pesos, por ejemplo 150000 o 150.000.' };
  const pesos = Number(t);
  if (!Number.isSafeInteger(pesos)) return { ok: false, error: 'Monto inválido.' };
  if (pesos > 1_000_000_000) return { ok: false, error: 'El monto parece demasiado grande — revisalo.' };
  if (pesos > 0 && pesos < 1000) return { ok: false, pareceMiles: true, pesos, error: `¿Quisiste decir $ ${(pesos * 1000).toLocaleString('es-AR')}? Escribí el monto en pesos completos.` };
  if (pesos % 100 !== 0) return { ok: false, error:'El sistema registra montos redondeados a los cien pesos (ej. $45.500). Revisá las últimas cifras.' };
  return { ok: true, vacio: false, pesos, miles: pesos / 1000, pareceMiles: pesos > 0 && pesos < 1000 };
}

// ── Normalización inteligente de escala ──
// Firestore guarda miles (150 = $150.000), pero hay sesiones donde se escribió
// el precio en pesos completos (21000 por $21.000) y la lectura en miles lo
// inflaba a $21.000.000. Regla: un monto individual <= 2000 está en miles; si
// es > 2000 ya está en pesos completos y se pasa a miles SIN tocar el dato
// guardado (solo se corrige al leer/calcular). Devuelve MILES.
export const UMBRAL_MILES_ARS = 2000;
export function normalizarMontoARS(valor) {
  if (valor === null || valor === undefined || valor === '') return valor;
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  if (Math.abs(n) <= UMBRAL_MILES_ARS) return n;
  return Math.round(n) / 1000;
}
// Copia de un doc de prestaciones / pagos / gastos con los importes normalizados.
const CAMPOS_MONTO = ['precioAcordado', 'monto', 'montoFijo'];
export function normalizarDocMontos(d) {
  if (!d || typeof d !== 'object') return d;
  let out = d;
  for (const k of CAMPOS_MONTO) {
    if (d[k] === null || d[k] === undefined || d[k] === '') continue;
    const v = normalizarMontoARS(d[k]);
    if (v !== d[k]) {
      if (out === d) { out = { ...d }; Object.defineProperty(out, '_enPesos', { value: {}, enumerable: false }); }
      out._enPesos[k] = d[k]; out[k] = v;
    }
  }
  return out;
}
// ¿El valor guardado estaba en pesos completos (y se normalizó al leer)?
export const estabaEnPesos = (valor) => Number.isFinite(Number(valor)) && Math.abs(Number(valor)) > UMBRAL_MILES_ARS;

// Miles (como está en Firestore) → pesos enteros.
export const milesAPesos = (miles) => (miles == null || !Number.isFinite(Number(miles)) ? null : Math.round(Number(miles) * 1000));
// Pesos → miles con 1 decimal exacto (la escala de Firestore).
export const pesosAMiles = (pesos) => Math.round(Number(pesos) / 100) / 10;

export function formatoPesos(miles) {
  const p = milesAPesos(miles);
  if (p == null) return '—';
  return (p < 0 ? '−' : '') + '$ ' + Math.abs(p).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
export const formatoPesosEnteros = (pesos) => (pesos == null ? '' : Math.round(pesos).toLocaleString('es-AR', { maximumFractionDigits: 0 }));

// ── Estado de cobro de una sesión ──
// prestacion: doc de "prestaciones" (o null). pagos: movimientos de esa prestación.
export function estadoCobro(prestacion, pagos) {
  const lista = pagos || [];
  const cobros = lista.filter((p) => p.tipo !== 'devolucion');
  const cobrado = Math.round(lista.reduce((s, p) => s + (p.tipo === 'devolucion' ? -p.monto : p.monto), 0) * 1000) / 1000;
  const medios = [...new Set(cobros.map((p) => p.metodoPago).filter(Boolean))];
  const medioTxt = medios.length > 1 ? 'Mixto' : medios.length ? etiquetaMedio(medios[0]) : '';
  const base = { cobrado, medios, medioTxt, precio: null, saldo: null };
  if (prestacion && prestacion.anulada) return { ...base, clave: 'anulada', icono: '⛔', tono: 'neutro', texto: 'Anulada' };
  if (prestacion && prestacion.sinCargo) return { ...base, clave: 'sin_cargo', icono: '🎁', tono: 'info', texto: 'Sin cargo' };
  const precio = prestacion && prestacion.precioAcordado != null ? Number(prestacion.precioAcordado) : null;
  if (precio == null) {
    if (cobrado > 0) return { ...base, clave: 'sin_precio', icono: '🟡', tono: 'warn', texto: `${formatoPesos(cobrado)} cobrado · falta precio` };
    return { ...base, clave: 'sin_registro', icono: '⚪', tono: 'neutro', texto: 'Cargar cobro' };
  }
  const saldo = Math.round((precio - cobrado) * 1000) / 1000;
  const r = { ...base, precio, saldo };
  if (saldo <= 0) return { ...r, clave: saldo < 0 ? 'saldo_a_favor' : 'pagado', icono: '🟢', tono: 'ok', texto: `${formatoPesos(precio)} · Pagado${medioTxt ? ` (${medioTxt})` : ''}${saldo < 0 ? ` · a favor ${formatoPesos(-saldo)}` : ''}` };
  if (cobrado > 0) return { ...r, clave: 'parcial', icono: '🟡', tono: 'warn', texto: `Debe ${formatoPesos(saldo)} (de ${formatoPesos(precio)})` };
  return { ...r, clave: 'sin_pagos', icono: '🟡', tono: 'warn', texto: `Debe ${formatoPesos(saldo)}` };
}

// ── Plan de cobro en 1 paso ──
// modo: 'total' | 'sena' | 'sincargo'
// total: monto (pesos) = precio acordado; se cobra lo que falte (precio − ya cobrado)
//        con `medio` o, si medio === 'mixto', con dos partes [{pesos, medio}, {pesos, medio}].
// sena:  precioTotal (pesos) + entrega (pesos) con `medio`.
// cobradoPrevio: en miles (lo que ya está registrado para esa sesión).
// → { ok, error, prestacion: { precioAcordado, sinCargo }, pagos: [{ monto (miles), metodoPago }] }
export function planCobro({ modo, monto, precioTotal, entrega, medio, mixto, cobradoPrevio = 0 }) {
  const prev = Number(cobradoPrevio) || 0;
  if (modo === 'sincargo') return { ok: true, prestacion: { precioAcordado: null, sinCargo: true }, pagos: [] };
  const leer = (txt, nombre) => {
    const r = parsearPesos(txt);
    if (!r.ok) return { error: r.error };
    if (r.vacio || r.pesos <= 0) return { error: `Ingresá ${nombre}.` };
    return { miles: r.miles };
  };
  if (modo === 'sena') {
    const p = leer(precioTotal, 'el precio total acordado'); if (p.error) return { ok: false, error: p.error };
    const e = leer(entrega, 'el monto que entrega hoy'); if (e.error) return { ok: false, error: e.error };
    const falta = Math.round((p.miles - prev) * 1000) / 1000;
    if (e.miles > falta) return { ok: false, error: `La entrega supera lo que falta cobrar (${formatoPesos(falta)}). Usá «Pagado total».` };
    const saldoLuego = Math.round((falta - e.miles) * 1000) / 1000;
    if (medio === 'mixto') {
      const mx = partesMixto(mixto, e.miles);
      if (mx.error) return { ok: false, error: mx.error };
      return { ok: true, prestacion: { precioAcordado: p.miles, sinCargo: false }, pagos: mx.pagos, esMixto: true, saldoLuego };
    }
    if (!medio) return { ok: false, error: 'Elegí el medio de pago de la seña.' };
    return { ok: true, prestacion: { precioAcordado: p.miles, sinCargo: false }, pagos: [{ monto: e.miles, metodoPago: medio }], saldoLuego };
  }
  // total
  const p = leer(monto, 'el monto'); if (p.error) return { ok: false, error: p.error };
  const aCobrar = Math.round((p.miles - prev) * 1000) / 1000;
  if (aCobrar < 0) return { ok: false, error: `Ya hay ${formatoPesos(prev)} cobrados, más que este precio. Si hay que devolver, usá «Devolución / ajuste».` };
  const prestacion = { precioAcordado: p.miles, sinCargo: false };
  if (aCobrar === 0) return { ok: true, prestacion, pagos: [], saldoLuego: 0 };
  if (medio === 'mixto') {
    const mx = partesMixto(mixto, aCobrar);
    if (mx.error) return { ok: false, error: mx.error };
    return { ok: true, prestacion, pagos: mx.pagos, esMixto: true, saldoLuego: 0 };
  }
  if (!medio) return { ok: false, error: 'Elegí el medio de pago.' };
  return { ok: true, prestacion, pagos: [{ monto: aCobrar, metodoPago: medio }], saldoLuego: 0 };
}

// Dos partes de un pago mixto que tienen que sumar exactamente `totalMiles`.
function partesMixto(mixto, totalMiles) {
  const partes = (mixto || []).map((x) => ({ r: parsearPesos(x && x.pesos), medio: x && x.medio }));
  if (partes.length !== 2) return { error: 'El pago mixto tiene dos partes.' };
  for (const x of partes) {
    if (!x.r.ok) return { error: x.r.error };
    if (x.r.vacio || x.r.pesos <= 0) return { error: 'Completá los dos montos del pago mixto.' };
    if (!x.medio || x.medio === 'mixto') return { error: 'Elegí el medio de cada parte del pago mixto.' };
  }
  const suma = Math.round(partes.reduce((s, x) => s + x.r.miles, 0) * 1000) / 1000;
  if (suma !== totalMiles) return { error: `Las dos partes suman ${formatoPesos(suma)} y hay que cobrar ${formatoPesos(totalMiles)}.` };
  return { pagos: partes.map((x) => ({ monto: x.r.miles, metodoPago: x.medio })) };
}

// Montos frecuentes del espacio (pesos) para los chips de 1 clic.
export const MONTOS_RAPIDOS = [15000, 20000, 25000, 30000, 45000, 60000, 150000];

// Pago mixto: al escribir la 1.ª parte, la 2.ª es el resto (en pesos).
export function restoMixto(totalPesos, parte1Pesos) {
  const t = Number(totalPesos) || 0, a = Number(parte1Pesos) || 0;
  return Math.max(0, t - a);
}

// Totales por medio de pago (miles). Las devoluciones (sin medio) se descuentan aparte.
export function totalesPorMedio(pagos) {
  const out = {};
  let devoluciones = 0;
  for (const p of pagos || []) {
    if (p.tipo === 'devolucion') { devoluciones += p.monto; continue; }
    const k = p.metodoPago || 'sin_medio';
    out[k] = Math.round(((out[k] || 0) + p.monto) * 1000) / 1000;
  }
  return { porMedio: out, devoluciones: Math.round(devoluciones * 1000) / 1000 };
}

// Último precio acordado de esa paciente para ese servicio (miles), para el chip rápido.
export function ultimoPrecio(prestaciones, reservasPorId, { pacienteKey, servicio, excluirId }) {
  let mejor = null;
  for (const p of prestaciones || []) {
    if (!p || p.anulada || p.sinCargo || p.precioAcordado == null || p.id === excluirId) continue;
    const r = reservasPorId.get(p.reservaId || p.id);
    if (!r || (servicio && r.servicio !== servicio)) continue;
    if (pacienteKey && p.pacienteKey !== pacienteKey) continue;
    if (!mejor || (r.fecha || '') > mejor.fecha) mejor = { fecha: r.fecha || '', precio: Number(p.precioAcordado) };
  }
  return mejor ? mejor.precio : null;
}
