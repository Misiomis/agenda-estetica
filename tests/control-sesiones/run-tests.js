// node tests/control-sesiones/run-tests.js   (datos 100% sintéticos)
import {
  calcularControl, filtrarControl, contarCumplidos, textoEstado, tratamientosDeServicio, esHifuSinZona,
  sumarDiasISO, diasEntreISO, fechaValida,
} from '../../js/control-sesiones.js';

let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

const HOY = '2026-11-07';
const menos = (n) => sumarDiasISO(HOY, -n);
const R = (id, dni, fecha, servicio, extra = {}) => ({ id, dni, nombre: 'Paciente ' + dni, fecha, hora: '10:00', servicio, estado: 'confirmado', ...extra });
const base = (reservas, hoy = HOY) => calcularControl({
  reservas, hoy, claveDe: (r) => 'dni:' + r.dni, nombreDe: (r) => r.nombre,
  // criterio del panel: activa (no cancelada) y ya pasó
  esRealizada: (r) => !/cancel/i.test(r.estado || '') && r.fecha < hoy,
});
const fila = (filas, dni, t) => filas.find((f) => f.clave === 'dni:' + dni && f.tratamiento === t);

console.log('\n=== Identificación de tratamientos ===');
check('"Hi-Fu Corporal" → HIFU corporal', tratamientosDeServicio('Hi-Fu Corporal').join() === 'hifu_corporal');
check('"HIFU corporal abdomen" → HIFU corporal', tratamientosDeServicio('HIFU corporal abdomen').join() === 'hifu_corporal');
check('"Hi-Fu Facial" NO es HIFU corporal', !tratamientosDeServicio('Hi-Fu Facial').length);
check('"Criolipolisis" y "Jornada especial de criolipólisis" → Crio', tratamientosDeServicio('Criolipolisis').join() === 'crio' && tratamientosDeServicio('Jornada especial de criolipólisis').join() === 'crio');
check('"Tratamientos Corporales" no es ninguno', !tratamientosDeServicio('Tratamientos Corporales').length);
check('"Hi-Fu" sin zona se informa aparte (no se inventa)', esHifuSinZona('Hi-Fu') && !tratamientosDeServicio('Hi-Fu').length && !esHifuSinZona('Hi-Fu Facial'));

console.log('\n=== Fechas en días calendario ===');
check('cambio de mes: 31/10 + 1 = 01/11', sumarDiasISO('2026-10-31', 1) === '2026-11-01');
check('cambio de año y bisiesto', sumarDiasISO('2027-12-31', 1) === '2028-01-01' && sumarDiasISO('2028-02-28', 1) === '2028-02-29');
check('días entre 01/10 y 15/11 = 45', diasEntreISO('2026-10-01', '2026-11-15') === 45);
check('fecha inválida detectada', !fechaValida('2026-02-30') && !fechaValida('') && !fechaValida('07/11/2026') && fechaValida('2026-11-07'));

console.log('\n=== HIFU corporal: 44, 45 y 46 días ===');
let f = base([R('h44', '44', menos(44), 'Hi-Fu Corporal'), R('h45', '45', menos(45), 'Hi-Fu Corporal'), R('h46', '46', menos(46), 'Hi-Fu Corporal')]);
check('44 días → Faltan 1 día', fila(f, '44', 'hifu_corporal').estado === 'espera' && textoEstado(fila(f, '44', 'hifu_corporal')) === 'Faltan 1 día');
check('45 días → Plazo cumplido (inclusive)', fila(f, '45', 'hifu_corporal').estado === 'cumplido');
check('46 días → Plazo cumplido', fila(f, '46', 'hifu_corporal').estado === 'cumplido');
check('fecha de cumplimiento = última + 45', fila(f, '45', 'hifu_corporal').fechaCumplimiento === HOY && fila(f, '44', 'hifu_corporal').fechaCumplimiento === sumarDiasISO(menos(44), 45));

console.log('\n=== Crio: 29, 30 y 31 días ===');
f = base([R('c29', '29', menos(29), 'Criolipolisis'), R('c30', '30', menos(30), 'Criolipolisis'), R('c31', '31', menos(31), 'Criolipolisis')]);
check('29 días → Faltan 1 día', fila(f, '29', 'crio').estado === 'espera' && fila(f, '29', 'crio').faltan === 1);
check('30 días → Plazo cumplido (inclusive)', fila(f, '30', 'crio').estado === 'cumplido');
check('31 días → Plazo cumplido', fila(f, '31', 'crio').estado === 'cumplido');

