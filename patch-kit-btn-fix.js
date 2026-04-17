const fs = require('fs');
const buf = fs.readFileSync('admin.html');
let content = buf.toString('utf16le');

// Fix the broken button onclick by switching to data attributes (avoids all quote escaping)
const badButton = `'<button onclick="enviarWaKit(\\'' + (p.id || '') + '\\',\\'' + (p.dni || '') + '\\',\\'' + (p.nombrePaciente || '').replace(/'/g, "\\\\'\\") + '\\')" ' +\r\n                            'style="margin-top:10px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">📲 Avisar por WhatsApp</button>'`;

const goodButton = `'<button data-wid="' + escapeHtml(p.id || '') + '" data-wdni="' + escapeHtml(p.dni || '') + '" data-wnombre="' + escapeHtml(p.nombrePaciente || '') + '" onclick="enviarWaKitBtn(this)" style="margin-top:10px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">📲 Avisar por WhatsApp</button>'`;

if (content.includes(badButton)) {
    content = content.replace(badButton, goodButton);
    console.log('✅ Fixed button onclick via data attributes');
} else {
    // Try flexible search — find the button by partial match
    const partial = `'<button onclick="enviarWaKit(\\''`;
    const idx = content.indexOf(partial);
    if (idx !== -1) {
        // Find the end of this button string
        const endMarker = `'>📲 Avisar por WhatsApp</button>'`;
        const endIdx = content.indexOf(endMarker, idx);
        if (endIdx !== -1) {
            content = content.slice(0, idx) + goodButton + content.slice(endIdx + endMarker.length);
            console.log('✅ Fixed button onclick (flexible match)');
        } else {
            // Even more flexible - find the button line and replace entirely
            const lineStart = content.lastIndexOf('\r\n', idx) + 2;
            const lineEnd = content.indexOf('\r\n', idx + 200);
            console.log('Problematic line:', JSON.stringify(content.slice(idx, lineEnd)));
            process.exit(1);
        }
    } else {
        // Search for the enviarWaKit button in innerHTML
        const alternateIdx = content.indexOf('onclick="enviarWaKit(');
        if (alternateIdx !== -1) {
            const lineStart = content.lastIndexOf('\n', alternateIdx);
            const lineEnd = content.indexOf('</button>', alternateIdx) + 9;
            console.log('Found alternate at:', alternateIdx);
            console.log('Line:', JSON.stringify(content.slice(lineStart, lineEnd + 50)));
            process.exit(1);
        }
        console.error('❌ Button not found at all');
        process.exit(1);
    }
}

// Add enviarWaKitBtn helper before enviarWaKit
const helperTarget = `window.enviarWaKit = async function(pedidoId, dni, nombre) {`;
const helperCode = `window.enviarWaKitBtn = function(btn) {
            var pedidoId = btn.getAttribute('data-wid');
            var dni = btn.getAttribute('data-wdni');
            var nombre = btn.getAttribute('data-wnombre');
            window.enviarWaKit(pedidoId, dni, nombre);
        };

        window.enviarWaKit = async function(pedidoId, dni, nombre) {`;

if (content.includes(helperTarget)) {
    content = content.replace(helperTarget, helperCode);
    console.log('✅ Added enviarWaKitBtn helper');
} else {
    console.warn('⚠️  enviarWaKit target not found, skipping helper');
}

// Write back with BOM
const BOM = Buffer.from([0xFF, 0xFE]);
const encoded = Buffer.from(content, 'utf16le');
fs.writeFileSync('admin.html', Buffer.concat([BOM, encoded]));
console.log('Done! admin.html fixed.');
