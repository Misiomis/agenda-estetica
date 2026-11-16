// node tests/telefono-wa/run-tests.js   (números ficticios)
import { numeroWhatsApp, esNumeroExtranjero } from '../../js/telefono-wa.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };
const eq = (entrada, esperado) => check(`${JSON.stringify(entrada)} → ${esperado}`, numeroWhatsApp(entrada) === esperado, numeroWhatsApp(entrada));

console.log('\n=== Bug: número de Brasil (+55 46 92001-8665) ===');
eq('+55 46 92001-8665', '5546920018665');
eq('5546920018665', '5546920018665');
eq('55 46 92001 8665', '5546920018665');
eq('0055 46 92001-8665', '5546920018665');
check('ya no se le antepone 549', !numeroWhatsApp('+55 46 92001-8665').startsWith('549'));
check('se marca como número extranjero', esNumeroExtranjero('+55 46 92001-8665') && !esNumeroExtranjero('3764111222'));

console.log('\n=== Otros países ===');
eq('+598 99 123 456', '59899123456');       // Uruguay
eq('+595 981 123456', '595981123456');      // Paraguay
eq('+56 9 8765 4321', '56987654321');       // Chile
eq('+34 612 345 678', '34612345678');       // España
eq('+1 305 555 0123', '13055550123');       // EE. UU.
eq('595981123456', '595981123456');         // Paraguay sin "+"
eq('34612345678', '34612345678');           // España sin "+"

console.log('\n=== Argentina: igual que siempre ===');
eq('3764111222', '5493764111222');
eq('03764111222', '5493764111222');
eq('03764 15 411122', '5493764411122');     // 0 + área + 15 + número → sin el 0 y sin el 15
eq('376415411122', '5493764411122');
eq('1121931848', '5491121931848');
eq('011 15 2193-1848', '5491121931848');
eq('5493757512496', '5493757512496');
eq('543757512496', '5493757512496');
eq('93757512496', '5493757512496');
eq('+54 9 3757 51-2496', '5493757512496');
eq('+54 3757 51-2496', '5493757512496');
eq('+54 11 15 2193 1848', '5491121931848');
eq('54 11 15 2193 1848', '5491121931848');
eq('', '');
eq(null, '');
eq('sin número', '');

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE TELÉFONO WHATSAPP OK');
process.exit(fails ? 1 : 0);
