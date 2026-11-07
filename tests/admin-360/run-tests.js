// node tests/admin-360/run-tests.js — integración de admin.html real en jsdom con Firebase simulado (datos 100% ficticios).
// Datos 100% ficticios. Recorre: Grilla enriquecida, Ficha 360°, mover turno,
// Recordatorios / retorno, Recomendación post-sesión y directorio.
import fs from 'fs';
import path from 'path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ESPEJO = path.join(__dirname, '..', '..');
let fails = 0;
const check = (d, c, extra) => { console.log((c ? '  OK  ' : '  FAIL ') + d); if (!c) { fails++; if (extra !== undefined) console.log('       →', String(extra).slice(0, 300)); } };

const html = fs.readFileSync(path.join(ESPEJO, 'admin.html'), 'utf8');
const vc = new VirtualConsole();
const errores = [];
vc.on('jsdomError', (e) => { if (!/Could not parse CSS|Not implemented/.test(e.message)) errores.push(e.message); });
vc.on('error', (...a) => errores.push(a.join(' ')));
const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'http://localhost/admin.html', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'location', 'history', 'Blob', 'URL'])
  try { Object.defineProperty(globalThis, k, { value: w[k] ?? globalThis[k], configurable: true, writable: true }); } catch (_) {}
globalThis.window = w; globalThis.document = w.document;
// Como en un navegador real: los identificadores sueltos (ej. recargarJornadaStatus()) se resuelven contra window.
try { Object.setPrototypeOf(globalThis, w); } catch (e) { console.log("no se pudo encadenar global→window", e.message); }
const abiertas = [];
w.open = (u) => { abiertas.push(u); return null; };
w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
w.confirm = () => true; w.alert = () => {};
globalThis.confirm = w.confirm; globalThis.alert = w.alert;

let src = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
src = src.replace('from "/js/firebase-web.js"', `from "${pathToFileURL(path.join(__dirname, 'fake-firebase-admin.js')).href}"`)
         .replace(/from "\/js\/([\w-]+\.js)"/g, (_, f) => `from "${pathToFileURL(path.join(ESPEJO, 'js', f)).href}"`);
const gen = path.join(__dirname, '_admin.generated.mjs');
fs.writeFileSync(gen, src);
const fb = await import('./fake-firebase-admin.js');

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const HOY = dia(0);
const set = (p, d) => fb.calls.store.set(p, d);

set('clients/30111222', { fullName: 'Paula Gómez', phone: '3764111222', membershipActive: true, hoursBalance: 2.5, planificacion: null, disponibilidadTexto: 'Puede jueves a la mañana' });
// Laura: disponibilidad cargada solo en la planificación estructurada (sin texto libre)
set('clients/30999888', { fullName: 'Laura Ruiz', phone: '3764999888', membershipActive: false, hoursBalance: 0,
  planificacion: { version: 1, disponibilidad: { modo: 'preferida', dias: { martes: [{ desde: '16:00', hasta: '19:00' }] } } } });
