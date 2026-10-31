// ── Sesión de paciente por DNI + panel "Mis Sesiones" ──────────────────
// Módulo compartido por index, servicios, kit-facial, depilacion y fecha.
// Usa las mismas consultas que ya funcionaban por separado en cada página:
//   · clients/{dni}           → identifica a la paciente (lectura pública)
//   · reservas  where dni==   → turnos de tratamientos
//   · reservasDepi where dni== → turnos de depilación
// La sesión vive en localStorage (mimar_paciente_*) y se sincroniza con las
// claves históricas clienteDNI / clienteNombre / esMiembro, que el resto de
// las páginas sigue leyendo.
import { db, doc, getDoc, getDocs, collection, query, where } from "/js/firebase-web.js";

const K_DNI = "mimar_paciente_dni";
const K_NOMBRE = "mimar_paciente_nombre";
// Todo lo que envía la paciente (consultas y reprogramaciones) va a administración
const WA_NUMERO = "5493757512496";
// Misma regla que figura en las preguntas frecuentes de index.html
const HORAS_ANTICIPACION_CANCELACION = 48;
const DURACION_TURNO_MS = 60 * 60 * 1000;

// ── Utilidades ──
const escapeHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const normalizarDni = (v) => String(v ?? "").replace(/\D/g, "");
const dniValido = (dni) => /^\d{7,8}$/.test(dni);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

const primerNombre = (nombre) => {
    const p = String(nombre || "").trim().split(/\s+/)[0] || "";
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
};

const _DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const _MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const formatFecha = (fechaStr) => {
    const [y, m, d] = String(fechaStr || "").split("-").map(Number);
    if (!y || !m || !d) return fechaStr || "—";
    const dt = new Date(y, m - 1, d);
    return `${_DIAS[dt.getDay()]} ${d} de ${_MESES[m - 1]}`;
};
const formatFechaCorta = (fechaStr) => {
    const [, m, d] = String(fechaStr || "").split("-").map(Number);
    return m && d ? `${d} ${_MESES[m - 1].slice(0, 3)}` : "—";
};

// ── Sesión ──
function obtener() {
    const dni = normalizarDni(lsGet(K_DNI) || lsGet("clienteDNI"));
    if (!dni || !dniValido(dni)) return null;
    const nombre = lsGet(K_NOMBRE) || lsGet("clienteNombre") || "";
    return { dni, nombre };
}

function guardar(dni, datos) {
    const nombre = datos?.fullName || datos?.nombre || "";
    lsSet(K_DNI, dni); lsSet(K_NOMBRE, nombre);
    lsSet("clienteDNI", dni); lsSet("clienteNombre", nombre);
    const esMiembro = datos?.membershipActive === true || datos?.membresia === true;
    lsSet("esMiembro", esMiembro ? "1" : "0");
    _datosCliente = datos || null;
    renderCuenta();
    window.dispatchEvent(new CustomEvent("mimar:sesion", { detail: { dni, nombre } }));
}

function cerrar() {
    [K_DNI, K_NOMBRE, "clienteDNI", "clienteNombre", "esMiembro"].forEach(lsDel);
    _datosCliente = null;
    cerrarPanel();
    renderCuenta();
    window.dispatchEvent(new CustomEvent("mimar:sesion", { detail: null }));
}

async function buscarPaciente(dni) {
    const snap = await getDoc(doc(db, "clients", dni));
    return snap.exists() ? snap.data() : null;
}

// Valida el DNI contra clients/{dni} y, si existe, deja la sesión iniciada.
async function ingresar(valor) {
    const dni = normalizarDni(valor);
    if (!dniValido(dni)) return { ok: false, motivo: "formato" };
    try {
        const datos = await buscarPaciente(dni);
        if (!datos) return { ok: false, motivo: "no-registrado" };
        guardar(dni, datos);
        return { ok: true, dni, datos };
    } catch (e) {
        console.error("[MimarSesion] Error consultando paciente:", e);
        return { ok: false, motivo: "conexion" };
    }
}

