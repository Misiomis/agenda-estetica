// node tests/boxes-grilla/por-fecha.mjs — Box 1 y orden por número recién desde diciembre 2026
import assert from 'node:assert/strict';
import { boxesParaFecha, normalizarBoxes, FECHA_BOXES_NUEVOS } from '../../js/boxes-grilla.js';
const t = (b) => b.map((x) => x.title).join(',');
assert.equal(FECHA_BOXES_NUEVOS, '2026-12-01');
assert.equal(t(boxesParaFecha(null, '2026-11-30')), 'Box 4,Box 2,Box 3,Box 5', 'noviembre queda igual');
assert.equal(t(boxesParaFecha(null, '2026-12-01')), 'Box 1,Box 2,Box 3,Box 4,Box 5', 'diciembre: 1 a 5');
assert.equal(boxesParaFecha(null, '2027-01-10')[0].id, 'b6');
const cfg = { boxes: [{ id: 'b1', title: 'Box 4' }, { id: 'b4', title: 'Box 2' }, { id: 'b3', title: 'Box 3' }, { id: 'b2', title: 'Box 5' }, { id: 'b6', title: 'Box 1', sub: 'Masajes' }] };
assert.ok(!normalizarBoxes(cfg).some((b) => b.id === 'b6'), 'b6 guardado no aparece antes de diciembre');
assert.equal(boxesParaFecha(cfg, '2026-12-02')[0].sub, 'Masajes', 'respeta lo editado del Box 1');
const conOtro = { boxes: [...cfg.boxes.slice(0, 4), { id: 'bx1', title: 'Box 1' }] };
assert.equal(boxesParaFecha(conOtro, '2026-12-02').filter((b) => b.title === 'Box 1').length, 1, 'sin dos «Box 1»');
console.log('BOXES POR FECHA OK');
