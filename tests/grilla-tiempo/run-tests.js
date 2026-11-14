// node tests/grilla-tiempo/run-tests.js   (datos 100% sintéticos)
import { PASO_GRILLA, aMin, etiquetaHora, franjasDelDia, generarFilas, filasDeIntervalo, agruparTurnos, bloqueosDeFila, intervaloBloqueo, turnoQueSePisa } from '../../js/grilla-tiempo.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

console.log('\n=== Filas cada 5 minutos, formato HH:MM ===');
check('paso de 5 minutos', PASO_GRILLA === 5);
check('etiquetas: 08:00, 08:05, 08:10, 08:15, 08:20', ['08:00', '08:05', '08:10', '08:15', '08:20'].map(etiquetaHora).join(',') === '08:00,08:05,08:10,08:15,08:20');
check('16:00 → "16:00" y 491 min → "08:11"', etiquetaHora('16:00') === '16:00' && etiquetaHora(491) === '08:11');
const fr = franjasDelDia(null, 3);
let filas = generarFilas({ franjas: fr });
check('arranca a las 08:00 (07:00–08:00 oculto) y la última fila es 20:55', filas[0].hora === '08:00' && filas[filas.length - 1].hora === '20:55' && !filas.some((f) => f.hora < '08:00'), [filas[0].hora, filas[filas.length - 1].hora]);
check('secuencia de la mañana', filas.slice(0, 5).map((f) => f.etiqueta).join(',') === '08:00,08:05,08:10,08:15,08:20');
check('pausa del mediodía oculta (13:30 a 14:00)', !filas.some((f) => f.hora === '13:30' || f.hora === '13:55') && filas.some((f) => f.hora === '13:25') && filas.some((f) => f.hora === '14:00'));
const cfg = { dias: { 6: [{ desde: '09:00', hasta: '13:00' }], 0: [] } };
const sab = generarFilas({ franjas: franjasDelDia(cfg, 6) });
check('horario configurado por día (sábado 9 a 13 → 48 filas)', sab[0].hora === '09:00' && sab[sab.length - 1].hora === '12:55' && sab.length === 48);
check('día cerrado (domingo) sin filas', generarFilas({ franjas: franjasDelDia(cfg, 0) }).length === 0);
check('un turno fuera de horario agrega sus filas (domingo 10:00 de 15 min)', generarFilas({ franjas: franjasDelDia(cfg, 0), eventos: [{ ini: 600, fin: 615 }] }).map((f) => f.hora).join(',') === '10:00,10:05,10:10');
check('un turno a las 07:30 (pedido especial) muestra solo sus filas, fuera de horario', (() => { const f = generarFilas({ franjas: fr, eventos: [{ ini: aMin('07:30'), fin: aMin('08:00') }] }); return f[0].hora === '07:30' && !f[0].dentro && f.find((x) => x.hora === '08:00').dentro; })());
const conExtra = generarFilas({ franjas: fr, extra: true });
check('"Horarios extra" muestra desde las 07:00, la pausa y la noche hasta 23:55', conExtra[0].hora === '07:00' && !conExtra[0].dentro && conExtra.some((f) => f.hora === '13:40' && !f.dentro) && conExtra[conExtra.length - 1].hora === '23:55');

console.log('\n=== Turnos existentes con su hora exacta ===');
filas = generarFilas({ franjas: fr });
const idx = (h) => filas.findIndex((f) => f.hora === h);
check('un turno 08:15–08:45 toca de la fila 08:15 a la 08:40', filasDeIntervalo(filas, aMin('08:15'), aMin('08:45')).join(',') === [idx('08:15'), idx('08:20'), idx('08:25'), idx('08:30'), idx('08:35'), idx('08:40')].join(','));
let g = agruparTurnos([{ id: 'a', ini: aMin('08:12'), fin: aMin('09:00') }], filas);
check('08:12–09:00 (desalineado): celda desde 08:10, la tarjeta arranca en proporción', g.length === 1 && filas[g[0].filaIni].hora === '08:10' && filas[g[0].filaFin].hora === '08:55' && Math.abs(g[0].items[0].top - 2 / 50) < 1e-9 && g[0].items[0].bottom === 0, g);
g = agruparTurnos([{ id: 'a', ini: aMin('08:00'), fin: aMin('08:12') }, { id: 'b', ini: aMin('08:12'), fin: aMin('09:00') }], filas);
check('08:00–08:12 y 08:12–09:00 comparten la fila 08:10 → un grupo con 2 tarjetas', g.length === 1 && g[0].items.length === 2 && g[0].items.every((i) => i.carril === 0 && i.carriles === 1));
g = agruparTurnos([{ id: 'a', ini: aMin('09:00'), fin: aMin('10:00') }, { id: 'b', ini: aMin('09:30'), fin: aMin('10:00') }], filas);
check('dos turnos que se pisan en el mismo box van lado a lado (2 carriles)', g.length === 1 && g[0].items.find((i) => i.id === 'b').carril === 1 && g[0].items[0].carriles === 2);
g = agruparTurnos([{ id: 'a', ini: aMin('09:00'), fin: aMin('09:30') }, { id: 'b', ini: aMin('09:30'), fin: aMin('10:00') }], filas);
check('turnos seguidos alineados son celdas separadas', g.length === 2);

console.log('\n=== Bloqueos ===');
check('bloqueo viejo sin duración = 15 min', (() => { const i = intervaloBloqueo({ hora: '08:45' }); return i.ini === aMin('08:45') && i.fin === aMin('09:00'); })());
const bl = [{ hora: '08:45' }, { hora: '09:10', duracionMinutos: 10 }, { hora: '10:05', duracionMinutos: 5 }];
check('bloqueo viejo de 08:45 cubre 08:45, 08:50 y 08:55', ['08:45', '08:50', '08:55'].every((h) => bloqueosDeFila(bl, aMin(h)).length === 1) && bloqueosDeFila(bl, aMin('09:00')).length === 0 && bloqueosDeFila(bl, aMin('08:40')).length === 0);
check('bloqueo de 10 min de ayer (09:10) cubre 09:10 y 09:15', bloqueosDeFila(bl, aMin('09:10')).length === 1 && bloqueosDeFila(bl, aMin('09:15')).length === 1 && bloqueosDeFila(bl, aMin('09:20')).length === 0);
check('bloqueo nuevo de 5 min (10:05) cubre solo su fila', bloqueosDeFila(bl, aMin('10:05')).length === 1 && bloqueosDeFila(bl, aMin('10:00')).length === 0 && bloqueosDeFila(bl, aMin('10:10')).length === 0);

console.log('\n=== Disponibilidad (choques por intervalo, no por hora exacta) ===');
const turnos = [{ id: 'x', ini: aMin('08:15'), fin: aMin('08:45') }];
check('un turno nuevo 08:00–08:30 choca con el de 08:15', !!turnoQueSePisa(turnos, aMin('08:00'), aMin('08:30')));
check('un turno nuevo 08:40–09:00 choca (el de 08:15 termina 08:45)', !!turnoQueSePisa(turnos, aMin('08:40'), aMin('09:00')));
check('un turno nuevo 08:45–09:15 entra', !turnoQueSePisa(turnos, aMin('08:45'), aMin('09:15')));
check('al mover un turno no choca consigo mismo', !turnoQueSePisa(turnos, aMin('08:20'), aMin('08:50'), 'x'));

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE GRILLA POR TIEMPO OK');
process.exit(fails ? 1 : 0);
