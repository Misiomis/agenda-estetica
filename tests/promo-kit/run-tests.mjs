import { promoVigente, cotizarKit, evaluarPago, mensajeKitListo, lineasSinPrecio, recotizarPedido, pesos, diaEnPromo, PROMO_BLACK_FRIDAY } from '../../js/promo-kit.js';

let fallas = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fallas++; };

// Vigencia: viernes 27/11/2026 en hora argentina
ok(!promoVigente('2026-11-26T23:59:59-03:00'), 'jueves 23:59 AR: sin promo');
ok(promoVigente('2026-11-27T00:00:00-03:00') === PROMO_BLACK_FRIDAY, 'viernes 00:00 AR: con promo');
ok(promoVigente('2026-11-27T23:59:59-03:00'), 'viernes 23:59 AR: con promo');
ok(!promoVigente('2026-11-28T00:00:00-03:00'), 'sábado 00:00 AR: terminó');
ok(promoVigente('2026-11-28T02:30:00Z'), 'viernes 23:30 AR expresado en UTC (sábado 02:30Z): con promo');
ok(diaEnPromo('2026-11-27', PROMO_BLACK_FRIDAY) && !diaEnPromo('2026-11-28', PROMO_BLACK_FRIDAY), 'día de pago manual 27 sí, 28 no');

// Ejemplo: Leche ×1 + Crema ×2 a $20.000 → $51.000
const items = [{ nombre: 'Leche de limpieza', precio: 20000, cantidad: 1 }, { nombre: 'Crema hidratante', precio: 20000, cantidad: 2 }];
const c = cotizarKit(items, PROMO_BLACK_FRIDAY);
ok(c.productosDetalle[0].precioFinal === 17000 && c.productosDetalle[1].importe === 34000, 'precio final 17.000 e importe 34.000');
ok(c.subtotalHabitual === 60000 && c.descuento === 9000 && c.total === 51000 && c.totalPedido === 51000, 'subtotal 60.000, descuento 9.000, total 51.000');
ok(c.promo && c.promo.pct === 15, 'el pedido guarda la promo');
const sin = cotizarKit(items, null);
ok(sin.total === 60000 && sin.descuento === 0 && sin.promo === null, 'fuera de promo: 60.000 sin descuento');
// redondeo a centavos por unidad
const r = cotizarKit([{ nombre: 'X', precio: 12345, cantidad: 3 }], PROMO_BLACK_FRIDAY);
ok(r.productosDetalle[0].precioFinal === 10493.25 && r.total === 31479.75, 'redondeo por unidad: 10.493,25 × 3 = 31.479,75');
ok(pesos(31479.75) === '$31.479,75' && pesos(51000) === '$51.000', 'formato de pesos');

// Mensaje con el ejemplo y pago completo
const pedido = { nombrePaciente: 'Ana Pérez', ...c, pagos: [{ monto: 51000, fecha: '2026-11-27' }] };
const msg = mensajeKitListo(pedido);
console.log(msg.split('\n').map((l) => '      ' + l).join('\n'));
ok(msg.startsWith('¡Hola, Ana! Tu kit facial de Espacio MimarT ya está listo. ❤') && ![...msg].some(ch => ch.codePointAt(0) > 0xFFFF), 'saludo');
ok(msg.includes('• Leche de limpieza × 1\nPrecio habitual $20.000 · Black Friday $17.000\nImporte $17.000'), 'línea leche');
ok(msg.includes('• Crema hidratante × 2\nPrecio habitual $20.000 c/u · Black Friday $17.000 c/u\nImporte por las 2 unidades $34.000'), 'línea crema');
ok(msg.includes('Subtotal a precio habitual $60.000\nDescuento Black Friday (15%) −$9.000\n*Total de tu pedido $51.000*\nAbonado $51.000 · Saldo pendiente $0'), 'resumen 51.000');
ok(msg.includes('¡Gracias por elegir Espacio MimarT!'), 'cierre');

// Pagado el viernes, aviso preparado el sábado (o con catálogo cambiado): mismo mensaje
ok(mensajeKitListo(JSON.parse(JSON.stringify(pedido))) === msg, 'pagado viernes, aviso sábado: mismos $51.000 (datos guardados)');
ok(!evaluarPago(pedido, '2026-11-30').pierdePromo, 'ya pagado completo el viernes: no pierde la promo');

// Pedido del viernes pagado el sábado → precio habitual antes de cobrar
const impago = { ...c, pagos: [] };
const ev = evaluarPago(impago, '2026-11-28');
ok(ev.pierdePromo && ev.totalAplicable === 60000, 'pedido del viernes pagado el sábado: total habitual 60.000');
ok(!evaluarPago(impago, '2026-11-27').pierdePromo, 'pagado el viernes: mantiene 51.000');

// Pedido a precio habitual: lista todo y total
const reg = mensajeKitListo({ nombrePaciente: 'Bea', ...sin });
ok(reg.includes('• Crema hidratante × 2\nPrecio $20.000 c/u\nImporte por las 2 unidades $40.000') && reg.includes('*Total de tu pedido $60.000*') && !/Descuento|Abonado/.test(reg), 'pedido habitual: precio, importe y total; sin descuento ni pago');

// Pedidos viejos
ok(lineasSinPrecio({ productos: ['Tónico'] }).join() === 'Tónico', 'pedido viejo sin detalle: marca el faltante');
ok(lineasSinPrecio({ productosDetalle: [{ nombre: 'A', precio: 100 }, { nombre: 'B' }] }).join() === 'B', 'línea sin precio');
ok(lineasSinPrecio(pedido).length === 0, 'pedido completo: nada faltante');
const viejo = mensajeKitListo({ nombrePaciente: 'Caro', productos: ['Tónico'] });
ok(viejo.includes('• Tónico × 1\nPrecio a confirmar'), 'mensaje de pedido viejo: "Precio a confirmar"');
const viejoDet = mensajeKitListo({ nombrePaciente: 'Dani', productosDetalle: [{ nombre: 'Gel', precio: 10000, cantidad: 2, subtotal: 20000 }], totalPedido: 20000 });
ok(viejoDet.includes('Precio $10.000 c/u\nImporte por las 2 unidades $20.000') && viejoDet.includes('*Total de tu pedido $20.000*'), 'pedido viejo con detalle');

// Recotizar
ok(recotizarPedido(pedido, null).total === 60000 && recotizarPedido(sin, PROMO_BLACK_FRIDAY).total === 51000, 'recotizar en ambos sentidos');

console.log(fallas ? `FALLAS: ${fallas}` : 'PROMO KIT OK');
process.exit(fallas ? 1 : 0);
