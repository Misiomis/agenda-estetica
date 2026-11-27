// Precios del Kit facial con promociones (Black Friday 2026).
// Un solo cálculo para la página de pacientes, el panel y el WhatsApp:
//   precio final unitario = precio habitual × (1 − %), redondeado a centavos
//   importe de la línea   = precio final unitario × cantidad
// Cada pedido guarda todo lo que se mostró (precios habituales, finales,
// importes, descuento y total) para que el aviso salga siempre igual aunque
// después cambie el catálogo o se prepare otro día.

import { normalizarCantidad } from './kit-cantidades.js';

// Viernes 27/11/2026 completo, hora de Argentina (UTC−3, sin horario de verano).
export const PROMO_BLACK_FRIDAY = {
  id: 'black-friday-2026',
  nombre: 'Black Friday',
  pct: 15,
  desde: '2026-11-27T00:00:00-03:00',
  hasta: '2026-11-28T00:00:00-03:00',
};

export const PROMOS_KIT = [PROMO_BLACK_FRIDAY];

// Promo vigente en ese instante (o null).
export function promoVigente(fecha = new Date(), promos = PROMOS_KIT) {
  const t = new Date(fecha).getTime();
  if (!Number.isFinite(t)) return null;
  return promos.find((p) => t >= Date.parse(p.desde) && t < Date.parse(p.hasta)) || null;
}

// Fecha 'YYYY-MM-DD' (día de pago registrado a mano) dentro de la promo.
export function diaEnPromo(diaISO, promo) {
  if (!promo || !/^\d{4}-\d{2}-\d{2}$/.test(String(diaISO || ''))) return false;
  return !!promoVigente(diaISO + 'T12:00:00-03:00', [promo]);
}

// Hoy en Argentina como 'YYYY-MM-DD'.
export function hoyArgentina(fecha = new Date()) {
  const d = new Date(new Date(fecha).getTime() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export const redondear2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;

export function precioConPromo(precioHabitual, promo) {
  const p = Number(precioHabitual) || 0;
  return promo ? redondear2(p * (1 - promo.pct / 100)) : redondear2(p);
}

function datosPromo(promo) {
  return promo ? { id: promo.id, nombre: promo.nombre, pct: promo.pct } : null;
}

// items: [{ nombre, precio (habitual), cantidad }] → campos a guardar.
// "precio" y "subtotal" de cada línea quedan con el valor FINAL (compatibles
// con el resto del panel); "precioHabitual" e "importeHabitual" con el de lista.
export function cotizarKit(items, promo = null) {
  const productosDetalle = (Array.isArray(items) ? items : []).map((it) => {
    const precioHabitual = redondear2(it.precioHabitual != null ? it.precioHabitual : it.precio);
    const cantidad = normalizarCantidad(it.cantidad);
    const precioFinal = precioConPromo(precioHabitual, promo);
    const importe = redondear2(precioFinal * cantidad);
    return {
      nombre: String(it.nombre || ''),
      cantidad,
      precioHabitual,
      precioFinal,
      importeHabitual: redondear2(precioHabitual * cantidad),
      importe,
      precio: precioFinal,
      subtotal: importe,
    };
  });
  const subtotalHabitual = redondear2(productosDetalle.reduce((s, l) => s + l.importeHabitual, 0));
  const total = redondear2(productosDetalle.reduce((s, l) => s + l.importe, 0));
  return {
    productos: productosDetalle.map((l) => l.nombre),
    productosDetalle,
    cantidadTotal: productosDetalle.reduce((s, l) => s + l.cantidad, 0),
    subtotalHabitual,
    descuento: redondear2(subtotalHabitual - total),
    total,
    totalPedido: total,
    promo: datosPromo(promo),
  };
}

// Vuelve a calcular un pedido guardado con otra promo (o sin promo),
// partiendo de sus precios habituales guardados.
export function recotizarPedido(pedido, promo = null) {
  const det = Array.isArray(pedido && pedido.productosDetalle) ? pedido.productosDetalle : [];
  return cotizarKit(det.map((d) => ({
    nombre: d.nombre,
    precio: d.precioHabitual != null ? d.precioHabitual : d.precio,
    cantidad: d.cantidad,
  })), promo);
}

export function promoDelPedido(pedido) {
  const id = pedido && pedido.promo && pedido.promo.id;
  return id ? PROMOS_KIT.find((p) => p.id === id) || null : null;
}

export function totalAbonado(pedido) {
  const pagos = Array.isArray(pedido && pedido.pagos) ? pedido.pagos : [];
  return redondear2(pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0));
}

// Qué pasa si se registra un pago con fecha diaISO:
// - pedido con promo y pago dentro de la promo → se mantiene;
// - pedido con promo, todavía no pagado del todo, y pago fuera de la promo →
//   vuelve al precio habitual (hay que mostrar el total nuevo antes de cobrar);
// - pedido ya pagado completo dentro de la promo → conserva su precio siempre.
export function evaluarPago(pedido, diaISO) {
  const promo = promoDelPedido(pedido);
  const total = Number(pedido && pedido.totalPedido) || 0;
  const abonado = totalAbonado(pedido);
  if (!promo) return { pierdePromo: false, totalAplicable: total, saldo: redondear2(total - abonado) };
  if (abonado >= total - 0.001 || diaEnPromo(diaISO, promo)) {
    return { pierdePromo: false, totalAplicable: total, saldo: redondear2(total - abonado) };
  }
  const habitual = recotizarPedido(pedido, null);
  return { pierdePromo: true, totalAplicable: habitual.total, saldo: redondear2(habitual.total - abonado), recotizado: habitual };
}

// Pedido sin precio en alguna línea (pedidos viejos): nombres faltantes.
export function lineasSinPrecio(pedido) {
  const det = Array.isArray(pedido && pedido.productosDetalle) ? pedido.productosDetalle : null;
  const nombres = Array.isArray(pedido && pedido.productos) ? pedido.productos : [];
  if (!det || !det.length) return nombres.map(String);
  return det.filter((d) => d.precio == null || d.precio === '' || isNaN(Number(d.precio)) || Number(d.precio) <= 0).map((d) => String(d.nombre || ''));
}

export function pesos(n) {
  const v = redondear2(n);
  const cent = Math.abs(v % 1) > 0.001;
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: cent ? 2 : 0, maximumFractionDigits: 2 });
}