set('clients/28777666', { fullName: 'Marta Sosa', phone: '3764777666', membershipActive: true, hoursBalance: 3, disponibilidadTexto: 'Todos los días por la tarde de 14 a 18' });
set('clients/27666555', { fullName: 'Ana Díaz', phone: '3764666555', membershipActive: false, hoursBalance: 0 });
set('clients/99000111', { fullName: 'GOMEZ   paula', phone: '', membershipActive: false, hoursBalance: 0, email: 'paula@ejemplo.test', notas: 'Ficha cargada dos veces' });
set('clients/26555444', { fullName: 'Rosa Paz', phone: '3764555444', membershipActive: false, hoursBalance: 0 });
const R = (id, d) => set('reservas/' + id, { estado: 'confirmado', ...d });
R('p-hoy', { dni: '30111222', nombre: 'Paula Gómez', fecha: HOY, hora: '10:00', servicio: 'Limpieza Facial Profunda', box: 'b3', duracionMinutos: 60, phone: '3764111222' });
// Turno futuro fijo: la prueba no depende de la hora en que corre.
R('p-fut', { dni: '30111222', nombre: 'Paula Gómez', fecha: dia(4), hora: '10:00', servicio: 'Limpieza Facial Profunda', box: 'b3', duracionMinutos: 60 });
R('p-prev', { dni: '30111222', nombre: 'Paula Gómez', fecha: dia(-21), hora: '15:00', servicio: 'Hi-Fu Facial', box: 'b3', duracionMinutos: 60, detalleSesion: 'Se trabajó óvalo facial y papada con 300 disparos. Piel con buena respuesta, leve eritema.' });
R('l-hoy', { dni: '30999888', nombre: 'Laura Ruiz', fecha: HOY, hora: '11:00', servicio: 'Criolipolisis', box: 'b2', duracionMinutos: 30, phone: '3764999888' });
R('l-man', { dni: '30999888', nombre: 'Laura Ruiz', fecha: dia(1), hora: '09:00', servicio: 'Criolipolisis', box: 'b2', duracionMinutos: 30, phone: '3764999888' });
R('dup1', { dni: '99000111', nombre: 'Paula Gomez', fecha: dia(-60), hora: '10:00', servicio: 'Limpieza Facial Profunda', box: 'b3', duracionMinutos: 60 });
set('prestaciones/y3', { precioAcordado: 50, sinCargo: false });
R('m-prev', { dni: '28777666', nombre: 'Marta Sosa', fecha: dia(-18), hora: '09:00', servicio: 'Drenaje linfático', box: 'b4', duracionMinutos: 60 });
R('a-prev', { dni: '27666555', nombre: 'Ana Díaz', fecha: dia(-20), hora: '12:00', servicio: 'Limpieza facial', box: 'b3', duracionMinutos: 60 });
R('r-prev', { dni: '26555444', nombre: 'Rosa Paz', fecha: dia(-17), hora: '12:00', servicio: 'Radiofrecuencia corporal', box: 'b2', duracionMinutos: 60 });
set('prestaciones/p-hoy', { precioAcordado: 45, sinCargo: false });
set('pagos/pg1', { prestacionId: 'p-hoy', monto: 20, tipo: 'cobro' });
set('historias/30111222', { nombre: 'Paula Gómez', alergias: 'Penicilina', medicacion: 'No', enfermedad: 'No', embarazo: 'No', zona: 'Rostro', objetivo: 'Mejorar textura' });
set('pedidosKit/k1', { dni: '30111222', nombrePaciente: 'Paula Gómez', productos: ['Leche de limpieza', 'Tónico calmante'], estado: 'pendiente', totalPedido: 30000, createdAt: new Date().toISOString() });
set('contactosWhatsApp/clients_27666555_retorno', { coleccion: 'clients', docId: '27666555', tipoMensaje: 'retorno', estado: 'enviado', enviadoAt: { seconds: Math.floor((Date.now() - 2 * 86400000) / 1000) } });
set('configuracion/serviciosBox', { assignments: { Criolipolisis: ['b2', 'b1'] }, defaults: {} });
// Yanina: sesiones realizadas en 3 meses distintos + 2 próximas (buscador de Sesiones)
const mesRel = (delta, d) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() + delta); x.setDate(d); return iso(x); };
const YM_HOY = HOY.slice(0, 7), YM_ANT = mesRel(-1, 5).slice(0, 7);
R('y1', { dni: '25444333', nombre: 'Yanina W', fecha: mesRel(-2, 7), hora: '19:00', servicio: 'Tratamientos Corporales', phone: '3764444333' });
R('y2', { dni: '25444333', nombre: 'Yanina W', fecha: mesRel(-1, 5), hora: '19:00', servicio: 'Reservar turno sin tratamiento específico', phone: '3764444333' });
R('y3', { dni: '25444333', nombre: 'Yanina W', fecha: mesRel(-1, 27), hora: '08:00', servicio: 'Hi-Fu Corporal', phone: '3764444333' });
R('y4', { dni: '25444333', nombre: 'Yanina W', fecha: dia(-1) < HOY.slice(0, 8) + '01' ? mesRel(0, 1) : dia(-1), hora: '18:00', servicio: 'Tratamiento Detox Drenante', phone: '3764444333' });
R('y5', { dni: '25444333', nombre: 'Yanina W', fecha: dia(2), hora: '18:15', servicio: 'Tratamientos Corporales', phone: '3764444333' });
R('y6', { dni: '25444333', nombre: 'Yanina W', fecha: dia(9), hora: '19:45', servicio: 'Hi-Fu Corporal', phone: '3764444333' });

await import(pathToFileURL(gen).href);
fs.unlinkSync(gen);
for (const k of Object.keys(w)) if (typeof w[k] === 'function' && !(k in globalThis)) globalThis[k] = w[k];
const $ = (id) => w.document.getElementById(id);
const tick = async (n = 15) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

await fb.calls.authCallback({ uid: 'u1', email: 'espaciomimart36@gmail.com', getIdTokenResult: async () => ({ claims: { email: 'espaciomimart36@gmail.com' } }) });
await tick(40);
await new Promise(r => setTimeout(r, 400)); await tick(40);

console.log('\n=== Grilla: barra de herramientas ===');
const tools = w.document.querySelector('.grilla-tools').textContent;
check('"Pendientes de reagendar" ya no está en la barra de la Grilla', !/Pendientes de reagendar/.test(tools));
check('siguen + Horario extra, Duplicar mes, Vista clásica y Cristina', /Horario extra/.test(tools) && /Duplicar mes/.test(tools) && /Vista clásica/.test(tools) && !!$('btn-grilla-cristina'));
check('hay "Hora actual" y selector de densidad', !!$('btn-grilla-ahora') && !!$('btn-grilla-densidad'));
check('"Pendientes de reagendar" tampoco aparece como botón en Agenda', ![...w.document.querySelectorAll('button')].some(b => /Pendientes de reagendar/.test(b.textContent)));

console.log('\n=== Grilla: disponibilidad y última sesión, sin datos financieros ===');
w.grillaIrHoy(); await tick(40); await new Promise(r => setTimeout(r, 300)); await tick(40);
const tb = $('grilla-tbody').innerHTML;
check('la Grilla muestra los turnos reales de hoy', tb.includes('Paula Gómez') && tb.includes('Laura Ruiz'), tb.slice(0, 200));
check('muestra el texto exacto de disponibilidad de la ficha (🗓️ Puede jueves a la mañana)', tb.includes('🗓️ Puede jueves a la mañana'));
check('muestra la disponibilidad estructurada de la planificación (Laura: martes 16 a 19)', /🗓️ Martes[^<]*16:00/.test(tb), tb.match(/gc-ctx-dispo[^<]*/g));
check('muestra la última sesión (Hi-Fu Facial, hace 21 d)', tb.includes('Hi-Fu Facial · hace 21 d'));
check('Laura sin sesiones previas → "Primera sesión"', tb.includes('Primera sesión'));
// ("No disp." es la etiqueta de horario bloqueado de siempre, no un saldo.)
check('NO muestra pagos ni saldo de horas en la Grilla', !/💳|Señado|Pagado|Pendiente de pago|\d h disp\.|⭐|saldo/i.test(tb + $('grilla-resumen-dia').innerHTML));
check('NO consulta prestaciones ni pagos al dibujar la Grilla', !fb.calls.lecturas.some(p => p === 'pagos' || p === 'prestaciones'), fb.calls.lecturas.join(','));
check('resumen del día solo con turnos, pacientes y boxes', /2<\/b> turnos/.test($('grilla-resumen-dia').innerHTML) && /Box 3: 1/.test($('grilla-resumen-dia').textContent), $('grilla-resumen-dia').textContent);
const filas15 = () => [...w.document.querySelectorAll('#grilla-tbody tr.grilla-row-15')];
w.grillaToggleDensidad(); await tick();
check('vista compacta activa la clase y oculta filas :15/:45 sin turnos', $('grilla-table').classList.contains('grilla-compacta') && filas15().some(tr => !tr.classList.contains('gr-con-inicio')));
check('el botón cambia a "Vista detallada · 15 min"', /detallada/.test($('btn-grilla-densidad').textContent));
w.grillaToggleDensidad(); await tick();
check('encabezado sticky con z-index 10 en el CSS', /\.grilla-table thead th \{ z-index: 10; \}/.test(html));

