// Número para enlaces de WhatsApp (wa.me / api.whatsapp.com) — una sola regla
// para todo el panel. Lógica pura: se prueba en tests/telefono-wa.
//
// Antes cada botón le pegaba "549" (Argentina, celular) a cualquier número
// que no empezara con 54: un número de Brasil +55 46 92001-8665 salía como
// 549 5546920018665 y WhatsApp no lo encontraba.
//
// Regla:
//  · Si el número trae código de país (+55…, 0055…) se respeta tal cual.
//    Para +54 se completa el 9 de celular y se quita el 15 si vino escrito.
//  · Sin "+": se toma como argentino (0 inicial, 15 después del código de
//    área, 9 de celular — como siempre), salvo que por su largo solo pueda
//    ser de otro país (11 dígitos que no empiezan con 9, 12 dígitos que no
//    son un número argentino con 15, 13 o más dígitos que no empiezan con
//    549). En ese caso también se respeta tal cual.
// Recomendación: guardar los números extranjeros con "+" y el código de país.

// 12 dígitos argentinos con el 15 después del código de área (2 a 4 dígitos,
// los códigos de área argentinos empiezan con 1, 2 o 3) → 10 dígitos sin el 15.
function sin15Argentino(d) {
  if (d.length !== 12 || !/^[123]/.test(d)) return null;
  for (const area of [2, 3, 4]) {
    if (d.slice(area, area + 2) === '15') return d.slice(0, area) + d.slice(area + 2);
  }
  return null;
}

// Parte nacional argentina (sin el 54) → número completo 549…
function argentino(nacional) {
  let n = nacional.replace(/^0+/, '');
  if (n.length === 11 && n.startsWith('9')) return '54' + n;
  const s15 = sin15Argentino(n);
  if (s15) n = s15;
  return '549' + n;
}

export function numeroWhatsApp(tel) {
  const crudo = String(tel ?? '').trim();
  let d = crudo.replace(/\D/g, '');
  if (!d) return '';
  // Con código de país explícito: "+…" o "00…".
  if (crudo.startsWith('+') || d.startsWith('00')) {
    d = d.replace(/^00/, '');
    if (!d.startsWith('54')) return d;
    const resto = d.slice(2);
    return resto.startsWith('9') && resto.length === 11 ? d : argentino(resto);
  }
  // Sin "+": argentino, salvo que el largo diga que es de otro país.
  if (d.startsWith('549') && d.length === 13) return d;
  if (d.startsWith('54') && d.length === 12) return '549' + d.slice(2);
  if (d.startsWith('54') && d.length === 14 && sin15Argentino(d.slice(2))) return argentino(d.slice(2));
  d = d.replace(/^0+/, '');
  if (d.length === 10) return '549' + d;
  if (d.length === 11 && d.startsWith('9')) return '54' + d;
  const s15 = sin15Argentino(d);
  if (s15) return '549' + s15;
  if (d.length >= 11) return d; // otro país (ya trae su código)
  return '549' + d; // corto o incompleto: como antes
}

// ¿El número es de otro país? (para mostrarlo en la ficha / avisos)
export const esNumeroExtranjero = (tel) => { const n = numeroWhatsApp(tel); return !!n && !n.startsWith('54'); };
