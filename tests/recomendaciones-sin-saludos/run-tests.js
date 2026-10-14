// Auditoría de contenido — "recomendaciones" sin saludos/agradecimientos/
// despedidas, personalizadas con el nombre real, y Plisagge Vela con el
// texto exacto pedido (punto 6 de la auditoría de facturación, 2026-09-16).
//
// A diferencia de los otros tests de esta carpeta, ESTE no es un espejo:
// lee admin.html real y audita el contenido tal cual quedó, línea por
// línea, para que la prueba deje de pasar si alguien reintroduce un saludo.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let fails = 0;
function check(desc, fn) {
  try { fn(); console.log('  OK  ' + desc); }
  catch (e) { fails++; console.log('  FAIL ' + desc + '\n       ' + e.message); }
}

const adminPath = path.join(__dirname, '..', '..', 'admin.html');
const src = fs.readFileSync(adminPath, 'utf8');

// Constantes de mensaje de "recomendaciones" que se auditaron y reescribieron
const NOMBRES_MSG_RECOMENDACION = [
  'msg1', 'msg2', 'msgMioUp', 'msgFraxisFacial', 'msgFraxisCorp', 'msgDrenapress',
  'msgVibratoria', 'msgPostCryo', 'msgPreFacial', 'msgPostFacial', 'msgKitFacial',
  'msgPostDepi', 'msgPlisaggeVela', '_m1c', '_m2c', '_mMioC', '_mFraxC',
];

// Extrae cada línea "const NOMBRE = ...;" (son statements de una sola línea en el archivo)
function extraerDefinicion(nombre) {
  const re = new RegExp('^\\s*const ' + nombre.replace(/[$]/g, '\\$') + ' = .*;\\s*$', 'm');
  const m = src.match(re);
  return m ? m[0] : null;
}

const FRASES_PROHIBIDAS = [
  /\bHola\s*[¡!]?\s*\$\{/i,        // saludo con nombre interpolado
  /¡?Gracias por (elegir|confiar)/i,
  /Esperamos que disfrutes/i,
  /Confío en tu compromiso/i,
  /Bienvenida\/o a Espacio/i,
];

console.log('\n═══ Auditoría — mensajes de recomendaciones sin saludo/agradecimiento/despedida ═══');
NOMBRES_MSG_RECOMENDACION.forEach((nombre) => {
  const def = extraerDefinicion(nombre);
  check(`"${nombre}" existe en admin.html`, () => assert.ok(def, 'no se encontró la definición'));
  if (!def) return;
  FRASES_PROHIBIDAS.forEach((re) => {
    check(`"${nombre}" no contiene "${re}"`, () => assert.ok(!re.test(def), 'contiene una frase prohibida: ' + def.slice(0, 160)));
  });
  check(`"${nombre}" está personalizado (usa _recTitulo o construye un título con el nombre real)`, () => {
    assert.ok(/_recTitulo|Recomendaciones para \$\{/.test(def), 'no parece incluir personalización por nombre');
  });
});

// La segunda copia (línea ~7337 de la versión pre-fix): msg1/msg2/msgMioUp/msgFraxis
// con _recTituloPN, y la tercera copia con _recTituloCP / _recTituloC
console.log('\n═══ Auditoría — copias duplicadas del panel (consultas, curso) ═══');
check('_recTituloC existe (título sin saludo para el panel de consultas — copia 1)', () => {
  assert.ok(/const _recTituloC = /.test(src));
});
check('_recTituloCP existe (copia 2, otro render de consultas)', () => {
  assert.ok(/const _recTituloCP = /.test(src));
});
check('_recTituloPN existe (copia 3)', () => {
  assert.ok(/const _recTituloPN = /.test(src));
});
['_m1', '_m2', '_mMioUp', '_mFraxis'].forEach((nombre) => {
  const re = new RegExp('const ' + nombre + ' = _cpMsg\\(.*;', 'm');
  const m = src.match(re);
  check(`"${nombre}" (copia de consultas) no empieza con "Hola $\\{"`, () => {
    assert.ok(m, 'no se encontró la definición');
    assert.ok(!/Hola \$\{/.test(m[0]), 'todavía tiene un saludo: ' + m[0].slice(0, 160));
  });
});

console.log('\n═══ Auditoría — Plisagge Vela con el texto exacto pedido ═══');
const defPlisagge = extraerDefinicion('msgPlisaggeVela');
check('msgPlisaggeVela existe', () => assert.ok(defPlisagge));
if (defPlisagge) {
  const fragmentosObligatorios = [
    'Cuidados posteriores a tu sesión de modelación corporal y tratamiento de adiposidad localizada con Plisagge Vela',
    'Después de tu sesión, recordá tomar abundante agua y mantener una buena hidratación',
    'Durante las 24 horas posteriores a la sesión, evitá depilación láser, IPL o cualquier procedimiento que pueda irritar la zona tratada',
    'Utilizá la faja si te fue indicada para este tratamiento y seguí las pautas de uso del profesional que te atendió',
    'Podés continuar con tus actividades habituales con normalidad',
  ];
  fragmentosObligatorios.forEach((frag) => {
    check('Plisagge Vela incluye: "' + frag.slice(0, 50) + '…"', () => assert.ok(defPlisagge.includes(frag)));
  });
  check('el título de Plisagge Vela usa "Recomendaciones para {nombre}" (vía _recTitulo)', () => {
    assert.ok(/\$\{_recTitulo\}/.test(defPlisagge));
  });
}
check('existe un botón de UI para enviar la recomendación de Plisagge Vela', () => {
  assert.ok(/Enviar recomendaciones Plisagge Vela/.test(src));
});

// ─── Control negativo: los mensajes que NO son recomendaciones deben seguir con "Hola" ───
// (si estas pruebas empiezan a fallar, alguien tocó mensajes fuera de alcance sin darse cuenta)
console.log('\n═══ Control — mensajes que NO son recomendaciones no deben haberse tocado ═══');
check('la confirmación de turno sigue empezando con "Hola" (no es una recomendación, está fuera de alcance)', () => {
  assert.ok(/Hola \$\{nombrePila\}, te confirmamos tu turno/.test(src));
});
check('el mensaje de bienvenida a cliente nuevo sigue existiendo tal cual (no es una recomendación)', () => {
  assert.ok(/Bienvenida\/o a Espacio MimarT/.test(src));
});

console.log('\n' + '='.repeat(60));
if (fails) {
  console.log('RESULTADO: ' + fails + ' prueba(s) fallaron.');
  process.exit(1);
} else {
  console.log('RESULTADO: TODAS LAS PRUEBAS DE RECOMENDACIONES SIN SALUDOS OK');
}
