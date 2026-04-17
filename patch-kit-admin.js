const fs = require('fs');
const buf = fs.readFileSync('admin.html');
const content = buf.toString('utf16le');

// 1. Add nav button before "Exportar" button
const navTarget = `<button class="btn-nav" id="btn-export" onclick="navegar('export')">Exportar</button>`;
const navReplacement = `<button class="btn-nav" id="btn-pedidos-kit" onclick="navegar('pedidos-kit')">Pedidos de Kit</button>\r\n                <button class="btn-nav" id="btn-export" onclick="navegar('export')">Exportar</button>`;

if (!content.includes(navTarget)) {
    console.error('ERROR: nav target not found');
    process.exit(1);
}

let updated = content.replace(navTarget, navReplacement);

// 2. Add sec-pedidos-kit section before sec-export
const sectionTarget = `            <div id="sec-export" class="section">`;
const newSection = `            <div id="sec-pedidos-kit" class="section">
                <div class="detalle-dia-card">
                    <h3 style="margin-top:0">Pedidos de Kit Facial</h3>
                    <p style="font-size:13px; color:#557b6b; margin:0 0 14px 0;">Pacientes que solicitaron su kit facial domiciliario.</p>
                    <div id="listaPedidosKit" style="font-size:13px; color:#557b6b;">Cargando pedidos...</div>
                </div>
            </div>

            <div id="sec-export" class="section">`;

if (!updated.includes(sectionTarget)) {
    console.error('ERROR: section target not found');
    process.exit(1);
}

updated = updated.replace(sectionTarget, newSection);

// 3. Add cargarPedidosKit function before window.navegar
const funcTarget = `        window.navegar = (s) => { `;
const kitFunc = `        window.cargarPedidosKit = async function() {
            const cont = document.getElementById('listaPedidosKit');
            if (!cont) return;
            cont.innerHTML = 'Cargando...';
            try {
                const snap = await getDocs(collection(db, 'pedidosKit'));
                if (snap.empty) {
                    cont.innerHTML = '<p style="color:#88948f;">No hay pedidos registrados todavía.</p>';
                    return;
                }
                const pedidos = [];
                snap.forEach(function(d) { pedidos.push({ id: d.id, ...d.data() }); });
                pedidos.sort(function(a, b) { return (b.createdAt || b.fecha || '').localeCompare(a.createdAt || a.fecha || ''); });

                const formatFecha = function(isoStr) {
                    if (!isoStr) return '-';
                    const d = new Date(isoStr);
                    if (isNaN(d)) return isoStr;
                    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                };

                cont.innerHTML = pedidos.map(function(p) {
                    const prods = Array.isArray(p.productos) ? p.productos.join(', ') : (p.productos || '-');
                    const estadoBadge = p.estado === 'listo'
                        ? '<span style="background:#e8f5ee;color:#3a7a5a;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">Listo</span>'
                        : '<span style="background:#fff8e1;color:#8a6c00;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">Pendiente</span>';
                    return '<div style="background:#fafafa;border:1px solid #e0ece6;border-radius:14px;padding:14px 16px;margin-bottom:12px;">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">' +
                            '<strong style="font-size:15px;color:#1e3028;">' + (p.nombrePaciente || '-') + '</strong>' +
                            estadoBadge +
                        '</div>' +
                        '<div style="font-size:12px;color:#5a7265;line-height:1.7;">' +
                            '<div><strong>DNI:</strong> ' + (p.dni || '-') + '</div>' +
                            '<div><strong>Productos:</strong> ' + prods + '</div>' +
                            '<div><strong>Fecha solicitud:</strong> ' + formatFecha(p.createdAt || p.fecha) + '</div>' +
                            (p.descripcionPiel ? '<div style="margin-top:6px;background:#f2f7f4;padding:8px 10px;border-radius:8px;"><strong>Descripción piel:</strong> ' + p.descripcionPiel + '</div>' : '') +
                        '</div>' +
                        '<button onclick="enviarWaKit(' + JSON.stringify(p.id) + ',' + JSON.stringify(p.dni || '') + ',' + JSON.stringify(p.nombrePaciente || '') + ')" ' +
                            'style="margin-top:10px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">📲 Avisar por WhatsApp</button>' +
                    '</div>';
                }).join('');
            } catch(e) {
                console.error(e);
                cont.innerHTML = '<p style="color:#c0392b;">Error al cargar pedidos.</p>';
            }
        };

        window.enviarWaKit = async function(pedidoId, dni, nombre) {
            var phone = '';
            if (dni) {
                try {
                    var clienteSnap = await getDoc(doc(db, 'clients', dni));
                    if (clienteSnap.exists()) {
                        var cd = clienteSnap.data();
                        phone = cd.phone || cd.telefono || cd.whatsapp || '';
                    }
                } catch(_) {}
            }
            if (!phone) { mostrarAviso('No hay teléfono registrado para este paciente.'); return; }
            var num = formatearTelefonoWhatsApp(phone);
            var msg = 'Hola ' + nombre + ', gracias por ser parte de Espacio Mimar T 💚 te escribo para avisarte que ya está listo tu kit facial personalizado, lo podés retirar en el espacio cuando quieras. ¡Cualquier consulta estoy acá!';
            var url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
            window.open(url, '_blank');
        };

        window.navegar = (s) => { `;

if (!updated.includes(funcTarget)) {
    console.error('ERROR: func target not found');
    process.exit(1);
}

updated = updated.replace(funcTarget, kitFunc);

// 4. Hook cargarPedidosKit into navegar
const navegarBody = `document.querySelectorAll('.section, '.btn-nav').forEach(x => x.classList.remove('active')); `;
// Actually let's find the navegar function and add a hook
const navegarTarget = `document.getElementById(\`sec-\${s}\`).classList.add('active');
            document.getElementById(\`btn-\${s}\`).classList.add('active');
        };`;

const navegarReplacement = `document.getElementById(\`sec-\${s}\`).classList.add('active');
            document.getElementById(\`btn-\${s}\`).classList.add('active');
            if (s === 'pedidos-kit') window.cargarPedidosKit();
        };`;

if (!updated.includes(navegarTarget)) {
    // Try with different line endings
    const alt = `document.getElementById(\`sec-\${s}\`).classList.add('active');\r\n            document.getElementById(\`btn-\${s}\`).classList.add('active');\r\n        };`;
    if (updated.includes(alt)) {
        updated = updated.replace(alt, `document.getElementById(\`sec-\${s}\`).classList.add('active');\r\n            document.getElementById(\`btn-\${s}\`).classList.add('active');\r\n            if (s === 'pedidos-kit') window.cargarPedidosKit();\r\n        };`);
    } else {
        console.warn('WARNING: navegar body target not found, skipping hook');
    }
} else {
    updated = updated.replace(navegarTarget, navegarReplacement);
}

// Write back with BOM
const BOM = Buffer.from([0xFF, 0xFE]);
const encoded = Buffer.from(updated, 'utf16le');
fs.writeFileSync('admin.html', Buffer.concat([BOM, encoded]));
console.log('Done! admin.html updated successfully.');
