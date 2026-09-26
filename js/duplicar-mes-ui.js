// Duplicar mes — interfaz, lectura y guardado. La lógica de decisión vive en
// duplicar-mes.js (pura y probada); este módulo solo lee datos reales, muestra la
// vista previa y, cuando el administrador pulsa el botón final, guarda con la MISMA
// validación aplicada sobre datos recién leídos.
import {
  prepararDuplicacion, prepararCopia, evaluarOcurrencia, buscarAlternativas, normalizarBloqueos, ocupacionDesdeReservas,
  fechaLarga, horaAMin, minAHora, idReservaDe, claveOcurrencia, categoriaServicio, tieneBloqueoProtegido, motivosInsalvables,
} from './duplicar-mes.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CAT_TXT = { facial: 'Facial', corporal: 'Corporal', relax: 'Relax', otro: 'Otro' };
const COLECCION_PEND = 'pendientesReagendar';
const COLECCION_LOTES = 'duplicacionesMes';
const CATEGORIAS_ORIGEN = {
  usada_pauta: 'Copiadas al mes de destino', pendiente: 'No se pudieron copiar (van a pendientes)', cita_puntual_continua: 'Cita confirmada para continuar', excepcion_historica: 'Excepción histórica (no continúa)',
  cancelada: 'Canceladas (no se regeneran)', continuidad_por_definir: 'Continuidad por definir', sin_paciente: 'Sin paciente identificado',
};
const MOTIVO_TXT = {
  cierre_dia: 'Estética cerrada', bloqueo_estetica: 'Estética bloqueada', bloqueo_box: 'Box bloqueado', bloqueo_depilacion_protegido: 'Box 2 bloqueado por depilación',
  box_ocupado: 'Box ocupado', paciente_ocupado: 'La paciente ya tiene otro turno', box_incompatible: 'Box incompatible', fuera_horario: 'Fuera de horario',
  indisponible: 'Indisponibilidad de la paciente', ausente: 'Paciente ausente', fuera_cupo: 'Fuera del cupo', pendiente_consultar: 'Pendiente de consultar',
  definir_frecuencia: 'Definir frecuencia', continuidad_por_definir: 'Continuidad por definir', deficit: 'Sesiones sin fecha',
};

const CSS = `
.dm-overlay{position:fixed;inset:0;z-index:200000;background:rgba(6,22,15,.55);backdrop-filter:blur(5px);display:none;align-items:flex-start;justify-content:center;padding:12px;overflow:auto}
.dm-overlay.dm-open{display:flex}
.dm-card{width:100%;max-width:880px;background:var(--surface,#fff);color:var(--ink,#2f3d34);border-radius:18px;border:1px solid var(--border,#d8e2dc);box-shadow:0 24px 52px rgba(6,40,25,.25);padding:18px 18px 20px;margin:auto 0}
.dm-card h2{font-family:'Playfair Display',serif;font-size:20px;margin:0 0 4px}
.dm-sub{font-size:12.5px;opacity:.75;margin:0 0 12px}
.dm-form{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:0 0 10px}
.dm-form label{display:flex;flex-direction:column;font-size:12px;font-weight:600;gap:4px}
.dm-form select,.dm-form input,.dm-in{min-height:40px;border-radius:10px;border:1.5px solid var(--border-strong,#b6c5bb);background:var(--surface,#fff);color:inherit;padding:6px 10px;font:inherit;font-size:14px}
.dm-regla{background:rgba(53,122,92,.10);border:1px solid rgba(53,122,92,.30);border-radius:10px;padding:8px 12px;font-size:13px;font-weight:600;margin:0 0 12px}
.dm-btn{min-height:42px;border-radius:12px;border:1.5px solid var(--border-strong,#b6c5bb);background:var(--surface,#fff);color:inherit;font:inherit;font-weight:700;font-size:13.5px;padding:8px 14px;cursor:pointer}
.dm-btn-p{background:var(--forest,#2f5a47);border-color:var(--forest,#2f5a47);color:#fff}
.dm-btn:disabled{opacity:.5;cursor:not-allowed}
.dm-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.dm-chip{border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700;background:rgba(53,122,92,.12);border:1px solid rgba(53,122,92,.30)}
.dm-chip.warn{background:rgba(138,106,34,.12);border-color:rgba(138,106,34,.40);color:#6b4d10}
.dm-chip.bad{background:rgba(165,67,58,.10);border-color:rgba(165,67,58,.40);color:#8a2f2a}
.dm-sec{border:1px solid var(--border,#d8e2dc);border-radius:12px;padding:8px 12px;margin:0 0 10px}
.dm-sec>summary{cursor:pointer;font-weight:700;font-size:13.5px}
.dm-fila{border-top:1px solid var(--border,#d8e2dc);padding:7px 0;font-size:13px;display:flex;flex-direction:column;gap:2px}
.dm-fila:first-of-type{border-top:none}
.dm-est{font-weight:700;font-size:11.5px;border-radius:999px;padding:1px 9px;margin-left:6px}
.dm-est.crear{background:rgba(53,122,92,.15);color:#2f5a47}.dm-est.ya_cubierta{background:rgba(80,100,140,.15);color:#3a4a6b}
.dm-est.pendiente{background:rgba(165,67,58,.12);color:#8a2f2a}.dm-est.fuera_cupo{background:rgba(138,106,34,.15);color:#6b4d10}
.dm-mot{font-size:12.5px;color:#8a2f2a}.dm-adv{font-size:12.5px;color:#6b4d10}.dm-orig{font-size:12px;opacity:.7}
.dm-acc{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center}
.dm-res{border:1.5px solid var(--forest,#2f5a47);border-radius:12px;padding:10px 14px;margin-top:12px;font-size:13.5px}
.dm-res.err{border-color:#a5433a}
.dm-alt{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid var(--border,#d8e2dc);font-size:13px}
.dm-badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:999px;background:#a5433a;color:#fff;font-size:11px;font-weight:800;text-align:center;margin-left:4px}
.dmp-filtros{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.dmp-grupo-t{font-weight:800;font-size:13px;margin:14px 0 4px;text-transform:capitalize}
.dmp-item{border:1px solid var(--border,#d8e2dc);border-radius:12px;padding:10px 12px;margin:0 0 8px;background:var(--surface,#fff)}
.dmp-item.resuelto{opacity:.65}
@media (max-width:600px){.dm-card{padding:14px 12px}.dm-form label{flex:1 1 130px}}
`;