// ── Estilos ──
function inyectarEstilos() {
    if (document.getElementById("mm-sesion-style")) return;
    if (!document.querySelector('link[href*="family=Jost"]')) {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@400;500;600&display=swap";
        document.head.appendChild(l);
    }
    const st = document.createElement("style");
    st.id = "mm-sesion-style";
    st.textContent = `
    :root{--mm-bg:#0B1912;--mm-bg2:#14241B;--mm-card:rgba(255,255,255,0.035);--mm-line:rgba(46,204,113,0.16);--mm-line2:rgba(46,204,113,0.34);--mm-acc:#2ECC71;--mm-ink:rgba(226,244,234,0.96);--mm-muted:rgba(165,205,188,0.62);--mm-faint:rgba(165,205,188,0.40);--mm-danger:#e57373;--mm-serif:'Cormorant Garamond','DM Serif Display',Georgia,serif;--mm-sans:'Jost','Montserrat',system-ui,-apple-system,sans-serif;}
    .mm-cuenta{position:fixed;top:14px;right:14px;z-index:1100;font-family:var(--mm-sans);}
    .mm-cuenta.mm-en-nav{position:relative;top:auto;right:auto;z-index:auto;}
    .mm-nav-grupo{display:flex;align-items:center;gap:12px;}
    .mm-en-nav .mm-chip{box-shadow:none;}
    @media(max-width:768px){.mm-nav-grupo{margin-left:auto;margin-right:12px;}}
    .mm-chip{display:inline-flex;align-items:center;gap:8px;max-width:min(78vw,340px);padding:8px 14px 8px 8px;border-radius:999px;border:1px solid var(--mm-line2);background:rgba(11,25,18,0.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:var(--mm-ink);font:500 12.5px/1.2 var(--mm-sans);letter-spacing:.02em;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,0.35);transition:border-color .2s,transform .2s,box-shadow .2s;}
    .mm-chip:hover{border-color:var(--mm-acc);transform:translateY(-1px);box-shadow:0 8px 26px rgba(46,204,113,0.18);}
    .mm-chip:focus-visible,.mm-btn:focus-visible,.mm-tab:focus-visible,.mm-link:focus-visible,.mm-acc-head:focus-visible,.mm-x:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(46,204,113,0.35);}
    .mm-avatar{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#2ECC71,#1e8f50);color:#06130c;font-weight:600;font-size:12px;flex-shrink:0;}
    .mm-chip-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .mm-chip-txt small{color:var(--mm-faint);font-size:11px;margin-left:4px;}
    .mm-menu{position:absolute;right:0;top:calc(100% + 8px);min-width:230px;background:linear-gradient(165deg,var(--mm-bg2),var(--mm-bg));border:1px solid var(--mm-line2);border-radius:16px;padding:8px;box-shadow:0 18px 44px rgba(0,0,0,0.55);display:none;animation:mmFade .18s ease;}
    .mm-menu.open{display:block;}
    .mm-menu-head{padding:8px 10px 10px;border-bottom:1px solid var(--mm-line);margin-bottom:6px;font-size:12px;color:var(--mm-muted);}
    .mm-menu-head strong{display:block;color:var(--mm-ink);font-size:13.5px;font-weight:500;}
    .mm-menu button{display:flex;width:100%;align-items:center;gap:10px;padding:10px;border:none;background:none;color:var(--mm-ink);font:500 13px var(--mm-sans);border-radius:10px;cursor:pointer;text-align:left;}
    .mm-menu button:hover,.mm-menu button:focus-visible{background:rgba(46,204,113,0.10);outline:none;}
    .mm-menu button.mm-salir{color:var(--mm-muted);}
    @media(max-width:520px){.mm-cuenta:not(.mm-en-nav){top:10px;right:10px;}.mm-chip-txt small{display:none;}}
    @media(max-width:380px){.mm-cuenta.mm-en-nav .mm-chip-txt{display:none;}.mm-cuenta.mm-en-nav .mm-chip{padding:5px;}}

    .mm-overlay{position:fixed;inset:0;z-index:12000;background:rgba(4,10,7,0.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;padding:16px;font-family:var(--mm-sans);}
    .mm-overlay.open{display:flex;animation:mmFade .2s ease;}
    .mm-modal{width:100%;max-width:400px;background:linear-gradient(165deg,var(--mm-bg2) 0%,var(--mm-bg) 100%);border:1px solid var(--mm-line2);border-radius:24px;padding:30px 24px 24px;box-shadow:0 32px 72px rgba(0,0,0,0.6);text-align:center;position:relative;color:var(--mm-ink);animation:mmUp .3s cubic-bezier(.2,.9,.3,1.1);}
    .mm-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border-radius:50%;border:none;background:transparent;color:var(--mm-faint);font-size:20px;cursor:pointer;line-height:1;}
    .mm-x:hover{color:var(--mm-ink);background:rgba(255,255,255,0.05);}
    .mm-eyebrow{font:600 10.5px var(--mm-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mm-acc);margin:0 0 6px;}
    .mm-title{font-family:var(--mm-serif);font-weight:500;font-size:28px;line-height:1.15;margin:0 0 8px;color:var(--mm-ink);}
    .mm-sub{font-size:13px;color:var(--mm-muted);line-height:1.6;margin:0 0 18px;}
    .mm-input{width:100%;box-sizing:border-box;padding:15px 16px;border-radius:14px;border:1.5px solid var(--mm-line2);background:rgba(255,255,255,0.04);color:var(--mm-ink);font:500 20px var(--mm-sans);letter-spacing:.14em;text-align:center;outline:none;transition:border-color .2s,box-shadow .2s,background .2s;}
    .mm-input::placeholder{letter-spacing:.04em;font-size:15px;color:var(--mm-faint);font-weight:400;}
    .mm-input:focus{border-color:var(--mm-acc);box-shadow:0 0 0 3px rgba(46,204,113,0.2);background:rgba(46,204,113,0.04);}
    .mm-input.mm-err{border-color:rgba(229,115,115,0.7);animation:mmShake .38s ease;}
    .mm-hint{font-size:11.5px;color:var(--mm-faint);margin:8px 0 16px;}
    .mm-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px 16px;border-radius:14px;border:none;background:linear-gradient(135deg,#2ECC71,#1f9d57);color:#06130c;font:600 13.5px var(--mm-sans);letter-spacing:.04em;cursor:pointer;box-shadow:0 8px 22px rgba(46,204,113,0.25);transition:filter .2s,transform .2s,opacity .2s;text-decoration:none;box-sizing:border-box;}
    .mm-btn:hover:not(:disabled){filter:brightness(1.06);transform:translateY(-1px);}
    .mm-btn:disabled{opacity:.7;cursor:progress;transform:none;}
    .mm-btn.mm-sec{background:transparent;color:var(--mm-ink);border:1px solid var(--mm-line2);box-shadow:none;}
    .mm-btn.mm-sec:hover:not(:disabled){background:rgba(46,204,113,0.08);}
    .mm-btn.mm-wa{background:transparent;color:#5fe39a;border:1px solid rgba(37,211,102,0.35);box-shadow:none;}
    .mm-btn.mm-wa:hover{background:rgba(37,211,102,0.08);}
    .mm-btn.mm-sm{width:auto;padding:9px 14px;font-size:12px;border-radius:11px;}
    .mm-spin{width:15px;height:15px;border-radius:50%;border:2px solid rgba(6,19,12,0.25);border-top-color:#06130c;animation:mmRot .7s linear infinite;}
    .mm-error-box{display:none;margin-top:14px;padding:14px;border-radius:14px;background:rgba(229,115,115,0.07);border:1px solid rgba(229,115,115,0.25);text-align:left;animation:mmUp .25s ease;}
    .mm-error-box.show{display:block;}
    .mm-error-box p{margin:0 0 10px;font-size:13px;color:#f1b1b1;line-height:1.55;}
    .mm-error-box p:last-child{margin-bottom:0;}
    .mm-link{background:none;border:none;color:var(--mm-muted);font:500 12.5px var(--mm-sans);cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:4px;margin-top:12px;border-radius:6px;}

    .mm-panel-ov{align-items:stretch;justify-content:flex-end;padding:0;}
    .mm-panel{width:100%;max-width:500px;height:100%;background:linear-gradient(180deg,var(--mm-bg2) 0%,var(--mm-bg) 60%);border-left:1px solid var(--mm-line2);display:flex;flex-direction:column;color:var(--mm-ink);animation:mmSlide .32s cubic-bezier(.2,.9,.3,1);box-shadow:-20px 0 60px rgba(0,0,0,0.5);}
    .mm-panel-head{padding:22px 22px 14px;position:relative;border-bottom:1px solid var(--mm-line);flex-shrink:0;}
    .mm-panel-head .mm-title{font-size:30px;margin:0 0 4px;}
    .mm-who{font-size:12.5px;color:var(--mm-muted);margin:0;}
    .mm-who strong{color:var(--mm-ink);font-weight:500;}
    .mm-panel-body{flex:1;overflow-y:auto;padding:18px 22px 28px;scrollbar-width:thin;scrollbar-color:var(--mm-line2) transparent;}
    .mm-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px;}
    .mm-kpis.mm-k2{grid-template-columns:repeat(2,1fr);}
    .mm-kpi{background:var(--mm-card);border:1px solid var(--mm-line);border-radius:14px;padding:12px 12px 11px;min-width:0;}
    .mm-kpi-n{font-family:var(--mm-serif);font-size:30px;line-height:1;color:var(--mm-ink);font-weight:500;}
    .mm-kpi-n.mm-acc{color:var(--mm-acc);}
    .mm-kpi-l{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--mm-faint);margin-top:6px;}
    .mm-kpi-s{font-size:11.5px;color:var(--mm-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .mm-tabs{display:flex;gap:4px;padding:4px;background:rgba(255,255,255,0.03);border:1px solid var(--mm-line);border-radius:14px;margin-bottom:16px;}
    .mm-tab{flex:1;padding:10px 8px;border:none;border-radius:10px;background:transparent;color:var(--mm-muted);font:500 12.5px var(--mm-sans);letter-spacing:.03em;cursor:pointer;transition:background .2s,color .2s;display:inline-flex;align-items:center;justify-content:center;gap:6px;}
    .mm-tab[aria-selected="true"]{background:rgba(46,204,113,0.14);color:var(--mm-ink);box-shadow:inset 0 0 0 1px rgba(46,204,113,0.3);}
    .mm-count{font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:999px;background:rgba(46,204,113,0.16);color:var(--mm-acc);}
    .mm-list{display:flex;flex-direction:column;gap:10px;}
    .mm-card{background:var(--mm-card);border:1px solid var(--mm-line);border-radius:16px;padding:15px 16px;animation:mmUp .3s ease both;transition:border-color .2s;}
    .mm-card:hover{border-color:var(--mm-line2);}
    .mm-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px;}
    .mm-card-serv{font-family:var(--mm-serif);font-size:19px;line-height:1.2;color:var(--mm-ink);font-weight:500;}
    .mm-card-meta{font-size:12.5px;color:var(--mm-muted);}
    .mm-card-cd{font-size:11.5px;color:var(--mm-acc);margin-top:6px;font-weight:500;}
    .mm-card-cd.mm-urg{color:#f0b46a;}
    .mm-card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
    .mm-card-actions .mm-btn{flex:1;min-width:130px;}
    .mm-card-note{font-size:11.5px;color:var(--mm-faint);margin-top:10px;line-height:1.5;}
    .mm-badge{display:inline-flex;align-items:center;gap:5px;font:600 10.5px var(--mm-sans);letter-spacing:.05em;padding:4px 9px;border-radius:999px;white-space:nowrap;flex-shrink:0;}
    .mm-badge.mm-ok{background:rgba(46,204,113,0.14);color:#2ECC71;border:1px solid rgba(46,204,113,0.32);}
    .mm-badge.mm-ok::before{content:"";width:6px;height:6px;border-radius:50%;background:#2ECC71;box-shadow:0 0 0 3px rgba(46,204,113,0.18);}
    .mm-badge.mm-done{background:rgba(165,205,188,0.08);color:var(--mm-muted);border:1px solid rgba(165,205,188,0.18);}
    .mm-badge.mm-cancel{background:rgba(229,115,115,0.08);color:rgba(241,161,161,0.85);border:1px solid rgba(229,115,115,0.2);}
    .mm-card.mm-c-done{background:rgba(255,255,255,0.02);}
    .mm-card.mm-c-cancel{background:transparent;border-style:dashed;border-color:rgba(229,115,115,0.16);padding:12px 14px;}
    .mm-card.mm-c-cancel .mm-card-serv{font-size:16px;color:var(--mm-muted);}
    .mm-motivo{font-size:11.5px;color:var(--mm-faint);margin-top:6px;font-style:italic;}
    .mm-empty{text-align:center;padding:30px 18px;border:1px dashed var(--mm-line2);border-radius:18px;background:rgba(46,204,113,0.025);}
    .mm-empty-ico{font-size:30px;margin-bottom:8px;}
    .mm-empty h4{font-family:var(--mm-serif);font-size:21px;font-weight:500;margin:0 0 6px;color:var(--mm-ink);}
    .mm-empty p{font-size:12.5px;color:var(--mm-muted);line-height:1.6;margin:0 0 16px;}
    .mm-acc{margin-top:22px;border-top:1px solid var(--mm-line);padding-top:6px;}
    .mm-acc-head{width:100%;display:flex;justify-content:space-between;align-items:center;padding:12px 4px;border:none;background:none;color:var(--mm-muted);font:500 12.5px var(--mm-sans);cursor:pointer;border-radius:8px;}
    .mm-acc-head:hover{color:var(--mm-ink);}
    .mm-acc-chev{transition:transform .25s;}
    .mm-acc-head[aria-expanded="true"] .mm-acc-chev{transform:rotate(180deg);}
    .mm-acc-body{display:none;padding-top:6px;}
    .mm-acc-body.open{display:flex;}
    .mm-skel{height:84px;border-radius:16px;background:linear-gradient(90deg,rgba(255,255,255,0.03) 25%,rgba(46,204,113,0.07) 50%,rgba(255,255,255,0.03) 75%);background-size:200% 100%;animation:mmShimmer 1.3s infinite;}
    .mm-panel-foot{padding:14px 22px 18px;border-top:1px solid var(--mm-line);flex-shrink:0;display:flex;gap:8px;}
    .mm-textarea{width:100%;box-sizing:border-box;min-height:90px;padding:12px 14px;border-radius:14px;border:1.5px solid var(--mm-line2);background:rgba(255,255,255,0.04);color:var(--mm-ink);font:400 13.5px var(--mm-sans);outline:none;resize:vertical;margin:4px 0 6px;transition:border-color .2s,box-shadow .2s;}
    .mm-textarea:focus{border-color:var(--mm-acc);box-shadow:0 0 0 3px rgba(46,204,113,0.2);}
    .mm-textarea.mm-err{border-color:rgba(229,115,115,0.7);animation:mmShake .38s ease;}
    .mm-confirm-info{font-size:13px;color:var(--mm-ink);background:var(--mm-card);border:1px solid var(--mm-line);border-radius:12px;padding:10px 12px;margin:0 0 14px;}
    .mm-stack{display:flex;flex-direction:column;gap:8px;margin-top:14px;}
    @media(max-width:600px){
        .mm-panel-ov{align-items:flex-end;}
        .mm-panel{max-width:none;height:94vh;border-left:none;border-top:1px solid var(--mm-line2);border-radius:24px 24px 0 0;animation:mmSheet .32s cubic-bezier(.2,.9,.3,1);}
        .mm-panel-head{padding:18px 18px 12px;}
        .mm-panel-head::before{content:"";position:absolute;top:7px;left:50%;width:40px;height:4px;margin-left:-20px;border-radius:4px;background:rgba(165,205,188,0.25);}
        .mm-panel-body{padding:14px 16px 24px;}
        .mm-panel-foot{padding:12px 16px calc(14px + env(safe-area-inset-bottom));}
        .mm-kpi{padding:10px;}
        .mm-kpi-n{font-size:26px;}
        .mm-overlay:not(.mm-panel-ov){align-items:flex-end;padding:0;}
        .mm-overlay:not(.mm-panel-ov) .mm-modal{max-width:none;border-radius:24px 24px 0 0;padding-bottom:calc(24px + env(safe-area-inset-bottom));animation:mmSheet .3s ease;}
    }

    /* Inputs de DNI de las páginas (kit, servicios, fecha, depilación, index) */
    #kitDniInput:focus,#mcDni:focus,#dni:focus{border-color:#2ECC71 !important;box-shadow:0 0 0 3px rgba(46,204,113,0.2) !important;outline:none;}

    /* Indicador de progreso de reserva (fecha.html / depilacion.html) */
    .mm-steps{display:flex;align-items:flex-start;gap:0;margin:6px auto 18px;max-width:560px;font-family:var(--mm-sans);}
    .mm-step{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;position:relative;text-align:center;}
    .mm-step:not(:last-child)::after{content:"";position:absolute;top:14px;left:calc(50% + 18px);right:calc(-50% + 18px);height:2px;border-radius:2px;background:rgba(165,205,188,0.15);transition:background .4s;}
    .mm-step.done:not(:last-child)::after{background:linear-gradient(90deg,#2ECC71,rgba(46,204,113,0.4));}
    .mm-step-dot{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:600;border:1.5px solid rgba(165,205,188,0.25);color:var(--mm-faint);background:rgba(11,25,18,0.6);transition:all .3s;}
    .mm-step.active .mm-step-dot{border-color:#2ECC71;color:#06130c;background:#2ECC71;box-shadow:0 0 0 4px rgba(46,204,113,0.18);}
    .mm-step.done .mm-step-dot{border-color:#2ECC71;color:#2ECC71;background:rgba(46,204,113,0.12);}
    .mm-step-lbl{font-size:11px;line-height:1.3;color:var(--mm-faint);max-width:110px;transition:color .3s;}
    .mm-step.active .mm-step-lbl{color:var(--mm-ink);font-weight:500;}
    .mm-step.done .mm-step-lbl{color:var(--mm-muted);}

    @keyframes mmFade{from{opacity:0}to{opacity:1}}
    @keyframes mmUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
    @keyframes mmSlide{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
    @keyframes mmSheet{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
    @keyframes mmRot{to{transform:rotate(360deg)}}
    @keyframes mmShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
    @keyframes mmShimmer{from{background-position:200% 0}to{background-position:-200% 0}}
    @media(prefers-reduced-motion:reduce){.mm-overlay *,.mm-cuenta *{animation:none !important;transition:none !important;}}
    `;
    document.head.appendChild(st);
}

