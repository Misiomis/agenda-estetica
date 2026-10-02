// node tests/precio-pagos/run-tests.js   (datos 100% sintéticos)
import {
  parsearImporte, formatearImporte, validarPrecio, validarMontoPago, totalRecibido, saldoPendiente,
  estadoCuenta, ETIQUETA_ESTADO, construirInstantaneaRecibo, construirMensajeRecibo, validarRespaldo,
  tieneEscalaConfirmada, ESCALA_CANONICA, ETIQUETA_UNIDAD, nuevoIdOperacion, TAMANO_MAX_RESPALDO,
} from '../../js/precio-pagos.js';

let fails = 0;
const check = (desc, cond, extra) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

console.log('\n=== Parseo e importes (sin inventar separador de miles) ===');
{
  check('entero simple', parsearImporte('300').valor === 300);
  check('vacío = sin precio, no cero', parsearImporte('').vacio === true && parsearImporte('').valor === null);
  check('solo espacios = vacío', parsearImporte('   ').vacio === true);
  check('decimal con coma: 100,5 = 100.5 (cientos de pesos exactos)', parsearImporte('100,5').valor === 100.5);
  check('decimal con punto equivalente', parsearImporte('100.5').valor === 100.5);
  check('NUNCA interpreta "100.000" como separador de miles — se rechaza con mensaje claro', parsearImporte('100.000').ok === false && /separador de miles/i.test(parsearImporte('100.000').error));
  check('dos separadores se rechaza igual', parsearImporte('1,000.5').ok === false);
  check('más de 1 decimal se rechaza', parsearImporte('100,55').ok === false);
  check('texto no numérico se rechaza', parsearImporte('abc').ok === false);
  check('negativo no matchea el formato (se rechaza)', parsearImporte('-50').ok === false);
  check('un valor absurdamente grande para "miles" se rechaza', parsearImporte('5000000').ok === false);
  check('formatearImporte muestra 300, no 300.000', formatearImporte(300) === '300');
  check('formatearImporte conserva el decimal exacto', formatearImporte(100.5) === '100,5');
  check('100 o 100,0 nunca se confunden entre sí al parsear y reformatear', parsearImporte('100').valor === parsearImporte('100,0').valor);
}

console.log('\n=== Precio: vacío, sin cargo, positivo ===');
{
  check('precio vacío → sin precio (no 0)', validarPrecio('').precio === null && validarPrecio('').ok);
  check('precio 0 se rechaza (no es un precio válido ni "sin precio")', validarPrecio('0').ok === false);
  check('precio negativo se rechaza', validarPrecio('-10').ok === false);
  check('"Sin cargo" ignora el texto y es gratuidad explícita', validarPrecio('300', { sinCargo: true }).precio === null && validarPrecio('300', { sinCargo: true }).sinCargo === true);
  check('precio válido', validarPrecio('320').precio === 320);
}

console.log('\n=== Pago: nunca cero ni negativo ===');
{
  check('monto vacío se rechaza', validarMontoPago('').ok === false);
  check('monto 0 se rechaza', validarMontoPago('0').ok === false);
  check('monto negativo se rechaza', validarMontoPago('-5').ok === false);
  check('monto válido', validarMontoPago('100').monto === 100);
}

console.log('\n=== Totales y estados — exactamente los ejemplos del pedido ===');
{
  const caso = (precio, pagos) => { const recibido = totalRecibido(pagos); return { recibido, saldo: saldoPendiente(precio, recibido), estado: estadoCuenta({ precio, sinCargo: false, recibido }) }; };
  const c1 = caso(120, [{ monto: 100, tipo: 'cobro' }]);
  check('120 acordado, pago 100 → recibido 100, saldo 20, Pago parcial', c1.recibido === 100 && c1.saldo === 20 && c1.estado === 'parcial', c1);
  const c2 = caso(120, [{ monto: 100, tipo: 'cobro' }, { monto: 20, tipo: 'cobro' }]);
  check('segundo pago de 20 sobre el mismo acuerdo → total 120, saldo 0, Pago completo (no un pago inicial de 120)', c2.recibido === 120 && c2.saldo === 0 && c2.estado === 'completo', c2);
  const c3 = caso(300, [{ monto: 300, tipo: 'cobro' }]);
  check('300 y 300 → Pago completo', c3.recibido === 300 && c3.saldo === 0 && c3.estado === 'completo');
  check('sin pagos → estado "Sin pagos"', estadoCuenta({ precio: 100, sinCargo: false, recibido: 0 }) === 'sin_pagos');
  check('excedente → "Saldo a favor", nunca se ajusta a 0 silenciosamente', estadoCuenta({ precio: 100, sinCargo: false, recibido: 150 }) === 'saldo_a_favor' && saldoPendiente(100, 150) === -50);
  check('sin precio → estado "Sin precio"', estadoCuenta({ precio: null, sinCargo: false, recibido: 0 }) === 'sin_precio');
  check('sin cargo → estado "Sin cargo" aunque haya "precio" cargado por error', estadoCuenta({ precio: 100, sinCargo: true, recibido: 0 }) === 'sin_cargo');
  check('una devolución resta del total recibido', totalRecibido([{ monto: 120, tipo: 'cobro' }, { monto: 20, tipo: 'devolucion' }]) === 100);
  check('todas las etiquetas de estado existen', Object.keys(ETIQUETA_ESTADO).length === 6);
}

