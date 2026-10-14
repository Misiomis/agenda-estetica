// Precio y pagos por sesión — lógica pura (sin DOM, sin Firestore), para que
// la aritmética de dinero y la validación se puedan probar solas.
//
// Unidad canónica: "miles de pesos argentinos" (ARS). Un valor cargado como
// 300 representa $300.000 reales. Esto no es una conversión nueva: el sistema
// ya se usaba así (los montos siempre fueron números chicos tipo 100/300/320,
// nunca se vio un "$300.000" completo) — lo que faltaba era decirlo explícito
// en vez de mostrar un "$" pelado que se puede leer como pesos sueltos. Todo
// registro nuevo guarda su escala (ESCALA_CANONICA) para que nunca vuelva a
// quedar ambiguo; uno viejo sin ese campo se trata como de unidad no
// confirmada (ver `tieneEscalaConfirmada`), nunca se reinterpreta por
// adivinanza.
export const MONEDA_CANONICA = 'ARS';
export const ESCALA_CANONICA = 'miles_ars'; // 1 unidad = 1000 ARS
export const ETIQUETA_UNIDAD = 'Importes expresados en miles de pesos argentinos (ARS)';

// Un importe se escribe con como máximo 1 decimal (cientos de pesos exactos:
// 100,5 = $100.500). Acepta coma o punto como separador decimal, nunca los
// dos juntos (eso sería un separador de miles, y "no se interpreta
// silenciosamente" — se rechaza con un mensaje claro en vez de adivinar).
const IMPORTE_RE = /^\d+([.,]\d)?$/;

// Parsea un importe escrito por la administradora. Devuelve { ok, valor,
// error }. valor queda en "décimas de mil" (entero exacto, sin punto
// flotante) para que las sumas nunca arrastren error de redondeo; se expone
// también en unidad canónica (divido por 10) para guardar/mostrar.
export function parsearImporte(texto) {
  const t = (texto == null ? '' : String(texto)).trim();
  if (t === '') return { ok: true, vacio: true, decimas: null, valor: null };
  if (!IMPORTE_RE.test(t)) {
    if (/[.,].*[.,]/.test(t) || /\d{1,3}[.,]\d{3}\b/.test(t)) {
      return { ok: false, error: 'No se puede interpretar un separador de miles. Escribí el número directamente, con como máximo 1 decimal (ej: 100,5).' };
    }
    return { ok: false, error: 'Importe inválido. Usá un número con como máximo 1 decimal (ej: 100 o 100,5).' };
  }
  const normal = t.replace(',', '.');
  const n = Number(normal);
  if (!Number.isFinite(n)) return { ok: false, error: 'Importe inválido.' };
  if (n > 1_000_000) return { ok: false, error: 'El importe parece demasiado grande para estar en miles de pesos — revisalo.' };
  const decimas = Math.round(n * 10);
  return { ok: true, vacio: false, decimas, valor: decimas / 10 };
}

export function formatearImporte(valorEnMiles) {
  if (valorEnMiles == null || !Number.isFinite(valorEnMiles)) return '';
  const redondeado = Math.round(valorEnMiles * 10) / 10;
  return redondeado.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function tieneEscalaConfirmada(registro) {
  return !!(registro && registro.escala === ESCALA_CANONICA);
}

// ── Validación de precio ──
// Vacío = "sin precio" (no es un acuerdo de $0). "Sin cargo" es una
// modalidad de gratuidad explícita, separada de "sin precio".
export function validarPrecio(texto, { sinCargo = false } = {}) {
  if (sinCargo) return { ok: true, precio: null, sinCargo: true };
  const r = parsearImporte(texto);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.vacio) return { ok: true, precio: null, sinCargo: false };
  if (r.valor <= 0) return { ok: false, error: 'El precio tiene que ser positivo (usá "Sin cargo" para gratuidad).' };
  return { ok: true, precio: r.valor, sinCargo: false };
}

// ── Validación de un pago ──
export function validarMontoPago(texto) {
  const r = parsearImporte(texto);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.vacio || r.valor <= 0) return { ok: false, error: 'Ingresá un importe positivo para este pago.' };
  return { ok: true, monto: r.valor };
}

// ── Totales y estado ──
// movimientos: [{ monto, tipo: 'cobro'|'devolucion' }]
export function totalRecibido(movimientos) {
  return (movimientos || []).reduce((s, m) => s + (m.tipo === 'devolucion' ? -m.monto : m.monto), 0);
}

export function saldoPendiente(precio, recibido) {
  if (precio == null) return null;
  return Math.round((precio - recibido) * 10) / 10;
}

// 'sin_precio' | 'sin_cargo' | 'sin_pagos' | 'parcial' | 'completo' | 'saldo_a_favor'
export function estadoCuenta({ precio, sinCargo, recibido }) {
  if (sinCargo) return 'sin_cargo';
  if (precio == null) return 'sin_precio';
  const saldo = saldoPendiente(precio, recibido);
  if (saldo > 0) return recibido > 0 ? 'parcial' : 'sin_pagos';
  if (saldo < 0) return 'saldo_a_favor';
  return 'completo';
}

