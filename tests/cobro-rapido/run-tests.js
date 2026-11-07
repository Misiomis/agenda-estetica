// node tests/cobro-rapido/run-tests.js   (datos 100% sintéticos)
import { parsearPesos, milesAPesos, pesosAMiles, formatoPesos, estadoCobro, planCobro, restoMixto, totalesPorMedio, ultimoPrecio, etiquetaMedio, normalizarMontoARS, normalizarDocMontos, MONTOS_RAPIDOS } from '../../js/cobro-rapido.js';
import { parsearImporte, formatearImporte } from '../../js/precio-pagos.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

console.log('\n=== Pesos completos ↔ miles (escala de Firestore) ===');
check('150000 → 150 miles', parsearPesos('150000').miles === 150);
check('"150.000" y "$ 150.000" → 150', parsearPesos('150.000').miles === 150 && parsearPesos('$ 150.000').miles === 150);
check('45.500 → 45,5 miles (decimal soportado)', parsearPesos('45.500').miles === 45.5 && parsearPesos('45500').miles === 45.5);
check('"45500,00" aceptado; con centavos no', parsearPesos('45500,00').miles === 45.5 && !parsearPesos('45500,50').ok);
check('montos con decenas de pesos se rechazan (no se redondea en silencio)', !parsearPesos('45550').ok);
check('"150" se marca como posible error de miles', parsearPesos('150').pareceMiles === true && parsearPesos('150000').pareceMiles === false);
check('vacío → vacio', parsearPesos('').vacio === true);
check('texto inválido', !parsearPesos('abc').ok && !parsearPesos('1.50.0').ok);
check('ida y vuelta exacta para históricos (300 → $300.000 → 300)', milesAPesos(300) === 300000 && pesosAMiles(300000) === 300 && milesAPesos(45.5) === 45500);
check('compatible con el validador existente en miles', parsearImporte(String(parsearPesos('45.500').miles).replace('.', ',')).valor === 45.5);
check('formato: $ 150.000', formatoPesos(150) === '$ 150.000' && formatoPesos(45.5) === '$ 45.500');
check('formatearImporte histórico sigue igual (300 → "300")', formatearImporte(300) === '300');

console.log('\n=== Estado del botón de cobro ===');
const P = (precio, extra = {}) => ({ precioAcordado: precio, sinCargo: false, ...extra });
const C = (monto, metodoPago, tipo = 'cobro') => ({ monto, metodoPago, tipo });
check('sin registro → ⚪ Cargar cobro', estadoCobro(null, []).texto === 'Cargar cobro' && estadoCobro(null, []).icono === '⚪');
let e = estadoCobro(P(150), [C(150, 'efectivo')]);
check('pagado → 🟢 $ 150.000 · Pagado (Efectivo)', e.texto === '$ 150.000 · Pagado (Efectivo)' && e.icono === '🟢', e.texto);
e = estadoCobro(P(150), [C(100, 'transferencia')]);
check('parcial → 🟡 Debe $ 50.000 (de $ 150.000)', e.texto === 'Debe $ 50.000 (de $ 150.000)' && e.clave === 'parcial', e.texto);
check('mixto → (Mixto)', /Mixto/.test(estadoCobro(P(150), [C(100, 'efectivo'), C(50, 'mercadopago')]).texto));
check('devolución descuenta', estadoCobro(P(150), [C(150, 'efectivo'), C(50, null, 'devolucion')]).clave === 'parcial');
check('sin cargo → 🎁', estadoCobro({ sinCargo: true, precioAcordado: null }, []).clave === 'sin_cargo');
check('anulada', estadoCobro(P(150, { anulada: true }), []).clave === 'anulada');

console.log('\n=== Plan de cobro en 1 paso ===');
let p = planCobro({ modo: 'total', monto: '150000', medio: 'efectivo' });
check('Pagado total: precio 150 + 1 pago de 150 en efectivo', p.ok && p.prestacion.precioAcordado === 150 && p.pagos.length === 1 && p.pagos[0].monto === 150 && p.pagos[0].metodoPago === 'efectivo', p);
p = planCobro({ modo: 'total', monto: '150.000', medio: 'transferencia', cobradoPrevio: 50 });
check('si ya había una seña, solo cobra el resto (100)', p.ok && p.pagos[0].monto === 100);
check('precio menor a lo ya cobrado → error claro', !planCobro({ modo: 'total', monto: '40000', medio: 'efectivo', cobradoPrevio: 50 }).ok);
check('precio igual a lo cobrado → solo actualiza precio', planCobro({ modo: 'total', monto: '50000', medio: 'efectivo', cobradoPrevio: 50 }).pagos.length === 0);
p = planCobro({ modo: 'total', monto: '150000', medio: 'mixto', mixto: [{ pesos: '100000', medio: 'efectivo' }, { pesos: '50000', medio: 'mercadopago' }] });
check('mixto: dos pagos que suman el total', p.ok && p.esMixto && p.pagos.map((x) => x.monto + x.metodoPago).join() === '100efectivo,50mercadopago', p);
check('mixto que no suma → error', !planCobro({ modo: 'total', monto: '150000', medio: 'mixto', mixto: [{ pesos: '100000', medio: 'efectivo' }, { pesos: '40000', medio: 'tarjeta' }] }).ok);
check('resto automático del mixto', restoMixto(150000, 100000) === 50000);
p = planCobro({ modo: 'sena', precioTotal: '150000', entrega: '50000', medio: 'efectivo' });
check('Seña: precio 150, entrega 50, saldo 100', p.ok && p.prestacion.precioAcordado === 150 && p.pagos[0].monto === 50 && p.saldoLuego === 100, p);
check('seña mayor al total → error', !planCobro({ modo: 'sena', precioTotal: '100000', entrega: '150000', medio: 'efectivo' }).ok);
check('Sin cargo: no registra pagos', planCobro({ modo: 'sincargo' }).prestacion.sinCargo === true && !planCobro({ modo: 'sincargo' }).pagos.length);
check('sin medio → error', !planCobro({ modo: 'total', monto: '150000' }).ok);