// Diálogo de confirmación propio (reemplaza a window.confirm, que se ve fuera de estilo).
// Devuelve una promesa: true si se acepta; false si se cancela (botón, Escape o clic afuera).
const CSS_CONFIRM = `
.ac-overlay{position:fixed;inset:0;z-index:300000;background:rgba(6,22,15,.5);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px}
.ac-card{width:100%;max-width:380px;background:var(--surface,#fff);color:var(--ink,#2f3d34);border:1px solid var(--border,#d8e2dc);border-radius:20px;box-shadow:0 24px 52px rgba(6,40,25,.28);padding:22px 20px 18px}
.ac-card h3{font-family:'Playfair Display',serif;font-size:18px;margin:0 0 8px}
.ac-card p{font-size:13.5px;line-height:1.5;margin:0 0 16px;opacity:.85;white-space:pre-line}
.ac-acc{display:flex;gap:10px;flex-wrap:wrap}
.ac-acc button{flex:1 1 130px;min-height:44px;border-radius:12px;font:inherit;font-weight:700;font-size:14px;cursor:pointer;border:1.5px solid var(--border-strong,#b6c5bb);background:var(--surface,#fff);color:inherit}
.ac-acc .ac-si{background:var(--forest,#2f5a47);border-color:var(--forest,#2f5a47);color:#fff}
`;
export function confirmarUI({ titulo = '¿Confirmar?', texto = '', aceptar = 'Aceptar', cancelar = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    if (!document.getElementById('ac-css')) { const s = document.createElement('style'); s.id = 'ac-css'; s.textContent = CSS_CONFIRM; document.head.appendChild(s); }
    const previo = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'ac-overlay'; ov.setAttribute('role', 'alertdialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'ac-tit');
    ov.innerHTML = '<div class="ac-card"><h3 id="ac-tit"></h3><p></p><div class="ac-acc"><button type="button" class="ac-no"></button><button type="button" class="ac-si"></button></div></div>';
    ov.querySelector('h3').textContent = titulo; ov.querySelector('p').textContent = texto;
    ov.querySelector('.ac-no').textContent = cancelar; ov.querySelector('.ac-si').textContent = aceptar;
    const fin = (v) => { document.removeEventListener('keydown', tecla, true); ov.remove(); try { if (previo && previo.focus) previo.focus(); } catch (_) { /* sin foco previo */ } resolve(v); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fin(false); } };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.ac-no')) fin(false); else if (e.target.closest('.ac-si')) fin(true); });
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(ov);
    ov.querySelector('.ac-no').focus();
  });
}
window.appConfirmar = confirmarUI;

