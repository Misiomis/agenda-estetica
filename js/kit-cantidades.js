// Cantidades en los pedidos de Kit Facial (panel y página de pacientes).
// Cada línea de productosDetalle guarda el precio UNITARIO, la cantidad y el
// subtotal. Los pedidos viejos no tienen "cantidad": cuentan como 1.

export const CANT_MAX_KIT = 20;

export function normalizarCantidad(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, CANT_MAX_KIT);
}

// Arma los campos a guardar a partir de [{ nombre, precio, cantidad }].
export function armarPedidoKit(items) {
  const productosDetalle = (Array.isArray(items) ? items : []).map((it) => {
    const precio = Number(it.precio) || 0;
    const cantidad = normalizarCantidad(it.cantidad);
    return { nombre: String(it.nombre || ''), precio, cantidad, subtotal: precio * cantidad };
  });
  return {
    productos: productosDetalle.map((p) => p.nombre),
    productosDetalle,
    totalPedido: productosDetalle.reduce((s, p) => s + p.subtotal, 0),
    cantidadTotal: productosDetalle.reduce((s, p) => s + p.cantidad, 0),
  };
}

// Líneas para mostrar un pedido guardado (nuevo o viejo).
// precioRespaldo(nombre) → precio unitario para pedidos viejos sin detalle.
export function lineasPedidoKit(pedido, precioRespaldo) {
  const p = pedido || {};
  const nombres = Array.isArray(p.productos) ? p.productos : (p.productos ? [p.productos] : []);
  const detalle = Array.isArray(p.productosDetalle) ? p.productosDetalle : null;
  const base = detalle && detalle.length ? detalle.map((d, i) => ({ nombre: d.nombre || nombres[i] || '', precio: d.precio, cantidad: d.cantidad }))
    : nombres.map((n) => ({ nombre: n, precio: undefined, cantidad: 1 }));
  return base.map((l) => {
    let precio = l.precio != null && l.precio !== '' && !isNaN(Number(l.precio)) ? Number(l.precio) : null;
    if (precio === null && typeof precioRespaldo === 'function') {
      const r = precioRespaldo(l.nombre);
      precio = r != null && !isNaN(Number(r)) ? Number(r) : null;
    }
    const cantidad = normalizarCantidad(l.cantidad);
    return { nombre: String(l.nombre || ''), precio, cantidad, subtotal: precio === null ? null : precio * cantidad };
  });
}

export function totalLineas(lineas) {
  return (lineas || []).reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
}

export function etiquetaLinea(l) {
  return (l.cantidad > 1 ? l.cantidad + ' × ' : '') + l.nombre;
}

// Cambia el precio unitario de una línea y recalcula subtotales y total.
export function cambiarPrecioLinea(detalle, idx, nuevoPrecio) {
  const lineas = (detalle || []).map((d) => {
    const precio = Number(d.precio) || 0;
    const cantidad = normalizarCantidad(d.cantidad);
    return { ...d, precio, cantidad, subtotal: precio * cantidad };
  });
  if (!lineas[idx]) return null;
  lineas[idx].precio = Number(nuevoPrecio) || 0;
  lineas[idx].subtotal = lineas[idx].precio * lineas[idx].cantidad;
  return { productosDetalle: lineas, totalPedido: lineas.reduce((s, l) => s + l.subtotal, 0) };
}