// ── Indicador de cuenta (header) ──
let _cuentaEl = null;
let _datosCliente = null;

function montarCuenta() {
    if (_cuentaEl) return;
    _cuentaEl = document.createElement("div");
    _cuentaEl.className = "mm-cuenta";
    // En index.html se integra a la barra de navegación existente
    const nav = document.querySelector(".nav-wrapper");
    if (nav) {
        _cuentaEl.classList.add("mm-en-nav");
        const grupo = document.createElement("div");
        grupo.className = "mm-nav-grupo";
        const cta = nav.querySelector(".nav-cta");
        const hamburger = nav.querySelector(".hamburger");
        nav.insertBefore(grupo, cta || hamburger || null);
        if (cta) grupo.appendChild(cta);
        grupo.appendChild(_cuentaEl);
    } else {
        document.body.appendChild(_cuentaEl);
    }
    document.addEventListener("click", (e) => {
        if (!_cuentaEl.contains(e.target)) _cuentaEl.querySelector(".mm-menu")?.classList.remove("open");
    });
    renderCuenta();
}

function renderCuenta() {
    if (!_cuentaEl) return;
    const s = obtener();
    if (!s) {
        _cuentaEl.innerHTML = `<button type="button" class="mm-chip" data-mm="login"><span class="mm-avatar" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg></span>
            <span class="mm-chip-txt">Ingresar con DNI</span></button>`;
        _cuentaEl.querySelector('[data-mm="login"]').onclick = () => abrirLogin({ alIngresar: () => abrirPanel() });
        return;
    }
    const nom = primerNombre(s.nombre) || "paciente";
    _cuentaEl.innerHTML = `
        <button type="button" class="mm-chip" aria-haspopup="menu" aria-expanded="false" data-mm="toggle">
            <span class="mm-avatar" aria-hidden="true">${escapeHtml(nom.charAt(0))}</span>
            <span class="mm-chip-txt">Hola, ${escapeHtml(nom)}<small>DNI ${escapeHtml(s.dni)}</small></span>
        </button>
        <div class="mm-menu" role="menu">
            <div class="mm-menu-head"><strong>${escapeHtml(s.nombre || nom)}</strong>DNI ${escapeHtml(s.dni)}</div>
            <button type="button" role="menuitem" data-mm="panel">📅&nbsp; Mis Sesiones</button>
            <button type="button" role="menuitem" class="mm-salir" data-mm="salir">↩&nbsp; Salir / Cambiar DNI</button>
        </div>`;
    const btn = _cuentaEl.querySelector('[data-mm="toggle"]');
    const menu = _cuentaEl.querySelector(".mm-menu");
    btn.onclick = () => { const o = menu.classList.toggle("open"); btn.setAttribute("aria-expanded", o); };
    _cuentaEl.querySelector('[data-mm="panel"]').onclick = () => { menu.classList.remove("open"); abrirPanel(); };
    _cuentaEl.querySelector('[data-mm="salir"]').onclick = () => cerrar();
}