console.log('\n=== Paciente con ambos tratamientos ===');
f = base([R('a1', '7', menos(50), 'Hi-Fu Corporal'), R('a2', '7', menos(10), 'Criolipolisis')]);
check('dos filas independientes', f.filter((x) => x.clave === 'dni:7').length === 2);
check('la sesión de Crio NO reinicia HIFU corporal (50 d → cumplido)', fila(f, '7', 'hifu_corporal').dias === 50 && fila(f, '7', 'hifu_corporal').estado === 'cumplido');
check('Crio cuenta su propia fecha (10 d → faltan 20)', fila(f, '7', 'crio').faltan === 20);
check('HIFU facial no afecta HIFU corporal', fila(base([R('a1', '7', menos(50), 'Hi-Fu Corporal'), R('a3', '7', menos(2), 'Hi-Fu Facial')]), '7', 'hifu_corporal').dias === 50);

console.log('\n=== Nueva sesión reinicia el contador ===');
const hist = [R('n1', '8', menos(40), 'Criolipolisis')];
check('antes: 40 d → cumplido', fila(base(hist), '8', 'crio').estado === 'cumplido');
hist.push(R('n2', '8', menos(3), 'Criolipolisis'));
check('después de registrar una sesión hace 3 d → faltan 27', fila(base(hist), '8', 'crio').estado === 'espera' && fila(base(hist), '8', 'crio').faltan === 27);
hist[1].estado = 'cancelado';
check('si esa sesión se cancela, vuelve a la anterior válida (40 d)', fila(base(hist), '8', 'crio').dias === 40);

console.log('\n=== Exclusiones ===');
f = base([R('x1', '9', menos(35), 'Criolipolisis'), R('x2', '9', menos(5), 'Criolipolisis', { estado: 'cancelado' }),
  R('x3', '9', sumarDiasISO(HOY, 4), 'Criolipolisis'), R('x4', '9', menos(2), 'Criolipolisis', { asistencia: 'ausente' })]);
check('canceladas, ausencias y turnos futuros no reinician (35 d → cumplido)', fila(f, '9', 'crio').dias === 35 && fila(f, '9', 'crio').estado === 'cumplido');
check('informa el próximo turno agendado', fila(f, '9', 'crio').proxima?.id === 'x3');
f = base([R('s1', '10', sumarDiasISO(HOY, 6), 'Hi-Fu Corporal'), R('s2', '11', 'fecha-rota', 'Criolipolisis')]);
check('solo turno futuro → "Sin sesión registrada"', fila(f, '10', 'hifu_corporal').estado === 'sin_sesion' && textoEstado(fila(f, '10', 'hifu_corporal')) === 'Sin sesión registrada');
check('fecha inválida → "Sin sesión registrada" (no se inventa fecha)', fila(f, '11', 'crio').estado === 'sin_sesion' && fila(f, '11', 'crio').fechaUltima === null);
check('cliente sin historial de estos tratamientos no aparece', !base([R('z', '12', menos(60), 'Drenaje linfático')]).length && !base([]).length);

console.log('\n=== Avance con los días y cambio de mes ===');
const r1 = [R('m1', '13', '2026-10-08', 'Criolipolisis')];
check('el 06/11 faltan 1 día; el 07/11 se cumple (sin registrar nada)', base(r1, '2026-11-06')[0].estado === 'espera' && base(r1, '2026-11-07')[0].estado === 'cumplido');
check('cumplimiento cruzando el mes: 08/10 + 30 = 07/11', base(r1)[0].fechaCumplimiento === '2026-11-07');

console.log('\n=== Orden por prioridad ===');
f = base([
  R('o1', '20', menos(60), 'Hi-Fu Corporal'),   // cumplido hace 15
  R('o2', '21', menos(50), 'Criolipolisis'),    // cumplido hace 20
  R('o3', '22', menos(31), 'Criolipolisis'),    // cumplido hace 1
  R('o4', '23', menos(40), 'Hi-Fu Corporal'),   // faltan 5
  R('o5', '24', menos(20), 'Criolipolisis'),    // faltan 10
  R('o6', '25', menos(28), 'Criolipolisis'),    // faltan 2
  R('o7', '26', sumarDiasISO(HOY, 3), 'Criolipolisis'), // sin sesión
]);
check('cumplidos por días desde el cumplimiento, luego espera por fecha, sin sesión al final',
  f.map((x) => x.clave.slice(4)).join() === '21,20,22,25,23,24,26', f.map((x) => x.clave.slice(4)));

console.log('\n=== Filtros y contadores (misma lógica) ===');
check('filtro por tratamiento', filtrarControl(f, { tratamiento: 'hifu_corporal' }).length === 2);
check('filtro por estado', filtrarControl(f, { estado: 'cumplido' }).length === 3);
check('búsqueda por cliente sin tildes', filtrarControl([{ ...f[0], nombre: 'María Pérez' }], { texto: 'maria perez' }).length === 1);
const c = contarCumplidos(f);
check('contadores: 1 HIFU corporal y 2 Crio cumplidos', c.hifu_corporal === 1 && c.crio === 2 && c.total === 3, c);
check('contadores coinciden con el listado filtrado', c.crio === filtrarControl(f, { tratamiento: 'crio', estado: 'cumplido' }).length);

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE CONTROL DE SESIONES OK');
process.exit(fails ? 1 : 0);