console.log('\n=== Ficha 360° desde la Grilla ===');
w.grillaAbrirFichaTurno(null, 'p-hoy'); await tick(30);
check('se abre el drawer sin cambiar de sección', $('f360-drawer').classList.contains('visible') && $('sec-grilla').classList.contains('active'));
check('abre en "Historial de sesiones"', w.document.querySelector('#f360-tabs .activo')?.dataset.tab === 'historial');
const hist = $('f360-cuerpo').textContent;
check('historial con observación completa sin truncar', hist.includes('Piel con buena respuesta, leve eritema.'));
check('historial con box y próximos turnos', hist.includes('Box 3') && /Próximos turnos \([12]\)/.test(hist));
w.f360Tab('resumen'); await tick();
const res = $('f360-cuerpo').textContent;
// p-hoy cuenta como agendada solo si todavía no terminó → 1 h o 2 h agendadas
check('resumen: saldo de horas (2,5 h vigente, agendadas y libres)', res.includes('2,5 h') && res.includes('Ya agendadas')
  && ((res.includes('1 h') && res.includes('1,5 h')) || (res.includes('2 h') && res.includes('0,5 h'))), res.slice(0, 400));
check('resumen: estado de planificación', /Planificación y disponibilidad/.test(res));
check('resumen: alerta clínica visible (Alergias: Penicilina)', res.includes('Alergias: Penicilina'));
check('header con DNI, teléfono y WhatsApp directo', $('f360-datos').textContent.includes('30111222') && $('f360-acciones').innerHTML.includes('wa.me/5493764111222'));
w.f360Tab('clinica'); await tick();
check('historia clínica editable con campos reales', $('hc-alergias')?.value === 'Penicilina' && $('hc-objetivo')?.value === 'Mejorar textura');
$('hc-biotipoCutaneo').value = 'Mixta';
await w.f360GuardarHistoria('30111222'); await tick();
const hc = fb.calls.store.get('historias/30111222');
check('guardar historia: merge en historias/{dni} sin perder datos', hc.biotipoCutaneo === 'Mixta' && hc.alergias === 'Penicilina' && hc.nombre === 'Paula Gómez');
w.f360Tab('kit'); await tick(30); await new Promise(r => setTimeout(r, 50)); await tick(20);
const kit = $('f360-cuerpo').textContent;
check('kit: pedido de Kit Facial de la paciente con productos', kit.includes('Tónico calmante') && kit.includes('Pendiente'));
w.cerrarFicha360(); await tick();
check('la ficha se cierra', !$('f360-drawer').classList.contains('visible'));

console.log('\n=== Mover turno de box / horario ===');
w.grillaAbrirMover('l-hoy'); await tick();
const chips = [...w.document.querySelectorAll('.p360-box-chip')];
check('respeta boxesPorServicio: b1 y b2 habilitados, b3 y b4 no', !chips.find(c => c.dataset.box === 'b1').disabled && chips.find(c => c.dataset.box === 'b3').disabled && chips.find(c => c.dataset.box === 'b4').disabled);
check('mover turno muestra la disponibilidad de la paciente arriba', /Disponibilidad según su ficha/.test(w.document.querySelector('.p360-ctx-agendar')?.textContent || '') && /Martes/.test(w.document.querySelector('.p360-ctx-agendar')?.textContent || ''));
chips.find(c => c.dataset.box === 'b1').click(); await tick();
const sel = $('_mov_hora'); sel.value = '12:00'; sel.dispatchEvent(new w.Event('change')); await tick();
$('_mov_ok').click(); await tick(30);
const lr = fb.calls.store.get('reservas/l-hoy');
check('el turno se movió sin borrarlo (box b1, 12:00, mismo id)', lr.box === 'b1' && lr.hora === '12:00');
check('el modal se cierra', !$('_grilla_mover_ov'));