// ── Modal de ingreso con DNI ──
let _loginOv = null;
let _alIngresar = null;
let _focoPrevio = null;

function abrirLogin(opts = {}) {
    // index.html tiene su propio modal (con el recorrido de alta: política,
    // historia clínica…); si la página lo expone, se usa ese.
    if (typeof window.mimarAbrirLoginPagina === "function" && !opts.forzarModulo) { window.mimarAbrirLoginPagina(); return; }
    _alIngresar = opts.alIngresar || null;
    if (!_loginOv) {
        _loginOv = document.createElement("div");
        _loginOv.className = "mm-overlay";
        _loginOv.setAttribute("role", "dialog");
        _loginOv.setAttribute("aria-modal", "true");
        _loginOv.setAttribute("aria-labelledby", "mmLoginTitulo");
        _loginOv.innerHTML = `
            <form class="mm-modal" novalidate>
                <button type="button" class="mm-x" aria-label="Cerrar">×</button>
                <p class="mm-eyebrow">Mi cuenta</p>
                <h2 class="mm-title" id="mmLoginTitulo">Ingresá con tu DNI</h2>
                <p class="mm-sub">Accedé a tus sesiones pendientes, tu historial y tus turnos, desde cualquier sección.</p>
                <input class="mm-input" id="mmDni" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12" placeholder="Tu DNI sin puntos" aria-describedby="mmDniHint">
                <p class="mm-hint" id="mmDniHint">7 u 8 números · podés escribirlo con o sin puntos</p>
                <button type="submit" class="mm-btn" id="mmLoginBtn">Ingresar</button>
                <div class="mm-error-box" id="mmLoginErr" role="alert"></div>
            </form>`;
        document.body.appendChild(_loginOv);
        const form = _loginOv.querySelector("form");
        const inp = _loginOv.querySelector("#mmDni");
        inp.addEventListener("input", () => { inp.value = inp.value.replace(/[^\d.\s-]/g, ""); inp.classList.remove("mm-err"); _loginOv.querySelector("#mmLoginErr").classList.remove("show"); });
        _loginOv.querySelector(".mm-x").onclick = cerrarLogin;
        _loginOv.addEventListener("click", (e) => { if (e.target === _loginOv) cerrarLogin(); });
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const btn = _loginOv.querySelector("#mmLoginBtn");
            const err = _loginOv.querySelector("#mmLoginErr");
            const dni = normalizarDni(inp.value);
            err.classList.remove("show");
            if (!dniValido(dni)) {
                inp.classList.remove("mm-err"); void inp.offsetWidth; inp.classList.add("mm-err");
                err.innerHTML = `<p>El DNI debe tener 7 u 8 números. Revisalo y probá de nuevo.</p>`;
                err.classList.add("show");
                return;
            }
            btn.disabled = true;
            btn.innerHTML = `<span class="mm-spin" aria-hidden="true"></span> Buscando tu ficha...`;
            const r = await ingresar(dni);
            btn.disabled = false;
            btn.textContent = "Ingresar";
            if (r.ok) {
                const cb = _alIngresar;
                cerrarLogin();
                cb?.(r);
                return;
            }
            inp.classList.remove("mm-err"); void inp.offsetWidth; inp.classList.add("mm-err");
            err.innerHTML = r.motivo === "no-registrado"
                ? `<p><strong style="color:#f6c9c9;font-weight:500;">Todavía no encontramos una ficha con el DNI ${escapeHtml(dni)}.</strong><br>Si es tu primera vez, el primer paso es la Consulta Inicial con Gimena 🌿</p>
                   <p><a class="mm-btn" href="/fecha.html">Agendar Consulta Inicial</a></p>`
                : `<p>No pudimos conectarnos en este momento. Revisá tu conexión e intentá de nuevo en unos segundos.</p>`;
            err.classList.add("show");
        });
    }
    _focoPrevio = document.activeElement;
    _loginOv.querySelector("#mmLoginErr").classList.remove("show");
    _loginOv.classList.add("open");
    document.body.style.overflow = "hidden";
    setTimeout(() => _loginOv.querySelector("#mmDni").focus(), 60);
}

