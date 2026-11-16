// node tests/kit-cantidades/run-tests.js
import assert from 'node:assert/strict';
import { normalizarCantidad, armarPedidoKit, lineasPedidoKit, totalLineas, etiquetaLinea, cambiarPrecioLinea, CANT_MAX_KIT } from '../../js/kit-cantidades.js';

let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('✓', nombre); };

t('normalizarCantidad', () => {
  assert.equal(normalizarCantidad(undefined), 1);
  assert.equal(normalizarCantidad(0), 1);
  assert.equal(normalizarCantidad(-3), 1);
  assert.equal(normalizarCantidad('3'), 3);
  assert.equal(normalizarCantidad(2.7), 2);
  assert.equal(normalizarCantidad(999), CANT_MAX_KIT);
});

t('armarPedidoKit multiplica precio por cantidad', () => {
  const r = armarPedidoKit([{ nombre: 'Leche', precio: 20000, cantidad: 2 }, { nombre: 'Tónico', precio: 20000 }]);
  assert.deepEqual(r.productos, ['Leche', 'Tónico']);
  assert.equal(r.totalPedido, 60000);
  assert.equal(r.cantidadTotal, 3);
  assert.deepEqual(r.productosDetalle[0], { nombre: 'Leche', precio: 20000, cantidad: 2, subtotal: 40000 });
});

t('pedido viejo sin cantidad cuenta 1', () => {
  const l = lineasPedidoKit({ productos: ['Gel'], productosDetalle: [{ nombre: 'Gel', precio: 15000 }] });
  assert.deepEqual(l, [{ nombre: 'Gel', precio: 15000, cantidad: 1, subtotal: 15000 }]);
  assert.equal(etiquetaLinea(l[0]), 'Gel');
});

t('pedido muy viejo sin detalle usa precio de respaldo', () => {
  const l = lineasPedidoKit({ productos: ['Leche de limpieza', 'Otro'] }, (nom) => /leche/i.test(nom) ? 15000 : null);
  assert.equal(l[0].subtotal, 15000);
  assert.equal(l[1].precio, null);
  assert.equal(totalLineas(l), 15000);
});

t('etiqueta con cantidad', () => {
  assert.equal(etiquetaLinea({ nombre: 'Crema', cantidad: 3 }), '3 × Crema');
});

t('cambiarPrecioLinea respeta la cantidad', () => {
  const r = cambiarPrecioLinea([{ nombre: 'A', precio: 10, cantidad: 3 }, { nombre: 'B', precio: 5 }], 0, 20);
  assert.equal(r.productosDetalle[0].subtotal, 60);
  assert.equal(r.totalPedido, 65);
  assert.equal(cambiarPrecioLinea([], 0, 1), null);
});

console.log(`\nTODAS LAS PRUEBAS DE KIT CON CANTIDADES OK (${n})`);
