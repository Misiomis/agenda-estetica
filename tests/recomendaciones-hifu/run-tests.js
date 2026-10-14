// node tests/recomendaciones-hifu/run-tests.js   (datos 100% sintéticos)
import { PLANTILLAS_HIFU, ORDEN_PLANTILLAS_HIFU, construirMensajeHifu } from '../../js/recomendaciones-hifu.js';

let fails = 0;
const check = (desc, cond, extra) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

console.log('\n=== Las 4 plantillas existen y están completas ===');
{
  check('existen exactamente las 4 claves esperadas', ORDEN_PLANTILLAS_HIFU.length === 4 &&
    ['facial_antes', 'facial_despues', 'corporal_antes', 'corporal_despues'].every(k => ORDEN_PLANTILLAS_HIFU.includes(k)));
  ORDEN_PLANTILLAS_HIFU.forEach(k => {
    const p = PLANTILLAS_HIFU[k];
    check(`"${k}" tiene título y texto no vacíos`, !!p && typeof p.titulo === 'string' && p.titulo.length > 0 && typeof p.texto === 'string' && p.texto.length > 200);
  });
}

console.log('\n=== Contenido exacto del anexo — nunca resumido ni mezclado ===');
{
  const fa = PLANTILLAS_HIFU.facial_antes.texto;
  check('facial_antes: título exacto', fa.startsWith('✨ Prepará tu sesión de HIFU facial'));
  check('facial_antes: menciona Starbene y ANMAT (no se resumió)', fa.includes('Starbene registrado ante ANMAT'));
  check('facial_antes: trae las 10 contraindicaciones completas', (fa.match(/^•/gm) || []).length >= 14); // 4 "cómo venir" + 10 contraindicaciones
  check('facial_antes: cierre exacto "¡Te esperamos!"', fa.trim().endsWith('¡Te esperamos!'));
  check('facial_antes: NO contiene texto de HIFU corporal (no se mezclaron plantillas)', !fa.includes('HIFU corporal') && !fa.includes('Starbene registrado ante ANMAT, de uso profesional. La evaluación previa'));

  const fd = PLANTILLAS_HIFU.facial_despues.texto;
  check('facial_despues: título exacto', fd.startsWith('✨ Cuidados después de tu HIFU facial'));
  check('facial_despues: menciona FPS 50 y reaplicación cada 2 horas', fd.includes('FPS 50') && fd.includes('cada 2 horas'));
  check('facial_despues: NO es igual al texto de "antes" (no se duplicó por error)', fd !== fa);

  const ca = PLANTILLAS_HIFU.corporal_antes.texto;
  check('corporal_antes: título exacto', ca.startsWith('✨ Prepará tu sesión de HIFU corporal'));
  check('corporal_antes: trae los 3 intervalos de frecuencia por zona', ca.includes('30 a 45 días') && ca.includes('40 a 45 días') && ca.includes('3 a 6 meses'));
  check('corporal_antes: NO contiene texto de HIFU facial (no se mezclaron plantillas)', !ca.includes('HIFU facial'));

  const cd = PLANTILLAS_HIFU.corporal_despues.texto;
  check('corporal_despues: título exacto', cd.startsWith('✨ Cuidados después de tu HIFU corporal'));
  check('corporal_despues: trae los 3 intervalos de control por zona', cd.includes('30 a 45 días') && cd.includes('40 a 45 días') && cd.includes('3 a 6 meses'));
  check('corporal_despues: NO es igual al texto de "antes" (no se duplicó por error)', cd !== ca);

  // Las 4 son distintas entre sí — ninguna quedó pisada por otra al copiarlas.
  const todas = ORDEN_PLANTILLAS_HIFU.map(k => PLANTILLAS_HIFU[k].texto);
  check('las 4 plantillas son todas distintas entre sí', new Set(todas).size === 4);
}

console.log('\n=== construirMensajeHifu: personalización sin tocar el contenido clínico ===');
{
  const conNombre = construirMensajeHifu('facial_antes', 'Susana Gómez');
  check('con nombre: empieza con el saludo personalizado', conNombre.startsWith('Recomendaciones para Susana Gómez\n\n'));
  check('con nombre: el cuerpo clínico sigue intacto después del saludo', conNombre.includes(PLANTILLAS_HIFU.facial_antes.texto));

  const sinNombre = construirMensajeHifu('facial_antes', '');
  check('sin nombre: usa el encabezado neutro (no inventa un nombre)', sinNombre.startsWith('Recomendaciones posteriores a tu sesión\n\n'));

  check('clave desconocida: falla explícitamente en vez de devolver texto vacío/incorrecto', (() => {
    try { construirMensajeHifu('no_existe', 'X'); return false; } catch (e) { return true; }
  })());
}

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DE PLANTILLAS HIFU OK');
process.exit(fails ? 1 : 0);
