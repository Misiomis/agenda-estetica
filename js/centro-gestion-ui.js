// Centro de Gestión y Consultas — interfaz (un solo menú con pestañas internas).
// La lógica vive en centro-gestion.js; acá solo se lee Firestore, se arma la
// pantalla y se exporta. La única escritura posible es el "estado registrado"
// del paciente (suspendido / finalizado / activo), siempre a pedido explícito,
// en clients/{dni}.seguimiento y conservando el historial.

import {
  construirPacientes, controlAgenda, compararMeses, filtrarPacientes, posiblesDuplicados, resumenDuplicacion,
  estadoEnMes, estadisticas, ordenarFilas, aCSV, nombreMes, nombreMesCap, fechaCorta, sumarMeses, rangoMeses, esMes,
  referenciaPorDefecto, ESTADOS, ESTADOS_FORMALES, ESTADO_TXT, ORDENES, criterioIncorporacion, fechaISO, retomo, esPendiente,
} from './centro-gestion.js';

const COL_LOTES = 'duplicacionesMes';
const COL_PEND = 'pendientesReagendar';
const POR_PAGINA = 50;
const MOTIVO_TXT = { cierre_dia: 'estética cerrada', bloqueo_estetica: 'estética bloqueada', bloqueo_box: 'box bloqueado', bloqueo_depilacion_protegido: 'box reservado para depilación', box_ocupado: 'box ocupado', paciente_ocupado: 'la paciente ya tenía otro turno', box_incompatible: 'box incompatible', fuera_horario: 'fuera de horario', indisponible: 'fuera de su disponibilidad', ausente: 'ausencia registrada' };
const motivoTxt = (m) => MOTIVO_TXT[m] || m;
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

const CSS = `
#sec-centro-gestion .cg-top{display:grid;gap:12px}
.cg-q{width:100%;box-sizing:border-box;padding:13px 16px 13px 42px;border:1.5px solid var(--border-strong);border-radius:14px;font:inherit;font-size:15px;background:var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='none' stroke='%2367806f' stroke-width='1.8'%3E%3Ccircle cx='8' cy='8' r='5.5'/%3E%3Cpath d='m16 16-4-4' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat 14px center;color:var(--ink);outline:none}
.cg-q:focus{border-color:var(--forest);box-shadow:0 0 0 3px rgba(47,90,71,.12)}
.cg-fila{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cg-lbl{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft)}
.cg-sel{padding:7px 10px;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface);font:inherit;font-size:12.5px;color:var(--ink);min-height:34px}
.cg-chips{display:flex;flex-wrap:wrap;gap:6px}
.cg-chip{padding:6px 11px;border-radius:999px;border:1px solid var(--border-strong);background:var(--surface);font:inherit;font-size:12px;font-weight:700;color:var(--ink-soft);cursor:pointer;min-height:30px}
.cg-chip.on{background:var(--forest);border-color:var(--forest);color:#fff}
.cg-chip small{opacity:.7;font-weight:600;margin-left:3px}
.cg-anio{font-size:11px;font-weight:800;color:var(--ink-soft);margin:4px 4px 0 0;align-self:center}
.cg-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--border);margin:16px 0 14px;scrollbar-width:none}
.cg-tabs button{flex:0 0 auto;padding:10px 14px;border:none;background:none;font:inherit;font-size:13px;font-weight:700;color:var(--ink-soft);cursor:pointer;border-bottom:2.5px solid transparent;margin-bottom:-1px}
.cg-tabs button.on{color:var(--forest);border-bottom-color:var(--forest)}
.cg-tabs .cg-badge{display:inline-block;min-width:18px;padding:1px 6px;margin-left:5px;border-radius:9px;background:var(--warning-soft,#fdf0d8);color:#8a5a00;font-size:11px}
.cg-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:0 0 14px}
.cg-kpi{text-align:left;padding:11px 13px;border:1px solid var(--border);border-radius:12px;background:var(--surface);cursor:pointer;font:inherit;color:var(--ink);transition:border-color .15s,box-shadow .15s}
.cg-kpi:hover{border-color:var(--forest);box-shadow:var(--shadow-sm)}
.cg-kpi.on{border-color:var(--forest);box-shadow:0 0 0 2px rgba(47,90,71,.18)}
.cg-kpi b{display:block;font-size:21px;line-height:1.1}
.cg-kpi span{font-size:11.5px;color:var(--ink-soft);font-weight:600}
.cg-kpi.warn b{color:#a5631a}.cg-kpi.bad b{color:#a33b3b}.cg-kpi.ok b{color:var(--forest)}
.cg-kpi.static{cursor:default}
.cg-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin:0 0 10px}
.cg-tabla-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px}
.cg-tabla{width:100%;border-collapse:collapse;font-size:12.5px}
.cg-tabla th{position:sticky;top:0;background:var(--surface-2);text-align:left;padding:8px 10px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-soft);white-space:nowrap}
.cg-tabla td{padding:8px 10px;border-top:1px solid var(--border);vertical-align:top}
.cg-tabla tr.cg-click{cursor:pointer}.cg-tabla tr.cg-click:hover td{background:var(--surface-2)}
.cg-tabla td.num{text-align:right;font-variant-numeric:tabular-nums}
.cg-nom{font-weight:700;color:var(--ink)}
.cg-sub{display:block;font-size:11px;color:var(--ink-soft);font-weight:500}
.cg-est{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}
.cg-est.agendado{background:#e3f3ea;color:#256b48}.cg-est.parcial{background:#fff1d6;color:#8a5a00}.cg-est.sin_agendar{background:#fde5e1;color:#a33b3b}
.cg-est.en_revision{background:#ece9f7;color:#5a4a99}.cg-est.suspendido{background:#e8eef6;color:#355a86}.cg-est.finalizado{background:#eceeed;color:#4a5550}.cg-est.posterior{background:#eceeed;color:#4a5550}
.cg-vacio{padding:26px;text-align:center;color:var(--ink-soft);font-size:13px}
.cg-pag{display:flex;gap:6px;align-items:center;justify-content:center;margin:10px 0 0;font-size:12px;color:var(--ink-soft)}
.cg-adv{border:1px solid var(--border);border-radius:12px;padding:0 14px;margin:0 0 12px;background:var(--surface)}
.cg-adv>summary{cursor:pointer;padding:11px 0;font-weight:800;font-size:12.5px;color:var(--ink);list-style:none}
.cg-adv>summary::-webkit-details-marker{display:none}
.cg-adv>summary::before{content:'▸';display:inline-block;margin-right:6px;transition:transform .15s}
.cg-adv[open]>summary::before{transform:rotate(90deg)}
.cg-adv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;padding:0 0 14px}
.cg-adv-grid>div{display:grid;gap:6px;align-content:start}
.cg-check{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--ink)}
.cg-nota{font-size:12px;color:var(--ink-soft);margin:6px 0 12px;line-height:1.45}
.cg-sec{border:1px solid var(--border);border-radius:12px;margin:0 0 10px;background:var(--surface)}
.cg-sec>summary{cursor:pointer;padding:11px 14px;font-weight:800;font-size:13px;display:flex;justify-content:space-between;gap:8px;list-style:none}
.cg-sec>summary::-webkit-details-marker{display:none}
.cg-sec>div{padding:0 14px 12px}
.cg-modal-bg{position:fixed;inset:0;background:rgba(20,30,25,.42);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow-y:auto}
.cg-modal{background:var(--surface);border-radius:18px;max-width:860px;width:100%;box-shadow:var(--shadow-lg);padding:20px 22px;position:relative}
.cg-modal h3{margin:0 34px 2px 0;font-size:19px}
.cg-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border-radius:50%;border:none;background:var(--surface-2);font-size:18px;cursor:pointer;color:var(--ink)}
.cg-datos{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin:14px 0}
.cg-dato{background:var(--surface-2);border-radius:10px;padding:8px 11px}
.cg-dato span{display:block;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-soft)}
.cg-dato b{font-size:13px}
.cg-estado-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;padding:10px;border:1px dashed var(--border-strong);border-radius:10px}
.cg-exp{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cg-mini{font-size:11.5px;color:var(--ink-soft)}
.cg-subrev{margin:0 0 14px}
.cg-catchips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.cg-catchip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);font:inherit;font-size:12.5px;font-weight:600;color:var(--ink);cursor:pointer;min-height:34px}
.cg-catchip b{font-size:13.5px}
.cg-catchip.bad b{color:#a33b3b}.cg-catchip.warn b{color:#a5631a}.cg-catchip.ok b{color:var(--forest)}
.cg-catchip.on{background:var(--forest);border-color:var(--forest);color:#fff}.cg-catchip.on b{color:#fff}
.cg-ind{margin-top:14px}
@media (max-width:640px){
  .cg-kpis{grid-template-columns:repeat(2,1fr)}
  .cg-tabla .cg-opc{display:none}
  .cg-modal{padding:16px 14px;border-radius:14px}
  .cg-q{font-size:16px}
}
`;

