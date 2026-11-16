// node tests/kit-cantidades/inteligente.mjs
// Aviso a Gime en Mimar Inteligente: debe leer la cantidad de cada producto.
import assert from 'node:assert/strict';
import { normalizarPedidoKit, construirTextoAvisoDuenaKit } from '../../mimar-inteligente/mimar-inteligente-logic.js';
import { armarPedidoKit } from '../../js/kit-cantidades.js';

// Formato nuevo (panel / kit-facial con cantidades)
const nuevo = armarPedidoKit([{ nombre: 'Leche de limpieza', precio: 20000, cantidad: 3 }, { nombre: 'Tónico calmante', precio: 20000, cantidad: 1 }]);
const k = normalizarPedidoKit('p1', { ...nuevo, nombrePaciente: 'Paula Gómez', estado: 'pendiente', createdAt: '2026-11-16T15:00:00.000Z' });
assert.equal(k.discrepanciaTotal, null, 'no debe marcar diferencia de total');
assert.equal(k.cantidadTotal, 4);
assert.deepEqual(k.items.map(i => [i.nombre, i.cantidad, i.subtotal]), [['Leche de limpieza', 3, 60000], ['Tónico calmante', 1, 20000]]);
const txt = construirTextoAvisoDuenaKit(k);
assert.match(txt, /• 3 × Leche de limpieza — \$\s?60\.000 \(\$\s?20\.000 c\/u\)/);
assert.match(txt, /• Tónico calmante — \$\s?20\.000\n/);
assert.match(txt, /Total del pedido: \$\s?80\.000\./);
assert.doesNotMatch(txt, /no coincide/);
console.log(txt.split('\n').filter(l => /•|Total/.test(l)).join('\n'));

// Formato viejo: una entrada por unidad, sin cantidad
const viejo = normalizarPedidoKit('p2', { productos: ['Gel', 'Gel'], productosDetalle: [{ nombre: 'Gel', precio: 15000 }, { nombre: 'Gel', precio: 15000 }], totalPedido: 30000 });
assert.equal(viejo.discrepanciaTotal, null);
assert.deepEqual(viejo.items.map(i => [i.cantidad, i.subtotal]), [[2, 30000]]);

// Diferencia real sigue avisándose
const mal = normalizarPedidoKit('p3', { productosDetalle: [{ nombre: 'Gel', precio: 15000, cantidad: 2 }], totalPedido: 15000 });
assert.deepEqual(mal.discrepanciaTotal, { registrado: 15000, calculado: 30000 });

console.log('\nAVISO A GIME CON CANTIDADES OK');
