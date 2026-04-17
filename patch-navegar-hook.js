const fs = require('fs');
const buf = fs.readFileSync('admin.html');
let content = buf.toString('utf16le');

// The exact string we found in context
const target = ".classList.add('active'); \r\n        };\r\n\r\n        // === F";
const replacement = ".classList.add('active'); \r\n            if (s === 'pedidos-kit') window.cargarPedidosKit();\r\n        };\r\n\r\n        // === F";

if (content.includes(target)) {
    content = content.replace(target, replacement);
    const BOM = Buffer.from([0xFF, 0xFE]);
    const encoded = Buffer.from(content, 'utf16le');
    fs.writeFileSync('admin.html', Buffer.concat([BOM, encoded]));
    console.log('Hook added!');
} else {
    console.error('Target not found!');
    process.exit(1);
}