function cerrarLogin() {
    if (!_loginOv?.classList.contains("open")) return;
    _loginOv.classList.remove("open");
    if (!_panelOv?.classList.contains("open")) document.body.style.overflow = "";
    _focoPrevio?.focus?.();
}

// ── Panel "Mis Sesiones" ──
let _panelOv = null;
let _turnos = { pendientes: [], realizadas: [], canceladas: [] };
let _tabActiva = "pendientes";

const esCancelado = (r) => [r.status, r.estado].some(v => String(v || "").toLowerCase().startsWith("cancelad"));
const inicioTurno = (r) => {
    if (!r.fecha || !r.hora) return null;
    const dt = new Date(`${r.fecha}T${String(r.hora).slice(0, 5)}:00-03:00`);
    return isNaN(dt.getTime()) ? null : dt;
};
const esRealizado = (r) => {
    const est = String(r.status || r.estado || "").toLowerCase();
    if (["realizado", "realizada", "completado", "completada", "finalizado", "finalizada"].includes(est)) return true;
    const ini = inicioTurno(r);
    return ini ? Date.now() >= ini.getTime() + DURACION_TURNO_MS : true;
};
// Motivos cargados como prueba ("Prueba 1", "Modo prueba", "SESESESE"…) no se muestran
const motivoVisible = (m) => {
    const t = String(m || "").trim();
    if (t.length < 4) return "";
    if (/prueb|probando|\btest/i.test(t)) return "";
    if (/^(asd+|qwe+|[.\-_ ]+)$/i.test(t) || /(.{1,3})\1{3,}/i.test(t)) return "";
    return t;
};
const cuentaRegresiva = (r) => {
    const ini = inicioTurno(r);
    if (!ini) return null;
    const diff = ini.getTime() - Date.now();
    if (diff <= 0) return { txt: "Turno en curso", urg: false };
    const min = Math.floor(diff / 60000);
    if (min < 60) return { txt: "Falta menos de 1 hora", urg: true };
    const hs = Math.floor(min / 60);
    if (hs < 48) return { txt: `Faltan ${hs} hora${hs !== 1 ? "s" : ""}`, urg: hs < 24 };
    const d = Math.floor(hs / 24);
    return { txt: `Faltan ${d} día${d !== 1 ? "s" : ""}`, urg: false };
};
const conAnticipacion = (r) => {
    const ini = inicioTurno(r);
    return ini ? (ini.getTime() - Date.now()) >= HORAS_ANTICIPACION_CANCELACION * 3600 * 1000 : false;
};
const linkWa = (txt) => `https://wa.me/${WA_NUMERO}?text=${encodeURIComponent(txt)}`;

