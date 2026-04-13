import { db, collection, onSnapshot, doc, updateDoc, getDocs } from "./firebase-web.js";

let reservas = [];
let diccionarioClientes = {};
let mesActual = new Date().getMonth();
let yearActual = new Date().getFullYear();

// 1. CARGAR CLIENTES (DNI -> Nombre/Tel)
async function cargarDiccionario() {
    const snap = await getDocs(collection(db, "clients"));
    diccionarioClientes = {};
    snap.forEach(d => {
        const c = d.data();
        if (c.dni) {
            diccionarioClientes[c.dni] = {
                nombre: c.fullName || "Sin nombre",
                tel: c.phone || ""
            };
        }
    });
}

// 2. ESCUCHAR RESERVAS EN TIEMPO REAL
async function iniciar() {
    await cargarDiccionario();
    onSnapshot(collection(db, "reservas"), (snapshot) => {
        reservas = snapshot.docs.map(d => {
            const data = d.data();
            const info = diccionarioClientes[data.dni] || { nombre: data.fullName || "Paciente", tel: data.phone || "" };
            return { id: d.id, ...data, nombreFinal: info.nombre, telFinal: info.tel };
        });
        renderCalendario();
    });
}

// 3. RENDERIZAR CALENDARIO
function renderCalendario() {
    const container = document.getElementById("agendaContainer");
    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px">
            <button onclick="window.cambiarMes(-1)" style="border:none; background:none; font-size:20px; cursor:pointer">◀</button>
            <h2 style="margin:0; font-family:'Playfair Display'">${obtenerNombreMes(mesActual)} ${yearActual}</h2>
            <button onclick="window.cambiarMes(1)" style="border:none; background:none; font-size:20px; cursor:pointer">▶</button>
        </div>
        <div class="diasSemana"><div>Lu</div><div>Ma</div><div>Mi</div><div>Ju</div><div>Vi</div><div>Sa</div><div>Do</div></div>
        <div id="gridDias" class="gridDias"></div>
    `;

    const grid = document.getElementById("gridDias");
    const primerDia = new Date(yearActual, mesActual, 1).getDay();
    const totalDias = new Date(yearActual, mesActual + 1, 0).getDate();
    const offset = (primerDia === 0) ? 6 : primerDia - 1;

    for (let i = 0; i < offset; i++) grid.appendChild(document.createElement("div"));

    for (let d = 1; d <= totalDias; d++) {
        const fecha = `${yearActual}-${String(mesActual + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const tieneTurno = reservas.some(r => r.fecha === fecha);
        const el = document.createElement("div");
        el.className = `day ${tieneTurno ? 'ocupado' : ''}`;
        el.innerText = d;
        el.onclick = () => mostrarTurnosDia(fecha);
        grid.appendChild(el);
    }
}

// URL de la Cloud Function de resumen (producción)
const CF_RESUMEN_URL = "https://us-central1-estetica-8d067.cloudfunctions.net/enviarResumenSesion";

// 4. MOSTRAR DETALLE DEL DÍA
function mostrarTurnosDia(fecha) {
    const container = document.getElementById("agendaContainer");
    const lista = reservas.filter(r => r.fecha === fecha).sort((a,b) => a.hora.localeCompare(b.hora));

    container.innerHTML = `<h3 style="font-family:'Playfair Display'">Turnos: ${fecha.split('-').reverse().join('/')}</h3>`;

    if (lista.length === 0) {
        container.innerHTML += "<p>No hay turnos hoy.</p>";
    }

    lista.forEach(t => {
        const card = document.createElement("div");
        card.className = "card-turno";
        card.style.cssText = "background:white; padding:15px; border-radius:15px; margin-bottom:10px; box-shadow:0 4px 10px rgba(0,0,0,0.05); text-align:left; position:relative";

        const tieneNota = !!(t.detalleSesion && t.detalleSesion.trim());

        card.innerHTML = `
            <strong style="font-size:16px">${escapeHtml(t.nombreFinal)}</strong><br>
            <small style="color:#666">${t.hora} hs — ${escapeHtml(t.servicio || 'Tratamiento')}</small>

            ${tieneNota ? `
            <div id="nota-display-${t.id}" style="margin-top:10px; background:#f3faf6; border:1px solid #b6dfc9; border-radius:10px; padding:10px; font-size:14px; color:#2f5a47; white-space:pre-wrap; position:relative">
                ${escapeHtml(t.detalleSesion)}
                <button title="Editar nota" onclick="window.activarEdicionNota('${t.id}')" style="position:absolute; top:8px; right:8px; background:none; border:none; cursor:pointer; font-size:16px; line-height:1">✏️</button>
            </div>
            <div id="nota-edit-${t.id}" style="display:none">
                <textarea id="nota-${t.id}" style="width:100%; margin-top:8px; border-radius:10px; border:1px solid #ddd; padding:8px; box-sizing:border-box" placeholder="Detalle de la sesión...">${escapeHtml(t.detalleSesion || "")}</textarea>
                <div style="display:flex; gap:8px; margin-top:8px">
                    <button onclick="window.guardarNota('${t.id}','${fecha}')" style="flex:1; background:#72bd99; color:white; border:none; padding:10px; border-radius:10px; cursor:pointer; font-weight:600">💾 Guardar</button>
                    <button onclick="window.cancelarEdicion('${t.id}')" style="background:#eee; border:none; padding:10px 14px; border-radius:10px; cursor:pointer; color:#555">Cancelar</button>
                </div>
            </div>
            ` : `
            <textarea id="nota-${t.id}" style="width:100%; margin-top:10px; border-radius:10px; border:1px solid #ddd; padding:8px; box-sizing:border-box" placeholder="Detalle de la sesión..."></textarea>
            <div style="display:flex; gap:8px; margin-top:8px">
                <button onclick="window.guardarNota('${t.id}','${fecha}')" style="flex:1; background:#72bd99; color:white; border:none; padding:10px; border-radius:10px; cursor:pointer; font-weight:600">💾 Guardar Registro</button>
            </div>
            `}
        `;
        container.appendChild(card);
    });

    // Botón enviar resumen del día por WhatsApp (solo si hay turnos)
    if (lista.length > 0) {
        const btnResumen = document.createElement("button");
        btnResumen.innerHTML = "📲 Enviar resumen del día por WhatsApp";
        btnResumen.style.cssText = "width:100%; margin-top:10px; padding:13px; border-radius:12px; border:none; background:#25d366; color:white; font-weight:700; cursor:pointer; font-size:14px";
        btnResumen.onclick = () => enviarResumenDia(fecha, lista);
        container.appendChild(btnResumen);
    }

    const btnVolver = document.createElement("button");
    btnVolver.innerText = "← Volver al Calendario";
    btnVolver.style.cssText = "width:100%; margin-top:10px; padding:12px; border-radius:12px; border:1px solid #ddd; background:#f9f9f9; cursor:pointer";
    btnVolver.onclick = renderCalendario;
    container.appendChild(btnVolver);
}

// Activa edición inline de la nota
window.activarEdicionNota = (id) => {
    document.getElementById(`nota-display-${id}`).style.display = "none";
    const editArea = document.getElementById(`nota-edit-${id}`);
    editArea.style.display = "block";
    document.getElementById(`nota-${id}`).focus();
};

window.cancelarEdicion = (id) => {
    document.getElementById(`nota-display-${id}`).style.display = "block";
    document.getElementById(`nota-edit-${id}`).style.display = "none";
};

// 5. GUARDAR NOTA Y ENVIAR WHATSAPP
window.guardarNota = async (id, fecha) => {
    const el = document.getElementById(`nota-${id}`);
    if (!el) return;
    const nota = el.value.trim();

    try {
        await updateDoc(doc(db, "reservas", id), { detalleSesion: nota });

        // Actualizar el objeto en memoria para que el botón de resumen lo tome
        const idx = reservas.findIndex(r => r.id === id);
        if (idx !== -1) reservas[idx].detalleSesion = nota;

        // Actualizar vista: mostrar bloque guardado con lápiz
        const displayEl = document.getElementById(`nota-display-${id}`);
        if (displayEl) {
            displayEl.innerHTML = `${escapeHtml(nota)}<button title="Editar nota" onclick="window.activarEdicionNota('${id}')" style="position:absolute; top:8px; right:8px; background:none; border:none; cursor:pointer; font-size:16px; line-height:1">✏️</button>`;
            displayEl.style.display = "block";
            const editArea = document.getElementById(`nota-edit-${id}`);
            if (editArea) editArea.style.display = "none";
        } else {
            // Primera vez que se guarda: reemplazar el textarea por el bloque display
            const card = el.closest(".card-turno");
            el.replaceWith((() => {
                const d = document.createElement("div");
                d.id = `nota-display-${id}`;
                d.style.cssText = "margin-top:10px; background:#f3faf6; border:1px solid #b6dfc9; border-radius:10px; padding:10px; font-size:14px; color:#2f5a47; white-space:pre-wrap; position:relative";
                d.innerHTML = `${escapeHtml(nota)}<button title="Editar nota" onclick="window.activarEdicionNota('${id}')" style="position:absolute; top:8px; right:8px; background:none; border:none; cursor:pointer; font-size:16px; line-height:1">✏️</button>`;
                return d;
            })());
            // Quitar el botón guardar originario (está en el sibling div)
            const botonesDiv = card.querySelector(`div[style*="gap:8px"]`);
            if (botonesDiv) botonesDiv.remove();
        }

        // Envío automático por WhatsApp al guardar
        const reserva = reservas.find(r => r.id === id);
        if (reserva && reserva.telFinal && nota) {
            await enviarNota1a1(reserva, nota);
        }

        mostrarToast("Registro guardado ✓");
    } catch (e) {
        console.error(e);
        mostrarToast("Error al guardar registro");
    }
};

// Envío inmediato de una nota individual vía Cloud Function
async function enviarNota1a1(reserva, nota) {
    if (!reserva.telFinal) return;
    try {
        const r = await fetch(CF_RESUMEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                tel: reserva.telFinal,
                nombre: reserva.nombreFinal,
                fecha: reserva.fecha,
                sesiones: [{ hora: reserva.hora, servicio: reserva.servicio || "Tratamiento", detalle: nota }]
            })
        });
        if (r.ok) mostrarToast("Resumen enviado por WhatsApp 📲");
    } catch (e) { console.error("WA enviarNota1a1:", e); }
}