export const ETIQUETA_ESTADO = {
  sin_precio: 'Sin precio', sin_cargo: 'Sin cargo', sin_pagos: 'Sin pagos',
  parcial: 'Pago parcial', completo: 'Pago completo', saldo_a_favor: 'Saldo a favor',
};

// ── Instantánea inmutable para un recibo ──
// pagoElegido: el pago que motiva este recibo. pagosHastaEse: todos los pagos
// de la misma prestación con fecha/creación <= la del elegido (para que el
// "total acumulado" de un recibo viejo, al regenerarlo, dé siempre el mismo
// número — nunca el acumulado de HOY).
export function construirInstantaneaRecibo({ prestacion, pagoElegido, pagosHastaEse, pacienteNombre, servicio }) {
  if (!pagoElegido) throw new Error('construirInstantaneaRecibo: falta el pago elegido');
  const recibidoHastaEse = totalRecibido(pagosHastaEse || [pagoElegido]);
  const precio = prestacion && !prestacion.sinCargo ? prestacion.precioAcordado : null;
  const saldo = saldoPendiente(precio, recibidoHastaEse);
  const estado = estadoCuenta({ precio, sinCargo: !!(prestacion && prestacion.sinCargo), recibido: recibidoHastaEse });
  return {
    pacienteNombre: pacienteNombre || '',
    concepto: servicio || 'Sesión',
    alcance: (prestacion && prestacion.alcance) || 'sesion',
    periodoDesde: (prestacion && prestacion.periodoDesde) || null,
    periodoHasta: (prestacion && prestacion.periodoHasta) || null,
    periodoMeses: (prestacion && prestacion.periodoMeses) || null,
    fechaPago: pagoElegido.fechaEfectiva,
    precioAcordado: precio,
    montoEstePago: pagoElegido.monto,
    totalRecibidoHastaEsto: recibidoHastaEse,
    saldo,
    estado,
    moneda: MONEDA_CANONICA,
    escala: ESCALA_CANONICA,
  };
}

// Texto de acompañamiento para WhatsApp, a partir de la MISMA instantánea
// (nunca recalcula con datos de hoy: lo que dice el mensaje es lo que dice el
// recibo).
export function construirMensajeRecibo(snapshot, primerNombre) {
  const nom = primerNombre ? `, ${primerNombre}` : '';
  // No se nombra el servicio/tratamiento en el mensaje — el recibo es solo
  // comprobante de un monto, no un detalle de qué se hizo.
  const partes = [`Hola${nom}. Te enviamos el comprobante de tu pago.`];
  if (snapshot.estado === 'completo') {
    partes.push(`El monto acordado es ${formatearImporte(snapshot.precioAcordado)} y recibimos el total de ${formatearImporte(snapshot.totalRecibidoHastaEsto)}. El pago está completo.`);
  } else if (snapshot.precioAcordado != null) {
    partes.push(`El monto acordado es ${formatearImporte(snapshot.precioAcordado)}, recibimos ${formatearImporte(snapshot.montoEstePago)}${snapshot.totalRecibidoHastaEsto !== snapshot.montoEstePago ? ` (acumulado: ${formatearImporte(snapshot.totalRecibidoHastaEsto)})` : ''} y queda un saldo pendiente de ${formatearImporte(Math.abs(snapshot.saldo))}.`);
  } else {
    partes.push(`Recibimos ${formatearImporte(snapshot.montoEstePago)}.`);
  }
  if (snapshot.periodoMeses) partes.push(`Período cubierto: ${snapshot.periodoMeses} mes${snapshot.periodoMeses === 1 ? '' : 'es'}.`);
  partes.push(ETIQUETA_UNIDAD + '.');
  return partes.join(' ');
}

// ── Respaldo de un pago ──
const TIPOS_AUTORIZADOS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
export const TAMANO_MAX_RESPALDO = 10 * 1024 * 1024; // 10 MB
export function validarRespaldo(archivo) {
  if (!archivo) return { ok: false, error: 'Para registrar este pago, adjuntá la factura o el comprobante correspondiente.' };
  const ext = TIPOS_AUTORIZADOS[archivo.type];
  if (!ext) return { ok: false, error: 'Formato no admitido. Adjuntá un PDF, JPG o PNG.' };
  if (!(archivo.size > 0)) return { ok: false, error: 'El archivo parece vacío. Volvé a seleccionarlo.' };
  if (archivo.size > TAMANO_MAX_RESPALDO) return { ok: false, error: 'El archivo es demasiado grande (máximo 10 MB).' };
  return { ok: true, ext };
}

// ── Idempotencia ──
// Un id estable por intento de pago, generado una sola vez en el cliente y
// reutilizado en reintentos (mismo id ⇒ mismo documento, nunca un cobro doble).
export function nuevoIdOperacion(prefijo, semilla) {
  return `${prefijo}_${semilla || Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