function abrirPanel() {
    const s = obtener();
    if (!s) { abrirLogin({ alIngresar: () => abrirPanel(), forzarModulo: true }); return; }
    if (!_panelOv) {
        _panelOv = document.createElement("div");
        _panelOv.className = "mm-overlay mm-panel-ov";
        _panelOv.setAttribute("role", "dialog");
        _panelOv.setAttribute("aria-modal", "true");
        _panelOv.setAttribute("aria-labelledby", "mmPanelTitulo");
        _panelOv.addEventListener("click", (e) => { if (e.target === _panelOv) cerrarPanel(); });
        document.body.appendChild(_panelOv);
    }
    _focoPrevio = document.activeElement;
    _tabActiva = "pendientes";
    _panelOv.classList.add("open");
    document.body.style.overflow = "hidden";
    renderPanelEsqueleto(s);
    cargarTurnos(s);
}

function cerrarPanel() {
    if (!_panelOv?.classList.contains("open")) return;
    _panelOv.classList.remove("open");
    document.body.style.overflow = "";
    _focoPrevio?.focus?.();
}

function renderPanelEsqueleto(s) {
    _panelOv.innerHTML = `
        <aside class="mm-panel">
            <header class="mm-panel-head">
                <button type="button" class="mm-x" aria-label="Cerrar">×</button>
                <p class="mm-eyebrow">Panel de paciente</p>
                <h2 class="mm-title" id="mmPanelTitulo">Mis Sesiones</h2>
                <p class="mm-who">Hola, <strong>${escapeHtml(s.nombre || "paciente")}</strong> · DNI ${escapeHtml(s.dni)}</p>
            </header>
            <div class="mm-panel-body" id="mmPanelBody">
                <div class="mm-kpis"><div class="mm-skel" style="height:78px"></div><div class="mm-skel" style="height:78px"></div><div class="mm-skel" style="height:78px"></div></div>
                <div class="mm-list"><div class="mm-skel"></div><div class="mm-skel"></div></div>
            </div>
            <footer class="mm-panel-foot">
                <button type="button" class="mm-btn mm-sec" data-mm="salir">Salir / Cambiar DNI</button>
            </footer>
        </aside>`;
    _panelOv.querySelector(".mm-x").onclick = cerrarPanel;
    _panelOv.querySelector('[data-mm="salir"]').onclick = () => { cerrar(); abrirLogin({ alIngresar: () => abrirPanel(), forzarModulo: true }); };
}

async function cargarTurnos(s) {
    const body = _panelOv.querySelector("#mmPanelBody");
    try {
        const [snapR, snapD, cliente] = await Promise.all([
            getDocs(query(collection(db, "reservas"), where("dni", "==", s.dni))),
            getDocs(query(collection(db, "reservasDepi"), where("dni", "==", s.dni))).catch(() => null),
            _datosCliente ? Promise.resolve(_datosCliente) : buscarPaciente(s.dni).catch(() => null)
        ]);
        _datosCliente = cliente;
        const todos = [];
        snapR.forEach(d => todos.push({ id: d.id, _col: "reservas", ...d.data() }));
        snapD?.forEach(d => todos.push({ id: d.id, _col: "reservasDepi", ...d.data() }));
        const asc = (a, b) => (a.fecha || "").localeCompare(b.fecha || "") || String(a.hora || "").localeCompare(String(b.hora || ""));
        _turnos = {
            pendientes: todos.filter(r => !esCancelado(r) && !esRealizado(r)).sort(asc),
            realizadas: todos.filter(r => !esCancelado(r) && esRealizado(r)).sort((a, b) => asc(b, a)),
            canceladas: todos.filter(esCancelado).sort((a, b) => asc(b, a))
        };
        renderPanel();
    } catch (e) {
        console.error("[MimarSesion] Error cargando turnos:", e);
        body.innerHTML = `<div class="mm-empty"><div class="mm-empty-ico">🌿</div><h4>No pudimos cargar tus sesiones</h4><p>Revisá tu conexión e intentá de nuevo.</p><button type="button" class="mm-btn mm-sec" id="mmReintentar">Reintentar</button></div>`;
        body.querySelector("#mmReintentar").onclick = () => { renderPanelEsqueleto(s); cargarTurnos(s); };
    }
}

function renderPanel() {
    const body = _panelOv.querySelector("#mmPanelBody");
    const { pendientes, realizadas, canceladas } = _turnos;
    const prox = pendientes[0];
    const saldo = Number(_datosCliente?.hoursBalance);
    const haySaldo = Number.isFinite(saldo) && _datosCliente?.hoursBalance != null;
    body.innerHTML = `
        <div class="mm-kpis${haySaldo ? "" : " mm-k2"}">
            <div class="mm-kpi"><div class="mm-kpi-n mm-acc">${pendientes.length}</div><div class="mm-kpi-l">Pendientes</div><div class="mm-kpi-s">${prox ? `Próxima: ${formatFechaCorta(prox.fecha)}` : "Sin turnos próximos"}</div></div>
            <div class="mm-kpi"><div class="mm-kpi-n">${realizadas.length}</div><div class="mm-kpi-l">Realizadas</div><div class="mm-kpi-s">Historial total</div></div>
            ${haySaldo ? `<div class="mm-kpi"><div class="mm-kpi-n">${saldo}</div><div class="mm-kpi-l">Saldo</div><div class="mm-kpi-s">hora${saldo !== 1 ? "s" : ""} disponible${saldo !== 1 ? "s" : ""}</div></div>` : ""}
        </div>
        <div class="mm-tabs" role="tablist" aria-label="Mis sesiones">
            <button type="button" class="mm-tab" role="tab" id="mmTabP" aria-controls="mmTabPanel" data-tab="pendientes">Pendientes <span class="mm-count">${pendientes.length}</span></button>
            <button type="button" class="mm-tab" role="tab" id="mmTabR" aria-controls="mmTabPanel" data-tab="realizadas">Realizadas <span class="mm-count">${realizadas.length}</span></button>
        </div>
        <div class="mm-list" id="mmTabPanel" role="tabpanel"></div>
        ${canceladas.length ? `
        <div class="mm-acc">
            <button type="button" class="mm-acc-head" aria-expanded="false" aria-controls="mmCanceladas">
                <span>Ver historial de turnos cancelados (${canceladas.length})</span><span class="mm-acc-chev" aria-hidden="true">▾</span>
            </button>
            <div class="mm-acc-body mm-list" id="mmCanceladas"></div>
        </div>` : ""}`;

    const tabs = body.querySelectorAll(".mm-tab");
    const pintarTab = () => {
        tabs.forEach(t => { const sel = t.dataset.tab === _tabActiva; t.setAttribute("aria-selected", sel); t.tabIndex = sel ? 0 : -1; });
        const cont = body.querySelector("#mmTabPanel");
        cont.setAttribute("aria-labelledby", _tabActiva === "pendientes" ? "mmTabP" : "mmTabR");
        cont.innerHTML = _tabActiva === "pendientes" ? htmlPendientes() : htmlRealizadas();
        enlazarAcciones(cont);
    };
    tabs.forEach(t => {
        t.onclick = () => { _tabActiva = t.dataset.tab; pintarTab(); };
        t.onkeydown = (e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            _tabActiva = _tabActiva === "pendientes" ? "realizadas" : "pendientes";
            pintarTab();
            body.querySelector(`.mm-tab[data-tab="${_tabActiva}"]`).focus();
        };
    });
    pintarTab();

    const accHead = body.querySelector(".mm-acc-head");
    if (accHead) {
        const accBody = body.querySelector("#mmCanceladas");
        accHead.onclick = () => {
            const abierto = accHead.getAttribute("aria-expanded") === "true";
            accHead.setAttribute("aria-expanded", !abierto);
            accBody.classList.toggle("open", !abierto);
            if (!abierto && !accBody.innerHTML) accBody.innerHTML = canceladas.map(htmlCancelada).join("");
        };
    }
}