// Envío del resumen completo del día (botón manual)
async function enviarResumenDia(fecha, lista) {
    // Si hay pacientes con distintos teléfonos, enviar uno a uno
    const porCliente = {};
    lista.forEach(t => {
        if (!t.telFinal) return;
        if (!porCliente[t.telFinal]) porCliente[t.telFinal] = { tel: t.telFinal, nombre: t.nombreFinal, sesiones: [] };
        porCliente[t.telFinal].sesiones.push({ hora: t.hora, servicio: t.servicio || "Tratamiento", detalle: t.detalleSesion || "" });
    });

    const clientes = Object.values(porCliente);
    if (!clientes.length) { mostrarToast("Sin teléfonos registrados"); return; }

    mostrarToast("Enviando resúmenes...");

    let ok = 0;
    for (const c of clientes) {
        try {
            const r = await fetch(CF_RESUMEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tel: c.tel, nombre: c.nombre, fecha, sesiones: c.sesiones })
            });
            if (r.ok) ok++;
        } catch (e) { console.error("resumenDia error:", e); }
    }
    mostrarToast(`✅ ${ok}/${clientes.length} resúmenes enviados`);
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 5b. AVISAR TURNO PRÓXIMO (botón individual - ya existía)
window.enviarWS = (tel, nombre, fecha, hora, servicio) => {
    if (!tel) return mostrarToast("Sin teléfono registrado");
    const dias = ["Dom.", "Lun.", "Mar.", "Mié.", "Jue.", "Vie.", "Sáb."];
    const [y, m, d] = fecha.split('-');
    const fObj = new Date(y, m - 1, d);
    const fechaLinda = `${dias[fObj.getDay()]} ${d}/${m}`;
    const msg = `Hola *${nombre}* 😊%0A%0ATe confirmo tu turno en *Espacio Mimar T*:%0A%0A📅 *Día:* ${fechaLinda}%0A🕒 *Hora:* ${hora} hs%0A✨ *Servicio:* ${servicio || "Tratamiento"}%0A%0A¡Te esperamos! 💜`;
    let num = tel.toString().replace(/\D/g, "");
    if (!num.startsWith("54")) num = "549" + num;
    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
};

