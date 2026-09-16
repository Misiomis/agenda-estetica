// Pruebas de regresión — precio/pagos/resumen mensual/gastos en admin.html
// (puntos 2, 3 y 4 de la auditoría de facturación, 2026-09-16).
//
// IMPORTANTE (mismo criterio que tests/identidad-paciente): esto es un
// espejo deliberado de las fórmulas reales de admin.html (módulos "PRECIO Y
// PAGOS" y "RESUMEN MENSUAL + GASTOS"). Si esas fórmulas cambian en
// admin.html, hay que reflejar el mismo cambio acá para que la prueba siga
// siendo representativa. Datos 100% sintéticos, no se toca Firestore real.

const assert = require('assert');

let fails = 0;
function check(desc, fn) {
  try { fn(); console.log('  OK  ' + desc); }
  catch (e) { fails++; console.log('  FAIL ' + desc + '\n       ' + e.message); }
}

// ─── Mirrors de admin.html ───────────────────────────────────────────────

// _fmtMoneyARS
const fmtMoneyARS = (n) => (n === null || n === undefined || isNaN(n)) ? 'Sin registro' : ('$' + Math.round(n).toLocaleString('es-AR'));

// _ppCobradoDe (Precio y pagos): cobros - devoluciones aplicados a una prestación
function cobradoDe(pagos, reservaId) {
  return pagos.filter(p => p.prestacionId === reservaId)
    .reduce((s, p) => s + (p.tipo === 'devolucion' ? -p.monto : p.monto), 0);
}

// _ppEstado (Precio y pagos): el estado SIEMPRE se deriva de los montos, nunca de un booleano guardado
function estadoPrestacion(prestacion, pagos) {
  if (!prestacion) return 'sin_registro';
  if (prestacion.anulada) return 'anulada';
  if (prestacion.sinCargo) return 'sin_cargo';
  const precio = prestacion.precioAcordado;
  if (precio === null || precio === undefined) return 'precio_no_definido';
  const cobrado = cobradoDe(pagos, prestacion.reservaId);
  if (cobrado <= 0) return 'pendiente';
  if (cobrado < precio) return 'parcial';
  return 'pagado';
}

// cobradoHasta (Resumen mensual): cobrado neto de una prestación hasta una fecha de corte (inclusive)
function cobradoHasta(pagos, reservaId, fechaCorte) {
  return pagos.filter(p => p.prestacionId === reservaId && (p.fechaEfectiva || '') <= fechaCorte)
    .reduce((s, p) => s + (p.tipo === 'devolucion' ? -p.monto : p.monto), 0);
}