function htmlPendientes() {
    const lista = _turnos.pendientes;
    if (!lista.length) return `
        <div class="mm-empty"><div class="mm-empty-ico">🗓️</div><h4>No tenés sesiones pendientes</h4>
        <p>Cuando tengas un turno agendado lo vas a ver acá, con su fecha, horario y cuenta regresiva.</p></div>`;
    return lista.map((r, i) => {
        const cd = cuentaRegresiva(r);
        const estado = String(r.estado || r.status || "").toLowerCase();
        const badge = estado.startsWith("confirm") ? "Confirmada" : "Pendiente";
        const aTiempo = conAnticipacion(r);
        return `
        <article class="mm-card" style="animation-delay:${Math.min(i * 50, 300)}ms">
            <div class="mm-card-top"><div class="mm-card-serv">${escapeHtml(r.servicio || r.combo || "Tratamiento")}</div><span class="mm-badge mm-ok">${badge}</span></div>
            <div class="mm-card-meta">${formatFecha(r.fecha)} · ${escapeHtml(String(r.hora || "—").slice(0, 5))} hs</div>
            ${cd ? `<div class="mm-card-cd${cd.urg ? " mm-urg" : ""}">⏱ ${cd.txt}</div>` : ""}
            <div class="mm-card-actions">
                <button type="button" class="mm-btn mm-sec mm-sm" data-accion="reprogramar" data-i="${i}">Reprogramar</button>
                <a class="mm-btn mm-wa mm-sm" target="_blank" rel="noopener" href="${linkWa(`Hola! Te escribo por mi turno de ${r.servicio || "tratamiento"} del ${formatFecha(r.fecha)} a las ${String(r.hora || "").slice(0, 5)} hs.`)}">Consultar por WhatsApp</a>
            </div>
            ${aTiempo ? "" : `<div class="mm-card-note">Faltan menos de ${HORAS_ANTICIPACION_CANCELACION} hs: podés pedir la reprogramación, pero según nuestra política el turno puede considerarse utilizado.</div>`}
        </article>`;
    }).join("");
}

function htmlRealizadas() {
    const lista = _turnos.realizadas;
    if (!lista.length) return `
        <div class="mm-empty"><div class="mm-empty-ico">🌱</div><h4>Tu historial empieza pronto</h4>
        <p>Acá vas a ir viendo cada sesión que realices con nosotras. Cada una suma a tu proceso 💚</p></div>`;
    return lista.map((r, i) => `
        <article class="mm-card mm-c-done" style="animation-delay:${Math.min(i * 40, 300)}ms">
            <div class="mm-card-top"><div class="mm-card-serv">${escapeHtml(r.servicio || r.combo || "Tratamiento")}</div><span class="mm-badge mm-done">Realizada ✓</span></div>
            <div class="mm-card-meta">${formatFecha(r.fecha)} · ${escapeHtml(String(r.hora || "—").slice(0, 5))} hs</div>
        </article>`).join("");
}

function htmlCancelada(r) {
    const motivo = motivoVisible(r.motivoCancelacion || r.motivo);
    return `
        <article class="mm-card mm-c-cancel">
            <div class="mm-card-top"><div class="mm-card-serv">${escapeHtml(r.servicio || r.combo || "Tratamiento")}</div><span class="mm-badge mm-cancel">Cancelada</span></div>
            <div class="mm-card-meta">${formatFecha(r.fecha)} · ${escapeHtml(String(r.hora || "—").slice(0, 5))} hs</div>
            ${motivo ? `<div class="mm-motivo">Nota: ${escapeHtml(motivo)}</div>` : ""}
        </article>`;
}

function enlazarAcciones(cont) {
    cont.querySelectorAll('[data-accion="reprogramar"]').forEach(b => b.onclick = () => pedirReprogramacion(_turnos.pendientes[+b.dataset.i]));
}