console.log('\n=== Totales por medio y último precio ===');
const t = totalesPorMedio([C(100, 'efectivo'), C(50, 'transferencia'), C(20, 'efectivo'), C(10, null, 'devolucion')]);
check('suma por medio y devoluciones aparte', t.porMedio.efectivo === 120 && t.porMedio.transferencia === 50 && t.devoluciones === 10);
const rs = new Map([['a', { fecha: '2026-09-01', servicio: 'Hi-Fu Facial' }], ['b', { fecha: '2026-10-01', servicio: 'Hi-Fu Facial' }], ['c', { fecha: '2026-10-05', servicio: 'Drenaje' }]]);
check('último precio de esa paciente y servicio', ultimoPrecio([{ id: 'a', reservaId: 'a', pacienteKey: 'dni:1', precioAcordado: 120 }, { id: 'b', reservaId: 'b', pacienteKey: 'dni:1', precioAcordado: 150 }, { id: 'c', reservaId: 'c', pacienteKey: 'dni:1', precioAcordado: 80 }], rs, { pacienteKey: 'dni:1', servicio: 'Hi-Fu Facial' }) === 150);
check('medios históricos se siguen leyendo', etiquetaMedio('otro') === 'Otro' && etiquetaMedio('mercadopago') === 'Mercado Pago');

console.log('\n=== Normalización inteligente de escala (normalizarMontoARS) ===');
check('<= 2000 se interpreta en miles (30, 150, 300, 2000 sin cambios)', normalizarMontoARS(30) === 30 && normalizarMontoARS(150) === 150 && normalizarMontoARS(300) === 300 && normalizarMontoARS(2000) === 2000);
check('> 2000 ya está en pesos: 21000 → 21, 45500 → 45,5, 150000 → 150 (miles)', normalizarMontoARS(21000) === 21 && normalizarMontoARS(45500) === 45.5 && normalizarMontoARS(150000) === 150);
check('21000 guardado se ve $ 21.000 (no $ 21.000.000)', formatoPesos(normalizarMontoARS(21000)) === '$ 21.000');
check('null / vacío se respetan', normalizarMontoARS(null) === null && normalizarMontoARS(undefined) === undefined && normalizarMontoARS('') === '');
const orig = { precioAcordado: 21000, sinCargo: false, escala: 'miles_ars' };
const nd = normalizarDocMontos(orig);
check('el doc normalizado es una copia: el original no se toca', orig.precioAcordado === 21000 && nd.precioAcordado === 21 && nd !== orig);
check('marca interna no enumerable (nunca viaja a Firestore)', nd._enPesos.precioAcordado === 21000 && !Object.keys(nd).includes('_enPesos') && !('_enPesos' in JSON.parse(JSON.stringify(nd))) && !('_enPesos' in { ...nd }));
const ya = { monto: 50 };
check('doc ya en miles → mismo objeto, sin cambios', normalizarDocMontos(ya) === ya);
const caso = estadoCobro(normalizarDocMontos({ precioAcordado: 21000 }), [normalizarDocMontos({ monto: 10, tipo: 'cobro', metodoPago: 'efectivo' })]);
check('precio cargado en pesos (21000) + seña de 10 (miles) → Debe $ 11.000 (de $ 21.000)', caso.texto === 'Debe $ 11.000 (de $ 21.000)', caso.texto);
check('montos rápidos del espacio', MONTOS_RAPIDOS.join() === '15000,20000,25000,30000,45000,60000,150000');

console.log('\n=== Pago mixto también en Seña ===');
let ps = planCobro({ modo: 'sena', precioTotal: '200.000', entrega: '50.000', medio: 'mixto', mixto: [{ pesos: '30.000', medio: 'efectivo' }, { pesos: '20.000', medio: 'transferencia' }] });
check('seña mixta: 2 pagos (30 efectivo + 20 transferencia), saldo 150', ps.ok && ps.esMixto && ps.pagos.length === 2 && ps.pagos[0].monto === 30 && ps.pagos[1].metodoPago === 'transferencia' && ps.saldoLuego === 150, ps);
ps = planCobro({ modo: 'sena', precioTotal: '200.000', entrega: '50.000', medio: 'mixto', mixto: [{ pesos: '30.000', medio: 'efectivo' }, { pesos: '10.000', medio: 'transferencia' }] });
check('seña mixta que no suma la entrega → error claro', !ps.ok && /suman/.test(ps.error));

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE COBRO RÁPIDO OK');
process.exit(fails ? 1 : 0);