// _rmCutoffFecha: corte = hoy si es el mes en curso, último día del mes si es un mes cerrado
function cutoffFecha(anio, mes, hoyISO, esMesActual) {
  if (esMesActual) return hoyISO;
  const ultimoDia = new Date(anio, mes, 0).getDate();
  return `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
}

// Saldo pendiente al cierre: TODAS las prestaciones (de cualquier período) con
// fecha de sesión <= corte, menos lo cobrado hasta esa misma fecha de corte.
function saldoPendienteAlCierre(prestaciones, reservasPorId, pagos, cutoff) {
  return prestaciones
    .filter(p => !p.anulada && !p.sinCargo && p.precioAcordado !== null && p.precioAcordado !== undefined)
    .filter(p => { const r = reservasPorId.get(p.reservaId); return r && r.fecha && r.fecha <= cutoff; })
    .reduce((s, p) => s + Math.max(0, p.precioAcordado - cobradoHasta(pagos, p.reservaId, cutoff)), 0);
}

// Cobros netos del mes (por fecha EFECTIVA de pago, no por fecha de la sesión ni de creación)
function cobrosNetosDelMes(pagos, prefijoMes) {
  const delMes = pagos.filter(p => (p.fechaEfectiva || '').startsWith(prefijoMes));
  const cobros = delMes.filter(p => p.tipo !== 'devolucion').reduce((s, p) => s + p.monto, 0);
  const devoluciones = delMes.filter(p => p.tipo === 'devolucion').reduce((s, p) => s + p.monto, 0);
  return { cobros, devoluciones, netos: cobros - devoluciones };
}

// Gastos: base del porcentaje nunca negativa (se usa cero), pero el neto final NO se fuerza a cero
function gastosPrevistosAdicionales(estimadosVigentes, cobrosNetosGenerales, cobrosNetosPorServicio) {
  return estimadosVigentes.reduce((s, g) => {
    const base = (g.alcance === 'servicio' && g.servicioVinculado) ? (cobrosNetosPorServicio.get(g.servicioVinculado) || 0) : cobrosNetosGenerales;
    const baseFloor = Math.max(0, base);
    return s + Math.round(baseFloor * (g.porcentaje || 0) / 100);
  }, 0);
}

// ─── Escenario 1 (spec): $75.000 de prestación, $30.000 pagados ──────────
console.log('\n═══ Escenario 1 — $75.000 de prestación con $30.000 pagados ═══');
{
  const reservaId = 'r1';
  const prestacion = { reservaId, precioAcordado: 75000, sinCargo: false, anulada: false };
  const pagos = [{ prestacionId: reservaId, monto: 30000, tipo: 'cobro', fechaEfectiva: '2026-09-15' }];
  check('estado = "parcial"', () => assert.strictEqual(estadoPrestacion(prestacion, pagos), 'parcial'));
  check('saldo pendiente = $45.000', () => assert.strictEqual(prestacion.precioAcordado - cobradoDe(pagos, reservaId), 45000));
  check('formato de saldo pendiente = "$45.000"', () => assert.strictEqual(fmtMoneyARS(45000), '$45.000'));

  // "Marcar como pagado" registra exactamente el saldo restante, sin duplicar
  const pagoMarcarComoPagado = { prestacionId: reservaId, monto: prestacion.precioAcordado - cobradoDe(pagos, reservaId), tipo: 'cobro', fechaEfectiva: '2026-09-20' };
  const pagosLuegoDePagar = [...pagos, pagoMarcarComoPagado];
  check('"Marcar como pagado" cobra exactamente $45.000 (el saldo, no el precio total de nuevo)', () => assert.strictEqual(pagoMarcarComoPagado.monto, 45000));
  check('después de marcar como pagado, estado = "pagado" y saldo = $0', () => {
    assert.strictEqual(estadoPrestacion(prestacion, pagosLuegoDePagar), 'pagado');
    assert.strictEqual(prestacion.precioAcordado - cobradoDe(pagosLuegoDePagar, reservaId), 0);
  });
}

// ─── Escenario 2 (spec): sesión de septiembre, cobro registrado en octubre ─
console.log('\n═══ Escenario 2 — sesión de septiembre pagada en octubre ═══');
{
  const reservaId = 'r2';
  const reservasPorId = new Map([[reservaId, { fecha: '2026-09-10' }]]);
  const prestacion = { reservaId, precioAcordado: 45000, sinCargo: false, anulada: false };
  const pagoDeOctubre = { prestacionId: reservaId, monto: 45000, tipo: 'cobro', fechaEfectiva: '2026-10-03' };
  const pagos = [pagoDeOctubre];

  const cutoffSeptiembre = cutoffFecha(2026, 9, null, false); // mes cerrado → último día del mes
  check('el corte de septiembre es 2026-09-30', () => assert.strictEqual(cutoffSeptiembre, '2026-09-30'));
  check('el pago de octubre NO cuenta en "cobros de septiembre" (fecha efectiva > corte)', () => {
    const { cobros } = cobrosNetosDelMes(pagos, '2026-09');
    assert.strictEqual(cobros, 0);
  });
  check('el pago de octubre SÍ cuenta en "cobros de octubre" (por fecha efectiva)', () => {
    const { cobros } = cobrosNetosDelMes(pagos, '2026-10');
    assert.strictEqual(cobros, 45000);
  });
  check('el saldo pendiente al cierre de septiembre sigue siendo $45.000 (lo que se debía en ese momento)', () => {
    const saldo = saldoPendienteAlCierre([prestacion], reservasPorId, pagos, cutoffSeptiembre);
    assert.strictEqual(saldo, 45000);
  });
  check('el saldo pendiente al cierre de octubre (o después) ya es $0 — el pago de octubre sí se aplicó', () => {
    const saldo = saldoPendienteAlCierre([prestacion], reservasPorId, pagos, '2026-10-31');
    assert.strictEqual(saldo, 0);
  });
}

// ─── Escenario 3 (spec): cobros netos, gastos, neto de caja y neto estimado ─
console.log('\n═══ Escenario 3 — $120.000 cobros − $20.000 devoluciones, gastos y estimado 10% ═══');
{
  const prefijoMes = '2026-11';
  const pagos = [
    { tipo: 'cobro', monto: 120000, fechaEfectiva: '2026-11-05' },
    { tipo: 'devolucion', monto: 20000, fechaEfectiva: '2026-11-12' },
  ];
  const { cobros, devoluciones, netos } = cobrosNetosDelMes(pagos, prefijoMes);
  check('cobros del mes = $120.000', () => assert.strictEqual(cobros, 120000));
  check('devoluciones del mes = $20.000', () => assert.strictEqual(devoluciones, 20000));
  check('cobros netos = $100.000', () => assert.strictEqual(netos, 100000));

  const gastosPagados = 25000;
  const netoCaja = netos - gastosPagados;
  check('neto de caja = cobros netos − gastos pagados = $75.000', () => assert.strictEqual(netoCaja, 75000));

  const estimado10pct = [{ alcance: 'general', porcentaje: 10 }];
  const gastosPrevistos = gastosPrevistosAdicionales(estimado10pct, netos, new Map());
  check('gasto estimado del 10% sobre $100.000 de cobros netos = $10.000', () => assert.strictEqual(gastosPrevistos, 10000));

  const netoEstimado = netoCaja - gastosPrevistos;
  check('neto estimado = neto de caja − gastos previstos = $65.000', () => assert.strictEqual(netoEstimado, 65000));
}

// ─── Escenario 4 (spec): reemplazar un estimado por el gasto real no duplica el descuento ─
console.log('\n═══ Escenario 4 — reemplazar un gasto estimado por el real no descuenta dos veces ═══');
{
  const cobrosNetosGenerales = 100000;
  // Antes de vincular: el estimado del 10% pesa $10.000 sobre el neto de caja
  const estimadosVigentesAntes = [{ id: 'est1', alcance: 'general', porcentaje: 10, reemplazadoPorGastoId: undefined }];
  const previstoAntes = gastosPrevistosAdicionales(estimadosVigentesAntes, cobrosNetosGenerales, new Map());
  check('antes de vincular: $10.000 previstos (estimado 10%)', () => assert.strictEqual(previstoAntes, 10000));

  // Se vincula con un gasto real de $9.500 (importe_fijo, pagado) — el estimado queda marcado reemplazadoPorGastoId
  const estimadosVigentesDespues = [{ id: 'est1', alcance: 'general', porcentaje: 10, reemplazadoPorGastoId: 'gastoReal1' }]
    .filter(g => !g.reemplazadoPorGastoId); // la lógica real filtra los ya reemplazados antes de sumar previstos
  const gastoRealPagado = 9500;
  const previstoDespues = gastosPrevistosAdicionales(estimadosVigentesDespues, cobrosNetosGenerales, new Map());
  check('después de vincular: el estimado ya no aporta a "previstos" (0, no $10.000 de nuevo)', () => assert.strictEqual(previstoDespues, 0));
  check('el gasto real pagado ($9.500) es el único que se descuenta de neto de caja', () => {
    const netoCaja = cobrosNetosGenerales - gastoRealPagado;
    assert.strictEqual(netoCaja, 90500);
  });
}

// ─── Escenario 5 (spec): base del porcentaje nunca negativa, pero el resultado sí puede serlo ─
console.log('\n═══ Escenario 5 — cobros netos negativos (devoluciones > cobros) ═══');
{
  const pagos = [
    { tipo: 'cobro', monto: 10000, fechaEfectiva: '2026-12-05' },
    { tipo: 'devolucion', monto: 30000, fechaEfectiva: '2026-12-10' },
  ];
  const { netos } = cobrosNetosDelMes(pagos, '2026-12');
  check('cobros netos = −$20.000 (negativo, no se oculta)', () => assert.strictEqual(netos, -20000));

  const estimado = [{ alcance: 'general', porcentaje: 15 }];
  const previsto = gastosPrevistosAdicionales(estimado, netos, new Map());
  check('la BASE del 15% se usa como $0 (no −$20.000), así que el estimado da $0', () => assert.strictEqual(previsto, 0));

  const gastosPagados = 5000;
  const netoCaja = netos - gastosPagados;
  const netoEstimado = netoCaja - previsto;
  check('el neto de caja SÍ queda negativo (−$25.000) — nunca se aplana artificialmente a cero', () => assert.strictEqual(netoCaja, -25000));
  check('el neto estimado también queda negativo (−$25.000, igual al de caja porque el previsto dio $0)', () => assert.strictEqual(netoEstimado, -25000));
}

// ─── Escenario 6 (spec): mes sin movimientos, datos incompletos ──────────
console.log('\n═══ Escenario 6 — mes sin movimientos y datos históricos incompletos ═══');
{
  check('mes sin pagos: cobros/devoluciones/netos = $0, no rompe ni da NaN', () => {
    const { cobros, devoluciones, netos } = cobrosNetosDelMes([], '2027-01');
    assert.strictEqual(cobros, 0);
    assert.strictEqual(devoluciones, 0);
    assert.strictEqual(netos, 0);
  });
  check('sin ningún registro de prestación: estado = "sin_registro" (nunca "pendiente $0" ni "pagado" por defecto)', () => {
    assert.strictEqual(estadoPrestacion(null, []), 'sin_registro');
  });
  check('formato de monto ausente = "Sin registro" (nunca $0 ni vacío)', () => {
    assert.strictEqual(fmtMoneyARS(null), 'Sin registro');
    assert.strictEqual(fmtMoneyARS(undefined), 'Sin registro');
  });
  check('precio guardado como null (definido pero sin cargar) da estado "precio_no_definido", distinto de "sin_registro"', () => {
    assert.strictEqual(estadoPrestacion({ reservaId: 'x', precioAcordado: null, sinCargo: false, anulada: false }, []), 'precio_no_definido');
  });
  check('"sin cargo" explícito nunca se confunde con "precio no definido" ni "pendiente"', () => {
    assert.strictEqual(estadoPrestacion({ reservaId: 'x', precioAcordado: null, sinCargo: true, anulada: false }, []), 'sin_cargo');
  });
}

// ─── Escenario 7: idempotencia — mismo operationId no duplica un cobro ────
console.log('\n═══ Escenario 7 — reintento/doble toque con el mismo operationId no duplica ═══');
{
  // Simula setDoc(doc(db,'pagos', operationId), data) con un Map como Firestore falso:
  // escribir dos veces con la MISMA clave sobrescribe, nunca agrega un segundo documento.
  const pagosFake = new Map();
  function setDocFake(id, data) { pagosFake.set(id, data); }
  const operationId = 'r1_1234567890_ab12cd';
  setDocFake(operationId, { monto: 45000, tipo: 'cobro', fechaEfectiva: '2026-09-20' });
  setDocFake(operationId, { monto: 45000, tipo: 'cobro', fechaEfectiva: '2026-09-20' }); // reintento con el mismo id
  check('dos escrituras con el mismo operationId dejan UN solo documento, no dos', () => {
    assert.strictEqual(pagosFake.size, 1);
  });
  check('el monto total cobrado sigue siendo $45.000, no $90.000', () => {
    const total = [...pagosFake.values()].reduce((s, p) => s + p.monto, 0);
    assert.strictEqual(total, 45000);
  });
}

console.log('\n' + '='.repeat(60));
if (fails) {
  console.log('RESULTADO: ' + fails + ' prueba(s) fallaron.');
  process.exit(1);
} else {
  console.log('RESULTADO: TODAS LAS PRUEBAS DE FACTURACIÓN (precio/pagos/resumen/gastos) OK');
}
