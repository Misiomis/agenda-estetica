// node tests/grilla-servicio-box/run-tests.js   (datos 100% sintéticos)
import { normalizarServiciosBox, serializarServiciosBox, serviciosDelBox, resolverServicioAlArrastrar } from '../../js/grilla-servicio-box.js';

let fails = 0;
const check = (desc, cond, extra) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

// Caso real que reportó la estética: Hi-Fu Facial exclusivo de b3, Tratamiento
// Facial sin asignar; Hi-Fu Corporal exclusivo de b1, Tratamientos Corporales
// compartido en b1/b2/b4.
const raw = () => ({
  assignments: { 'Hi-Fu Facial': ['b3'], 'Hi-Fu Corporal': ['b1'], 'Tratamientos Corporales': ['b1', 'b2', 'b4'] },
  defaults: { b1: 'Tratamientos Corporales', b2: 'Tratamientos Corporales', b3: 'Tratamiento Facial', b4: 'Tratamientos Corporales' },
});

console.log('\n=== normalizar / serializar ===');
{
  const { boxesPorServicio, defaultPorBox } = normalizarServiciosBox(raw());
  check('assignments y defaults se leen aparte', boxesPorServicio.get('Hi-Fu Facial').join() === 'b3' && defaultPorBox.get('b3') === 'Tratamiento Facial');
  check('sin datos no rompe (vacío, no inventa nada)', normalizarServiciosBox(undefined).defaultPorBox.size === 0 && normalizarServiciosBox(null).boxesPorServicio.size === 0);
  const ida = serializarServiciosBox(boxesPorServicio, defaultPorBox);
  check('ida y vuelta estable', JSON.stringify(ida) === JSON.stringify(raw()));
  check('serviciosDelBox(b3) solo trae lo asignado a b3', serviciosDelBox('b3', boxesPorServicio).join() === 'Hi-Fu Facial');
  check('serviciosDelBox(b1) trae los 2 asignados, ordenados', serviciosDelBox('b1', boxesPorServicio).join() === 'Hi-Fu Corporal,Tratamientos Corporales');
  check('un box sin nada asignado da lista vacía', serviciosDelBox('b9', boxesPorServicio).length === 0);
}

console.log('\n=== resolverServicioAlArrastrar — el caso reportado ===');
{
  const { boxesPorServicio, defaultPorBox } = normalizarServiciosBox(raw());
  const r = (boxId, actual) => resolverServicioAlArrastrar(boxId, actual, boxesPorServicio, defaultPorBox);
  check('arrastrar a Facial (b3) con el predeterminado configurado → Tratamiento Facial, NUNCA Hi-Fu Facial', r('b3', 'Masaje cualquiera') === 'Tratamiento Facial');
  check('arrastrar a General Corporal (b1) → Tratamientos Corporales, NUNCA Hi-Fu Corporal (antes era el bug: exclusivo ganaba)', r('b1', 'Masaje cualquiera') === 'Tratamientos Corporales');
  check('arrastrar a Corporal (b2) → Tratamientos Corporales', r('b2', 'Masaje cualquiera') === 'Tratamientos Corporales');
  check('arrastrar a Relax (b4) → Tratamientos Corporales', r('b4', 'Masaje cualquiera') === 'Tratamientos Corporales');
  check('si ya tiene Hi-Fu Facial y lo arrastran dentro del mismo b3, no se toca (ya es válido ahí)', r('b3', 'Hi-Fu Facial') === null);
  check('si el servicio actual ya es válido en el box destino, no se toca aunque haya otro predeterminado', r('b1', 'Hi-Fu Corporal') === null);
  check('si ya tiene el predeterminado, no hace un "cambio" redundante', r('b3', 'Tratamiento Facial') === null);
}

console.log('\n=== Box sin predeterminado configurado: nunca se inventa nada ===');
{
  const sinDefaults = normalizarServiciosBox({ assignments: raw().assignments, defaults: {} });
  check('sin ningún predeterminado configurado, arrastrar a cualquier box no cambia el servicio', ['b1', 'b2', 'b3', 'b4'].every((b) => resolverServicioAlArrastrar(b, 'Lo que sea', sinDefaults.boxesPorServicio, sinDefaults.defaultPorBox) === null));
  const parcial = normalizarServiciosBox({ assignments: raw().assignments, defaults: { b3: 'Tratamiento Facial' } });
  check('con predeterminado solo en b3, b1/b2/b4 no cambian nada', resolverServicioAlArrastrar('b1', 'X', parcial.boxesPorServicio, parcial.defaultPorBox) === null && resolverServicioAlArrastrar('b3', 'X', parcial.boxesPorServicio, parcial.defaultPorBox) === 'Tratamiento Facial');
  check('un predeterminado inexistente/vacío no rompe', resolverServicioAlArrastrar('b9', 'X', parcial.boxesPorServicio, parcial.defaultPorBox) === null);
}

console.log('\n=== Nunca elige el servicio "exclusivo" por accidente de orden ===');
{
  // Mismo escenario pero sin defaults configurados todavía (recién migrado):
  // el comportamiento viejo (exclusivo > compartido) habría elegido Hi-Fu
  // Facial / Hi-Fu Corporal por ser los únicos exclusivos. El nuevo nunca
  // elige nada por su cuenta.
  const { boxesPorServicio, defaultPorBox } = normalizarServiciosBox({ assignments: raw().assignments, defaults: {} });
  check('b3 sin predeterminado explícito jamás cae en Hi-Fu Facial por ser el único exclusivo', resolverServicioAlArrastrar('b3', 'Otro', boxesPorServicio, defaultPorBox) !== 'Hi-Fu Facial' && resolverServicioAlArrastrar('b3', 'Otro', boxesPorServicio, defaultPorBox) === null);
  check('b1 sin predeterminado explícito jamás cae en Hi-Fu Corporal por ser el único exclusivo', resolverServicioAlArrastrar('b1', 'Otro', boxesPorServicio, defaultPorBox) !== 'Hi-Fu Corporal' && resolverServicioAlArrastrar('b1', 'Otro', boxesPorServicio, defaultPorBox) === null);
}

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE GRILLA/SERVICIO POR BOX OK');
process.exit(fails ? 1 : 0);