// ── Reprogramación ──
// No modifica la reserva: arma un WhatsApp con el motivo para que el
// equipo reprograme el turno a mano.
let _reproOv = null;
function pedirReprogramacion(r) {
    const s = obtener();
    if (!r || !s) return;
    if (!_reproOv) {
        _reproOv = document.createElement("div");
        _reproOv.className = "mm-overlay";
        _reproOv.style.zIndex = "12100";
        _reproOv.setAttribute("role", "dialog");
        _reproOv.setAttribute("aria-modal", "true");
        _reproOv.setAttribute("aria-labelledby", "mmReproTitulo");
        _reproOv.addEventListener("click", (e) => { if (e.target === _reproOv) _reproOv.classList.remove("open"); });
        document.body.appendChild(_reproOv);
    }
    const info = `${r.servicio || "Tratamiento"} · ${formatFecha(r.fecha)} · ${String(r.hora || "").slice(0, 5)} hs`;
    _reproOv.innerHTML = `
        <div class="mm-modal" style="text-align:left;">
            <button type="button" class="mm-x" aria-label="Cerrar">×</button>
            <p class="mm-eyebrow">Reprogramar turno</p>
            <h2 class="mm-title" id="mmReproTitulo" style="font-size:24px;">¿Necesitás cambiar tu turno?</h2>
            <p class="mm-confirm-info">${escapeHtml(info)}</p>
            <label for="mmMotivo" style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--mm-faint);">Motivo *</label>
            <textarea id="mmMotivo" class="mm-textarea" placeholder="Contanos brevemente por qué necesitás reprogramar"></textarea>
            <label for="mmPreferencia" style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--mm-faint);">¿Qué días u horarios te quedan mejor? (opcional)</label>
            <textarea id="mmPreferencia" class="mm-textarea" style="min-height:60px;" placeholder="Ej: martes o jueves por la tarde"></textarea>
            <p class="mm-hint" style="text-align:left;margin:4px 0 0;">Se abrirá WhatsApp con tu mensaje listo para enviar. Te respondemos con las nuevas opciones de turno.</p>
            <div class="mm-stack">
                <button type="button" class="mm-btn" id="mmReproOk">Enviar pedido por WhatsApp</button>
                <button type="button" class="mm-btn mm-sec" id="mmReproNo">Volver</button>
            </div>
            <div class="mm-error-box" id="mmReproMsg" role="status" style="background:rgba(46,204,113,0.06);border-color:rgba(46,204,113,0.25);"></div>
        </div>`;
    const cerrarR = () => _reproOv.classList.remove("open");
    _reproOv.querySelector(".mm-x").onclick = cerrarR;
    _reproOv.querySelector("#mmReproNo").onclick = cerrarR;
    _reproOv.querySelector("#mmReproOk").onclick = () => {
        const ta = _reproOv.querySelector("#mmMotivo");
        const motivo = ta.value.trim();
        if (motivo.length < 3) { ta.classList.remove("mm-err"); void ta.offsetWidth; ta.classList.add("mm-err"); ta.focus(); return; }
        const pref = _reproOv.querySelector("#mmPreferencia").value.trim();
        const msg = `Hola! Necesito reprogramar mi turno.\n\nPaciente: ${s.nombre || "—"} (DNI ${s.dni})\nTurno: ${r.servicio || "Tratamiento"}\nFecha: ${formatFecha(r.fecha)} · ${String(r.hora || "").slice(0, 5)} hs\n\nMotivo: ${motivo}${pref ? `\nDisponibilidad: ${pref}` : ""}`;
        const url = linkWa(msg);
        window.open(url, "_blank");
        const box = _reproOv.querySelector("#mmReproMsg");
        box.innerHTML = `<p style="color:var(--mm-ink);">Listo, abrimos WhatsApp con tu pedido. Solo falta tocar <strong>Enviar</strong>. Tu turno sigue reservado hasta que te confirmemos el cambio.</p>
            <p><a class="mm-btn mm-wa" target="_blank" rel="noopener" href="${url}">¿No se abrió? Tocá acá</a></p>`;
        box.classList.add("show");
        _reproOv.querySelector("#mmReproOk").style.display = "none";
        _reproOv.querySelector("#mmReproNo").textContent = "Cerrar";
    };
    _reproOv.classList.add("open");
    setTimeout(() => _reproOv.querySelector("#mmMotivo").focus(), 60);
}
// ── Indicador de progreso de reserva ──
// Se monta donde la página tenga [data-mm-pasos="Etiqueta 1|Etiqueta 2|Etiqueta 3"]
// y se actualiza solo, observando el botón "Continuar" y el modal de datos.
function montarPasos() {
    const cont = document.querySelector("[data-mm-pasos]");
    if (!cont) return;
    const etiquetas = cont.dataset.mmPasos.split("|");
    cont.className = "mm-steps";
    cont.setAttribute("aria-label", "Progreso de la reserva");
    cont.innerHTML = etiquetas.map((t, i) => `<div class="mm-step"><span class="mm-step-dot">${i + 1}</span><span class="mm-step-lbl">${escapeHtml(t)}</span></div>`).join("");
    const pasos = cont.querySelectorAll(".mm-step");
    const btn = document.getElementById("reservarBtn");
    const modal = document.getElementById("modalDepi") || document.getElementById("modalConsulta");
    const paso2Modal = document.getElementById("mcStep2");
    const exito = document.getElementById("mcStep3");
    const actualizar = () => {
        let n = 0;
        if (btn && !btn.disabled) n = 1;
        if (modal?.classList.contains("open")) n = 1;
        if (paso2Modal?.classList.contains("active")) n = 2;
        if (exito?.classList.contains("active")) n = 3;
        pasos.forEach((p, i) => { p.classList.toggle("done", i < n); p.classList.toggle("active", i === n); p.setAttribute("aria-current", i === n ? "step" : "false"); });
    };
    const obs = new MutationObserver(actualizar);
    [btn, modal, paso2Modal, exito].filter(Boolean).forEach(el => obs.observe(el, { attributes: true, attributeFilter: ["disabled", "class"] }));
    actualizar();
}

// En las páginas de reserva, si la paciente ya ingresó, se completa su DNI
// (y el autocompletado de la ficha que esas páginas ya hacen al salir del campo)
// Espera a "load" para que la página ya haya registrado su listener de blur.
function precargarDniReserva() {
    const precargar = () => {
        const s = obtener();
        const inp = document.getElementById("mcDni");
        if (!s || !inp || inp.value) return;
        inp.value = s.dni;
        inp.dispatchEvent(new Event("blur"));
    };
    if (document.readyState === "complete") setTimeout(precargar, 0);
    else window.addEventListener("load", precargar, { once: true });
}

// ── Init ──
function init() {
    inyectarEstilos();
    montarCuenta();
    montarPasos();
    precargarDniReserva();
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (_reproOv?.classList.contains("open")) { _reproOv.classList.remove("open"); return; }
        if (_loginOv?.classList.contains("open")) { cerrarLogin(); return; }
        cerrarPanel();
    });
}

window.MimarSesion = { obtener, guardar, cerrar, ingresar, buscarPaciente, normalizarDni, dniValido, abrirLogin, abrirPanel, cerrarPanel };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