console.log('\n=== Recordatorios y retorno ===');
w.navegar('recordatorios'); await tick(30); await new Promise(r => setTimeout(r, 50)); await tick(20);
const rt = $('rec-turnos').textContent;
check('lista los turnos de hoy con tratamiento y box', rt.includes('Paula Gómez') && rt.includes('Laura Ruiz') && rt.includes('Box 3'));
check('sin aviso previo → "Pendiente de avisar"', rt.includes('Pendiente de avisar'));
w.recRecordar('p-hoy'); await tick(20);
const msgRec = abiertas.map(decodeURIComponent).find(u => u.includes('wa.me/5493764111222')) || '';
check('Recordar abre WhatsApp con día y hora', msgRec.includes('10:00') && msgRec.includes('hoy'));
check('el recordatorio NO dice tratamiento ni box', !msgRec.includes('Limpieza') && !/Box \d/.test(msgRec), msgRec);
check('queda registrado en contactosWhatsApp (preparado)', fb.calls.store.get('contactosWhatsApp/reservas_p-hoy_recordatorio')?.estado === 'preparado');
check('la fila pasa a "Preparado"', $('rec-turnos').textContent.includes('Preparado'));
w.recSetDia(1); await tick();
check('pestaña Mañana (24 hs) muestra el turno de Laura', $('rec-turnos').textContent.includes('Laura Ruiz') && !$('rec-turnos').textContent.includes('Paula Gómez'));
const ret = $('rec-retorno').textContent;
check('retorno: Marta (18 días) aparece en la lista', ret.includes('Marta Sosa') && ret.includes('Hace 18 días'));
check('retorno: muestra qué días puede según la ficha (📌)', ret.includes('📌 Todos los días por la tarde de 14 a 18'));
check('retorno: sin saldo de horas ni membresía en la tabla', !/a favor|⭐/.test($('rec-retorno').innerHTML));
check('retorno: ciclo cumplido 15–25 días (Rosa, 17 días)', ret.includes('Rosa Paz') && ret.includes('Hace 17 días'));
check('retorno: Ana avisada hace 2 días queda oculta', !ret.includes('Ana Díaz'));
check('retorno: Paula (tiene turno futuro) no aparece', !ret.includes('Paula Gómez'));
$('ret-ocultar').checked = false; w.recRenderRetorno(); await tick();
check('desmarcando "Ocultar ya avisadas" aparece Ana con su aviso', $('rec-retorno').textContent.includes('Ana Díaz') && $('rec-retorno').textContent.includes('Avisado'));
$('ret-trat').value = 'radiofrecuencia'; w.recRenderRetorno(); await tick();
check('filtro por tratamiento (Radiofrecuencia) deja solo a Rosa', $('rec-retorno').textContent.includes('Rosa Paz') && !$('rec-retorno').textContent.includes('Ana Díaz'));
$('ret-trat').value = ''; $('ret-ocultar').checked = true;
w.recAvisarRetorno(encodeURIComponent('dni:26555444')); await tick(20);
check('Avisar retorno: WhatsApp personalizado + registro en contactosWhatsApp', abiertas.some(u => u.includes('wa.me/5493764555444') && decodeURIComponent(u).includes('17 días')) && fb.calls.store.get('contactosWhatsApp/clients_26555444_retorno')?.estado === 'preparado');
check('tras avisar, Rosa queda oculta (ya avisada)', !$('rec-retorno').textContent.includes('Rosa Paz'));

console.log('\n=== Recomendación post-sesión ===');
w.abrirRecomendacionPostSesion('p-hoy'); await tick(20);
check('preselecciona la plantilla según el servicio (Limpieza → limpieza_peeling)', $('_recps_sel').value === 'limpieza_peeling');
check('texto personalizado y editable', $('_recps_txt').value.startsWith('Recomendaciones para Paula Gómez') && !$('_recps_txt').readOnly);
$('_recps_sel').value = 'criolipolisis'; $('_recps_sel').dispatchEvent(new w.Event('change'));
check('cambiar plantilla actualiza el texto', /Criolipólisis/.test($('_recps_txt').value));
$('_recps_txt').value += '\n\nNota extra de Gimena.';
$('_recps_wa').click(); await tick(20);
check('abre WhatsApp con el texto ajustado', abiertas.some(u => decodeURIComponent(u).includes('Nota extra de Gimena.')));
check('deja asentado qué recomendación se envió', fb.calls.store.get('contactosWhatsApp/reservas_p-hoy_rec_criolipolisis')?.estado === 'preparado');
w.abrirFicha360Dni('30111222', 'kit'); await tick(30);
check('la ficha muestra la recomendación en el seguimiento', $('f360-cuerpo').textContent.includes('Recomendación · Criolipólisis'));
w.cerrarFicha360();

