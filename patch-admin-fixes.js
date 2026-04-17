const fs = require('fs');
const buf = fs.readFileSync('admin.html');
let content = buf.toString('utf16le');

// ── 1. Fix nombreLimpio in cargarTodo to use more fallback fields ──────────────
const nombreLimpioTarget = `const nombreLimpio = borrarEtiquetaDNI(data.clienteNombre || data.nombre || "");`;
const nombreLimpioReplacement = `const nombreLimpio = borrarEtiquetaDNI(data.clienteNombre || data.nombre || data.cliente || data.title || data.displayName || "");`;
if (content.includes(nombreLimpioTarget)) {
    content = content.replace(nombreLimpioTarget, nombreLimpioReplacement);
    console.log('✅ Fix 1: nombreLimpio fallback fields');
} else {
    console.warn('⚠️  Fix 1 target not found');
}

// ── 2. Replace enviarDetalleManual with Cloud Function version ─────────────────
const detalleOld = `window.enviarDetalleManual = function(id) {
            var r = todasLasReservas.find(function(x) { return x.id === id; });
            if (!r) return;
            var notaEl = document.getElementById('n-' + id);
            var nota = ((notaEl && notaEl.value) || r.detalleSesion || "").trim();
            if (!nota) { mostrarAviso("Escribi el detalle de la sesion primero"); return; }
            var telefonoDestino = r.phone || r.telefono || r.whatsapp || "";
            if (!telefonoDestino) { mostrarAviso("Sin telefono registrado"); return; }
            var num = formatearTelefonoWhatsApp(telefonoDestino);
            var texto = "Hola " + r.nombreLimpio + ", resumen de tu sesion del " + r.fecha + " a las " + r.hora + ":\\n\\nServicio: " + (r.servicio || "-") + "\\n\\n" + nota;
            var waUrl = "https://wa.me/" + num + "?text=" + encodeURIComponent(texto);
            window.open(waUrl, "_blank");
            mostrarAviso("WhatsApp abierto para " + r.nombreLimpio + ". Revisa la app y presiona Enviar.");
        };`;

const detalleNew = `window.enviarDetalleManual = async function(id) {
            var r = todasLasReservas.find(function(x) { return x.id === id; });
            if (!r) return;
            var notaEl = document.getElementById('n-' + id);
            var nota = ((notaEl && notaEl.value) || r.detalleSesion || "").trim();
            if (!nota) { mostrarAviso("Escribi el detalle de la sesion primero"); return; }
            var telefonoDestino = r.phone || r.telefono || r.whatsapp || "";
            if (!telefonoDestino) { mostrarAviso("Sin telefono registrado para " + r.nombreLimpio); return; }
            mostrarAviso("Enviando resumen a " + r.nombreLimpio + "...");
            try {
                var resp = await fetch('https://us-central1-estetica-8d067.cloudfunctions.net/enviarResumenSesion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tel: telefonoDestino,
                        nombre: r.nombreLimpio,
                        fecha: r.fecha,
                        sesiones: [{ hora: r.hora || '', servicio: r.servicio || 'Tratamiento', detalle: nota }]
                    })
                });
                var result = await resp.json().catch(function() { return {}; });
                if (!resp.ok) throw new Error(result.error || 'Error del servidor');
                try { await updateDoc(doc(db, 'reservas', id), { detalleSesion: nota }); } catch(_) {}
                mostrarAviso('✅ Resumen enviado por WhatsApp a ' + r.nombreLimpio);
            } catch(e) {
                console.error(e);
                mostrarAviso('❌ No se pudo enviar: ' + (e.message || 'intenta de nuevo'));
            }
        };`;

if (content.includes(detalleOld)) {
    content = content.replace(detalleOld, detalleNew);
    console.log('✅ Fix 2: enviarDetalleManual uses Cloud Function');
} else {
    // Try a more flexible match
    const startMarker = `window.enviarDetalleManual = function(id) {`;
    const endMarker = `mostrarAviso("WhatsApp abierto para " + r.nombreLimpio + ". Revisa la app y presiona Enviar.");\r\n        };`;
    const start = content.indexOf(startMarker);
    const end = content.indexOf(endMarker);
    if (start !== -1 && end !== -1) {
        content = content.slice(0, start) + detalleNew + content.slice(end + endMarker.length);
        console.log('✅ Fix 2 (flexible): enviarDetalleManual replaced');
    } else {
        console.warn('⚠️  Fix 2 target not found. Start:', start, 'End:', end);
    }
}

// ── 3. Fix enviarWaKit onclick - replace JSON.stringify with proper quoting ─────
const kitFuncOld = `'onclick="enviarWaKit(' + JSON.stringify(p.id) + ',' + JSON.stringify(p.dni || '') + ',' + JSON.stringify(p.nombrePaciente || '') + ')"'`;
const kitFuncNew = `'onclick="enviarWaKit(\\'' + (p.id || '').replace(/'/g,\"\\\\\\\\'\\") + '\\',\\'' + (p.dni || '').replace(/'/g,\"\\\\\\\\'\\") + '\\',\\'' + (p.nombrePaciente || '').replace(/'/g,\"\\\\\\\\'\\") + '\\')"'`;

if (content.includes(kitFuncOld)) {
    content = content.replace(kitFuncOld, kitFuncNew);
    console.log('✅ Fix 3: enviarWaKit onclick quoting');
} else {
    // Try alternative - replace the whole button line
    const btnOld = `'<button onclick="enviarWaKit(' + JSON.stringify(p.id) + ',' + JSON.stringify(p.dni || '') + ',' + JSON.stringify(p.nombrePaciente || '') + ')" `;
    const btnNew = `'<button onclick="enviarWaKit(\\'' + (p.id || '') + '\\',\\'' + (p.dni || '') + '\\',\\'' + (p.nombrePaciente || '').replace(/'/g, \"\\\\'\\") + '\\')" `;
    if (content.includes(btnOld)) {
        content = content.replace(btnOld, btnNew);
        console.log('✅ Fix 3 (btn): enviarWaKit onclick quoting');
    } else {
        // Find by context
        const kitButtonIdx = content.indexOf('enviarWaKit(');
        if (kitButtonIdx !== -1) {
            const lineStart = content.lastIndexOf("'<button onclick=", kitButtonIdx);
            const lineEnd = content.indexOf(')"\'', kitButtonIdx);
            if (lineStart !== -1 && lineEnd !== -1) {
                console.log('Context around enviarWaKit onclick:', JSON.stringify(content.slice(lineStart, lineEnd + 10)));
            }
        }
        console.warn('⚠️  Fix 3 target not found');
    }
}

// Write back with BOM
const BOM = Buffer.from([0xFF, 0xFE]);
const encoded = Buffer.from(content, 'utf16le');
fs.writeFileSync('admin.html', Buffer.concat([BOM, encoded]));
console.log('Done!');
