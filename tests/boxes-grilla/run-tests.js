// node tests/boxes-grilla/run-tests.js   (datos 100% sintéticos)
import { BOXES_POR_DEFECTO, normalizarBoxes, serializarBoxes, validarNombre, nuevoBox, renombrar, mover, nombreCorto } from '../../js/boxes-grilla.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

console.log('\n=== Correspondencia y orden 4, 2, 3, 5 ===');
let l = normalizarBoxes(null);
check('orden visual exacto: Box 4, Box 2, Box 3, Box 5', l.map((b) => b.title).join(',') === 'Box 4,Box 2,Box 3,Box 5');
check('identidad: b1→Box 4, b4→Box 2, b3→Box 3, b2→Box 5', l.map((b) => `${b.id}:${b.title}`).join(',') === 'b1:Box 4,b4:Box 2,b3:Box 3,b2:Box 5');
check('cada box conserva su descripción (b2 sigue siendo el Corporal)', l.find((b) => b.id === 'b2').sub === 'Corporal' && l.find((b) => b.id === 'b1').sub === 'General Corporal');
check('el «Box 5» anterior (b5) no está entre los activos', !l.some((b) => b.id === 'b5'));
check('etiquetas cortas: B4, B2, B3, B5', l.map(nombreCorto).join(',') === 'B4,B2,B3,B5');

console.log('\n=== Editar nombres ===');
let r = renombrar(l, 'b3', { nombre: 'Box Facial', sub: 'Facial y HIFU' });
check('renombrar cambia solo el nombre visible (el id sigue igual)', r.ok && r.lista.find((b) => b.id === 'b3').title === 'Box Facial' && r.lista.find((b) => b.id === 'b3').sub === 'Facial y HIFU' && r.lista.length === 4);
check('no permite dos boxes con el mismo nombre', !renombrar(l, 'b3', { nombre: 'box 4' }).ok);
check('nombre vacío o demasiado largo → error claro', !validarNombre(l, '  ').ok && !validarNombre(l, 'x'.repeat(30)).ok);
check('nombre corto de un nombre sin número', nombreCorto({ title: 'Camilla' }) === 'Cam');

console.log('\n=== Agregar un box ===');
r = nuevoBox(l, { nombre: 'Box 6', sub: 'Depilación', icon: '🪷' });
check('se agrega al final con id propio (bx1), nunca reutiliza b5', r.ok && r.box.id === 'bx1' && r.lista[r.lista.length - 1].id === 'bx1' && r.lista.length === 5);
check('su número interno no choca con los de los boxes base', r.box.num > 100);
const r2 = nuevoBox(r.lista, { nombre: 'Box 7' });
check('el siguiente toma bx2', r2.ok && r2.box.id === 'bx2');
check('no permite agregar un nombre repetido', !nuevoBox(l, { nombre: 'Box 3' }).ok);

console.log('\n=== Guardar y volver a cargar (persistencia) ===');
let lista = renombrar(nuevoBox(l, { nombre: 'Camilla' }).lista, 'b4', { nombre: 'Box 2 Relax' }).lista;
lista = mover(lista, 'bx1', -1);
const recargada = normalizarBoxes(JSON.parse(JSON.stringify(serializarBoxes(lista))));
check('al recargar se conservan nombres, orden y el box agregado', recargada.map((b) => `${b.id}:${b.title}`).join(',') === lista.map((b) => `${b.id}:${b.title}`).join(','), recargada.map((b) => b.title));
check('lo guardado no lleva colores de fondo ni campos derivados', !JSON.stringify(serializarBoxes(lista)).includes('bg'));
const sinB3 = normalizarBoxes({ boxes: [{ id: 'b1', title: 'Box 4' }, { id: 'b2', title: 'Box 5' }, { id: 'b4', title: 'Box 2' }] });
check('si faltara un box base en lo guardado, vuelve (nunca se pierde)', sinB3.some((b) => b.id === 'b3') && sinB3.length === 4);
check('ids desconocidos o repetidos en lo guardado se ignoran (ej. b5 histórico)', normalizarBoxes({ boxes: [{ id: 'b5', title: 'Box 5 viejo' }, { id: 'b1', title: 'A' }, { id: 'b1', title: 'B' }] }).filter((b) => b.id === 'b1').length === 1 && !normalizarBoxes({ boxes: [{ id: 'b5', title: 'x' }] }).some((b) => b.id === 'b5'));
check('mover respeta los límites', mover(l, 'b1', -1) === l && mover(l, 'b2', 1) === l);
check('la configuración por defecto coincide con BOXES_POR_DEFECTO', l.length === BOXES_POR_DEFECTO.length);

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE BOXES OK');
process.exit(fails ? 1 : 0);
