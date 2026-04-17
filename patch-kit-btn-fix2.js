const fs = require('fs');
const buf = fs.readFileSync('admin.html');
let content = buf.toString('utf16le');

// Find the exact button start
const btnStart = content.indexOf("'<button onclick=\"enviarWaKit(\\''");
if (btnStart === -1) { console.error('Start not found'); process.exit(1); }

// Find the end: after </button>'
const btnEnd = content.indexOf("</button>' +", btnStart);
if (btnEnd === -1) { console.error('End not found'); process.exit(1); }
const actualEnd = btnEnd + "</button>' +".length;

console.log('Replacing from', btnStart, 'to', actualEnd);
console.log('OLD:', JSON.stringify(content.slice(btnStart, actualEnd)));

const goodButton = `'<button data-wid="' + escapeHtml(p.id || '') + '" data-wdni="' + escapeHtml(p.dni || '') + '" data-wnombre="' + escapeHtml(p.nombrePaciente || '') + '" onclick="enviarWaKitBtn(this)" style="margin-top:10px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;border:none;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">📲 Avisar por WhatsApp</button>' +`;

content = content.slice(0, btnStart) + goodButton + content.slice(actualEnd);
console.log('NEW:', JSON.stringify(goodButton));

// Add enviarWaKitBtn helper before enviarWaKit
const helperTarget = `window.enviarWaKit = async function(pedidoId, dni, nombre) {`;
const helperCode = `window.enviarWaKitBtn = function(btn) {\r\n            window.enviarWaKit(btn.getAttribute('data-wid'), btn.getAttribute('data-wdni'), btn.getAttribute('data-wnombre'));\r\n        };\r\n\r\n        window.enviarWaKit = async function(pedidoId, dni, nombre) {`;

if (content.includes(helperTarget)) {
    content = content.replace(helperTarget, helperCode);
    console.log('✅ Added enviarWaKitBtn helper');
}

// Verify with syntax check
const start = content.indexOf('window.cargarPedidosKit = async function()');
const end = content.indexOf('window.enviarWaKit = async function', start);
const fn = content.slice(start, end);
try {
    new Function(fn);
    console.log('✅ Syntax OK for cargarPedidosKit');
} catch(e) {
    console.error('❌ Still has syntax error:', e.message);
}

const BOM = Buffer.from([0xFF, 0xFE]);
fs.writeFileSync('admin.html', Buffer.concat([BOM, Buffer.from(content, 'utf16le')]));
console.log('Done!');