window.cambiarMes = (n) => { 
    mesActual += n; 
    if(mesActual < 0){ mesActual = 11; yearActual--; } 
    if(mesActual > 11){ mesActual = 0; yearActual++; } 
    renderCalendario(); 
};


// --- BUSCADOR DE SERVICIOS REALIZADOS (solo fechas pasadas) ---
window.buscarServiciosRealizadosInput = function() {
    const input = document.getElementById('inpBuscadorRealizados');
    const cont = document.getElementById('contenedorServiciosRealizados');
    const filtro = (input.value || '').toLowerCase().trim();
    if (!filtro) {
        cont.innerHTML = '<div class="empty-state">Escribe el nombre o parte del nombre de la paciente...</div>';
        return;
    }
    // Solo fechas pasadas (hoy o antes)
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const lista = reservas.filter(r => {
        const nombre = (r.nombreFinal || '').toLowerCase();
        const fechaObj = parsearFecha(r.fecha);
        return nombre.includes(filtro) && fechaObj && fechaObj <= hoy;
    }).sort((a,b) => parsearFecha(b.fecha) - parsearFecha(a.fecha));

    if (!lista.length) {
        cont.innerHTML = '<div class="empty-state">No se encontraron sesiones pasadas para ese nombre.</div>';
        return;
    }
    cont.innerHTML = lista.map(r => `
        <div class="detalle-dia-card" style="margin-bottom:10px;">
            <b>${escapeHtml(r.nombreFinal)}</b> <span class="tag-fecha">${escapeHtml(r.fecha)} ${escapeHtml(r.hora || '')}</span><br>
            <span style="color:#4a7c6a; font-weight:600">${escapeHtml(r.servicio || 'Tratamiento')}</span>
            <div style="margin-top:7px;">
                <b>Nota:</b> <span>${escapeHtml(r.detalleSesion || '(sin nota)')}</span>
                <button class="btn-mini" style="margin-left:10px;" onclick="window.activarEdicionNota('${r.id}')">Editar</button>
            </div>
        </div>
    `).join('');
};
// --- FIN BUSCADOR DE SERVICIOS REALIZADOS ---

function obtenerNombreMes(m) { 
    return ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][m]; 
}

iniciar();