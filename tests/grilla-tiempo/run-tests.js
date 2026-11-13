// node tests/grilla-tiempo/run-tests.js   (datos 100% sintéticos)
import { PASO_GRILLA, aMin, etiquetaHora, franjasDelDia, generarFilas, filasDeIntervalo, agruparTurnos, bloqueosDeFila, intervaloBloqueo, turnoQueSePisa } from '../../js/grilla-tiempo.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

console.log('\n=== Filas cada 10 minutos ===');
check('paso de 10 minutos', PASO_GRILLA === 10);
check('etiquetas: 7, 7:10 … 7:50, 8', ['07:00', '07:10', '07:20', '07:30', '07:40', '07:50', '08:00'].map(etiquetaHora).join(',') === '7,7:10,7:20,7:30,7:40,7:50,8');
check('16:00 → "16" y 13:20 → "13:20"', etiquetaHora('16:00') === '16' && etiquetaHora('13:20') === '13:20');
const fr = franjasDelDia(null, 3);
let filas = generarFilas({ franjas: fr });
check('desde la apertura (7) hasta el cierre (21): última fila 20:50', filas[0].hora === '07:00' && filas[filas.length - 1].hora === '20:50', [filas[0].hora, filas[filas.length - 1].hora]);
check('secuencia de la mañana', filas.slice(0, 7).map((f) => f.etiqueta).join(',') === '7,7:10,7:20,7:30,7:40,7:50,8');
check('pausa del mediodía oculta (13:30 a 14:00)', !filas.some((f) => f.hora === '13:30' || f.hora === '13:50') && filas.some((f) => f.hora === '13:20') && filas.some((f) => f.hora === '14:00'));
const cfg = { dias: { 6: [{ desde: '09:00', hasta: '13:00' }], 0: [] } };
const sab = generarFilas({ franjas: franjasDelDia(cfg, 6) });
check('horario configurado por día (sábado 9 a 13)', sab[0].hora === '09:00' && sab[sab.length - 1].hora === '12:50' && sab.length === 24);
check('día cerrado (domingo) sin filas', generarFilas({ franjas: franjasDelDia(cfg, 0) }).length === 0);
check('un turno fuera de horario agrega sus filas (domingo 10:00 de 30 min)', generarFilas({ franjas: franjasDelDia(cfg, 0), eventos: [{ ini: 600, fin: 630 }] }).map((f) => f.hora).join(',') === '10:00,10:10,10:20');
const conExtra = generarFilas({ franjas: fr, extra: true });
check('"Horarios extra" muestra la pausa y la noche hasta 23:50 (fuera de horario)', conExtra.some((f) => f.hora === '13:40' && !f.dentro) && conExtra[conExtra.length - 1].hora === '23:50');

console.log('\n=== Turnos existentes con su hora exacta (7:15, 7:45) ===');
filas = generarFilas({ franjas: fr });
const idx = (h) => filas.findIndex((f) => f.hora === h);
check('un turno 7:15–7:45 toca las filas 7:10, 7:20, 7:30 y 7:40', filasDeIntervalo(filas, aMin('07:15'), aMin('07:45')).join(',') === [idx('07:10'), idx('07:20'), idx('07:30'), idx('07:40')].join(','));
let g = agruparTurnos([{ id: 'a', ini: aMin('07:15'), fin: aMin('08:00') }], filas);
check('7:15–8:00: una celda de 7:10 a 7:50, la tarjeta empieza a mitad de la primera fila', g.length === 1 && filas[g[0].filaIni].hora === '07:10' && filas[g[0].filaFin].hora === '07:50' && Math.abs(g[0].items[0].top - 5 / 50) < 1e-9 && g[0].items[0].bottom === 0, g);
g = agruparTurnos([{ id: 'a', ini: aMin('07:00'), fin: aMin('07:15') }, { id: 'b', ini: aMin('07:15'), fin: aMin('08:00') }], filas);
check('7:00–7:15 y 7:15–8:00 comparten la fila 7:10 → un grupo con 2 tarjetas en un solo carril', g.length === 1 && g[0].items.length === 2 && g[0].items.every((i) => i.carril === 0 && i.carriles === 1));
check('… cada una en su posición proporcional', (() => { const [a, b] = g[0].items; return a.top === 0 && Math.abs(a.bottom - 45 / 60) < 1e-9 && Math.abs(b.top - 15 / 60) < 1e-9 && b.bottom === 0; })(), g[0].items);
g = agruparTurnos([{ id: 'a', ini: aMin('09:00'), fin: aMin('10:00') }, { id: 'b', ini: aMin('09:30'), fin: aMin('10:00') }], filas);
check('dos turnos que se pisan en el mismo box van lado a lado (2 carriles)', g.length === 1 && g[0].items.find((i) => i.id === 'b').carril === 1 && g[0].items[0].carriles === 2);
g = agruparTurnos([{ id: 'a', ini: aMin('09:00'), fin: aMin('09:30') }, { id: 'b', ini: aMin('09:30'), fin: aMin('10:00') }], filas);
check('turnos seguidos alineados son celdas separadas', g.length === 2);

console.log('\n=== Bloqueos ===');
check('bloqueo viejo sin duración = 15 min', (() => { const i = intervaloBloqueo({ hora: '07:45' }); return i.ini === aMin('07:45') && i.fin === aMin('08:00'); })());
const bl = [{ hora: '07:45' }, { hora: '09:10', duracionMinutos: 10 }];
check('bloqueo viejo de 7:45 cubre las filas 7:40 y 7:50', bloqueosDeFila(bl, aMin('07:40')).length === 1 && bloqueosDeFila(bl, aMin('07:50')).length === 1 && bloqueosDeFila(bl, aMin('08:00')).length === 0);
check('bloqueo nuevo de 9:10 cubre solo su fila', bloqueosDeFila(bl, aMin('09:10')).length === 1 && bloqueosDeFila(bl, aMin('09:00')).length === 0 && bloqueosDeFila(bl, aMin('09:20')).length === 0);

console.log('\n=== Disponibilidad (choques por intervalo, no por hora exacta) ===');
const turnos = [{ id: 'x', ini: aMin('07:15'), fin: aMin('07:45') }];
check('un turno nuevo 7:00–7:30 choca con el de 7:15', !!turnoQueSePisa(turnos, aMin('07:00'), aMin('07:30')));
check('un turno nuevo 7:40–8:00 choca (el de 7:15 termina 7:45)', !!turnoQueSePisa(turnos, aMin('07:40'), aMin('08:00')));
check('un turno nuevo 7:50–8:20 entra', !turnoQueSePisa(turnos, aMin('07:50'), aMin('08:20')));
check('al mover un turno no choca consigo mismo', !turnoQueSePisa(turnos, aMin('07:20'), aMin('07:50'), 'x'));

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE GRILLA POR TIEMPO OK');
process.exit(fails ? 1 : 0);
