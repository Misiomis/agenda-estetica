const fs = require('fs');
const puppeteer = require('puppeteer');

// Usa Chrome del sistema si existe (rutas típicas en Windows); si no, deja
// que Puppeteer use el Chromium que descarga con "npx puppeteer browsers install chrome".
const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
].filter(Boolean);
const CHROME = CHROME_PATHS.find(p => fs.existsSync(p));
const URL = 'http://localhost:8934/fecha.html';

// El modal "Si sos menor de edad..." se muestra SIEMPRE (a propósito, es un
// aviso general, no un age-gate real — el código hace document.getElementById
// que siempre existe, no una condición de edad). Un envío real lo cierra con
// este botón antes de seguir.
async function cerrarAvisoMenorSiAparece(page) {
  const apareció = await page.evaluate(() => {
    const ov = document.getElementById('modalMenorConsulta');
    if (ov && ov.style.display === 'flex') { document.getElementById('_menorOkBtn').click(); return true; }
    return false;
  });
  return apareció;
}

async function abrirModalConTurno(page) {
  // Selección real por UI: primer día habilitado -> primer horario libre -> Reservar.
  await page.waitForSelector('.dia.dia-libre, .dia.dia-parcial', { timeout: 20000 });
  const diaSel = await page.evaluate(() => {
    const el = document.querySelector('.dia.dia-libre, .dia.dia-parcial');
    if (!el) return null;
    el.click();
    return true;
  });
  if (!diaSel) throw new Error('No se encontró ningún día habilitado en el calendario');
  await page.waitForSelector('.hora:not(.ocupado)', { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.hora:not(.ocupado)').click());
  await page.waitForFunction(() => !document.getElementById('reservarBtn').disabled, { timeout: 10000 });
  await page.click('#reservarBtn');
  await page.waitForSelector('#modalConsulta.open', { timeout: 10000 });
}

async function run() {
  const browser = await puppeteer.launch({ ...(CHROME ? { executablePath: CHROME } : {}), headless: 'new' });
  let fails = 0;
  const check = (desc, cond) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) fails++; };

  console.log('\n=== Caso 1: cliente existente (Victoria A, DNI 11419953, nombre abreviado + fecha DD/MM/YYYY) ===');
  {
    const page = await browser.newPage();
    const consoleMsgs = [];
    page.on('console', msg => consoleMsgs.push(msg.text()));
    page.on('pageerror', err => consoleMsgs.push('PAGEERROR: ' + err.message));
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await abrirModalConTurno(page);

    await page.type('#mcDni', '11419953');
    await page.focus('#mcTelefono');
    await new Promise(r => setTimeout(r, 1500));

    const estado = await page.evaluate(() => ({
      nombre: document.getElementById('mcNombre').value,
      nombreReadonly: document.getElementById('mcNombre').readOnly,
      edad: document.getElementById('mcEdad').value,
      domicilio: document.getElementById('mcDomicilio').value,
      telefono: document.getElementById('mcTelefono').value,
      email: document.getElementById('mcEmail').value,
    }));
    console.log('  estado tras autocompletar:', JSON.stringify(estado));
    check('nombre autocompletado = "Victoria A"', estado.nombre === 'Victoria A');
    check('nombre quedó bloqueado (perfil real)', estado.nombreReadonly === true);
    // El perfil guarda "72" como campo edad (puede haber quedado desactualizado
    // desde que se cargó), pero la fecha real "11/10/1954" SÍ se reconoce ahora
    // (antes el parser solo entendía YYYY-MM-DD) y calcula la edad real vigente
    // a partir del cumpleaños — 71, no un valor vacío ni la fecha por defecto.
    const edadNum = parseInt(estado.edad, 10);
    check('edad calculada desde la fecha real de nacimiento (no vacía, no el default del selector) = ' + estado.edad, edadNum >= 70 && edadNum <= 72);
    check('domicilio autocompletado', estado.domicilio === 'Andresito');

    await page.evaluate(() => window.irPaso2());
    await new Promise(r => setTimeout(r, 300));
    await cerrarAvisoMenorSiAparece(page); // aviso general "si sos menor...", no bloquea, pero hay que cerrarlo
    await new Promise(r => setTimeout(r, 200));
    const paso2Activo = await page.evaluate(() => document.getElementById('mcStep2').classList.contains('active'));
    check('avanzó a Paso 2 (antes se quedaba trabado acá)', paso2Activo);

    const asyncListenerError = consoleMsgs.some(m => m.includes('asynchronous response'));
    check('sin el error "A listener indicated an asynchronous response" (Chrome limpio, sin extensiones)', !asyncListenerError);
    if (consoleMsgs.length) console.log('  consola completa:', JSON.stringify(consoleMsgs));

    await page.close();
  }

  console.log('\n=== Caso 2: DNI con espacios ("11 419 953") ===');
  {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await abrirModalConTurno(page);
    await page.type('#mcDni', '11 419 953');
    await page.focus('#mcTelefono');
    await new Promise(r => setTimeout(r, 1500));
    const nombre = await page.evaluate(() => document.getElementById('mcNombre').value);
    check('encontró el perfil pese a los espacios en el DNI', nombre === 'Victoria A');
    await page.close();
  }

  console.log('\n=== Caso 3: DNI nuevo, cliente no existente ===');
  {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await abrirModalConTurno(page);
    await page.type('#mcDni', '99888777');
    await page.focus('#mcTelefono');
    await new Promise(r => setTimeout(r, 1500));
    const readonlyAntes = await page.evaluate(() => document.getElementById('mcNombre').readOnly);
    check('el nombre queda editable (no hay perfil previo)', readonlyAntes === false);

    await page.evaluate(() => { document.getElementById('mcNombre').value = 'Rosa P'; });
    await page.evaluate(() => { document.getElementById('mcDomicilio').value = 'Barrio Centro'; });
    await page.evaluate(() => { document.getElementById('mcTelefono').value = '3764555555'; });
    await page.evaluate(() => { document.getElementById('mcEmail').value = 'rosa@test.com'; });
    // Deja el selector en su posición por defecto (índice 30 = ~30 años) y solo
    // dispara el 'scroll' para que se recalcule mcEdad — no lo mueve a un año
    // que daría una edad de pocos años y activaría el aviso por otro motivo.
    await page.evaluate(() => { const a = document.getElementById('drumAnio'); a.dispatchEvent(new Event('scroll')); });
    await new Promise(r => setTimeout(r, 500));

    const edadPrevia = await page.evaluate(() => document.getElementById('mcEdad').value);
    console.log('  edad tomada de la posición por defecto del selector:', edadPrevia);

    await page.evaluate(() => window.irPaso2());
    await new Promise(r => setTimeout(r, 300));
    await cerrarAvisoMenorSiAparece(page);
    await new Promise(r => setTimeout(r, 200));
    const paso2Activo = await page.evaluate(() => document.getElementById('mcStep2').classList.contains('active'));
    check('nombre "Rosa P" (inicial de apellido) pasa la validación y avanza', paso2Activo);
    await page.close();
  }

  console.log('\n=== Caso 4: cambio rápido de DNI (carrera de búsquedas) ===');
  {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await abrirModalConTurno(page);
    // Escribe un DNI, dispara blur, y ANTES de que termine cambia a otro DNI.
    await page.type('#mcDni', '99888777');
    await page.focus('#mcTelefono'); // dispara blur #1 (no existe -> debería tardar poco igual)
    await page.focus('#mcDni');
    await page.evaluate(() => { document.getElementById('mcDni').value = ''; });
    await page.type('#mcDni', '11419953');
    await page.focus('#mcTelefono'); // dispara blur #2 (existe)
    await new Promise(r => setTimeout(r, 1500));
    const nombreFinal = await page.evaluate(() => document.getElementById('mcNombre').value);
    check('con cambio rápido de DNI, el resultado final corresponde al ÚLTIMO DNI (11419953 -> Victoria A)', nombreFinal === 'Victoria A');
    await page.close();
  }

  await browser.close();
  console.log('\n' + '='.repeat(60));
  console.log(fails ? (fails + ' prueba(s) fallaron') : 'TODAS LAS PRUEBAS OK');
  process.exit(fails ? 1 : 0);
}

run().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