console.log('\n=== Sesiones: próximas y realizadas por mes ===');
w.navegar('buscador-sesiones'); await tick();
$('inpBuscadorSesiones').value = 'yanina';
w.buscarSesionesPorNombreInput(); await new Promise(r => setTimeout(r, 400)); await tick();
const ses = $('contenedorSesionesBuscadas').innerHTML;
check('buscador muestra a Yanina con botón de realizadas del mes actual y "Elegir meses"', /_sesMsgRealizadas\(/.test(ses) && /_sesElegirMeses\(/.test(ses), ses.slice(0, 300));
const ultimoMsg = () => w._sesMsgDB[w._sesMsgDB.length - 1].texto;
// jsdom no ejecuta onclick inline: se lee el mensaje que arma el buscador para ese botón.
check('botón "Enviar sesiones pendientes (2)"', /Enviar sesiones pendientes \(2\)/.test($('contenedorSesionesBuscadas').textContent));
const pend = w._sesMsgDB.filter(d => d.titulo === 'Sesiones pendientes').pop().texto;
check('próximas: sin saludo, empieza con el nombre', pend.startsWith('Yanina W\n\nTe recuerdo tus próximas sesiones'), pend.slice(0, 80));
check('próximas: solo día y hora, sin tratamiento', /18:15 hs/.test(pend) && !/Tratamientos Corporales|Hi-Fu/.test(pend), pend);
check('próximas: total en negrita', /\*Total: 2 sesiones\*/.test(pend));
w.document.querySelectorAll('div[style*="position:fixed"]').forEach(x => x.remove());
const exportIdx = w._sesExportDB.length - 1;
w._sesElegirMeses(exportIdx); await tick();
const checksMes = [...w.document.querySelectorAll('.ses-mes-item input')];
check('selector lista los 3 meses con sesiones realizadas', checksMes.length === 3, checksMes.map(c => c.value));
check('por defecto viene marcado solo el mes actual', checksMes.filter(c => c.checked).map(c => c.value).join() === YM_HOY);
w.document.querySelector('[data-atajo="nada"]').click();
checksMes.find(c => c.value === YM_ANT).checked = true; checksMes.find(c => c.value === YM_ANT).dispatchEvent(new w.Event('change'));
w.document.querySelector('[data-accion="ver"]').click(); await tick();
const real = ultimoMsg();
check('realizadas del mes elegido: sin saludo y con el mes en el encabezado', real.startsWith('Yanina W\n\nEstas son tus sesiones realizadas en ') && !/^Hola/.test(real), real.slice(0, 90));
check('realizadas: incluye el tratamiento', real.includes('Hi-Fu Corporal'));
check('realizadas: "sin tratamiento específico" se muestra como "Sesión"', !/sin tratamiento/i.test(real) && /\nSesión\n/.test(real));
check('realizadas: solo ese mes (2 sesiones, no las de otros meses)', /\*Total: 2 sesiones\*/.test(real) && !real.includes('Tratamientos Corporales') && !real.includes('Detox'), real);
w.document.querySelectorAll('div[style*="position:fixed"]').forEach(x => x.remove());
w._sesMsgRealizadas(exportIdx, [YM_HOY]); await tick();
check('botón directo del mes actual: solo la sesión de este mes', /\*Total: 1 sesion\*/.test(ultimoMsg()) && ultimoMsg().includes('Detox'));
w.document.querySelectorAll('div[style*="position:fixed"]').forEach(x => x.remove());
w._sesMsgRealizadas(exportIdx, []); await tick();
check('"Todo": las 4 realizadas separadas por mes', /\*Total: 4 sesiones\*/.test(ultimoMsg()) && (ultimoMsg().match(/\n_[A-ZÁÉÍÓÚ][^_]+_\n/g) || []).length === 3, ultimoMsg());
w.document.querySelectorAll('div[style*="position:fixed"]').forEach(x => x.remove());

console.log('\n=== Directorio de pacientes ===');
w.navegar('clientes'); await tick(30);
$('inpBusPaciente').value = '3764999'; w.filtrarListadoClientes(); await tick();
check('busca por teléfono', $('contenedorClientes').textContent.includes('Laura Ruiz') && !$('contenedorClientes').textContent.includes('Paula Gómez'));
$('inpBusPaciente').value = 'radiofrec'; w.filtrarListadoClientes(); await tick();
check('busca por tratamiento habitual', $('contenedorClientes').textContent.includes('Rosa Paz'));
$('inpBusPaciente').value = 'gomez'; w.filtrarListadoClientes(); await tick();
const card = $('contenedorClientes').innerHTML;
check('busca sin tildes y muestra próximo turno, disponibilidad y última sesión', card.includes('Paula') && /Próximo turno:/.test(card) && card.includes('🗓️ Puede jueves a la mañana') && /Última sesión: <b>/.test(card));
check('la tarjeta no muestra "Saldo bajo" (sin ruido de horas)', !/Saldo bajo/.test(card));
check('botón Ficha 360° en la tarjeta', card.includes('abrirFicha360Dni'));

console.log('\n=== Disponibilidad: editar en la ficha → Firestore, Grilla y directorio al instante ===');
w.navegar('grilla'); w.grillaIrHoy(); await tick(30);
w.abrirFicha360Dni('30111222', 'resumen'); await tick();
check('la ficha arranca con la disponibilidad editable arriba', $('f360-cuerpo').firstElementChild?.classList.contains('f360-dispo') && $('f360-dispo-txt')?.value === 'Puede jueves a la mañana');
$('f360-dispo-txt').value = 'Puede martes y jueves de 9 a 12';
await w.f360GuardarDispo('30111222'); await tick(20);
check('se guarda en clients/{dni}.disponibilidadTexto', fb.calls.store.get('clients/30111222').disponibilidadTexto === 'Puede martes y jueves de 9 a 12');
check('la Grilla se actualiza al instante', $('grilla-tbody').innerHTML.includes('🗓️ Puede martes y jueves de 9 a 12'));
w.cerrarFicha360();
w.navegar('clientes'); await tick(20);
$('inpBusPaciente').value = 'martes y jueves'; w.filtrarListadoClientes(); await tick();
check('el directorio busca por disponibilidad y la muestra en la tarjeta', $('contenedorClientes').textContent.includes('Paula Gómez') && $('contenedorClientes').textContent.includes('Puede martes y jueves de 9 a 12'));
$('inpBusPaciente').value = 'rosa'; w.filtrarListadoClientes(); await tick();
check('sin disponibilidad cargada → botón para agregarla con 1 clic', /Agregar días y horarios que puede/.test($('contenedorClientes').textContent));
w.editarDisponibilidad('26555444'); await tick();
$('_dispo_txt').value = 'Puede viernes por la tarde'; $('_dispo_ok').click(); await tick(20);
check('edición rápida guarda y refresca el directorio', fb.calls.store.get('clients/26555444').disponibilidadTexto === 'Puede viernes por la tarde' && $('contenedorClientes').textContent.includes('Puede viernes por la tarde'));
check('la tarjeta muestra última sesión con fecha, box y tratamiento', /Última sesión: .*Box 2.*Radiofrecuencia corporal/.test($('contenedorClientes').textContent));

console.log('\n=== Registrar turno: recuadro de disponibilidad y últimas sesiones ===');
const elPac = w.document.createElement('div');
Object.assign(elPac.dataset, { dni: '30111222', nombre: 'Paula Gómez', phone: '3764111222', notas: '' });
w.seleccionarPacienteRegistro(elPac); await tick();
const ctxReg = $('mreg-resultados').textContent;
check('al elegir la paciente se ve su disponibilidad', ctxReg.includes('Disponibilidad según su ficha') && ctxReg.includes('Puede martes y jueves de 9 a 12'));
check('y sus últimas sesiones con box y tratamiento', ctxReg.includes('Hi-Fu Facial') && ctxReg.includes('Box 3'));

console.log('\n=== Navegación en 5 bloques con pestañas internas ===');
check('el sidebar tiene los 5 bloques', ['jornada', 'pacientes', 'seguimiento', 'recursos', 'gestion'].every(g => $('btn-g-' + g)));
check('ninguna sección quedó sin acceso', ['grilla', 'agenda', 'preparar-jornada', 'clientes', 'historias', 'buscador-sesiones', 'recordatorios', 'recomendaciones', 'consultas', 'control-consultas', 'agenda-ci', 'servicios', 'pedidos-kit', 'calculadora', 'cursos', 'resumen-mensual', 'export'].every(s => $('btn-' + s)));
w.navegar('control-consultas'); await tick(20);
const bar = $('subtabs-bar');
check('la sección muestra las pestañas de su bloque', !bar.hidden && /Recordatorios y retorno/.test(bar.textContent) && /Consultas web/.test(bar.textContent) && bar.querySelector('.subtab.activo')?.textContent.includes('Control de consultas'));
check('el bloque activo queda desplegado en el sidebar', w.document.querySelector('.nav-grupo-wrap[data-grupo="seguimiento"]').classList.contains('abierto') && $('btn-control-consultas').classList.contains('active'));
w.navegarGrupo('jornada'); await tick();
check('volver a un bloque recuerda su última pantalla (Grilla)', $('sec-grilla').classList.contains('active'));
w.navegarGrupo('seguimiento'); await tick(20);
check('… y al volver a Seguimiento abre Control de consultas', $('sec-control-consultas').classList.contains('active'));
check('el menú inferior del celular marca el bloque activo', w.document.querySelector('.bni[data-grupo="seguimiento"]').classList.contains('active'));

console.log('\n=== Recomendaciones post-sesión (pestaña) ===');
w.navegar('recomendaciones'); await tick(30);
const rp = $('recpost-lista').textContent;
check('lista las sesiones del día con la plantilla sugerida', rp.includes('Paula Gómez') && rp.includes('Limpieza profunda / Peeling / Dermaplaning'));
check('marca la ya enviada (Criolipólisis a Paula)', /Preparado|Enviada/.test(rp));
check('la biblioteca agrupa por tipo de tratamiento', ['Facial', 'Radiofrecuencia / Tensado', 'HIFU / Lifting sin cirugía', 'Criolipólisis', 'Drenaje / Masajes / Detox', 'Kit domiciliario'].every(c => $('recpost-biblioteca').textContent.includes(c)));

console.log('\n=== Grilla: "Eliminar reserva" desde el menú ⋮ ===');
w.navegar('grilla'); w.grillaIrHoy(); await tick(30);
check('el turno de Laura está en la Grilla antes de eliminar', $('grilla-tbody').innerHTML.includes('Laura Ruiz'));
// Cancelar: no borra nada
let pendiente = w.grillaEliminarReserva('l-hoy'); await tick();
// (el modal escribe con innerText, que jsdom guarda como propiedad sin pasarlo a textContent)
check('pide confirmación antes de borrar', $('confirm-delete-modal').style.display === 'flex' && /Laura Ruiz/.test($('confirm-delete-text-1').innerText || $('confirm-delete-text-1').textContent));
w.cerrarModalBorradoReserva(false); await pendiente; await tick();
check('cancelar no borra la reserva', fb.calls.store.has('reservas/l-hoy') && $('grilla-tbody').innerHTML.includes('Laura Ruiz'));
// Confirmar: se borra de Firestore y desaparece de la Grilla
pendiente = w.grillaEliminarReserva('l-hoy'); await tick();
w.cerrarModalBorradoReserva(true); await pendiente; await tick(20);
check('confirmar borra el documento de Firestore (reservas/l-hoy)', !fb.calls.store.has('reservas/l-hoy'));
check('el turno desaparece de la Grilla al instante', !$('grilla-tbody').innerHTML.includes('Laura Ruiz'));

console.log('\n=== Buscador avanzado (servicio · período · estado) ===');
w.navegar('buscador-avanzado'); await tick(40); await new Promise(r => setTimeout(r, 100)); await tick(40);
check('la sección abre dentro de Pacientes y Fichas', $('sec-buscador-avanzado').classList.contains('active') && /Buscador avanzado/.test($('subtabs-bar').textContent));
check('lista los servicios existentes con su cantidad', /Hi-Fu Corporal/.test($('ba-svc-list').textContent) && /Criolipolisis/.test($('ba-svc-list').textContent));
check('muestra KPIs del mes en curso', /Sesiones en el período/.test($('ba-kpis').textContent) && /Pacientes únicos/.test($('ba-kpis').textContent));
// Hi-Fu Corporal, todo el historial hasta hoy
w.baLimpiarMeses(); $('ba-desde').value = '2000-01-01'; $('ba-hasta').value = '2100-12-31';
const tildar = (svc, on = true) => { const c = [...$('ba-svc-list').querySelectorAll('input')].find(i => i.dataset.svc === svc); c.checked = on; w.baToggleSvc(c); };
tildar('Hi-Fu Corporal'); await tick();
const kpiVal = (i) => $('ba-kpis').querySelectorAll('.ba-kpi-val')[i]?.textContent;
check('Hi-Fu Corporal realizado: 1 sesión (la futura no cuenta)', kpiVal(0) === '1', $('ba-kpis').textContent);
check('importe de la sesión con precio ($ 50 mil)', /\$ 50 mil/.test($('ba-kpis').textContent), $('ba-kpis').textContent);
w.baSetVista('sesiones'); await tick();
check('detalle por sesión sin mezclar servicios', /Yanina W/.test($('ba-resultados').textContent) && !/Tratamientos Corporales|Detox/.test($('ba-resultados').textContent));
$('ba-futuros').checked = true; w.baAplicar(); await tick();
check('con turnos futuros: 2 sesiones', kpiVal(0) === '2');
// Exclusivo: Criolipolisis → solo Laura
tildar('Hi-Fu Corporal', false); tildar('Criolipolisis');
w.document.querySelector('input[name="ba-modo"][value="exclusivo"]').checked = true; w.baAplicar(); await tick();
check('«Exclusivo» de Criolipolisis: solo Laura', /Reporte Exclusivo: Criolipolisis/.test($('ba-titulo').textContent) && /Laura Ruiz/.test($('ba-resultados').textContent) && !/Paula|Yanina/.test($('ba-resultados').textContent));
// PDF con jsPDF simulado
const pdfs = [];
w.jspdf = { jsPDF: class { constructor() { this.textos = []; this.tablas = []; this.lastAutoTable = { finalY: 40 }; this.pag = 1; pdfs.push(this); }
  setTextColor() {} setFont() {} setFontSize() {} setPage() {} getNumberOfPages() { return 1; }
  setFillColor() {} setDrawColor() {} setLineWidth() {} roundedRect() {}
  text(t) { this.textos.push([].concat(t).join(' ')); } splitTextToSize(t) { return [t]; }
  autoTable(o) { this.tablas.push(o); } save(n) { this.archivo = n; } } };
await w.baDescargarPdf(); await tick();
const pdf = pdfs[0];
check('PDF generado con el título exacto del filtro', pdf && pdf.textos[0] === 'Reporte Exclusivo: Criolipolisis' && /reporte_exclusivo_criolipolisis_/.test(pdf.archivo), pdf && pdf.textos[0]);
check('PDF compacto: solo números (mes a mes + servicio × mes), sin listados de pacientes ni detalle', pdf && pdf.tablas.length === 2 && !pdf.tablas.some(t => t.head[0].includes('Paciente')) && !pdf.textos.some(x => /Laura Ruiz/.test(x)));
check('PDF con recuadros de totales', pdf && pdf.textos.includes('SESIONES') && pdf.textos.includes('PACIENTES ÚNICOS'));
const porSvc = pdf ? pdf.tablas[1].body : [];
check('PDF no mezcla servicios (solo Criolipolisis, 1 sesión)', porSvc.length === 1 && porSvc[0][0] === 'Criolipolisis' && porSvc[0].includes('1'), JSON.stringify(porSvc));
// Exportar / Jornadas
w.navegar('export'); await tick(20);
const chks = [...w.document.querySelectorAll('#expDepiServicios input')];
chks.forEach(c => { c.checked = c.value === 'Hi-Fu Corporal'; });
$('expDepiDesde').value = '2000-01-01'; $('expDepiHasta').value = '2100-12-31';
check('Exportar tiene el botón Descargar Resumen en PDF', /Descargar Resumen en PDF/.test($('expResumenPdfBtn').textContent));
await w.expResumenPDF(); await tick();
const pdf2 = pdfs[1];
check('PDF de Exportar respeta servicios tildados y fechas', pdf2 && /Hi-Fu Corporal/.test(pdf2.textos[0]) && pdf2.tablas[1].body.length === 1 && pdf2.tablas[1].body[0][0] === 'Hi-Fu Corporal' && pdf2.tablas[0].body.reduce((a, f) => a + Number(f[1]), 0) === 2, pdf2 && JSON.stringify(pdf2.tablas.map(t => t.body)));

console.log('\n=== Directorio: fichas duplicadas ===');
w.navegar('clientes'); await tick(20);
w.dupToggle(); await tick();
const dp = $('dup-panel').textContent;
check('detecta "GOMEZ paula" como duplicado de "Paula Gómez"', /1 grupo/.test(dp) && /Gomez\s+Paula/i.test(dp) && /Paula Gómez/.test(dp), [/1 grupo/.test(dp), /Gomez Paula/i.test(dp), /Paula Gómez/.test(dp)].join());
check('muestra servicios y cantidad de turnos por ficha', /Limpieza Facial Profunda/.test(dp) && /Turnos/.test(dp));
w.dupUnificar(0, '30111222'); await tick();
const okBtn = $('_dup_ok');
check('pide confirmación antes de unificar', !!okBtn);
okBtn.onclick({ target: okBtn }); await tick(60);
check('el turno de la duplicada pasa a la principal', fb.calls.store.get('reservas/dup1')?.dni === '30111222' && fb.calls.store.get('reservas/dup1')?.unificadoDesdeDni === '99000111');
check('la duplicada queda como redirección (no se borra)', fb.calls.store.get('clients/99000111')?.redirigidoA === '30111222');
check('la principal recibe el email faltante y las notas', fb.calls.store.get('clients/30111222')?.email === 'paula@ejemplo.test' && /Unificado desde DNI 99000111/.test(fb.calls.store.get('clients/30111222')?.notas || ''));
check('la principal conserva su membresía', fb.calls.store.get('clients/30111222')?.membershipActive === true);
check('ya no quedan duplicados en el panel', /No se encontraron fichas duplicadas/.test($('dup-panel').textContent));

console.log('\n=== Control de sesiones (HIFU corporal 45 d · Crio 30 d) ===');
// Datos agregados recién acá para no alterar los escenarios anteriores.
R('cs-h45', { dni: '31000001', nombre: 'Carla Plazo', fecha: dia(-45), hora: '10:00', servicio: 'Hi-Fu Corporal', duracionMinutos: 60 });
R('cs-hfa', { dni: '31000001', nombre: 'Carla Plazo', fecha: dia(-3), hora: '10:00', servicio: 'Hi-Fu Facial', duracionMinutos: 60 });
R('cs-c29', { dni: '31000002', nombre: 'Dora Espera', fecha: dia(-29), hora: '10:00', servicio: 'Criolipolisis', duracionMinutos: 30 });
R('cs-cx', { dni: '31000002', nombre: 'Dora Espera', fecha: dia(-2), hora: '10:00', servicio: 'Criolipolisis', duracionMinutos: 30, estado: 'cancelado' });
R('cs-c31', { dni: '31000003', nombre: 'Elsa Ambos', fecha: dia(-31), hora: '10:00', servicio: 'Criolipolisis', duracionMinutos: 30 });
R('cs-h10', { dni: '31000003', nombre: 'Elsa Ambos', fecha: dia(-10), hora: '10:00', servicio: 'Hi-Fu Corporal', duracionMinutos: 60 });
w.navegar('control-sesiones'); await tick(20);
await w.csRecargar(); await tick(20);
check('el acceso está en Pacientes y Fichas (sidebar, pestañas y menú del celular)', !!$('btn-control-sesiones') && /Control de sesiones/.test($('subtabs-bar').textContent) && [...w.document.querySelectorAll('.bsh-item')].filter(b => /Control de sesiones/.test(b.textContent)).length === 1);
check('un solo botón en el sidebar (sin duplicados)', w.document.querySelectorAll('#btn-control-sesiones').length === 1);
const filasCs = () => [...$('cs-resultados').querySelectorAll('tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' '));
let fc = filasCs();
const filaDe = (nom, trat) => fc.find(t => t.includes(nom) && t.includes(trat)) || '';
check('HIFU corporal a los 45 días → Plazo cumplido (el HIFU facial no reinicia)', /Plazo cumplido/.test(filaDe('Carla Plazo', 'HIFU corporal')) && / 45 /.test(filaDe('Carla Plazo', 'HIFU corporal')), filaDe('Carla Plazo', 'HIFU corporal'));
check('Crio a los 29 días → Faltan 1 día (la cancelada no reinicia)', /Faltan 1 día/.test(filaDe('Dora Espera', 'Crio')), filaDe('Dora Espera', 'Crio'));
check('paciente con ambos: Crio cumplido y HIFU corporal faltan 35', /Plazo cumplido/.test(filaDe('Elsa Ambos', 'Crio')) && /Faltan 35 días/.test(filaDe('Elsa Ambos', 'HIFU corporal')));
check('turno solo futuro → Sin sesión registrada (Laura, Crio)', /Sin sesión registrada/.test(filaDe('Laura Ruiz', 'Crio')));
const orden = fc.map(t => /Plazo cumplido/.test(t) ? 0 : /Faltan/.test(t) ? 1 : 2);
check('orden: cumplidos → en espera → sin sesión', orden.every((v, i) => i === 0 || orden[i - 1] <= v), orden.join());
check('entre cumplidos, más días vencidos primero (Crio +1 d antes que HIFU +0 d)', fc.findIndex(t => t.includes('Elsa Ambos') && t.includes('Crio')) < fc.findIndex(t => t.includes('Carla Plazo')));
const nums = [...$('cs-contadores').querySelectorAll('.cs-contador-num')].map(n => n.textContent);
check('contadores visibles: HIFU corporal 1 · Crio 1', nums.join() === '1,1', nums.join());
w.csVerCumplidos('crio'); await tick();
fc = filasCs();
check('tocar el contador filtra Crio con plazo cumplido (coincide con el número)', fc.length === 1 && fc[0].includes('Elsa Ambos'), fc);
$('cs-trat').value = 'todos'; w.csSetEstado('todos'); $('cs-busq').value = 'dora'; w.csRender(); await tick();
fc = filasCs();
check('búsqueda por cliente', fc.length === 1 && fc[0].includes('Dora Espera'));
// Registrar una nueva sesión de Crio a Elsa (ayer) → su contador se reinicia
$('cs-busq').value = ''; R('cs-new', { dni: '31000003', nombre: 'Elsa Ambos', fecha: dia(-1), hora: '10:00', servicio: 'Criolipolisis', duracionMinutos: 30 });
await w.csRecargar(); await tick(20); fc = filasCs();
check('nueva sesión de Crio reinicia solo Crio (faltan 29) y HIFU sigue igual', /Faltan 29 días/.test(filaDe('Elsa Ambos', 'Crio')) && /Faltan 35 días/.test(filaDe('Elsa Ambos', 'HIFU corporal')));
check('acceso a la ficha / historial', /Historial/.test($('cs-resultados').textContent) && !!$('cs-resultados').querySelector('button[onclick*="abrirFicha360Enc"]'));
w.abrirFicha360Enc('dni:31000001', 'historial'); await tick(30);
check('abre la Ficha 360° del paciente (pestaña historial)', $('f360-drawer').classList.contains('visible'));
w.cerrarFicha360?.();

check('sin errores de JavaScript durante la prueba', errores.length === 0, errores.join(' | '));
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODOS LOS FLUJOS DE ADMIN OK'));
process.exit(fails ? 1 : 0);