export function initCentroGestion(deps) {
  const { db, F, escapeHtml: E } = deps;
  const st = {
    datos: null, cargando: null, cargadoAt: 0, tab: 'pacientes', cache: new Map(),
    per: { modo: 'todos', meses: new Set(), anio: '', desde: '', hasta: '' },
    q: '', rapido: new Set(), adv: { nuevosEn: new Set(), presentesEn: new Set(), ausentesEn: new Set(), estadoMes: '', estados: new Set(), sinDias: '', servicio: '', box: '', estadoFormal: '', min: '', max: '', dup: false, conFut: false, sinFut: false, fichasSin: false },
    orden: 'nombre', vista: 'resumida', pagina: 0, sel: new Set(), campos: { dni: false, phone: false, todas: false },
    ctrl: { mes: '', ref: null, umbral: 2, cat: 'pendientes' }, cmp: new Set(), loteSel: null, ultimaLista: null, subRev: 'comparar',
  };
  const $ = (id) => document.getElementById(id);
  const hoy = () => deps.hoy();
  const mesActual = () => hoy().slice(0, 7);
  const aviso = (m) => deps.mostrarAviso(m);
  if (!document.getElementById('cg-css')) { const s = document.createElement('style'); s.id = 'cg-css'; s.textContent = CSS; document.head.appendChild(s); }

  // ── Datos ──
  async function cargar(forzar) {
    if (st.datos && !forzar) return st.datos;
    if (st.cargando) return st.cargando;
    st.cargando = (async () => {
      const [reservas, snapC, snapL, snapP] = await Promise.all([
        deps.fetchReservas(),
        F.getDocs(F.collection(db, 'clients')),
        F.getDocs(F.collection(db, COL_LOTES)).catch(() => null),
        F.getDocs(F.collection(db, COL_PEND)).catch(() => null),
      ]);
      const fichas = snapC.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((c) => !c.redirigidoA && deps.esDniValido(c.id))
        .map((c) => ({ dni: c.id, fullName: deps.nombreFicha(c), phone: c.phone || c.telefono || '', createdAt: c.createdAt || c.fechaAlta || null, seguimiento: c.seguimiento || null, planificacion: c.planificacion || null, _clave: deps.claveDni(c.id) }));
      const pacientes = construirPacientes({
        reservas, fichas, hoy: hoy(), ahora: deps.ahora(), claveDe: deps.claveDe, claveFicha: (f) => f._clave,
        esActiva: deps.esActiva, esBloqueo: deps.esBloqueo, boxDe: deps.boxDe,
      });
      const lotes = snapL ? snapL.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))) : null;
      const pendientes = snapP ? snapP.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
      const meses = [...new Set(pacientes.flatMap((p) => p.sesiones.map((s) => s.fecha.slice(0, 7))))].sort();
      const ma = mesActual();
      const desde = meses[0] && meses[0] < ma ? meses[0] : ma;
      const hasta = sumarMeses((meses[meses.length - 1] && meses[meses.length - 1] > ma ? meses[meses.length - 1] : ma), 3);
      const duplicados = posiblesDuplicados(fichas, pacientes);
      st.cache = new Map();
      st.datos = { pacientes, fichas, lotes, pendientes, mesesConDatos: new Set(meses), mesesTodos: rangoMeses(desde, hasta), duplicados, porClave: new Map(pacientes.map((p) => [p.clave, p])),
        servicios: [...new Set(pacientes.flatMap((p) => p.servicios))].sort((a, b) => a.localeCompare(b, 'es')),
        boxes: [...new Set(pacientes.flatMap((p) => p.boxes))].sort() };
      st.cargadoAt = Date.now();
      return st.datos;
    })().finally(() => { st.cargando = null; });
    return st.cargando;
  }
  window.addEventListener('dm-lote-terminado', () => { st.cargadoAt = 0; });

  // ── Período ──
  function periodo() {
    const p = st.per;
    if (p.modo === 'meses' && p.meses.size) return { meses: [...p.meses].sort() };
    if (p.modo === 'anio' && p.anio) return { desde: `${p.anio}-01-01`, hasta: `${p.anio}-12-31` };
    if (p.modo === 'rango' && (p.desde || p.hasta)) return { desde: p.desde, hasta: p.hasta };
    return {};
  }
  function textoPeriodo() {
    const p = st.per;
    if (p.modo === 'meses' && p.meses.size) { const ms = [...p.meses].sort(); return ms.length <= 3 ? ms.map((m) => nombreMes(m)).join(', ') : `${nombreMes(ms[0])} a ${nombreMes(ms[ms.length - 1])} (${ms.length} meses)`; }
    if (p.modo === 'anio' && p.anio) return `año ${p.anio}`;
    if (p.modo === 'rango' && (p.desde || p.hasta)) return `${p.desde ? fechaCorta(p.desde) : '…'} al ${p.hasta ? fechaCorta(p.hasta) : '…'}`;
    return 'todos los períodos';
  }
  const mesesPeriodo = () => { const per = periodo(); if (per.meses) return per.meses; if (per.desde || per.hasta) return st.datos.mesesTodos.filter((m) => (!per.desde || m >= per.desde.slice(0, 7)) && (!per.hasta || m <= per.hasta.slice(0, 7))); return []; };
  // Mes de referencia para "sin agendar" / "ausentes": el último mes del período o el actual.
  const mesFoco = () => { const ms = mesesPeriodo(); return ms.length ? ms[ms.length - 1] : mesActual(); };

  // Selector de meses reutilizable (chips por año).
  function chipsMeses(setSel, accion, { soloConDatos = false } = {}) {
    const d = st.datos;
    const lista = d.mesesTodos.filter((m) => !soloConDatos || d.mesesConDatos.has(m) || m >= mesActual());
    let anio = '';
    return `<div class="cg-chips">${lista.map((m) => { const a = m.slice(0, 4); const cab = a !== anio ? `<span class="cg-anio">${a}</span>` : ''; anio = a; return `${cab}<button type="button" class="cg-chip${setSel.has(m) ? ' on' : ''}" onclick="${accion}('${m}')">${E(nombreMesCap(m, false).slice(0, 3))}${d.mesesConDatos.has(m) ? '' : '<small>·</small>'}</button>`; }).join('')}</div>`;
  }
  const toggleSet = (set, v) => { if (set.has(v)) set.delete(v); else set.add(v); };

  // ── Render general ──
  function marco() {
    const d = st.datos;
    const anios = [...new Set(d.mesesTodos.map((m) => m.slice(0, 4)))];
    const p = st.per;
    const pendCount = controlAgenda(d.pacientes, { mesDestino: st.ctrl.mes || mesActual(), referencia: st.ctrl.ref || undefined, umbral: st.ctrl.umbral }).cats.pendientes.length;
    return `
      <div class="p360-card cg-top">
        <input type="search" id="cg-q" class="cg-q" placeholder="Buscar en todos los meses: nombre, DNI, teléfono, tratamiento, box, fecha (12/11), horario…" value="${E(st.q)}" oninput="cgBuscar(this.value)" aria-label="Buscar pacientes" autocomplete="off">
        <div class="cg-fila">
          <span class="cg-lbl">Período</span>
          <div class="p360-seg" role="group" aria-label="Período">
            ${[['todos', 'Todos'], ['meses', 'Meses'], ['anio', 'Año'], ['rango', 'Rango']].map(([k, t]) => `<button type="button" class="${p.modo === k ? 'activo' : ''}" onclick="cgPerModo('${k}')">${t}</button>`).join('')}
          </div>
          ${p.modo === 'anio' ? `<select class="cg-sel" onchange="cgPerAnio(this.value)">${anios.map((a) => `<option ${a === p.anio ? 'selected' : ''}>${a}</option>`).join('')}</select>` : ''}
          ${p.modo === 'rango' ? `<input type="date" class="cg-sel" value="${E(p.desde)}" onchange="cgPerRango('desde',this.value)" aria-label="Desde"><span class="cg-mini">al</span><input type="date" class="cg-sel" value="${E(p.hasta)}" onchange="cgPerRango('hasta',this.value)" aria-label="Hasta">` : ''}
          <span class="cg-mini" id="cg-per-txt">${E(textoPeriodo())}</span>
        </div>
        ${p.modo === 'meses' ? chipsMeses(p.meses, 'cgPerMes', { soloConDatos: true }) + '<div class="cg-mini">Elegí uno o varios meses (se pueden combinar años). · = mes sin turnos cargados todavía.</div>' : ''}
      </div>
      <nav class="cg-tabs" role="tablist">
        ${[['pacientes', 'Pacientes'], ['control', `Control de agenda${pendCount ? `<span class="cg-badge">${pendCount}</span>` : ''}`], ['revision', `Revisión de datos${d.duplicados.length ? `<span class="cg-badge">${d.duplicados.length}</span>` : ''}`]]
          .map(([k, t]) => `<button type="button" role="tab" class="${st.tab === k ? 'on' : ''}" aria-selected="${st.tab === k}" onclick="cgTab('${k}')">${t}</button>`).join('')}
      </nav>
      <div id="cg-cuerpo"></div>`;
  }
  function render() {
    const raiz = $('cg-raiz');
    if (!raiz || !st.datos) return;
    const foco = document.activeElement && document.activeElement.id === 'cg-q';
    const pos = foco ? document.activeElement.selectionStart : null;
    raiz.innerHTML = marco();
    renderCuerpo();
    if (foco) { const q = $('cg-q'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) { /* */ } }
    const t = $('cg-actualizado'); if (t) t.textContent = 'Datos de ' + new Date(st.cargadoAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  function renderCuerpo() {
    const c = $('cg-cuerpo'); if (!c) return;
    c.innerHTML = ({ pacientes: vistaPacientes, control: vistaControl, revision: vistaRevision }[st.tab] || vistaPacientes)();
  }

  // ── Pestaña: Pacientes ──
  const RAPIDOS = [
    ['nuevos', 'Nuevos del período'], ['sin_agendar', 'Sin agendar'], ['ausentes', 'Ausentes del mes'], ['pendientes', 'Pendientes de revisar'],
    ['suspendidos', 'Suspendidos'], ['sin_futuros', 'Sin turnos futuros'], ['canceladas', 'Canceladas sin reprogramar'], ['retomaron', 'Retomaron'], ['duplicados', 'Posibles duplicados'],
  ];
  function criterios() {
    const a = st.adv, f = { texto: st.q, periodo: periodo(), ordenar: st.orden, umbral: st.ctrl.umbral };
    const foco = mesFoco();
    if (a.nuevosEn.size) f.nuevosEn = [...a.nuevosEn];
    if (a.presentesEn.size) f.presentesEn = [...a.presentesEn];
    if (a.ausentesEn.size) f.ausentesEn = [...a.ausentesEn];
    if (a.estadoMes || a.estados.size) f.estadoMes = { mes: a.estadoMes || foco, estados: [...a.estados] };
    if (Number(a.sinDias) > 0) f.sinSesionesDias = Number(a.sinDias);
    if (a.servicio) f.servicio = a.servicio;
    if (a.box) f.box = a.box;
    if (a.estadoFormal) f.estadoFormal = a.estadoFormal;
    if (a.min !== '') f.minRealizadas = a.min;
    if (a.max !== '') f.maxRealizadas = a.max;
    if (a.dup) f.deDuplicacion = true;
    if (a.conFut) f.conFuturos = true;
    if (a.sinFut) f.sinFuturos = true;
    if (a.fichasSin) f.soloFichasSinTurnos = true;
    const r = st.rapido;
    const ms = mesesPeriodo();
    if (r.has('nuevos')) f.nuevosEn = [...new Set([...(f.nuevosEn || []), ...(ms.length ? ms : [mesActual()])])];
    if (r.has('sin_agendar')) f.estadoMes = { mes: foco, estados: ['sin_agendar'] };
    if (r.has('pendientes')) f.estadoMes = { mes: foco, estados: ['sin_agendar', 'en_revision', 'parcial'] };
    // Ausentes del mes: tuvieron turnos en los 2 meses anteriores y ninguno en el mes.
    if (r.has('ausentes')) { f.ausentesEn = [...new Set([...(f.ausentesEn || []), foco])]; f.periodo = { meses: referenciaPorDefecto(foco, 2) }; }
    if (r.has('suspendidos')) f.estadoFormal = 'suspendido';
    if (r.has('sin_futuros')) f.sinFuturos = true;
    if (r.has('canceladas')) f.canceladasSinReprog = true;
    if (r.has('retomaron')) f.retomaron = true;
    return f;
  }
  function textoCriterios(f) {
    const t = [`Período: ${textoPeriodo()}`];
    if (f.texto) t.push(`búsqueda "${f.texto}"`);
    if (f.nuevosEn) t.push('nuevos de ' + f.nuevosEn.map((m) => nombreMes(m)).join(', '));
    if (f.presentesEn) t.push('con turnos en ' + f.presentesEn.map((m) => nombreMes(m)).join(' y '));
    if (f.ausentesEn) t.push('sin turnos en ' + f.ausentesEn.map((m) => nombreMes(m)).join(' ni '));
    if (f.estadoMes) t.push(`estado en ${nombreMes(f.estadoMes.mes)}: ${f.estadoMes.estados.length ? f.estadoMes.estados.map(ESTADO_TXT).join(' / ') : 'cualquiera'}`);
    if (f.sinSesionesDias) t.push(`sin sesiones hace ${f.sinSesionesDias}+ días`);
    if (f.servicio) t.push('servicio ' + f.servicio);
    if (f.box) t.push(f.box);
    if (f.estadoFormal) t.push('estado registrado: ' + (ESTADOS_FORMALES[f.estadoFormal] || 'sin registrar'));
    if (f.minRealizadas !== undefined) t.push(`≥ ${f.minRealizadas} realizadas`);
    if (f.maxRealizadas !== undefined) t.push(`≤ ${f.maxRealizadas} realizadas`);
    if (f.deDuplicacion) t.push('turnos de una agenda duplicada');
    if (f.conFuturos) t.push('con turnos futuros');
    if (f.sinFuturos) t.push('sin turnos futuros');
    if (f.canceladasSinReprog) t.push('cancelaciones sin reprogramar');
    if (f.retomaron) t.push('retomaron tras una ausencia');
    if (f.soloFichasSinTurnos) t.push('fichas sin ningún turno');
    return t.join(' · ');
  }
  function calcularLista() {
    const f = criterios();
    const filas = filtrarPacientes(st.datos.pacientes, f, { hoy: hoy(), cache: st.cache });
    return { f, filas };
  }
  function vistaPacientes() {
    const d = st.datos;
    const { f, filas } = calcularLista();
    st.ultimaLista = { f, filas };
    const foco = mesFoco();
    const stats = estadisticas(filas, { mes: foco, hoy: hoy(), duplicados: d.duplicados.length });
    const a = st.adv;
    const advActivos = a.nuevosEn.size + a.presentesEn.size + a.ausentesEn.size + a.estados.size + (a.estadoMes ? 1 : 0) + (a.sinDias ? 1 : 0) + (a.servicio ? 1 : 0) + (a.box ? 1 : 0) + (a.estadoFormal ? 1 : 0) + (a.min !== '' ? 1 : 0) + (a.max !== '' ? 1 : 0) + (a.dup ? 1 : 0) + (a.conFut ? 1 : 0) + (a.sinFut ? 1 : 0) + (a.fichasSin ? 1 : 0);
    const kpi = (k, v, t, cls = '', on = false) => `<button type="button" class="cg-kpi ${cls}${on ? ' on' : ''}${k ? '' : ' static'}" ${k ? `onclick="cgRapido('${k}')"` : ''}><b>${v}</b><span>${t}</span></button>`;
    const total = filas.length, pags = Math.max(1, Math.ceil(total / POR_PAGINA));
    if (st.pagina >= pags) st.pagina = pags - 1;
    const pagina = filas.slice(st.pagina * POR_PAGINA, (st.pagina + 1) * POR_PAGINA);
    const completa = st.vista === 'completa';
    const filasHtml = pagina.map((fl) => {
      const p = fl.p, ep = fl.enPeriodo;
      const e = fl.est || estadoEnMes(p, foco, { umbral: st.ctrl.umbral });
      const k = encodeURIComponent(p.clave);
      return `<tr class="cg-click" onclick="cgVer('${k}')">
        <td onclick="event.stopPropagation()"><input type="checkbox" ${st.sel.has(p.clave) ? 'checked' : ''} onchange="cgSel('${k}',this.checked)" aria-label="Seleccionar ${E(p.nombre)}"></td>
        <td><span class="cg-nom">${E(p.nombre)}</span>${p.estadoFormal ? `<span class="cg-sub">${E(ESTADOS_FORMALES[p.estadoFormal.estado])}</span>` : ''}${completa && p.dni ? `<span class="cg-sub">DNI ${E(p.dni)}</span>` : ''}</td>
        <td>${p.incorporacion.mes ? E(nombreMesCap(p.incorporacion.mes)) : '—'}<span class="cg-sub">${E(p.incorporacion.criterio === 'registro' ? 'registro' : p.incorporacion.criterio === 'primera_sesion' ? '1.ª sesión' : '')}</span></td>
        <td class="num">${ep.realizadas}${ep.futuras ? `<span class="cg-sub">+${ep.futuras} futuras</span>` : ''}</td>
        <td>${p.ultimaSesion ? fechaCorta(p.ultimaSesion) : '—'}</td>
        <td class="cg-opc">${p.proxima ? `${fechaCorta(p.proxima.fecha)} ${E(p.proxima.hora)}` : '—'}</td>
        <td><span class="cg-est ${e.estado}" title="${E(e.motivo || '')}">${E(ESTADO_TXT(e.estado))}</span></td>
        ${completa ? `<td class="cg-opc">${E(p.servicios.slice(0, 3).join(', '))}${p.servicios.length > 3 ? '…' : ''}<span class="cg-sub">${E(Object.entries(ep.porBox).map(([b, n]) => `${b}: ${n}`).join(' · '))}</span></td><td class="num cg-opc">${ep.canceladas || ''}</td>` : ''}
      </tr>`;
    }).join('');
    return `
      <div class="cg-chips" style="margin-bottom:10px">${RAPIDOS.map(([k, t]) => `<button type="button" class="cg-chip${st.rapido.has(k) ? ' on' : ''}" onclick="cgRapido('${k}')">${t}</button>`).join('')}</div>
      <div class="cg-bar">
        <div class="cg-fila">
          <select class="cg-sel" onchange="cgOrden(this.value)" aria-label="Ordenar">${Object.entries(ORDENES).map(([k, t]) => `<option value="${k}" ${st.orden === k ? 'selected' : ''}>Ordenar: ${t}</option>`).join('')}</select>
          <div class="p360-seg"><button type="button" class="${st.vista === 'resumida' ? 'activo' : ''}" onclick="cgVista('resumida')">Resumida</button><button type="button" class="${st.vista === 'completa' ? 'activo' : ''}" onclick="cgVista('completa')">Completa</button></div>
          <button type="button" class="p360-btn" onclick="cgLimpiar()">Limpiar filtros</button>
          <button type="button" class="p360-btn" onclick="cgDirectorio()">👥 Directorio</button>
        </div>
        ${barraExport('lista', total)}
      </div>
      <div class="cg-nota">${E(textoCriterios(f))}. Estado calculado para <b>${E(nombreMes(foco))}</b>.</div>
      ${total ? `<div class="cg-tabla-wrap"><table class="cg-tabla"><thead><tr><th><input type="checkbox" onchange="cgSelPagina(this.checked)" aria-label="Seleccionar página"></th><th>Paciente</th><th>Incorporación</th><th>Realizadas</th><th>Última</th><th class="cg-opc">Próximo turno</th><th>Estado</th>${completa ? '<th class="cg-opc">Tratamientos · boxes</th><th class="cg-opc">Canc.</th>' : ''}</tr></thead><tbody>${filasHtml}</tbody></table></div>
      ${pags > 1 ? `<div class="cg-pag"><button class="p360-btn" ${st.pagina ? '' : 'disabled'} onclick="cgPagina(-1)">‹</button> Página ${st.pagina + 1} de ${pags} · ${total} pacientes <button class="p360-btn" ${st.pagina < pags - 1 ? '' : 'disabled'} onclick="cgPagina(1)">›</button></div>` : ''}`
        : '<div class="cg-vacio">Ningún paciente coincide con estos filtros.</div>'}
      <details class="cg-adv cg-ind" ${st.indAbierto ? 'open' : ''} ontoggle="cgInd(this.open)"><summary>Indicadores del listado</summary>
      <div class="cg-kpis">
        ${kpi('', stats.unicos, 'pacientes únicos', 'ok')}
        ${kpi('nuevos', stats.nuevos, 'nuevos de ' + nombreMes(foco, false), '', st.rapido.has('nuevos'))}
        ${kpi('sin_agendar', stats.sinAgendar, 'sin agendar en ' + nombreMes(foco, false), stats.sinAgendar ? 'bad' : '', st.rapido.has('sin_agendar'))}
        ${kpi('sin_futuros', stats.unicos - stats.conTurnos, 'sin turnos futuros', '', st.rapido.has('sin_futuros'))}
        ${kpi('suspendidos', stats.suspendidos, 'suspensión registrada', '', st.rapido.has('suspendidos'))}
        ${kpi('', stats.sinContinuidad, 'sin continuidad (30+ días, sin turno)', stats.sinContinuidad ? 'warn' : '')}
        ${kpi('', stats.programadas, 'sesiones programadas')}
        ${kpi('', stats.realizadas, 'sesiones realizadas')}
        ${kpi('', stats.pendientes, 'sesiones pendientes (futuras)')}
        ${kpi('canceladas', stats.canceladas, 'sesiones canceladas', '', st.rapido.has('canceladas'))}
        ${kpi('duplicados', stats.duplicados, 'posibles duplicados', stats.duplicados ? 'warn' : '')}
      </div>
      </details>
      <details class="cg-adv" ${advActivos ? 'open' : ''} style="margin-top:12px"><summary>Filtros avanzados${advActivos ? ` (${advActivos})` : ''}</summary>
        <div class="cg-adv-grid">
          <div><span class="cg-lbl">Nuevos (incorporados) en</span>${chipsMeses(a.nuevosEn, 'cgAdvMes_nuevosEn', { soloConDatos: true })}</div>
          <div><span class="cg-lbl">Con turnos en (todos estos meses)</span>${chipsMeses(a.presentesEn, 'cgAdvMes_presentesEn', { soloConDatos: true })}</div>
          <div><span class="cg-lbl">Sin turnos en (ninguno de estos meses)</span>${chipsMeses(a.ausentesEn, 'cgAdvMes_ausentesEn', { soloConDatos: true })}</div>
          <div><span class="cg-lbl">Estado de agenda en</span>
            <select class="cg-sel" onchange="cgAdv('estadoMes',this.value)"><option value="">${E(nombreMesCap(mesFoco()))} (mes del período)</option>${d.mesesTodos.map((m) => `<option value="${m}" ${a.estadoMes === m ? 'selected' : ''}>${E(nombreMesCap(m))}</option>`).join('')}</select>
            <div class="cg-chips">${['agendado', 'parcial', 'sin_agendar', 'en_revision', 'suspendido', 'finalizado'].map((k) => `<button type="button" class="cg-chip${a.estados.has(k) ? ' on' : ''}" onclick="cgAdvEstado('${k}')">${E(ESTADOS[k].txt)}</button>`).join('')}</div></div>
          <div><span class="cg-lbl">Continuidad</span>
            <label class="cg-check">Sin sesiones hace al menos <input type="number" min="1" max="999" class="cg-sel" style="width:70px" value="${E(a.sinDias)}" onchange="cgAdv('sinDias',this.value)"> días</label>
            <label class="cg-check"><input type="checkbox" ${a.sinFut ? 'checked' : ''} onchange="cgAdv('sinFut',this.checked)"> Sin turnos futuros</label>
            <label class="cg-check"><input type="checkbox" ${a.conFut ? 'checked' : ''} onchange="cgAdv('conFut',this.checked)"> Con turnos futuros (sesiones pendientes)</label>
            <label class="cg-check"><input type="checkbox" ${a.dup ? 'checked' : ''} onchange="cgAdv('dup',this.checked)"> Con turnos creados al duplicar un mes</label>
            <label class="cg-check"><input type="checkbox" ${a.fichasSin ? 'checked' : ''} onchange="cgAdv('fichasSin',this.checked)"> Fichas registradas sin ningún turno</label></div>
          <div><span class="cg-lbl">Tratamiento, box y estado</span>
            <select class="cg-sel" onchange="cgAdv('servicio',this.value)"><option value="">Todos los tratamientos</option>${d.servicios.map((s) => `<option ${a.servicio === s ? 'selected' : ''}>${E(s)}</option>`).join('')}</select>
            <select class="cg-sel" onchange="cgAdv('box',this.value)"><option value="">Todos los boxes</option>${d.boxes.map((s) => `<option ${a.box === s ? 'selected' : ''}>${E(s)}</option>`).join('')}</select>
            <select class="cg-sel" onchange="cgAdv('estadoFormal',this.value)"><option value="">Cualquier estado registrado</option>${Object.entries(ESTADOS_FORMALES).map(([k, t]) => `<option value="${k}" ${a.estadoFormal === k ? 'selected' : ''}>${E(t)}</option>`).join('')}<option value="ninguno" ${a.estadoFormal === 'ninguno' ? 'selected' : ''}>Sin estado registrado</option></select>
            <label class="cg-check">Realizadas en el período: <input type="number" min="0" class="cg-sel" style="width:62px" placeholder="mín" value="${E(a.min)}" onchange="cgAdv('min',this.value)"> a <input type="number" min="0" class="cg-sel" style="width:62px" placeholder="máx" value="${E(a.max)}" onchange="cgAdv('max',this.value)"></label></div>
        </div>
      </details>`;
  }
  function barraExport(origen, total) {
    const s = st.sel.size;
    return `<div class="cg-exp">
      <span class="cg-mini">${s ? `${s} seleccionado${s === 1 ? '' : 's'} · <a href="#" onclick="cgSelLimpiar();return false">quitar</a> ·` : ''} Exportar ${s && origen === 'lista' ? 'selección' : total + ''}:</span>
      <button class="p360-btn" onclick="cgExportar('${origen}','pdf')">PDF</button>
      <button class="p360-btn" onclick="cgExportar('${origen}','xlsx')">Excel</button>
      <button class="p360-btn" onclick="cgExportar('${origen}','csv')">CSV</button>
      <button class="p360-btn pri" onclick="cgExportar('${origen}','print')">🖨 Imprimir</button>
      <details style="position:relative"><summary class="p360-btn" style="list-style:none">Campos ▾</summary>
        <div style="position:absolute;right:0;z-index:20;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px;box-shadow:var(--shadow-md);min-width:220px;display:grid;gap:6px">
          <label class="cg-check"><input type="checkbox" ${st.campos.todas ? 'checked' : ''} onchange="cgCampo('todas',this.checked)"> Todas las columnas</label>
          <label class="cg-check"><input type="checkbox" ${st.campos.dni ? 'checked' : ''} onchange="cgCampo('dni',this.checked)"> Incluir DNI</label>
          <label class="cg-check"><input type="checkbox" ${st.campos.phone ? 'checked' : ''} onchange="cgCampo('phone',this.checked)"> Incluir teléfono</label>
          <span class="cg-mini">Por defecto los listados no llevan DNI ni teléfono.</span>
        </div></details>
    </div>`;
  }

  // ── Pestaña: Control de agenda ──
  const CATS = [
    ['pendientes', 'Pendientes de agendar o revisar', 'bad'], ['sinAgendar', 'Sin agendar', 'bad'], ['nuevosDestinoSinAgendar', 'Nuevos del mes sin agendar', 'bad'],
    ['enRevision', 'En revisión', 'warn'], ['parciales', 'Parcialmente agendados', 'warn'], ['canceladasSinReprogramar', 'Cancelados sin reprogramar', 'warn'],
    ['anterioresSinTurnos', 'Pacientes anteriores sin turnos', 'warn'], ['conTurnos', 'Con turnos en el mes', 'ok'], ['suspendidos', 'Suspendidos (registrado)', ''],
    ['finalizados', 'Finalizados', ''], ['registradosSinTurnos', 'Fichas sin ningún turno', ''],
  ];
  function controlActual() {
    const d = st.datos;
    if (!st.ctrl.mes) st.ctrl.mes = mesActual();
    const ref = st.ctrl.ref || referenciaPorDefecto(st.ctrl.mes, 2);
    return controlAgenda(d.pacientes, { mesDestino: st.ctrl.mes, referencia: ref, umbral: st.ctrl.umbral });
  }
  function listaCategoria(c, cat) {
    const [tipo, mes] = String(cat).split(':');
    if (tipo === 'nuevos') return c.nuevosPorMes[mes] || [];
    if (tipo === 'ausentes') return c.ausentesPorMes[mes] || [];
    if (tipo === 'nuevosRef') return c.nuevosRefSinAgendar[mes] || [];
    return c.cats[tipo] || [];
  }
  function tituloCategoria(c, cat) {
    const [tipo, mes] = String(cat).split(':');
    const dest = nombreMes(c.mesDestino);
    if (tipo === 'nuevos') return `Pacientes nuevos de ${nombreMes(mes)}`;
    if (tipo === 'ausentes') return `Pacientes de ${nombreMes(mes)} ausentes en ${dest}`;
    if (tipo === 'nuevosRef') return `Nuevos de ${nombreMes(mes)} sin agendar en ${dest}`;
    const x = CATS.find((k) => k[0] === tipo);
    return (x ? x[1] : tipo) + ` — ${dest}`;
  }
  function vistaControl() {
    const d = st.datos;
    const c = controlActual();
    const ch = (cat, v, t, cls) => `<button type="button" class="cg-catchip ${cls}${st.ctrl.cat === cat ? ' on' : ''}" onclick="cgCtrlCat('${cat}')"><b>${v}</b> ${E(t)}</button>`;
    const lista = ordenarFilas(listaCategoria(c, st.ctrl.cat), st.orden === 'nombre' ? 'estado' : st.orden);
    st.ultimaLista = { control: c, filas: lista, titulo: tituloCategoria(c, st.ctrl.cat) };
    const destinos = d.mesesTodos;
    const refSet = new Set(c.referencia);
    const filas = lista.map((f, i) => {
      const p = f.p, k = encodeURIComponent(p.clave);
      return `<tr class="cg-click" onclick="cgVer('${k}')"><td class="num">${i + 1}</td><td><span class="cg-nom">${E(p.nombre)}</span><span class="cg-sub">${E(f.motivo || '')}</span></td>
        <td>${p.incorporacion.mes ? E(nombreMesCap(p.incorporacion.mes)) : '—'}</td><td>${p.ultimaSesion ? fechaCorta(p.ultimaSesion) : '—'}</td>
        <td class="cg-opc">${c.referencia.map((m) => (f.presente && f.presente[m] ? '✓' : '·')).join(' ')}</td>
        <td><span class="cg-est ${f.estado}">${E(ESTADO_TXT(f.estado))}</span>${f.soloCanceladas ? '<span class="cg-sub">solo cancelados</span>' : ''}</td></tr>`;
    }).join('');
    return `
      <div class="p360-card">
        <div class="cg-fila" style="gap:14px">
          <label class="cg-fila"><span class="cg-lbl">Mes de destino</span><select class="cg-sel" onchange="cgCtrlMes(this.value)">${destinos.map((m) => `<option value="${m}" ${m === c.mesDestino ? 'selected' : ''}>${E(nombreMesCap(m))}</option>`).join('')}</select></label>
          <label class="cg-fila"><span class="cg-lbl">Revisión después de</span><select class="cg-sel" onchange="cgCtrlUmbral(this.value)">${[1, 2, 3, 4, 6].map((n) => `<option value="${n}" ${n === c.umbral ? 'selected' : ''}>${n} mes${n === 1 ? '' : 'es'} sin actividad</option>`).join('')}</select></label>
        </div>
        <details class="cg-adv" style="margin:10px 0 0"><summary>Comparar contra: ${E(c.referencia.map((m) => nombreMes(m, false)).join(', '))}</summary>
          ${chipsMeses(refSet, 'cgCtrlRef', { soloConDatos: true })}
          <div class="cg-mini" style="margin:4px 0 10px">Por defecto, los dos meses anteriores al destino. Podés sumar o quitar meses (por ejemplo, el mes que duplicaste).</div></details>
      </div>
      <div class="cg-nota"><b>Control de agenda — ${E(nombreMesCap(c.mesDestino))}.</b> ${c.totales.registrados} fichas registradas en el sistema · ${c.totales.unicos} pacientes con actividad en ${E(c.referencia.map((m) => nombreMes(m, false)).join(', '))} o ${E(nombreMes(c.mesDestino, false))} · ${c.totales.turnosDestino} turnos vigentes en ${E(nombreMes(c.mesDestino, false))}. Cada persona se cuenta una sola vez. "Sin agendar" no significa suspendido: la suspensión solo se toma si está registrada en la ficha.</div>
      <div class="cg-catchips">${CATS.map(([k, t, cls]) => ch(k, (c.cats[k] || []).length, t, (c.cats[k] || []).length ? cls : '')).join('')}</div>
      <details class="cg-adv" ${/:/.test(st.ctrl.cat) ? 'open' : ''}><summary>Por mes: nuevos, ausentes y nuevos sin agendar</summary><div class="cg-catchips" style="padding-bottom:12px">
        ${[...c.referencia, c.mesDestino].map((m) => ch('nuevos:' + m, (c.nuevosPorMes[m] || []).length, 'Nuevos de ' + nombreMes(m, false), '')).join('')}
        ${c.referencia.map((m) => ch('ausentes:' + m, (c.ausentesPorMes[m] || []).length, `De ${nombreMes(m, false)} ausentes en ${nombreMes(c.mesDestino, false)}`, (c.ausentesPorMes[m] || []).length ? 'bad' : '')).join('')}
        ${c.referencia.map((m) => ch('nuevosRef:' + m, (c.nuevosRefSinAgendar[m] || []).length, `Nuevos de ${nombreMes(m, false)} sin agendar`, (c.nuevosRefSinAgendar[m] || []).length ? 'bad' : '')).join('')}
      </div></details>
      <div class="cg-bar"><h4 style="margin:0;font-size:15px">${E(tituloCategoria(c, st.ctrl.cat))} (${lista.length})</h4>${barraExport('control', lista.length)}</div>
      ${lista.length ? `<div class="cg-tabla-wrap"><table class="cg-tabla"><thead><tr><th>N.º</th><th>Paciente</th><th>Incorporación</th><th>Última sesión</th><th class="cg-opc">${E(c.referencia.map((m) => nombreMes(m, false).slice(0, 3)).join(' '))}</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>` : '<div class="cg-vacio">No hay pacientes en esta categoría. 🎉</div>'}`;
  }

  // ── Pestaña: Revisión de datos (comparar meses · duplicaciones · duplicados) ──
  function vistaRevision() {
    const d = st.datos;
    const subs = [['comparar', 'Comparar meses'], ['duplicaciones', 'Duplicaciones de mes'], ['duplicados', `Posibles duplicados${d.duplicados.length ? ' (' + d.duplicados.length + ')' : ''}`]];
    const cuerpo = ({ comparar: vistaComparar, duplicaciones: vistaDuplicaciones, duplicados: vistaDuplicados }[st.subRev] || vistaComparar)();
    return `<div class="p360-seg cg-subrev" role="tablist">${subs.map(([k, t]) => `<button type="button" class="${st.subRev === k ? 'activo' : ''}" onclick="cgSubRev('${k}')">${t}</button>`).join('')}</div>${cuerpo}`;
  }

  // ── Pestaña: Comparar meses ──
  function vistaComparar() {
    const d = st.datos;
    if (!st.cmp.size) { const m = mesActual(); [sumarMeses(m, -1), m].forEach((x) => st.cmp.add(x)); }
    const r = compararMeses(d.pacientes, [...st.cmp]);
    const ult = r.meses[r.meses.length - 1];
    const grupos = [
      ['enTodos', `En todos los meses elegidos`, r.enTodos],
      ['perdidos', `Estaban antes y no están en ${nombreMes(ult)}`, r.perdidos],
      ['nuevosUltimo', `Aparecen en ${nombreMes(ult)} y en ningún mes anterior elegido`, r.nuevosUltimo],
      ...r.meses.map((m) => ['solo:' + m, `Solo en ${nombreMes(m)}`, r.soloEn[m]]),
    ];
    st.ultimaLista = { comparar: r, grupos };
    const tabla = (lista) => lista.length ? `<div class="cg-tabla-wrap"><table class="cg-tabla"><thead><tr><th>Paciente</th>${r.meses.map((m) => `<th class="num">${E(nombreMesCap(m).replace(/ (\d{4})$/, ' $1'))}</th>`).join('')}<th>Última</th></tr></thead><tbody>${lista.map((f) => `<tr class="cg-click" onclick="cgVer('${encodeURIComponent(f.p.clave)}')"><td class="cg-nom">${E(f.p.nombre)}</td>${r.meses.map((m) => `<td class="num">${f.sesiones[m] ? f.sesiones[m] : '<span style="opacity:.35">—</span>'}</td>`).join('')}<td>${f.p.ultimaSesion ? fechaCorta(f.p.ultimaSesion) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="cg-vacio">Nadie.</div>';
    return `
      <div class="p360-card"><span class="cg-lbl">Meses a comparar (2 o más, de cualquier año)</span>${chipsMeses(st.cmp, 'cgCmpMes', { soloConDatos: true })}</div>
      <div class="cg-kpis">${r.meses.map((m) => `<div class="cg-kpi static"><b>${r.totales[m].pacientes}</b><span>pacientes en ${E(nombreMes(m))} · ${r.totales[m].sesiones} turnos</span></div>`).join('')}<div class="cg-kpi static"><b>${r.filas.length}</b><span>pacientes únicos en total</span></div></div>
      ${grupos.map(([k, t, l], i) => `<details class="cg-sec" ${i < 2 ? 'open' : ''}><summary><span>${E(t)}</span><span class="cg-mini">${l.length} · <a href="#" onclick="event.preventDefault();event.stopPropagation();cgExportarGrupo('${k}','print')">imprimir</a> · <a href="#" onclick="event.preventDefault();event.stopPropagation();cgExportarGrupo('${k}','pdf')">PDF</a> · <a href="#" onclick="event.preventDefault();event.stopPropagation();cgExportarGrupo('${k}','xlsx')">Excel</a></span></summary><div>${tabla(l)}</div></details>`).join('')}`;
  }

  // ── Pestaña: Duplicados ──
  function vistaDuplicados() {
    const g = st.datos.duplicados;
    return `<div class="cg-nota">Coincidencias por DNI (mismo número con distinto formato), nombre y apellido (en cualquier orden) o teléfono. <b>Tener varias sesiones no es un duplicado</b>: acá solo aparecen identidades distintas que podrían ser la misma persona. Nada se fusiona ni se borra automáticamente: revisalo desde la ficha.</div>
      ${g.length ? g.map((x) => `<details class="cg-sec" open><summary><span>${E(x.miembros[0].nombre)} <span class="cg-mini">· ${E(x.tipo)}</span></span><span class="cg-mini">${E(x.motivos.join(' · '))}</span></summary><div><div class="cg-tabla-wrap"><table class="cg-tabla"><thead><tr><th>Registro</th><th>DNI</th><th>Teléfono</th><th class="num">Turnos</th><th></th></tr></thead><tbody>
        ${x.miembros.map((m) => `<tr><td class="cg-nom">${E(m.nombre)}<span class="cg-sub">${m.ficha ? 'Ficha de paciente' : 'Solo en la agenda'}</span></td><td>${E(m.dni || 'sin DNI')}</td><td>${E(m.phone || '—')}</td><td class="num">${m.sesiones}</td><td><button class="p360-btn" onclick="cgVer('${encodeURIComponent(m.clavePaciente || m.clave)}')">Ver</button></td></tr>`).join('')}
      </tbody></table></div></div></details>`).join('') : '<div class="cg-vacio">No se detectaron posibles duplicados.</div>'}`;
  }

  // ── Pestaña: Duplicaciones de mes ──
  function vistaDuplicaciones() {
    const d = st.datos;
    if (d.lotes === null) return '<div class="cg-vacio">No se pudo leer el registro de duplicaciones (permiso o conexión).</div>';
    if (!d.lotes.length) return '<div class="cg-vacio">Todavía no se duplicó ningún mes. Cuando dupliques uno (Agenda → Duplicar mes), su resumen aparece acá.</div>';
    const lote = d.lotes.find((l) => l.id === st.loteSel) || d.lotes[0];
    st.loteSel = lote.id;
    const nombreDe = (dni) => { const p = d.porClave.get(deps.claveDni(dni)); return p ? p.nombre : ''; };
    const r = resumenDuplicacion(lote, d.pacientes, { pendientes: d.pendientes, nombreDe, umbral: st.ctrl.umbral });
    st.ultimaLista = { duplicacion: r };
    const lp = (arr) => arr.length ? `<ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px">${arr.map((x) => `<li>${E(x.nombre || x.dni)}${x.items ? ` <span class="cg-mini">— ${E(x.items.map((i) => `${fechaCorta(i.fecha)} ${i.hora || ''} (${(i.motivos || []).map(motivoTxt).join(', ')})`).join(' · '))}</span>` : ''}</li>`).join('')}</ul>` : '<div class="cg-mini">Ninguno.</div>';
    const lf = (arr) => arr.length ? `<ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px">${arr.map((f) => `<li><a href="#" onclick="cgVer('${encodeURIComponent(f.p.clave)}');return false">${E(f.p.nombre)}</a> <span class="cg-mini">— se sumó en ${E(nombreMes(f.p.incorporacion.mes))} · ${E(f.motivo || '')}</span></li>`).join('')}</ul>` : '<div class="cg-mini">Ninguno.</div>';
    const sec = (t, n, body, open, cls = '') => `<details class="cg-sec" ${open ? 'open' : ''}><summary><span>${t}</span><span class="cg-est ${cls}">${n}</span></summary><div>${body}</div></details>`;
    return `
      <div class="p360-card cg-fila"><span class="cg-lbl">Duplicación</span>
        <select class="cg-sel" onchange="cgLote(this.value)">${d.lotes.map((l) => { const o = l.origen || {}, de = l.destino || {}; return `<option value="${E(l.id)}" ${l.id === lote.id ? 'selected' : ''}>${E(nombreMesCap(`${o.anio}-${String(o.mes).padStart(2, '0')}`))} → ${E(nombreMesCap(`${de.anio}-${String(de.mes).padStart(2, '0')}`))} · ${E(String(l.fecha || '').slice(0, 10).split('-').reverse().join('/'))} · ${E(l.estado || '')}</option>`; }).join('')}</select>
        <button class="p360-btn" onclick="cgIrControl('${r.destino}','${r.origen}')">Abrir control de ${E(nombreMes(r.destino))}</button>
        <button class="p360-btn pri" onclick="cgExportar('duplicacion','print')">🖨 Imprimir resumen</button>
        <button class="p360-btn" onclick="cgExportar('duplicacion','pdf')">PDF</button>
      </div>
      <div class="cg-kpis">
        <div class="cg-kpi static ok"><b>${r.pacientesCopiados.length}</b><span>pacientes copiados${r.turnosCreados != null ? ` (${r.turnosCreados} turnos)` : ''}</span></div>
        <div class="cg-kpi static"><b>${r.pacientesYaEnDestino.length}</b><span>ya tenían sus turnos en el destino</span></div>
        <div class="cg-kpi static ${r.noIncorporados.length ? 'bad' : ''}"><b>${r.noIncorporados.length}</b><span>no se pudieron incorporar</span></div>
        <div class="cg-kpi static ${r.posterioresSinTurno.length ? 'bad' : ''}"><b>${r.posterioresSinTurno.length}</b><span>se sumaron después de ${E(nombreMes(r.origen, false))} y no están en ${E(nombreMes(r.destino, false))}</span></div>
        <div class="cg-kpi static ${r.sinAgendar.length ? 'warn' : ''}"><b>${r.sinAgendar.length}</b><span>siguen sin agendar / a revisar</span></div>
      </div>
      ${sec(`Se sumaron después de ${E(nombreMes(r.origen))} y no figuran en ${E(nombreMes(r.destino))}`, r.posterioresSinTurno.length, lf(r.posterioresSinTurno), true, r.posterioresSinTurno.length ? 'sin_agendar' : 'agendado')}
      ${sec('No se pudieron incorporar (quedaron como pendientes)', r.noIncorporados.length, lp(r.noIncorporados), r.noIncorporados.length > 0, r.noIncorporados.length ? 'sin_agendar' : 'agendado')}
      ${sec('Turnos en conflicto (box o paciente ocupados, box incompatible)', r.conflictos.length, lp(r.conflictos), false, r.conflictos.length ? 'parcial' : 'agendado')}
      ${sec('No copiados por bloqueos o restricciones', r.porBloqueos.length, lp(r.porBloqueos), false, r.porBloqueos.length ? 'parcial' : 'agendado')}
      ${sec('Pendientes de reagendar que requieren revisión', r.pendientesRevision.length, r.pendientesRevision.length ? `<ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px">${r.pendientesRevision.map((p) => `<li>${E(p.paciente || p.dni)} <span class="cg-mini">— ${E(p.servicio || '')} ${p.fecha ? fechaCorta(p.fecha) : ''} ${E(p.hora || '')} · ${E((p.motivos || []).map((m) => m.texto || m.codigo || m).join(', '))}</span></li>`).join('')}</ul>` : '<div class="cg-mini">Ninguno.</div>', false, r.pendientesRevision.length ? 'en_revision' : 'agendado')}
      ${sec('Pacientes copiados', r.pacientesCopiados.length, lp(r.pacientesCopiados), false)}
      ${r.errores.length ? sec('Errores al guardar', r.errores.length, `<ul style="font-size:12.5px">${r.errores.map((e) => `<li>${E(e.paciente || e.clave || '')}: ${E(e.error || '')}</li>`).join('')}</ul>`, true, 'sin_agendar') : ''}
      <div class="cg-nota">Este resumen solo lee: no crea turnos para los pendientes, no sobrescribe la agenda ni borra sesiones. Para incorporar a alguien, abrí su ficha o la Grilla.</div>`;
  }

  // ── Detalle del paciente ──
  function verPaciente(clave) {
    const p = st.datos.porClave.get(clave);
    if (!p) { aviso('No se encontró ese paciente en los datos cargados.'); return; }
    const foco = st.tab === 'control' ? (st.ctrl.mes || mesActual()) : mesFoco();
    const e = estadoEnMes(p, foco, { umbral: st.ctrl.umbral });
    const ret = retomo(p, 45);
    const dato = (t, v) => `<div class="cg-dato"><span>${t}</span><b>${v}</b></div>`;
    const ses = [...p.sesiones].reverse();
    const filaSes = (s) => `<tr><td>${fechaCorta(s.fecha)}</td><td>${E(s.hora)}</td><td>${E(s.servicio || '—')}</td><td>${E(s.box || '—')}</td><td>${s.cancelada ? '<span class="cg-est sin_agendar">Cancelada</span>' : s.realizada ? '<span class="cg-est agendado">Realizada</span>' : '<span class="cg-est parcial">Futura</span>'}${s.duplicada ? '<span class="cg-sub">de agenda duplicada</span>' : ''}${s.reprogramada ? '<span class="cg-sub">reprogramada</span>' : ''}</td><td class="cg-opc">${E(s.nota)}</td></tr>`;
    const tablaSes = (l) => `<div class="cg-tabla-wrap"><table class="cg-tabla"><thead><tr><th>Fecha</th><th>Hora</th><th>Tratamiento</th><th>Box</th><th>Estado</th><th class="cg-opc">Nota</th></tr></thead><tbody>${l.map(filaSes).join('')}</tbody></table></div>`;
    const ef = p.estadoFormal;
    const hist = ef && ef.historial && ef.historial.length ? `<div class="cg-mini" style="margin-top:4px">Historial: ${ef.historial.map((h) => `${E(ESTADOS_FORMALES[h.estado] || h.estado)} (${E(fechaCorta(String(h.desde || h.registrado || '').slice(0, 10)))})`).join(' → ')}</div>` : '';
    const dni = p.dni;
    const html = `<div class="cg-modal-bg" id="cg-modal" onclick="if(event.target===this)cgCerrar()"><div class="cg-modal" role="dialog" aria-modal="true" aria-label="Historial de ${E(p.nombre)}">
      <button class="cg-x" onclick="cgCerrar()" aria-label="Cerrar">×</button>
      <h3>${E(p.nombre)}</h3>
      <div class="cg-mini">${dni ? 'DNI ' + E(dni) : 'Sin DNI (identificado por nombre)'}${p.phone ? ' · ' + E(p.phone) : ''}${p.ficha ? '' : ' · sin ficha de paciente'}</div>
      <div style="margin-top:8px"><span class="cg-est ${e.estado}">${E(ESTADO_TXT(e.estado))} en ${E(nombreMes(foco))}</span> <span class="cg-mini">${E(e.motivo || '')}</span></div>
      <div class="cg-datos">
        ${dato('Incorporación', p.incorporacion.fecha ? `${fechaCorta(p.incorporacion.fecha)}<span class="cg-sub">${E(criterioIncorporacion(p.incorporacion))}</span>` : '—')}
        ${dato('Registro de ficha', p.registro ? fechaCorta(p.registro) : 'sin dato')}
        ${dato('Primera sesión', p.primeraSesion ? fechaCorta(p.primeraSesion) : '—')}
        ${dato('Última sesión', p.ultimaSesion ? fechaCorta(p.ultimaSesion) : '—')}
        ${dato('Próxima sesión', p.proxima ? `${fechaCorta(p.proxima.fecha)} ${E(p.proxima.hora)}` : '—')}
        ${dato('Sesiones', `${p.nRealizadas} realizadas · ${p.nFuturas} futuras · ${p.nCanceladas} canceladas`)}
        ${dato('Tratamientos', E(p.servicios.join(', ') || '—'))}
        ${dato('Boxes y horarios', E([p.boxes.join(', '), p.horarios.slice(0, 6).join(' ')].filter(Boolean).join(' · ') || '—'))}
        ${ret ? dato('Retomó', `tras ${fechaCorta(ret.desde)} → ${fechaCorta(ret.hasta)}`) : ''}
      </div>
      <div><span class="cg-lbl">Meses con actividad</span><div class="cg-chips" style="margin-top:4px">${p.mesesActivos.map((m) => `<span class="cg-chip" style="cursor:default">${E(nombreMesCap(m))} · ${p.sesiones.filter((s) => s.activa && s.fecha.startsWith(m)).length}</span>`).join('') || '<span class="cg-mini">Ninguno</span>'}</div></div>
      <div style="margin-top:12px"><span class="cg-lbl">Estado registrado</span>
        <div class="cg-mini">${ef ? `<b>${E(ESTADOS_FORMALES[ef.estado])}</b>${ef.desde ? ' desde ' + E(fechaCorta(ef.desde)) : ''}${ef.motivo ? ' — ' + E(ef.motivo) : ''}` : 'Sin estado registrado. La falta de turnos no se toma como suspensión.'}</div>${hist}
        ${p.ficha && dni ? `<div class="cg-estado-form"><select class="cg-sel" id="cg-ef-estado"><option value="">Elegir…</option>${Object.entries(ESTADOS_FORMALES).map(([k, t]) => `<option value="${k}">${E(t)}</option>`).join('')}</select><input type="date" class="cg-sel" id="cg-ef-desde" value="${hoy()}" aria-label="Desde"><input type="text" class="cg-sel" id="cg-ef-motivo" placeholder="Motivo (opcional)" style="flex:1;min-width:140px"><button class="p360-btn pri" onclick="cgGuardarEstado('${encodeURIComponent(clave)}','${E(dni)}')">Registrar</button></div>` : '<div class="cg-mini">Para registrar un estado, el paciente necesita ficha con DNI.</div>'}
      </div>
      <div style="margin-top:14px"><span class="cg-lbl">Últimas 3 sesiones</span>${ses.length ? tablaSes(ses.filter((s) => !s.futura).slice(0, 3)) : '<div class="cg-mini">Sin sesiones.</div>'}</div>
      ${ses.length > 3 ? `<details class="cg-sec" style="margin-top:10px"><summary><span>Historial completo</span><span class="cg-mini">${ses.length} turnos</span></summary><div>${tablaSes(ses)}</div></details>` : ''}
      ${p.notas.length ? `<div style="margin-top:12px"><span class="cg-lbl">Observaciones registradas</span><ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px">${p.notas.slice(-10).reverse().map((n) => `<li>${fechaCorta(n.fecha)}: ${E(n.nota)}</li>`).join('')}</ul></div>` : ''}
      <div class="cg-fila" style="margin-top:14px">
        ${clave.startsWith('dni:') || clave.startsWith('nom:') ? `<button class="p360-btn pri" onclick="cgCerrar();cgFicha('${encodeURIComponent(clave)}')">Abrir ficha 360°</button>` : ''}
        ${p.proxima ? `<button class="p360-btn" onclick="cgCerrar();cgGrilla('${p.proxima.fecha}')">Ver próximo turno en la Grilla</button>` : ''}
        <button class="p360-btn" onclick="cgCerrar();cgGrilla('${foco === mesActual() ? hoy() : foco + '-01'}')">Ir a la Grilla de ${E(nombreMes(foco, false))}</button>
      </div>
    </div></div>`;
    cerrarModal();
    document.body.insertAdjacentHTML('beforeend', html);
  }
  function cerrarModal() { const m = $('cg-modal'); if (m) m.remove(); }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarModal(); });

  async function guardarEstado(clave, dni) {
    const estado = $('cg-ef-estado').value;
    if (!estado) { aviso('Elegí el estado a registrar.'); return; }
    const desde = $('cg-ef-desde').value || hoy();
    const motivo = ($('cg-ef-motivo').value || '').trim().slice(0, 300);
    const p = st.datos.porClave.get(clave);
    const previo = p && p.estadoFormal ? p.estadoFormal : null;
    const historial = [...((previo && previo.historial) || [])];
    if (previo) historial.push({ estado: previo.estado, desde: previo.desde || '', motivo: previo.motivo || '' });
    historial.push({ estado, desde, motivo, registrado: new Date().toISOString(), por: deps.usuario() || '' });
    const seguimiento = { estado, desde, motivo, actualizado: new Date().toISOString(), por: deps.usuario() || '', historial: historial.slice(-30) };
    try {
      await F.setDoc(F.doc(db, 'clients', dni), { seguimiento }, { merge: true });
      if (p) p.estadoFormal = { estado, desde, motivo, historial: seguimiento.historial };
      aviso('Estado registrado: ' + ESTADOS_FORMALES[estado]);
      verPaciente(clave); render();
    } catch (e) { console.error(e); aviso('No se pudo guardar el estado (' + (e && (e.code || e.message)) + ').'); }
  }

  // ── Exportación ──
  function columnasPacientes(tipo) {
    const foco = tipo === 'control' ? (st.ctrl.mes || mesActual()) : mesFoco();
    const c = st.campos;
    const cols = [{ titulo: 'N.º', valor: (_, i) => String(i + 1), ancho: 9 }, { titulo: 'Paciente', valor: (f) => f.p.nombre, ancho: 48 }];
    if (c.dni) cols.push({ titulo: 'DNI', valor: (f) => f.p.dni });
    if (c.phone) cols.push({ titulo: 'Teléfono', valor: (f) => f.p.phone });
    cols.push({ titulo: 'Mes de incorporación', valor: (f) => (f.p.incorporacion.mes ? nombreMesCap(f.p.incorporacion.mes) : '') });
    cols.push({ titulo: 'Última sesión', valor: (f) => fechaCorta(f.p.ultimaSesion) });
    cols.push({ titulo: 'Estado', valor: (f) => { const e = f.estado ? f : (f.est || estadoEnMes(f.p, foco, { umbral: st.ctrl.umbral })); return ESTADO_TXT(e.estado) + (e.soloCanceladas ? ' (solo cancelados)' : ''); } });
    if (c.todas) {
      cols.push({ titulo: 'Criterio de incorporación', valor: (f) => criterioIncorporacion(f.p.incorporacion) });
      cols.push({ titulo: 'Primera sesión', valor: (f) => fechaCorta(f.p.primeraSesion) });
      cols.push({ titulo: 'Próximo turno', valor: (f) => (f.p.proxima ? `${fechaCorta(f.p.proxima.fecha)} ${f.p.proxima.hora}` : '') });
      cols.push({ titulo: 'Realizadas', valor: (f) => String(f.enPeriodo ? f.enPeriodo.realizadas : f.p.nRealizadas) });
      cols.push({ titulo: 'Futuras', valor: (f) => String(f.enPeriodo ? f.enPeriodo.futuras : f.p.nFuturas) });
      cols.push({ titulo: 'Canceladas', valor: (f) => String(f.enPeriodo ? f.enPeriodo.canceladas : f.p.nCanceladas) });
      cols.push({ titulo: 'Tratamientos', valor: (f) => f.p.servicios.join(', ') });
      cols.push({ titulo: 'Boxes', valor: (f) => f.p.boxes.join(', ') });
      cols.push({ titulo: 'Meses con actividad', valor: (f) => f.p.mesesActivos.map((m) => nombreMes(m)).join(', ') });
      cols.push({ titulo: 'Motivo', valor: (f) => (f.motivo || (f.est && f.est.motivo) || '') });
    }
    return cols;
  }
  const colsRevision = [{ titulo: 'Revisado', valor: () => '☐', ancho: 16, revision: true }, { titulo: 'Observaciones', valor: () => '', ancho: 60, revision: true }];
  function datosExport(origen, grupo) {
    const L = st.ultimaLista || {};
    if (origen === 'lista') {
      let filas = L.filas || [];
      if (st.sel.size) filas = filas.filter((f) => st.sel.has(f.p.clave));
      return { titulo: 'LISTADO DE PACIENTES', subtitulo: textoCriterios(L.f || {}) + (st.sel.size ? ` · ${filas.length} seleccionados` : ''), columnas: columnasPacientes('lista'), filas, revision: false, nombre: 'pacientes' };
    }
    if (origen === 'control') {
      const c = L.control;
      const pend = ['pendientes', 'sinAgendar', 'nuevosDestinoSinAgendar', 'enRevision', 'parciales', 'canceladasSinReprogramar', 'anterioresSinTurnos'].includes(st.ctrl.cat) || /^(ausentes|nuevosRef):/.test(st.ctrl.cat);
      return { titulo: pend ? 'CONTROL DE PACIENTES PENDIENTES DE AGENDAR' : 'CONTROL DE AGENDA', subtitulo: `Mes de destino: ${nombreMesCap(c.mesDestino)} · ${L.titulo} · referencia: ${c.referencia.map((m) => nombreMes(m)).join(', ')}`, columnas: [...columnasPacientes('control'), ...colsRevision], filas: L.filas, revision: true, nombre: `control-agenda-${c.mesDestino}` };
    }
    if (origen === 'comparar') {
      const r = L.comparar, g = L.grupos.find((x) => x[0] === grupo);
      const cols = [{ titulo: 'N.º', valor: (_, i) => String(i + 1), ancho: 9 }, { titulo: 'Paciente', valor: (f) => f.p.nombre, ancho: 50 }, ...(st.campos.dni ? [{ titulo: 'DNI', valor: (f) => f.p.dni }] : []), ...(st.campos.phone ? [{ titulo: 'Teléfono', valor: (f) => f.p.phone }] : []), ...r.meses.map((m) => ({ titulo: nombreMesCap(m), valor: (f) => String(f.sesiones[m] || '—') })), { titulo: 'Última sesión', valor: (f) => fechaCorta(f.p.ultimaSesion) }];
      return { titulo: 'COMPARACIÓN DE PACIENTES ENTRE MESES', subtitulo: `${g[1]} · meses: ${r.meses.map((m) => nombreMes(m)).join(', ')}`, columnas: [...cols, ...colsRevision], filas: g[2], revision: true, nombre: 'comparacion-meses' };
    }
    if (origen === 'duplicacion') {
      const r = L.duplicacion;
      const filas = [
        ...r.posterioresSinTurno.map((f) => ({ grupo: `Se sumaron después de ${nombreMes(r.origen)}`, nombre: f.p.nombre, det: `Incorporación: ${nombreMesCap(f.p.incorporacion.mes)} · última sesión ${fechaCorta(f.p.ultimaSesion) || '—'}` })),
        ...r.noIncorporados.map((x) => ({ grupo: 'No se pudieron incorporar', nombre: x.nombre, det: x.items.map((i) => `${fechaCorta(i.fecha)} ${i.hora || ''} (${(i.motivos || []).map(motivoTxt).join(', ')})`).join(' · ') })),
        ...r.pendientesRevision.map((p) => ({ grupo: 'Pendiente de reagendar', nombre: p.paciente || p.dni, det: `${p.servicio || ''} ${fechaCorta(p.fecha)} ${p.hora || ''}` })),
        ...r.sinAgendar.filter((f) => !r.posterioresSinTurno.includes(f)).map((f) => ({ grupo: `Sin agendar / a revisar en ${nombreMes(r.destino)}`, nombre: f.p.nombre, det: `${ESTADO_TXT(f.estado)} · ${f.motivo || ''}` })),
      ];
      return { titulo: 'RESUMEN DE DUPLICACIÓN DE MES', subtitulo: `${nombreMesCap(r.origen)} → ${nombreMesCap(r.destino)} · ${r.pacientesCopiados.length} pacientes copiados · ${r.pacientesYaEnDestino.length} ya estaban · ${r.noIncorporados.length} sin incorporar`, columnas: [{ titulo: 'N.º', valor: (_, i) => String(i + 1), ancho: 9 }, { titulo: 'Situación', valor: (f) => f.grupo, ancho: 42 }, { titulo: 'Paciente', valor: (f) => f.nombre, ancho: 45 }, { titulo: 'Detalle', valor: (f) => f.det }, ...colsRevision], filas, revision: true, nombre: `duplicacion-${r.origen}-a-${r.destino}` };
    }
    return null;
  }
  async function exportar(origen, formato, grupo) {
    const x = datosExport(origen, grupo);
    if (!x) return;
    if (!x.filas.length) { aviso('No hay filas para exportar con estos filtros.'); return; }
    const cols = formato === 'xlsx' || formato === 'csv' ? x.columnas.filter((c) => !c.revision) : x.columnas;
    const matriz = x.filas.map((f, i) => cols.map((c) => c.valor(f, i) ?? ''));
    const emitido = `Emitido el ${fechaCorta(hoy())} ${deps.ahora()}`;
    const archivo = `${x.nombre}_${hoy()}`;
    if (formato === 'csv') {
      const csv = aCSV(cols.map((c, j) => ({ titulo: c.titulo, valor: (fila) => fila[j] })), matriz);
      descargar(new Blob([csv], { type: 'text/csv;charset=utf-8' }), archivo + '.csv');
    } else if (formato === 'xlsx') {
      try {
        const XLSX = await cargarXLSX();
        const ws = XLSX.utils.aoa_to_sheet([[`Espacio Mimar T — ${x.titulo}`], [x.subtitulo], [emitido], [], cols.map((c) => c.titulo), ...matriz]);
        ws['!cols'] = cols.map((c) => ({ wch: Math.min(45, Math.max(8, c.titulo.length + 2, ...matriz.slice(0, 200).map((r) => String(r[cols.indexOf(c)] || '').length + 1))) }));
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Listado');
        XLSX.writeFile(wb, archivo + '.xlsx');
      } catch (e) { console.error(e); aviso('No se pudo generar el Excel (¿sin conexión?). Probá con CSV.'); }
    } else if (formato === 'pdf') {
      const tools = deps.getPdfTools(); if (!tools) return;
      const { jsPDF, runAutoTable } = tools;
      const ancha = cols.length > 8;
      const pdf = new jsPDF({ orientation: ancha ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
      const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
      const t = (s) => String(s ?? '').replace(/☐/g, '').replace(/[^\x20-\x7E -ÿ\n]/g, '');
      const encabezado = () => {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(47, 90, 71); pdf.text('ESPACIO MIMAR T', 14, 12);
        pdf.setFontSize(13); pdf.setTextColor(30, 40, 35); pdf.text(t(x.titulo), 14, 19);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(90, 90, 90);
        const sub = pdf.splitTextToSize(t(x.subtitulo), W - 28); pdf.text(sub, 14, 24.5);
        pdf.text(t(emitido), W - 14, 12, { align: 'right' });
        return 24.5 + sub.length * 3.6 + 2;
      };
      const y0 = encabezado();
      const anchos = {}; let fijo = 0;
      cols.forEach((c, j) => { if (c.ancho) { anchos[j] = { cellWidth: c.ancho }; fijo += c.ancho; } });
      runAutoTable(pdf, {
        startY: y0, head: [cols.map((c) => t(c.titulo))], body: matriz.map((r) => r.map(t)),
        margin: { top: y0, left: 14, right: 14, bottom: 14 }, rowPageBreak: 'avoid',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: x.revision ? 2.6 : 1.8, overflow: 'linebreak', lineColor: [205, 220, 212], lineWidth: 0.2, textColor: [35, 45, 40], minCellHeight: x.revision ? 9 : 0 },
        headStyles: { fillColor: [47, 90, 71], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [247, 250, 248] },
        columnStyles: anchos,
        didDrawCell: (dd) => { if (x.revision && dd.section === 'body' && cols[dd.column.index] && cols[dd.column.index].titulo === 'Revisado') { const s = 3.6; pdf.setDrawColor(90, 110, 100); pdf.setLineWidth(0.3); pdf.rect(dd.cell.x + dd.cell.width / 2 - s / 2, dd.cell.y + dd.cell.height / 2 - s / 2, s, s); } },
        didDrawPage: (dd) => { if (dd.pageNumber > 1) encabezado(); },
      });
      const n = pdf.getNumberOfPages();
      for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(140, 140, 140); pdf.text(`Página ${i} de ${n} · ${x.filas.length} registro${x.filas.length === 1 ? '' : 's'}`, W - 14, H - 7, { align: 'right' }); }
      pdf.save(archivo + '.pdf');
    } else {
      imprimirHTML(x, cols, matriz, emitido);
    }
  }
  function imprimirHTML(x, cols, matriz, emitido) {
    const w = window.open('', '_blank');
    if (!w) { aviso('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio.'); return; }
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(x.titulo)}</title><style>
      @page{size:A4 ${cols.length > 8 ? 'landscape' : 'portrait'};margin:14mm 12mm 16mm}
      body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1e2823;font-size:10.5pt;margin:0}
      .marca{font-size:8.5pt;font-weight:800;letter-spacing:.12em;color:#2f5a47}
      h1{font-size:15pt;margin:2px 0 3px}.sub{font-size:9pt;color:#555;margin:0 0 2px}.emi{font-size:8.5pt;color:#777;margin:0 0 10px}
      table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid;break-inside:avoid}
      th{background:#2f5a47;color:#fff;text-align:left;font-size:8.5pt;padding:5px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      td{border-bottom:1px solid #cfdcd4;padding:${x.revision ? '9px' : '5px'} 6px;vertical-align:top;font-size:9.5pt}
      td.rev{text-align:center;font-size:13pt}td.obs{min-width:45mm}
      .pie{position:fixed;bottom:-10mm;right:0;font-size:8pt;color:#888}
      @media screen{body{padding:20px;max-width:1100px;margin:auto}}
    </style></head><body>
      <div class="marca">ESPACIO MIMAR T</div><h1>${esc(x.titulo)}</h1><p class="sub">${esc(x.subtitulo)}</p><p class="emi">${esc(emitido)} · ${x.filas.length} registro${x.filas.length === 1 ? '' : 's'}</p>
      <table><thead><tr>${cols.map((c) => `<th>${esc(c.titulo)}</th>`).join('')}</tr></thead><tbody>${matriz.map((r) => `<tr>${r.map((v, j) => `<td class="${cols[j].titulo === 'Revisado' ? 'rev' : cols[j].titulo === 'Observaciones' ? 'obs' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
    w.document.close();
  }
  function descargar(blob, nombre) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, mal) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => (window.XLSX ? ok(window.XLSX) : mal(new Error('XLSX no disponible'))); s.onerror = () => mal(new Error('No se pudo cargar XLSX')); document.head.appendChild(s); });
  }

  // ── Acciones globales (onclick del HTML) ──
  const rerender = () => { st.pagina = 0; render(); };
  let tBuscar = null;
  Object.assign(window, {
    cgAbrir: async () => {
      const raiz = $('cg-raiz'); if (!raiz) return;
      if (!st.datos || Date.now() - st.cargadoAt > 5 * 60 * 1000) {
        if (!st.datos) raiz.innerHTML = '<div class="p360-cargando">Leyendo todos los pacientes, turnos y duplicaciones…</div>';
        try { await cargar(true); } catch (e) { console.error(e); raiz.innerHTML = `<p class="p360-alerta err">No se pudieron leer los datos (${E(e && (e.code || e.message) || 'sin conexión')}). <button class="p360-btn" onclick="cgAbrir()">Reintentar</button></p>`; return; }
      }
      render();
    },
    cgRecargar: async () => { try { await cargar(true); render(); aviso('Datos actualizados'); } catch (e) { aviso('No se pudieron actualizar los datos.'); } },
    cgBuscar: (v) => { st.q = v; clearTimeout(tBuscar); tBuscar = setTimeout(() => { if (st.tab !== 'pacientes') st.tab = 'pacientes'; rerender(); }, 180); },
    cgTab: (t) => { if (['comparar', 'duplicados', 'duplicaciones'].includes(t)) { st.subRev = t; t = 'revision'; } st.tab = t; st.sel.clear(); render(); },
    cgSubRev: (k) => { st.subRev = k; render(); },
    cgInd: (open) => { st.indAbierto = !!open; },
    cgDirectorio: () => { if (window.navegar) window.navegar('clientes'); },
    cgPerModo: (m) => { st.per.modo = m; if (m === 'anio' && !st.per.anio) st.per.anio = hoy().slice(0, 4); if (m === 'meses' && !st.per.meses.size) st.per.meses.add(mesActual()); rerender(); },
    cgPerAnio: (a) => { st.per.anio = a; rerender(); },
    cgPerRango: (k, v) => { st.per[k] = v; rerender(); },
    cgPerMes: (m) => { toggleSet(st.per.meses, m); rerender(); },
    cgRapido: (k) => { if (k === 'duplicados') { st.tab = 'revision'; st.subRev = 'duplicados'; render(); return; } toggleSet(st.rapido, k); if (k === 'sin_agendar' && st.rapido.has('pendientes')) st.rapido.delete('pendientes'); if (k === 'pendientes' && st.rapido.has('sin_agendar')) st.rapido.delete('sin_agendar'); rerender(); },
    cgAdvMes_nuevosEn: (m) => { toggleSet(st.adv.nuevosEn, m); rerender(); },
    cgAdvMes_presentesEn: (m) => { toggleSet(st.adv.presentesEn, m); rerender(); },
    cgAdvMes_ausentesEn: (m) => { toggleSet(st.adv.ausentesEn, m); rerender(); },
    cgAdvEstado: (k) => { toggleSet(st.adv.estados, k); rerender(); },
    cgAdv: (k, v) => { st.adv[k] = typeof v === 'boolean' ? v : String(v ?? ''); rerender(); },
    cgLimpiar: () => { st.q = ''; st.rapido.clear(); st.sel.clear(); st.adv = { nuevosEn: new Set(), presentesEn: new Set(), ausentesEn: new Set(), estadoMes: '', estados: new Set(), sinDias: '', servicio: '', box: '', estadoFormal: '', min: '', max: '', dup: false, conFut: false, sinFut: false, fichasSin: false }; rerender(); },
    cgOrden: (o) => { st.orden = o; rerender(); },
    cgVista: (v) => { st.vista = v; render(); },
    cgPagina: (d) => { st.pagina += d; render(); $('cg-raiz')?.scrollIntoView({ block: 'start' }); },
    cgSel: (k, on) => { const c = decodeURIComponent(k); if (on) st.sel.add(c); else st.sel.delete(c); render(); },
    cgSelPagina: (on) => { const L = st.ultimaLista; (L && L.filas ? L.filas.slice(st.pagina * POR_PAGINA, (st.pagina + 1) * POR_PAGINA) : []).forEach((f) => (on ? st.sel.add(f.p.clave) : st.sel.delete(f.p.clave))); render(); },
    cgSelLimpiar: () => { st.sel.clear(); render(); },
    cgCampo: (k, v) => { st.campos[k] = v; },
    cgVer: (k) => verPaciente(decodeURIComponent(k)),
    cgCerrar: cerrarModal,
    cgGuardarEstado: (k, dni) => guardarEstado(decodeURIComponent(k), dni),
    cgFicha: (k) => deps.abrirFicha(decodeURIComponent(k)),
    cgGrilla: (f) => deps.irAGrilla(f),
    cgCtrlMes: (m) => { st.ctrl.mes = m; st.ctrl.ref = null; render(); },
    cgCtrlRef: (m) => { const c = controlActual(); const s = new Set(c.referencia); toggleSet(s, m); s.delete(st.ctrl.mes); st.ctrl.ref = [...s].sort(); render(); },
    cgCtrlUmbral: (n) => { st.ctrl.umbral = Number(n) || 2; render(); },
    cgCtrlCat: (c) => { st.ctrl.cat = c; render(); },
    cgIrControl: (destino, origen) => { st.tab = 'control'; st.ctrl.mes = destino; const ref = new Set(referenciaPorDefecto(destino, 2)); if (esMes(origen) && origen < destino) rangoMeses(origen, sumarMeses(destino, -1)).forEach((m) => ref.add(m)); st.ctrl.ref = [...ref].sort(); st.ctrl.cat = 'pendientes'; render(); },
    cgCmpMes: (m) => { toggleSet(st.cmp, m); render(); },
    cgLote: (id) => { st.loteSel = id; render(); },
    cgExportar: (o, f) => exportar(o, f),
    cgExportarGrupo: (g, f) => exportar('comparar', f, g),
  });
  return { abrir: () => window.cgAbrir(), estado: st };
}