export function initDuplicarMes(deps) {
  const { db, F, escapeHtml: esc, mostrarAviso } = deps;
  const { collection, getDocs, getDoc, doc, setDoc, runTransaction, serverTimestamp, query, where } = F;
  const $ = (id) => document.getElementById(id);
  const E = (v) => esc(v == null ? '' : v);

  const st = { datos: null, decisiones: { global: {}, patrones: {}, items: {} }, res: null, ctx: null, ejecutando: false, agrupar: 'paciente', preparando: false };
  const pend = { docs: [], cargado: false, filtros: { estado: 'abiertos', texto: '', motivo: '', categoria: '', box: '' } };

  // ── utilidades de lectura ──────────────────────────────────────────────
  const rangoMes = (anio, mes) => ({ ini: `${anio}-${String(mes).padStart(2, '0')}-01`, fin: `${anio}-${String(mes).padStart(2, '0')}-31` });
  const boxIdNum = (n) => `b${n}`;
  async function leerReservas(desde, hasta) {
    const snap = await getDocs(query(collection(db, 'reservas'), where('fecha', '>=', desde), where('fecha', '<=', hasta)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async function leerBloqueos() {
    const snap = await getDocs(collection(db, 'calendarExceptions'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async function leerPendientes() {
    const snap = await getDocs(collection(db, COLECCION_PEND));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  function mapaServicios(reservas) {
    const out = {};
    [...new Set(reservas.map((r) => r.servicio).filter(Boolean))].forEach((n) => {
      const info = deps.servicioInfo(n);
      out[n] = { duracionMin: info.duracionMin, boxes: info.boxes, categoria: categoriaServicio(n, null) };
    });
    return out;
  }
  function mapaPacientes() {
    const out = {};
    (deps.getPacientes() || []).forEach((p) => { out[String(p.dni)] = { dni: String(p.dni), fullName: p.fullName || '', phone: p.phone || '', planificacion: p.planificacion || null }; });
    return out;
  }
  function armarCtx(datos, decisiones, origen, destino) {
    // Los documentos "block_<fecha>_<hora>" (sin box) son cierres de horario de la agenda pública: el alta manual del
    // administrador no los respeta, así que tampoco frenan la copia. Sí cuentan los cierres de día y los bloqueos por box.
    const { bloqueos, desbloqueos } = normalizarBloqueos(datos.bloqueosRaw.filter((d) => !((d.hora || d.hour || d.time) && !d.boxId && d.source !== 'admin_unblock')));
    const ctx = {
      origen, destino, reservas: datos.reservas, pacientes: datos.pacientes, servicios: datos.servicios, boxes: deps.boxes,
      bloqueos, desbloqueos, pendientes: datos.pendientes.map((p) => ({ id: p.id, clave: p.clave, estado: p.estado, reservaId: p.reservaId })), decisiones,
      esActiva: deps.esReservaActiva, boxDe: deps.boxDeReserva, duracionDe: (r) => Number(r.duracionMinutos) > 0 ? Number(r.duracionMinutos) : 30,
      nombreDe: (r) => r.nombreLimpio || r.nombre || r.cliente || r.clienteNombre || '',
    };
    ctx.mesDestino = `${destino.anio}-${String(destino.mes).padStart(2, '0')}`;
    ctx.ocupacion = ocupacionDesdeReservas(datos.reservas, ctx);
    return ctx;
  }
  const boxLabel = (id) => (deps.boxes.find((b) => b.id === id) || {}).label || id || '—';
  const mesTxt = (m) => `${MESES[m.mes - 1]} ${m.anio}`;
  const finHora = (hora, dur) => minAHora(horaAMin(hora) + dur);

  // ── modal ──────────────────────────────────────────────────────────────
  function inyectar() {
    if ($('dm-css')) return;
    const s = document.createElement('style'); s.id = 'dm-css'; s.textContent = CSS; document.head.appendChild(s);
    const ov = document.createElement('div');
    ov.id = 'dm-overlay'; ov.className = 'dm-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'dm-titulo');
    ov.innerHTML = `<div class="dm-card"><h2 id="dm-titulo">Duplicar mes</h2>
      <p class="dm-sub">Prepara los turnos de otro mes a partir de uno ya cargado. Nada se guarda hasta que pulses el botón final.</p>
      <div class="dm-form">
        <label>Mes de origen <select id="dm-o-mes"></select></label><label>Año <input id="dm-o-anio" type="number" min="2000" max="2100" step="1" style="width:92px"></label>
        <label>Mes de destino <select id="dm-d-mes"></select></label><label>Año <input id="dm-d-anio" type="number" min="2000" max="2100" step="1" style="width:92px"></label>
      </div>
      <div class="dm-regla">Conservar días de la semana y horarios habituales</div>
      <div class="dm-acc" style="margin-top:0"><button type="button" class="dm-btn dm-btn-p" id="dm-preparar">Preparar vista previa</button><button type="button" class="dm-btn" id="dm-cerrar">Cerrar</button></div>
      <div id="dm-cuerpo" role="status" aria-live="polite"></div></div>`;
    document.body.appendChild(ov);
    const opts = MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    $('dm-o-mes').innerHTML = opts; $('dm-d-mes').innerHTML = opts;
    $('dm-cerrar').addEventListener('click', cerrar);
    $('dm-preparar').addEventListener('click', () => preparar());
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
    $('dm-cuerpo').addEventListener('click', onClickCuerpo);
    $('dm-cuerpo').addEventListener('change', onCambioCuerpo);
  }
  function abrir() {
    inyectar();
    const base = deps.getFechaAgenda();
    const anio = base.getFullYear(), mes = base.getMonth() + 1;
    $('dm-o-mes').value = String(mes); $('dm-o-anio').value = String(anio);
    const dm = mes === 12 ? 1 : mes + 1;
    $('dm-d-mes').value = String(dm); $('dm-d-anio').value = String(mes === 12 ? anio + 1 : anio);
    st.datos = null; st.res = null; st.decisiones = { global: {}, patrones: {}, items: {} };
    $('dm-cuerpo').innerHTML = '';
    $('dm-overlay').classList.add('dm-open');
    $('dm-o-mes').focus();
  }
  function cerrar() { if (st.ejecutando) return; $('dm-overlay')?.classList.remove('dm-open'); }
  const leerMeses = () => ({
    origen: { anio: parseInt($('dm-o-anio').value, 10), mes: parseInt($('dm-o-mes').value, 10) },
    destino: { anio: parseInt($('dm-d-anio').value, 10), mes: parseInt($('dm-d-mes').value, 10) },
  });

  async function preparar({ recargar = true } = {}) {
    if (st.preparando || st.ejecutando) return;
    const { origen, destino } = leerMeses();
    if (!(origen.anio > 1999 && destino.anio > 1999)) { $('dm-cuerpo').innerHTML = '<div class="dm-res err">Indicá el año de origen y de destino.</div>'; return; }
    if (origen.anio === destino.anio && origen.mes === destino.mes) { $('dm-cuerpo').innerHTML = '<div class="dm-res err">El origen y el destino tienen que ser meses distintos.</div>'; return; }
    st.preparando = true; $('dm-preparar').disabled = true;
    try {
      if (recargar || !st.datos) {
        $('dm-cuerpo').innerHTML = '<p class="dm-sub">Leyendo reservas, bloqueos y preferencias…</p>';
        const a = rangoMes(origen.anio, origen.mes), b = rangoMes(destino.anio, destino.mes);
        const desde = a.ini < b.ini ? a.ini : b.ini, hasta = a.fin > b.fin ? a.fin : b.fin;
        const [reservas, bloqueosRaw, pendientes] = await Promise.all([leerReservas(desde, hasta), leerBloqueos(), leerPendientes().catch(() => [])]);
        st.datos = { reservas, bloqueosRaw, pendientes, pacientes: mapaPacientes(), servicios: mapaServicios(reservas), origen, destino };
      }
      st.ctx = armarCtx(st.datos, st.decisiones, origen, destino);
      st.res = prepararCopia(st.ctx);
      st.origenMes = origen; st.destinoMes = destino;
      pintar();
    } catch (e) {
      console.error('duplicar mes: preparar', e);
      $('dm-cuerpo').innerHTML = `<div class="dm-res err">No se pudo preparar la vista previa: ${E(e && e.message || e)}</div>`;
    } finally { st.preparando = false; $('dm-preparar').disabled = false; }
  }

  // ── vista previa ───────────────────────────────────────────────────────
  const motivosHtml = (it) => [...it.motivos.map((m) => `<span class="dm-mot">⛔ ${E(m.texto)}</span>`), ...it.advertencias.map((a) => `<span class="dm-adv">⚠ ${E(a.texto)}</span>`)].join('');
  const origenTxt = (it) => (it.origen && it.origen.tipo === 'pauta' && !it.origen.espejo ? 'Generado desde pauta semanal' : `Origen: reserva del ${it.origen && it.origen.espejo ? fechaEspejo(it.origen.espejo) : 'mes de origen'}`);
  function fechaEspejo(id) { const r = (st.datos.reservas || []).find((x) => x.id === id); return r ? `${r.fecha.split('-').reverse().join('/')} ${r.hora}` : 'mes de origen'; }
  function filaItem(it) {
    const est = { crear: 'Se creará', ya_cubierta: 'Ya cubierta', pendiente: 'Pendiente', fuera_cupo: 'Fuera del cupo' }[it.estado];
    const consultar = it.estado === 'pendiente' ? `<label class="dm-orig"><input type="checkbox" data-dm-consultar="${E(it.clave)}" ${it.estadoManual === 'pendiente_consultar' ? 'checked' : ''}> Pendiente de consultar</label>` : '';
    return `<div class="dm-fila"><div><b>${E(fechaLarga(it.fecha))}</b> · ${E(it.hora)}–${E(finHora(it.hora, it.dur))} · ${E(boxLabel(it.boxId))} · ${E(CAT_TXT[it.categoria] || it.categoria)}${it.yaRegistrado ? ' · ya estaba en pendientes' : ''}<span class="dm-est ${it.estado}">${est}</span></div>
      <div class="dm-orig">${E(it.paciente)} · ${E(it.servicio)} · ${it.dur} min · ${E(origenTxt(it))}${it.reservaExistente ? ` · reserva existente ${E(it.reservaExistente)}` : ''}</div>${motivosHtml(it)}${consultar}</div>`;
  }
  function pintar() {
    const r = st.res, s = r.resumen;
    const chip = (t, n, c = '') => `<span class="dm-chip ${c}"><b>${n}</b> ${t}</span>`;
    const resumen = `<div class="dm-chips">${chip('turnos se crearán', s.crear)}${chip('ya cubren una ocurrencia', s.yaCubiertas)}${chip('pendientes de reagendar', s.pendientes, s.pendientes ? 'bad' : '')}${chip('fuera del cupo', s.fueraCupo, s.fueraCupo ? 'warn' : '')}${chip('patrones por definir', s.porDefinir, s.porDefinir ? 'warn' : '')}${chip('con sesiones sin fecha', s.deficits, s.deficits ? 'warn' : '')}</div>`;
    // por definir
    let definir = '';
    if (r.porDefinir.length) {
      const hayFrec = r.porDefinir.some((p) => p.tipo === 'definir_frecuencia' && p.opciones.length);
      definir = `<details class="dm-sec" open><summary>Patrones que necesitan aclaración (${r.porDefinir.length})</summary>
        ${hayFrec ? `<div class="dm-fila"><label>Las frecuencias "cada N días" se interpretan como
          <select id="dm-cadan" class="dm-in"><option value="">— elegir —</option><option value="dias_exactos" ${st.decisiones.global.cadaNDias === 'dias_exactos' ? 'selected' : ''}>N días exactos desde la última fecha</option><option value="semanas_alternas" ${st.decisiones.global.cadaNDias === 'semanas_alternas' ? 'selected' : ''}>semanas alternas (mismo día de la semana)</option></select></label></div>` : ''}
        ${r.porDefinir.map((p) => `<div class="dm-fila"><div><b>${E(p.paciente)}</b> · ${E(CAT_TXT[p.categoria])} <span class="dm-est fuera_cupo">${p.tipo === 'definir_frecuencia' ? 'Definir frecuencia' : 'Continuidad por definir'}</span></div><div class="dm-orig">${E(p.texto)}</div>
          ${p.tipo === 'continuidad_por_definir' ? `<label class="dm-orig">Esta cita es <select class="dm-in" data-dm-cont="${E(p.patronKey)}"><option value="">— elegir —</option><option value="habitual">habitual (se repite cada semana)</option><option value="puntual">puntual (no continúa)</option></select></label>` : ''}</div>`).join('')}
        </details>`;
    }
    const deficits = r.deficits.length ? `<details class="dm-sec" open><summary>Sesiones sin fecha definida (${r.deficits.length})</summary>${r.deficits.map((d) => `<div class="dm-fila"><b>${E(d.paciente)}</b> · ${E(CAT_TXT[d.categoria])}<span class="dm-orig">${E(d.texto)}</span></div>`).join('')}</details>` : '';
    // revisión
    const grupos = new Map();
    const clave = (it) => st.agrupar === 'fecha' ? it.fecha : st.agrupar === 'box' ? boxLabel(it.boxId) : `${it.paciente} · ${it.dni}`;
    r.items.forEach((it) => { const k = clave(it); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(it); });
    const orden = [...grupos.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    const revision = `<div class="dm-form"><label>Revisar por <select id="dm-agrupar" class="dm-in"><option value="paciente" ${st.agrupar === 'paciente' ? 'selected' : ''}>Paciente</option><option value="fecha" ${st.agrupar === 'fecha' ? 'selected' : ''}>Fecha</option><option value="box" ${st.agrupar === 'box' ? 'selected' : ''}>Box</option></select></label>
      <button type="button" class="dm-btn" id="dm-recalcular">Recalcular</button></div>
      ${orden.map((k) => { const its = grupos.get(k).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)); const nP = its.filter((i) => i.estado === 'pendiente').length;
        return `<details class="dm-sec" ${nP ? 'open' : ''}><summary>${E(st.agrupar === 'fecha' ? fechaLarga(k) : k)} — ${its.length} ocurrencia${its.length === 1 ? '' : 's'}${nP ? ` · <span class="dm-mot">${nP} pendiente${nP === 1 ? '' : 's'}</span>` : ''}</summary>${its.map(filaItem).join('')}</details>`; }).join('') || '<p class="dm-sub">No hay ocurrencias para el destino con los datos actuales.</p>'}`;
    // origen explicado
    const porCat = {};
    r.origenExplicado.forEach((o) => { (porCat[o.categoria] = porCat[o.categoria] || []).push(o); });
    const origen = `<details class="dm-sec"><summary>Reservas de origen explicadas (${r.origenExplicado.length})</summary>${Object.keys(porCat).map((c) => `<div class="dm-fila"><b>${E(CATEGORIAS_ORIGEN[c] || c)} (${porCat[c].length})</b>${porCat[c].map((o) => `<span class="dm-orig">${E(o.paciente)} · ${E(o.fecha.split('-').reverse().join('/'))} ${E(o.hora)} · ${E(o.servicio)} — ${E(o.texto)}</span>`).join('')}</div>`).join('')}</details>`;
    const notas = r.patrones.filter((p) => p.nota).map((p) => `<div class="dm-fila"><b>${E(p.paciente)}</b> · ${E(CAT_TXT[p.categoria])}<span class="dm-orig">${E(p.nota)}</span></div>`).join('');
    const sinBloqDepi = !st.ctx.bloqueos.some((b) => b.protegido && b.fecha.startsWith(st.ctx.mesDestino));
    const avisoDepi = sinBloqDepi ? `<div class="dm-sec"><span class="dm-adv">⚠ No hay bloqueos de depilación (box 2) guardados para ${E(mesTxt(st.destinoMes))}. Si corresponden, cargalos primero en la gestión de bloqueos de la grilla (marcados como depilación); esta función no supone fechas.</span></div>` : '';
    const boton = `<div class="dm-acc"><button type="button" class="dm-btn dm-btn-p" id="dm-crear" ${(s.crear === 0 && s.guardarPendientes === 0) || st.ejecutando ? 'disabled' : ''}>${E(s.etiquetaBoton)}</button></div>`;
    $('dm-cuerpo').innerHTML = `<h3 style="margin:14px 0 0;font-size:15px">Vista previa: ${E(mesTxt(st.origenMes))} → ${E(mesTxt(st.destinoMes))}</h3>${resumen}${avisoDepi}${definir}${deficits}${notas ? `<details class="dm-sec"><summary>Notas de los patrones</summary>${notas}</details>` : ''}${revision}${origen}${boton}<div id="dm-resultado"></div>`;
  }
  function onCambioCuerpo(e) {
    const t = e.target;
    if (t.id === 'dm-cadan') { st.decisiones.global.cadaNDias = t.value || undefined; preparar({ recargar: false }); }
    else if (t.dataset.dmCont !== undefined) { if (t.value) { st.decisiones.patrones[t.dataset.dmCont] = { ...(st.decisiones.patrones[t.dataset.dmCont] || {}), continuidad: t.value }; preparar({ recargar: false }); } }
    else if (t.id === 'dm-agrupar') { st.agrupar = t.value; pintar(); }
    else if (t.dataset.dmConsultar !== undefined) {
      const k = t.dataset.dmConsultar;
      st.decisiones.items[k] = { ...(st.decisiones.items[k] || {}), estadoManual: t.checked ? 'pendiente_consultar' : undefined };
      preparar({ recargar: false });
    }
  }
  function onClickCuerpo(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'dm-recalcular') preparar({ recargar: true });
    else if (b.id === 'dm-crear') ejecutar();
  }

  // ── guardado ───────────────────────────────────────────────────────────
  function docReserva(it, pac, loteId, extraDup) {
    const nombre = (pac && pac.fullName) || it.paciente;
    const b = deps.boxes.find((x) => x.id === it.boxId);
    return {
      cliente: nombre, clienteNombre: nombre, nombre, title: nombre, displayName: nombre,
      phone: (pac && pac.phone) || null, telefono: (pac && pac.phone) || null, dni: it.dni,
      servicio: it.servicio, fecha: it.fecha, hora: it.hora, origen: 'normal', status: 'confirmado', estado: 'confirmado', reminderSent: false,
      duracionMinutos: it.dur, timestamp: serverTimestamp(), creadoPor: 'admin_duplicar_mes',
      boxes: deps.inferirBoxes(it.servicio), box: it.boxId || null, boxLabel: b ? b.label : null,
      duplicacion: { loteId, ocurrenciaKey: it.clave, patronKey: it.patronKey, origenTipo: it.origen && it.origen.tipo, origenRefs: (it.origen && it.origen.refs) || [], ...extraDup },
    };
  }
  // Crea la reserva (y los bloqueos de slot que la acompañan, igual que el alta manual)
  // solo si todavía no existe. Devuelve 'creada' | 'ya_existia'.
  async function crearReserva(it, pac, loteId, { alCrear, extraDup } = {}) {
    const ref = doc(db, 'reservas', it.idReserva);
    const baseId = `reserva_admin_${it.fecha}_${it.hora.replace(':', '-')}`;
    const exts = [];
    for (let m = horaAMin(it.hora) + 30; m < horaAMin(it.hora) + it.dur && m < 24 * 60; m += 30) exts.push({ hora: minAHora(m), id: `ext_${it.fecha}_${minAHora(m).replace(':', 'h')}` });
    let resultado = 'creada';
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const baseSnap = await tx.get(doc(db, 'calendarExceptions', baseId));
      const extSnaps = [];
      for (const x of exts) extSnaps.push(await tx.get(doc(db, 'calendarExceptions', x.id)));
      const pSnap = alCrear && alCrear.pendienteRef ? await tx.get(alCrear.pendienteRef) : null;
      if (snap.exists()) { resultado = 'ya_existia'; return; }
      tx.set(ref, docReserva(it, pac, loteId, extraDup));
      if (!baseSnap.exists()) tx.set(doc(db, 'calendarExceptions', baseId), { fecha: it.fecha, hora: it.hora, blocked: true, tipo: 'reserva', reservaId: it.idReserva, boxes: deps.inferirBoxes(it.servicio), updatedAt: serverTimestamp() });
      exts.forEach((x, i) => { if (!extSnaps[i].exists()) tx.set(doc(db, 'calendarExceptions', x.id), { fecha: it.fecha, hora: x.hora, blocked: true, tipo: 'extension', reservaId: it.idReserva }); });
      if (pSnap && alCrear.pendienteRef && pSnap.exists() && pSnap.data().estado !== 'resuelto') {
        tx.update(alCrear.pendienteRef, { estado: 'resuelto', reservaId: it.idReserva, resueltoAt: serverTimestamp(), resolucion: alCrear.resolucion || { via: 'duplicar_mes', fecha: it.fecha, hora: it.hora, boxId: it.boxId } });
      }
    });
    return resultado;
  }
  const idPend = (kind, clave) => `pd_${idReservaDe(`${kind}|${clave}`).slice(3)}`;
  async function guardarPendiente(p, loteId) {
    const ref = doc(db, COLECCION_PEND, p.id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const d = snap.data();
        if (d.estado === 'resuelto') return; // nunca se reabre
        tx.set(ref, { ...p.datos, estado: d.estado || p.datos.estado, loteId: d.loteId || loteId, actualizadoAt: serverTimestamp() }, { merge: true });
        return;
      }
      tx.set(ref, { ...p.datos, loteId, creadoAt: serverTimestamp(), actualizadoAt: serverTimestamp() });
    });
  }
  function descargar(nombre, objeto) {
    try {
      const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (_) { /* el respaldo también queda en el registro del lote */ }
  }

  async function ejecutar() {
    if (st.ejecutando || !st.res) return;
    const previa = st.res;
    if (!(await confirmarUI({ titulo: `${previa.resumen.etiquetaBoton}?`, texto: `Se crean reservas reales en ${mesTxt(st.destinoMes)}. Antes se descarga un respaldo. Los bloqueos no se modifican.`, aceptar: 'Sí, crear', cancelar: 'Volver' }))) return;
    st.ejecutando = true; $('dm-crear').disabled = true; $('dm-preparar').disabled = true;
    const out = $('dm-resultado');
    out.innerHTML = '<div class="dm-res">Revalidando con los datos actuales…</div>';
    const email = (deps.auth.currentUser && deps.auth.currentUser.email) || null;
    const loteId = `dm_${st.ctx.mesDestino}_${Date.now().toString(36)}`;
    const resultado = { creadas: [], yaExistian: [], pasoAPendiente: [], pendientesGuardados: 0, errores: [], verificadas: 0 };
    try {
      // 1) datos frescos + misma validación que en la vista previa
      const { origen, destino } = { origen: st.origenMes, destino: st.destinoMes };
      const a = rangoMes(origen.anio, origen.mes), b = rangoMes(destino.anio, destino.mes);
      const [reservas, bloqueosRaw, pendientes] = await Promise.all([leerReservas(a.ini < b.ini ? a.ini : b.ini, a.fin > b.fin ? a.fin : b.fin), leerBloqueos(), leerPendientes().catch(() => [])]);
      const fresco = { reservas, bloqueosRaw, pendientes, pacientes: st.datos.pacientes, servicios: mapaServicios(reservas), origen, destino };
      const ctxF = armarCtx(fresco, st.decisiones, origen, destino);
      const resF = prepararCopia(ctxF);
      const clavesPrevia = new Set(previa.items.map((i) => i.clave));
      const itemsF = resF.items.filter((i) => clavesPrevia.has(i.clave));
      const aCrear = itemsF.filter((i) => i.estado === 'crear');
      const aPend = itemsF.filter((i) => i.estado === 'pendiente' && !i.yaRegistrado);
      previa.items.filter((i) => i.estado === 'crear').forEach((i) => { const f = itemsF.find((x) => x.clave === i.clave); if (f && f.estado === 'pendiente') resultado.pasoAPendiente.push(f); });
      // 2) respaldo y registro del lote ANTES de escribir reservas
      const plan = { loteId, origen, destino, administrador: email, fecha: new Date().toISOString(), decisiones: st.decisiones, resumenPrevio: previa.resumen, resumenFinal: resF.resumen,
        aCrear: aCrear.map((i) => ({ clave: i.clave, id: i.idReserva, dni: i.dni, fecha: i.fecha, hora: i.hora, boxId: i.boxId, servicio: i.servicio })),
        aPendiente: aPend.map((i) => ({ clave: i.clave, dni: i.dni, fecha: i.fecha, hora: i.hora, boxId: i.boxId, motivos: i.motivos.map((m) => m.codigo) })),
        bloqueosLeidos: ctxF.bloqueos.filter((x) => x.fecha.startsWith(ctxF.mesDestino)).map((x) => ({ id: x.id, tipo: x.tipo, fecha: x.fecha, boxId: x.boxId, protegido: !!x.protegido })) };
      descargar(`respaldo-duplicar-mes-${loteId}.json`, plan);
      await setDoc(doc(db, COLECCION_LOTES, loteId), { ...JSON.parse(JSON.stringify(plan)), estado: 'en_curso', creadoAt: serverTimestamp() });
      // 3) reservas, una por una, cada una atómica y sin duplicar
      out.innerHTML = `<div class="dm-res">Guardando ${aCrear.length} turno(s)…</div>`;
      for (const it of aCrear) {
        try {
          const r = await crearReserva(it, st.datos.pacientes[it.dni], loteId, { alCrear: { pendienteRef: doc(db, COLECCION_PEND, idPend('ocurrencia', it.clave)) } });
          (r === 'creada' ? resultado.creadas : resultado.yaExistian).push(it);
        } catch (e) { console.error('duplicar mes: crear', it.clave, e); resultado.errores.push({ clave: it.clave, paciente: it.paciente, fecha: it.fecha, error: (e && e.message) || String(e) }); }
      }
      // 4) pendientes persistentes
      const pendDocs = [];
      const base = (i) => ({ dni: i.dni, paciente: i.paciente, categoria: i.categoria, servicio: i.servicio, dur: i.dur, fecha: i.fecha, hora: i.hora, boxId: i.boxId, patronKey: i.patronKey, mesDestino: ctxF.mesDestino, origen: { tipo: i.origen.tipo, refs: i.origen.refs || [], espejo: i.origen.espejo || null, texto: i.origen.tipo === 'pauta' && !i.origen.espejo ? 'Generado desde pauta semanal' : 'Reserva de septiembre' }, frecuencia: i.frecuencia || '' });
      aPend.concat(resultado.pasoAPendiente.filter((x) => !aPend.includes(x))).forEach((i) => pendDocs.push({ id: idPend('ocurrencia', i.clave), datos: { ...base(i), kind: 'ocurrencia', clave: i.clave, estado: i.estadoManual === 'pendiente_consultar' ? 'pendiente_consultar' : 'pendiente', motivos: i.motivos, advertencias: i.advertencias } }));
      resF.porDefinir.forEach((p) => pendDocs.push({ id: idPend('por_definir', `${p.patronKey}|${ctxF.mesDestino}|${p.tipo}`), datos: { kind: 'pauta_por_definir', clave: `${p.patronKey}|${ctxF.mesDestino}|${p.tipo}`, dni: p.dni, paciente: p.paciente, categoria: p.categoria, patronKey: p.patronKey, mesDestino: ctxF.mesDestino, estado: 'pendiente', motivos: [{ codigo: p.tipo, texto: p.texto }], evidencias: p.evidencias, frecuencia: p.frecuencia } }));
      resF.deficits.forEach((d) => pendDocs.push({ id: idPend('deficit', `${d.patronKey}|${ctxF.mesDestino}`), datos: { kind: 'deficit', clave: `${d.patronKey}|${ctxF.mesDestino}|deficit`, dni: d.dni, paciente: d.paciente, categoria: d.categoria, patronKey: d.patronKey, mesDestino: ctxF.mesDestino, estado: 'pendiente', faltan: d.faltan, motivos: [{ codigo: 'deficit', texto: d.texto }] } }));
      for (const p of pendDocs) {
        try { await guardarPendiente(p, loteId); resultado.pendientesGuardados++; } catch (e) { console.error('duplicar mes: pendiente', p.id, e); resultado.errores.push({ clave: p.datos.clave, paciente: p.datos.paciente, error: (e && e.message) || String(e) }); }
      }
      // 5) releer lo persistido
      for (const it of [...resultado.creadas, ...resultado.yaExistian]) {
        try { const s = await getDoc(doc(db, 'reservas', it.idReserva)); const d = s.exists() ? s.data() : null; if (d && d.fecha === it.fecha && d.hora === it.hora && d.dni === it.dni && d.box === it.boxId) resultado.verificadas++; } catch (_) { /* cuenta como no verificada */ }
      }
      const completo = !resultado.errores.length && resultado.verificadas === resultado.creadas.length + resultado.yaExistian.length;
      await setDoc(doc(db, COLECCION_LOTES, loteId), { estado: completo ? 'completo' : 'parcial', terminadoAt: serverTimestamp(), resultado: { creadas: resultado.creadas.map((i) => i.idReserva), yaExistian: resultado.yaExistian.map((i) => i.idReserva), pendientesGuardados: resultado.pendientesGuardados, errores: resultado.errores, verificadas: resultado.verificadas } }, { merge: true }).catch(() => {});
      mostrarResultado(out, resultado, completo, loteId);
      contarPendientes();
      window.dispatchEvent(new CustomEvent('dm-lote-terminado'));
    } catch (e) {
      console.error('duplicar mes: ejecutar', e);
      const permiso = /permission|insufficient/i.test(String(e && (e.code || e.message)));
      out.innerHTML = `<div class="dm-res err"><b>No se pudo completar.</b> ${permiso ? 'Falta permiso de escritura en las colecciones del lote (hay que desplegar las reglas de Firestore). ' : ''}${E(e && e.message || e)}<br>Guardado hasta ahora: ${resultado.creadas.length} turno(s) y ${resultado.pendientesGuardados} pendiente(s). Podés volver a pulsar el botón: no se duplica nada.</div>`;
    } finally { st.ejecutando = false; $('dm-preparar').disabled = false; const c = $('dm-crear'); if (c) c.disabled = false; }
  }
  function mostrarResultado(out, r, completo, loteId) {
    const lista = (arr, f) => arr.length ? `<ul style="margin:4px 0 0 18px">${arr.map(f).join('')}</ul>` : '';
    out.innerHTML = `<div class="dm-res ${completo ? '' : 'err'}"><b>${completo ? 'Listo: lo guardado fue releído y coincide.' : 'Guardado parcial: revisá lo siguiente.'}</b>
      <div>Turnos creados: <b>${r.creadas.length}</b> · ya existían: <b>${r.yaExistian.length}</b> · verificados en la base: <b>${r.verificadas}</b> · pendientes guardados: <b>${r.pendientesGuardados}</b></div>
      ${r.pasoAPendiente.length ? `<div>Cambiaron desde la vista previa y quedaron como pendientes (${r.pasoAPendiente.length}):${lista(r.pasoAPendiente, (i) => `<li>${E(i.paciente)} · ${E(fechaLarga(i.fecha))} ${E(i.hora)} — ${E(i.motivos.map((m) => m.texto).join(' '))}</li>`)}</div>` : ''}
      ${r.errores.length ? `<div>Errores (${r.errores.length}): ${lista(r.errores, (e) => `<li>${E(e.paciente || e.clave)} ${E(e.fecha || '')}: ${E(e.error)}</li>`)}<div>Podés volver a pulsar el botón: solo se reintenta lo que falta.</div></div>` : ''}
      <div class="dm-orig">Lote ${E(loteId)} registrado. Se descargó un respaldo del plan.</div></div>`;
  }

  // ── pendientes de reagendar ────────────────────────────────────────────
  async function contarPendientes() {
    try {
      const docs = await leerPendientes();
      pend.docs = docs; pend.cargado = true;
      const n = docs.filter((d) => d.estado === 'pendiente' || d.estado === 'pendiente_consultar').length;
      document.querySelectorAll('.dm-badge-pend').forEach((el) => { el.textContent = n ? String(n) : ''; el.style.display = n ? '' : 'none'; });
    } catch (_) { /* sin permiso o sin conexión: el contador queda oculto */ }
  }
  const motivosDe = (p) => (p.motivos || []).map((m) => m.texto).join(' ');
  async function pendientesCargar() {
    const cont = $('dm-pend-cuerpo'); if (!cont) return;
    cont.innerHTML = '<p class="dm-sub">Cargando…</p>';
    await contarPendientes();
    pintarPendientes();
  }
  function pintarPendientes() {
    const cont = $('dm-pend-cuerpo'); if (!cont) return;
    const f = pend.filtros;
    const abiertos = (p) => p.estado === 'pendiente' || p.estado === 'pendiente_consultar';
    const codigos = [...new Set(pend.docs.flatMap((p) => (p.motivos || []).map((m) => m.codigo)))];
    let lista = pend.docs.filter((p) => f.estado === 'todos' ? true : f.estado === 'abiertos' ? abiertos(p) : p.estado === f.estado);
    if (f.texto) { const t = f.texto.toLowerCase(); lista = lista.filter((p) => `${p.paciente} ${p.dni}`.toLowerCase().includes(t)); }
    if (f.motivo) lista = lista.filter((p) => (p.motivos || []).some((m) => m.codigo === f.motivo));
    if (f.categoria) lista = lista.filter((p) => p.categoria === f.categoria);
    if (f.box) lista = lista.filter((p) => p.boxId === f.box);
    const concretos = lista.filter((p) => p.kind === 'ocurrencia');
    const porDefinir = lista.filter((p) => p.kind !== 'ocurrencia');
    const porFecha = new Map();
    concretos.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)).forEach((p) => { if (!porFecha.has(p.fecha)) porFecha.set(p.fecha, []); porFecha.get(p.fecha).push(p); });
    const filtros = `<div class="dmp-filtros">
      <select class="dm-in" data-dmp-f="estado" aria-label="Estado"><option value="abiertos" ${f.estado === 'abiertos' ? 'selected' : ''}>Abiertos</option><option value="pendiente" ${f.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option><option value="pendiente_consultar" ${f.estado === 'pendiente_consultar' ? 'selected' : ''}>Pendiente de consultar</option><option value="resuelto" ${f.estado === 'resuelto' ? 'selected' : ''}>Resueltos</option><option value="todos" ${f.estado === 'todos' ? 'selected' : ''}>Todos</option></select>
      <input class="dm-in" data-dmp-f="texto" placeholder="Paciente" value="${E(f.texto)}" aria-label="Filtrar por paciente">
      <select class="dm-in" data-dmp-f="motivo" aria-label="Motivo"><option value="">Todos los motivos</option>${codigos.map((c) => `<option value="${E(c)}" ${f.motivo === c ? 'selected' : ''}>${E(MOTIVO_TXT[c] || c)}</option>`).join('')}</select>
      <select class="dm-in" data-dmp-f="categoria" aria-label="Tratamiento"><option value="">Todos los tratamientos</option>${Object.entries(CAT_TXT).map(([k, v]) => `<option value="${k}" ${f.categoria === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select class="dm-in" data-dmp-f="box" aria-label="Box"><option value="">Todos los boxes</option>${deps.boxes.map((b) => `<option value="${b.id}" ${f.box === b.id ? 'selected' : ''}>${E(b.label)}</option>`).join('')}</select></div>`;
    const item = (p) => `<div class="dmp-item ${p.estado === 'resuelto' ? 'resuelto' : ''}" data-dmp-id="${E(p.id)}">
      <div><b>${E(p.paciente)}</b> · ${E(fechaLarga(p.fecha))} · ${E(p.hora)}–${E(finHora(p.hora, p.dur))} · ${E(boxLabel(p.boxId))} · ${E(CAT_TXT[p.categoria] || p.categoria)} · ${p.dur} min <span class="dm-est ${p.estado === 'resuelto' ? 'crear' : 'pendiente'}">${p.estado === 'resuelto' ? 'Resuelto' : p.estado === 'pendiente_consultar' ? 'Pendiente de consultar' : 'Pendiente'}</span></div>
      ${(p.motivos || []).map((m) => `<span class="dm-mot">Motivo: ${E(m.texto)}</span>`).join('')}
      <span class="dm-orig">Origen: ${E((p.origen && p.origen.texto) || '—')}${p.origen && p.origen.espejo ? ` · reserva ${E(p.origen.espejo)}` : ''} · ref. paciente ${E(p.dni)}</span>
      ${p.estado === 'resuelto' && p.resolucion ? `<span class="dm-orig">Reagendado: ${E(fechaLarga(p.resolucion.fecha))} ${E(p.resolucion.hora)} · ${E(boxLabel(p.resolucion.boxId))}</span>` : ''}
      ${p.estado !== 'resuelto' ? `<div class="dm-acc"><button type="button" class="dm-btn dm-btn-p" data-dmp-alt="${E(p.id)}">Ver alternativas / Reagendar</button><button type="button" class="dm-btn" data-dmp-consultar="${E(p.id)}">${p.estado === 'pendiente_consultar' ? 'Quitar "pendiente de consultar"' : 'Pendiente de consultar'}</button></div>` : ''}</div>`;
    const grupoDef = porDefinir.length ? `<div class="dmp-grupo-t">Pauta por definir (${porDefinir.length})</div>${porDefinir.map((p) => `<div class="dmp-item ${p.estado === 'resuelto' ? 'resuelto' : ''}"><div><b>${E(p.paciente)}</b> · ${E(CAT_TXT[p.categoria] || p.categoria)} <span class="dm-est fuera_cupo">${p.kind === 'deficit' ? 'Sesiones sin fecha' : 'Pauta por definir'}</span></div>${(p.motivos || []).map((m) => `<span class="dm-mot">${E(m.texto)}</span>`).join('')}<span class="dm-orig">Ref. paciente ${E(p.dni)} · Se resuelve volviendo a preparar la duplicación de ${E(p.mesDestino || '')} (Duplicar mes) o completando el perfil.</span>${p.estado !== 'resuelto' ? `<div class="dm-acc"><button type="button" class="dm-btn" data-dmp-cerrar="${E(p.id)}">Marcar como resuelto</button></div>` : ''}</div>`).join('')}` : '';
    cont.innerHTML = `${filtros}<p class="dm-sub">${concretos.length} ocurrencia${concretos.length === 1 ? '' : 's'} · ${porDefinir.length} por definir</p>
      ${[...porFecha.keys()].map((fe) => `<div class="dmp-grupo-t">${E(fechaLarga(fe))}</div>${porFecha.get(fe).map(item).join('')}`).join('') || (porDefinir.length ? '' : '<p class="dm-sub">No hay pendientes con esos filtros.</p>')}${grupoDef}`;
  }
  async function cambiarEstadoPend(id, estado) {
    try { await runTransaction(db, async (tx) => { const ref = doc(db, COLECCION_PEND, id); const s = await tx.get(ref); if (!s.exists() || s.data().estado === 'resuelto') return; tx.update(ref, { estado, actualizadoAt: serverTimestamp() }); }); await pendientesCargar(); }
    catch (e) { mostrarAviso('No se pudo actualizar el pendiente: ' + ((e && e.message) || e)); }
  }
  function conectarPanelPendientes() {
    const cont = $('dm-pend-cuerpo'); if (!cont || cont.dataset.listo) return; cont.dataset.listo = '1';
    cont.addEventListener('input', (e) => { const k = e.target.dataset && e.target.dataset.dmpF; if (k === 'texto') { pend.filtros.texto = e.target.value; pintarPendientes(); const t = cont.querySelector('[data-dmp-f="texto"]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } } });
    cont.addEventListener('change', (e) => { const k = e.target.dataset && e.target.dataset.dmpF; if (k && k !== 'texto') { pend.filtros[k] = e.target.value; pintarPendientes(); } });
    cont.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dmpAlt) abrirReagendar(b.dataset.dmpAlt);
      else if (b.dataset.dmpConsultar) { const p = pend.docs.find((x) => x.id === b.dataset.dmpConsultar); if (p) cambiarEstadoPend(p.id, p.estado === 'pendiente_consultar' ? 'pendiente' : 'pendiente_consultar'); }
      else if (b.dataset.dmpCerrar) cambiarEstadoPend(b.dataset.dmpCerrar, 'resuelto');
    });
  }

  // ── reagendar un pendiente ─────────────────────────────────────────────
  const rg = { p: null, ctx: null, alts: [], autoriza: false };
  function inyectarReag() {
    if ($('dm-reag')) return;
    const ov = document.createElement('div'); ov.id = 'dm-reag'; ov.className = 'dm-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'dm-reag-t');
    ov.innerHTML = '<div class="dm-card"><h2 id="dm-reag-t">Reagendar</h2><div id="dm-reag-cuerpo"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.classList.remove('dm-open'); });
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'dm-reag-cerrar') ov.classList.remove('dm-open');
      else if (b.dataset.rgElegir !== undefined) reagendar(rg.alts[Number(b.dataset.rgElegir)]);
      else if (b.id === 'dm-reag-manual') reagendar({ fecha: $('dm-rg-fecha').value, hora: $('dm-rg-hora').value, boxId: $('dm-rg-box').value, manual: true });
    });
    ov.addEventListener('change', (e) => { if (e.target.id === 'dm-rg-aut') { rg.autoriza = e.target.checked; recalcularAlternativas(); } });
  }
  async function contextoFresco(fecha) {
    const anio = +fecha.slice(0, 4), mes = +fecha.slice(5, 7);
    const r = rangoMes(anio, mes);
    const [reservas, bloqueosRaw] = await Promise.all([leerReservas(r.ini, r.fin), leerBloqueos()]);
    const datos = { reservas, bloqueosRaw, pendientes: [], pacientes: mapaPacientes(), servicios: mapaServicios(reservas) };
    datos.servicios = { ...datos.servicios };
    return armarCtx(datos, { global: {}, patrones: {}, items: {} }, { anio, mes }, { anio, mes });
  }
  async function abrirReagendar(id) {
    inyectarReag();
    const p = pend.docs.find((x) => x.id === id); if (!p) return;
    rg.p = p; rg.autoriza = false;
    $('dm-reag').classList.add('dm-open');
    $('dm-reag-cuerpo').innerHTML = '<p class="dm-sub">Buscando alternativas con los datos actuales…</p>';
    try {
      rg.ctx = await contextoFresco(p.fecha);
      // el servicio del pendiente puede no estar en el mes: completar su info
      if (!rg.ctx.servicios[p.servicio]) { const i = deps.servicioInfo(p.servicio); rg.ctx.servicios[p.servicio] = { duracionMin: i.duracionMin, boxes: i.boxes, categoria: p.categoria }; }
      recalcularAlternativas();
    } catch (e) { $('dm-reag-cuerpo').innerHTML = `<div class="dm-res err">No se pudieron leer los datos: ${E(e && e.message || e)}</div><div class="dm-acc"><button type="button" class="dm-btn" id="dm-reag-cerrar">Cerrar</button></div>`; }
  }
  function itemDe(p) { return { servicio: p.servicio, categoria: p.categoria, dni: p.dni, fecha: p.fecha, hora: p.hora, dur: p.dur, boxId: p.boxId }; }
  function recalcularAlternativas() {
    const p = rg.p;
    rg.alts = buscarAlternativas(rg.ctx, itemDe(p), { max: 8, incluirRestricciones: rg.autoriza });
    const protegido = (p.motivos || []).some((m) => m.codigo === 'bloqueo_depilacion_protegido');
    const necesitaAut = (p.motivos || []).some((m) => m.codigo === 'indisponible' || m.codigo === 'ausente');
    $('dm-reag-cuerpo').innerHTML = `<p class="dm-sub"><b>${E(p.paciente)}</b> · ${E(fechaLarga(p.fecha))} · ${E(p.hora)}–${E(finHora(p.hora, p.dur))} · ${E(boxLabel(p.boxId))} · ${E(CAT_TXT[p.categoria] || p.categoria)}</p>
      ${(p.motivos || []).map((m) => `<span class="dm-mot">Motivo: ${E(m.texto)}</span>`).join('')}
      ${protegido ? '<div class="dm-sec"><span class="dm-adv">Este bloqueo está protegido por depilación: no se puede desbloquear ni acortar, ni siquiera con autorización de la paciente. Se ofrecen solo otros horarios o boxes compatibles.</span></div>' : ''}
      ${necesitaAut || rg.autoriza ? `<div class="dm-sec"><label><input type="checkbox" id="dm-rg-aut" ${rg.autoriza ? 'checked' : ''}> Consulté a la paciente y autorizó esta excepción puntual (no cambia sus preferencias)</label>${rg.autoriza ? '<input class="dm-in" id="dm-rg-nota" placeholder="Nota: cuándo y cómo se consultó (obligatoria)" style="width:100%;margin-top:6px">' : ''}</div>` : ''}
      <div class="dmp-grupo-t">Alternativas disponibles</div>
      ${rg.alts.map((a, i) => `<div class="dm-alt"><div style="flex:1"><b>${E(fechaLarga(a.fecha))}</b> · ${E(a.hora)}–${E(finHora(a.hora, p.dur))} · ${E(boxLabel(a.boxId))}<br><span class="dm-orig">Cambia: ${E(a.cambios.join(', ') || 'nada')}</span>${a.advertencias.map((w) => `<br><span class="dm-adv">⚠ ${E(w.texto)}</span>`).join('')}</div><button type="button" class="dm-btn dm-btn-p" data-rg-elegir="${i}">Reagendar aquí</button></div>`).join('') || '<p class="dm-sub">No hay alternativas compatibles con los datos actuales. El pendiente se conserva.</p>'}
      <div class="dmp-grupo-t">Elegir otro día, hora o box</div>
      <div class="dm-form"><label>Fecha <input class="dm-in" type="date" id="dm-rg-fecha" value="${E(p.fecha)}"></label><label>Hora <input class="dm-in" type="time" id="dm-rg-hora" value="${E(p.hora)}"></label><label>Box <select class="dm-in" id="dm-rg-box">${deps.boxes.map((b) => `<option value="${b.id}" ${b.id === p.boxId ? 'selected' : ''}>${E(b.label)}</option>`).join('')}</select></label><button type="button" class="dm-btn" id="dm-reag-manual">Validar y reagendar</button></div>
      <div id="dm-reag-msg" role="status" aria-live="polite"></div>
      <div class="dm-acc"><button type="button" class="dm-btn" id="dm-reag-cerrar">Cerrar</button></div>`;
  }
  let reagendando = false;
  async function reagendar(sel) {
    if (reagendando || !sel) return; reagendando = true;
    const msg = $('dm-reag-msg') || $('dm-reag-cuerpo');
    const p = rg.p;
    try {
      const nota = ($('dm-rg-nota') && $('dm-rg-nota').value.trim()) || '';
      if (rg.autoriza && !nota) { msg.innerHTML = '<div class="dm-res err">Registrá la nota de la consulta a la paciente antes de asignar la excepción.</div>'; return; }
      if (!(sel.fecha && sel.hora && sel.boxId)) { msg.innerHTML = '<div class="dm-res err">Completá fecha, hora y box.</div>'; return; }
      // la misma validación, con datos recién leídos, en la capa que guarda
      const ctx = await contextoFresco(sel.fecha);
      if (!ctx.servicios[p.servicio]) { const i = deps.servicioInfo(p.servicio); ctx.servicios[p.servicio] = { duracionMin: i.duracionMin, boxes: i.boxes, categoria: p.categoria }; }
      const ev = evaluarOcurrencia(ctx, { fecha: sel.fecha, hora: sel.hora, dur: p.dur, boxId: sel.boxId, dni: p.dni, servicio: p.servicio, categoria: p.categoria, autoriza: rg.autoriza ? { indisponible: true, ausente: true } : undefined });
      if (ev.motivos.length) { msg.innerHTML = `<div class="dm-res err"><b>No se puede reagendar ahí:</b><br>${ev.motivos.map((m) => E(m.texto)).join('<br>')}${tieneBloqueoProtegido(ev.motivos) ? '<br><b>El bloqueo de depilación es inamovible.</b>' : ''}</div>`; return; }
      const clave = claveOcurrencia(p.dni, p.categoria, sel.fecha, sel.hora);
      const it = { clave, idReserva: idReservaDe(`${p.clave || p.id}|reagendado`), dni: p.dni, paciente: p.paciente, categoria: p.categoria, servicio: p.servicio, fecha: sel.fecha, hora: sel.hora, dur: p.dur, boxId: sel.boxId, patronKey: p.patronKey, origen: { tipo: (p.origen && p.origen.tipo) || 'pauta', refs: (p.origen && p.origen.refs) || [] } };
      const email = (deps.auth.currentUser && deps.auth.currentUser.email) || null;
      const resolucion = { via: 'reagendar', fecha: sel.fecha, hora: sel.hora, boxId: sel.boxId, por: email, autorizacion: rg.autoriza ? { consultada: true, nota } : null, cambios: [sel.fecha !== p.fecha && 'día', sel.hora !== p.hora && 'hora', sel.boxId !== p.boxId && 'box'].filter(Boolean) };
      const r = await crearReserva(it, mapaPacientes()[p.dni], p.loteId || 'reagendado', { alCrear: { pendienteRef: doc(db, COLECCION_PEND, p.id), resolucion }, extraDup: { pendienteId: p.id, ocurrenciaOriginal: p.clave || null } });
      // verificar lo persistido y que el pendiente quedó resuelto
      const rs = await getDoc(doc(db, 'reservas', it.idReserva)); const ps = await getDoc(doc(db, COLECCION_PEND, p.id));
      if (rs.exists() && ps.exists() && ps.data().estado === 'resuelto') {
        msg.innerHTML = `<div class="dm-res"><b>Reagendado y verificado.</b> ${E(fechaLarga(sel.fecha))} · ${E(sel.hora)} · ${E(boxLabel(sel.boxId))}${r === 'ya_existia' ? ' (la reserva ya existía; no se duplicó)' : ''}</div>`;
        await pendientesCargar();
      } else msg.innerHTML = '<div class="dm-res err">La reserva se guardó pero no se pudo confirmar el estado del pendiente; volvé a abrir el panel para revisarlo.</div>';
    } catch (e) {
      console.error('reagendar', e);
      msg.innerHTML = `<div class="dm-res err">No se pudo reagendar: ${E(e && e.message || e)}</div>`;
    } finally { reagendando = false; }
  }

  // ── exposición ─────────────────────────────────────────────────────────
  window.dmAbrir = abrir;
  window.dmPendientesCargar = () => { conectarPanelPendientes(); return pendientesCargar(); };
  contarPendientes();
  return { abrir, contarPendientes, _estado: st };
}