// Líneas normalizadas de un pedido guardado (nuevo o viejo).
export function lineasCotizadas(pedido) {
  const det = Array.isArray(pedido && pedido.productosDetalle) && pedido.productosDetalle.length
    ? pedido.productosDetalle
    : (Array.isArray(pedido && pedido.productos) ? pedido.productos : (pedido && pedido.productos ? [pedido.productos] : [])).map((n) => ({ nombre: n }));
  return det.map((d) => {
    const cantidad = normalizarCantidad(d.cantidad);
    const tienePrecio = d.precio != null && d.precio !== '' && !isNaN(Number(d.precio)) && Number(d.precio) > 0;
    const precioFinal = tienePrecio ? redondear2(d.precioFinal != null ? d.precioFinal : d.precio) : null;
    const precioHabitual = tienePrecio ? redondear2(d.precioHabitual != null ? d.precioHabitual : precioFinal) : null;
    const importe = tienePrecio ? redondear2(d.importe != null ? d.importe : (d.subtotal != null ? d.subtotal : precioFinal * cantidad)) : null;
    return { nombre: String(d.nombre || ''), cantidad, precioHabitual, precioFinal, importe };
  });
}

// Mensaje de WhatsApp "tu kit está listo", con los datos GUARDADOS del pedido.
// Solo símbolos del plano básico (❤, •, ×, −): por el enlace wa.me los emojis
// como 💚 llegaban rotos ("�").
export function mensajeKitListo(pedido, nombre) {
  const p = pedido || {};
  const pila = String(p.nombrePaciente || nombre || '').trim().split(/\s+/)[0] || '';
  const promo = p.promo && p.promo.pct ? p.promo : null;
  const etiquetaPromo = promo ? (promo.nombre || 'Promo') : '';
  const lineas = lineasCotizadas(p);
  const out = [];
  out.push('¡Hola' + (pila ? ', ' + pila : '') + '! Tu kit facial de Espacio MimarT ya está listo. ❤');
  out.push('');
  lineas.forEach((l) => {
    const cu = l.cantidad > 1 ? ' c/u' : '';
    out.push('• ' + l.nombre + ' × ' + l.cantidad);
    if (l.precioFinal == null) {
      out.push('Precio a confirmar');
    } else if (promo && l.precioHabitual > l.precioFinal) {
      out.push('Precio habitual ' + pesos(l.precioHabitual) + cu + ' · ' + etiquetaPromo + ' ' + pesos(l.precioFinal) + cu);
    } else {
      out.push('Precio ' + pesos(l.precioFinal) + cu);
    }
    if (l.importe != null) out.push((l.cantidad > 1 ? 'Importe por las ' + l.cantidad + ' unidades ' : 'Importe ') + pesos(l.importe));
    out.push('');
  });
  const conPrecio = lineas.filter((l) => l.importe != null);
  const total = p.totalPedido != null && !isNaN(Number(p.totalPedido)) ? redondear2(p.totalPedido) : redondear2(conPrecio.reduce((s, l) => s + l.importe, 0));
  if (promo) {
    const sub = p.subtotalHabitual != null ? redondear2(p.subtotalHabitual) : redondear2(conPrecio.reduce((s, l) => s + l.precioHabitual * l.cantidad, 0));
    const desc = p.descuento != null ? redondear2(p.descuento) : redondear2(sub - total);
    out.push('Subtotal a precio habitual ' + pesos(sub));
    out.push('Descuento ' + etiquetaPromo + ' (' + promo.pct + '%) −' + pesos(desc));
  }
  if (total > 0) out.push('*Total de tu pedido ' + pesos(total) + '*');
  const pagos = Array.isArray(p.pagos) ? p.pagos : [];
  if (pagos.length) {
    const ab = totalAbonado(p);
    out.push('Abonado ' + pesos(ab) + ' · Saldo pendiente ' + pesos(Math.max(0, redondear2(total - ab))));
  }
  out.push('');
  out.push('Podés retirarlo en *Farmacia Central*, de 08:00 a 12:00 y de 16:00 a 20:00.');
  out.push('');
  out.push('¡Gracias por elegir Espacio MimarT!');
  return out.join('\n');
}