console.log('\n=== Instantánea del recibo: no se recalcula con el acumulado de HOY ===');
{
  const prest = { precioAcordado: 120, sinCargo: false };
  const pago1 = { id: 'p1', monto: 100, fechaEfectiva: '2026-09-01', tipo: 'cobro' };
  const pago2 = { id: 'p2', monto: 20, fechaEfectiva: '2026-09-15', tipo: 'cobro' };
  const snap1 = construirInstantaneaRecibo({ prestacion: prest, pagoElegido: pago1, pagosHastaEse: [pago1], pacienteNombre: 'Paciente Prueba', servicio: 'Facial Prueba' });
  check('recibo del primer pago: parcial, acumulado 100 (no 120)', snap1.estado === 'parcial' && snap1.totalRecibidoHastaEsto === 100 && snap1.montoEstePago === 100, snap1);
  const snap2 = construirInstantaneaRecibo({ prestacion: prest, pagoElegido: pago2, pagosHastaEse: [pago1, pago2], pacienteNombre: 'Paciente Prueba', servicio: 'Facial Prueba' });
  check('recibo del segundo pago: completo, acumulado 120, este pago 20', snap2.estado === 'completo' && snap2.totalRecibidoHastaEsto === 120 && snap2.montoEstePago === 20, snap2);
  check('regenerar el recibo del PRIMER pago después del segundo sigue dando 100 (no se contamina con el pago de después)', construirInstantaneaRecibo({ prestacion: prest, pagoElegido: pago1, pagosHastaEse: [pago1], pacienteNombre: 'x', servicio: 'y' }).totalRecibidoHastaEsto === 100);
  check('la instantánea guarda moneda y escala', snap1.moneda === 'ARS' && snap1.escala === ESCALA_CANONICA);
  check('sin pago elegido, se rechaza (no hay recibo sin un pago confirmado)', (() => { try { construirInstantaneaRecibo({ prestacion: prest, pagoElegido: null }); return false; } catch (e) { return true; } })());

  const msgParcial = construirMensajeRecibo(snap1, 'Susana');
  check('mensaje de pago parcial: acordado, recibido y saldo, con la aclaración de unidad', msgParcial.includes('120') && msgParcial.includes('100') && msgParcial.includes('20') && msgParcial.includes(ETIQUETA_UNIDAD));
  const msgCompleto = construirMensajeRecibo(snap2, 'Susana');
  check('mensaje de pago completo dice "el total" y no menciona saldo', /total/.test(msgCompleto) && !/saldo/i.test(msgCompleto));
  check('sin período, el mensaje no inventa meses', !/Período cubierto/.test(msgParcial));
  const prest2 = { ...prest, periodoMeses: 3 };
  const snapPlan = construirInstantaneaRecibo({ prestacion: prest2, pagoElegido: pago1, pagosHastaEse: [pago1], servicio: 'Plan' });
  check('con período registrado, el mensaje sí lo menciona', /Período cubierto: 3 meses/.test(construirMensajeRecibo(snapPlan, '')));
}

console.log('\n=== Respaldo obligatorio ===');
{
  check('sin archivo → rechazado con el aviso pedido', validarRespaldo(null).ok === false && /adjuntá la factura o el comprobante/i.test(validarRespaldo(null).error));
  check('PDF válido', validarRespaldo({ type: 'application/pdf', size: 1000 }).ok === true);
  check('JPG y PNG válidos', validarRespaldo({ type: 'image/jpeg', size: 1000 }).ok && validarRespaldo({ type: 'image/png', size: 1000 }).ok);
  check('un formato no admitido se rechaza (ej: Word)', validarRespaldo({ type: 'application/msword', size: 1000 }).ok === false);
  check('un archivo de tamaño 0 se rechaza (no alcanza con "haberlo seleccionado")', validarRespaldo({ type: 'application/pdf', size: 0 }).ok === false);
  check('un archivo demasiado grande se rechaza', validarRespaldo({ type: 'application/pdf', size: TAMANO_MAX_RESPALDO + 1 }).ok === false);
}

console.log('\n=== Escala / unidad: nunca se adivina sobre datos viejos ===');
{
  check('un registro nuevo con escala canónica se reconoce', tieneEscalaConfirmada({ escala: ESCALA_CANONICA }));
  check('un registro viejo sin el campo "escala" NO se asume en miles ni en pesos — queda sin confirmar', tieneEscalaConfirmada({ precioAcordado: 300 }) === false && tieneEscalaConfirmada(null) === false && tieneEscalaConfirmada({}) === false);
}

console.log('\n=== Idempotencia ===');
{
  const a = nuevoIdOperacion('pago', 'r1');
  const b = nuevoIdOperacion('pago', 'r1');
  check('dos ids generados por separado nunca coinciden (no se reutilizan por accidente)', a !== b);
  check('el id es estable una vez generado (se pasa igual en reintentos, eso lo asegura quien lo guarda, no esta función)', typeof a === 'string' && a.startsWith('pago_'));
}

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE PRECIO Y PAGOS OK');
process.exit(fails ? 1 : 0);
