// Mirror del algoritmo de paginación de generarPDFJornada() en admin.html.
// Se mantiene aparte para poder correrlo en Node (sin navegador/Firestore)
// con datos sintéticos y verificar el PDF real que produce.
// IMPORTANTE: si se cambia la lógica de layout en admin.html, hay que
// reflejar el mismo cambio acá para que la prueba siga siendo representativa.

const { jsPDF } = require('jspdf');

function generarJornadaPDF(f, patientData, opts) {
  opts = opts || {};
  const duplex = !!opts.duplex;

  const MESES_PDF = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS_PDF  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const fmtF = (ff) => {
    const p = (ff||'').split('-');
    if (!p[0]||!p[1]||!p[2]) return ff||'—';
    const dt = new Date(+p[0],+p[1]-1,+p[2]);
    return DIAS_PDF[dt.getDay()] + ' ' + parseInt(p[2]) + ' de ' + (MESES_PDF[+p[1]-1]||p[1]) + ' de ' + p[0];
  };
  const fmtBox = (r) => r.box || '';
  const fechaLargaJornada = fmtF(f);

  const PAGE_W = 210, PAGE_H = 297;
  const MARGIN_L = 14, MARGIN_R = 14;
  const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
  const CONTENT_BOTTOM = 278;
  const FOOTER_Y = 288;
  const HEADER_TOP = 16;
  const CONTINUATION_HEADER_H = 24;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const patientRanges = [];
  let sessionsWritten = 0;
  let firstPage = true;

  function drawHeader(pd, isContinuation) {
    let y = HEADER_TOP;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(140,140,140);
    doc.text('JORNADA · ' + fechaLargaJornada, MARGIN_L, y);
    y += isContinuation ? 6 : 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(isContinuation ? 12 : 16);
    doc.setTextColor(220,38,38);
    doc.text(pd.nombre + (isContinuation ? '  (continuación)' : ''), MARGIN_L, y);
    y += 2;
    doc.setDrawColor(220,38,38); doc.setLineWidth(0.6);
    doc.line(MARGIN_L, y, MARGIN_L + CONTENT_W, y);
    y += 5;
    if (!isContinuation) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.setTextColor(90,90,90);
      doc.text('Edad: ' + (pd.edad || '______________') + (pd.phone ? '     ·     Tel: ' + pd.phone : ''), MARGIN_L, y);
      y += 6;
      const total = pd.sesiones.length;
      const nReal = pd.sesiones.filter(s => s.status==='real').length;
      const nPend = pd.sesiones.filter(s => s.status==='pend').length;
      const nCanc = pd.sesiones.filter(s => s.status==='canc').length;
      doc.setFillColor(248,248,248); doc.setDrawColor(220,220,220);
      doc.rect(MARGIN_L, y - 4, CONTENT_W, 8, 'FD');
      doc.setFontSize(8.5); doc.setTextColor(60,60,60);
      doc.text('Total de sesiones: ' + total + '   ·   Realizadas: ' + nReal + '   ·   Pendientes: ' + nPend + (nCanc ? '   ·   Canceladas: ' + nCanc : ''), MARGIN_L + 3, y + 1);
      y += 9;
    }
    return y;
  }

  function statusColors(status) {
    if (status === 'real') return { bar:[30,92,63],  badgeBg:[212,237,223], badgeFg:[26,82,53],  label:'REALIZADA' };
    if (status === 'pend') return { bar:[200,160,0], badgeBg:[255,239,192], badgeFg:[122,88,0],  label:'PENDIENTE' };
    return                        { bar:[170,170,170], badgeBg:[232,232,232], badgeFg:[136,136,136], label:'CANCELADA' };
  }

  const COL_A_X = MARGIN_L + 3, COL_A_W = 24;
  const COL_B_X = COL_A_X + COL_A_W + 3, COL_B_W = 38;
  const COL_C_X = COL_B_X + COL_B_W + 3;
  const COL_C_W = MARGIN_L + CONTENT_W - COL_C_X - 3;
  const LINE_H = 4.2;

  patientData.forEach((pd) => {
    if (!firstPage) doc.addPage(); else firstPage = false;
    const patStartPage = doc.internal.getNumberOfPages();
    let y = drawHeader(pd, false);
    const tot = pd.sesiones.length;

    pd.sesiones.forEach((ses, i) => {
      const n = i + 1;
      const r = ses.r, status = ses.status;
      const sc = statusColors(status);
      const est = (r.estado||r.status||'').toLowerCase();
      const statusLabel = est === 'reprogramado' ? 'REPROGRAMADA' : sc.label;
      const det  = (r.detalleSesion||'').trim();
      const det2 = (r.detalleSesion2||'').trim();
      const box  = fmtBox(r);
      const servicio = r.servicio || '—';

      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      const servicioLines = doc.splitTextToSize(servicio, COL_C_W);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3);
      const detLines  = det  ? doc.splitTextToSize(det, COL_C_W - 3)  : [];
      const det2Lines = det2 ? doc.splitTextToSize(det2, COL_C_W - 3) : [];

      const colCBlocks = [{ kind: 'servicio', lines: servicioLines }];
      if (det)  { colCBlocks.push({ kind: 'lbl', text: status==='pend' ? 'Obs. previas' : 'Detalle de la sesión' }); colCBlocks.push({ kind: 'det', lines: detLines }); }
      if (det2) { colCBlocks.push({ kind: 'lbl', text: 'Nota adicional' }); colCBlocks.push({ kind: 'det', lines: det2Lines }); }
      if (status === 'pend') { colCBlocks.push({ kind: 'lbl', text: 'Anotaciones de la sesión' }); colCBlocks.push({ kind: 'blankline' }); }
      else if (status === 'real' && !det && !det2) { colCBlocks.push({ kind: 'muted', text: 'Sin detalle registrado' }); }

      let colCHeight = 2;
      colCBlocks.forEach((b) => {
        if (b.kind === 'blankline') colCHeight += 7;
        else if (b.kind === 'lbl' || b.kind === 'muted') colCHeight += LINE_H;
        else colCHeight += b.lines.length * LINE_H;
      });
      const blockH = Math.max(17, colCHeight) + 4;

      if (y + blockH > CONTENT_BOTTOM && blockH <= (CONTENT_BOTTOM - CONTINUATION_HEADER_H)) {
        doc.addPage();
        y = drawHeader(pd, true);
      }

      const cardTopY = y;
      let pageFragmentTop = cardTopY;
      let cy = cardTopY + 3;

      doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.setTextColor(120,120,120);
      doc.text('S.' + n + '/' + tot, COL_A_X, cardTopY + 3);
      doc.setFillColor(sc.badgeBg[0], sc.badgeBg[1], sc.badgeBg[2]);
      doc.rect(COL_A_X, cardTopY + 5, COL_A_W, 4.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2);
      doc.setTextColor(sc.badgeFg[0], sc.badgeFg[1], sc.badgeFg[2]);
      doc.text(statusLabel, COL_A_X + COL_A_W/2, cardTopY + 7.8, { align: 'center' });

      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.setTextColor(20,20,20);
      const fechaTxt = r.fecha ? fmtF(r.fecha) : 'Sin fecha';
      const fechaLines = doc.splitTextToSize(fechaTxt, COL_B_W);
      doc.text(fechaLines, COL_B_X, cardTopY + 3);
      let bY = cardTopY + 3 + fechaLines.length * 4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.setTextColor(90,90,90);
      if (r.hora) { doc.text(r.hora + ' hs', COL_B_X, bY); bY += 3.6; }
      if (box) { doc.text(doc.splitTextToSize(box, COL_B_W), COL_B_X, bY); }

      colCBlocks.forEach((b) => {
        const linesToWrite = b.kind === 'lbl' ? [b.text] : b.kind === 'blankline' ? [''] : b.kind === 'muted' ? [b.text] : b.lines;
        linesToWrite.forEach((line) => {
          if (cy + LINE_H > CONTENT_BOTTOM) {
            doc.setDrawColor(sc.bar[0], sc.bar[1], sc.bar[2]); doc.setLineWidth(1.2);
            doc.line(MARGIN_L, pageFragmentTop, MARGIN_L, cy);
            doc.addPage();
            y = drawHeader(pd, true);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
            doc.setTextColor(120,120,120);
            doc.text('S.' + n + '/' + tot + ' (continuación)', MARGIN_L + 3, y + 3);
            y += 8;
            pageFragmentTop = y;
            cy = y + 2;
          }
          if (b.kind === 'blankline') {
            doc.setDrawColor(160,160,160); doc.setLineWidth(0.3);
            doc.line(COL_C_X, cy + 2, COL_C_X + COL_C_W, cy + 2);
            cy += 7;
          } else if (b.kind === 'lbl') {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4);
            doc.setTextColor(150,150,150);
            doc.text(line.toUpperCase(), COL_C_X, cy);
            cy += LINE_H;
          } else if (b.kind === 'muted') {
            doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5);
            doc.setTextColor(170,170,170);
            doc.text(line, COL_C_X, cy);
            cy += LINE_H;
          } else if (b.kind === 'servicio') {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
            doc.setTextColor(20,20,20);
            doc.text(line, COL_C_X, cy);
            cy += LINE_H;
          } else {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3);
            doc.setTextColor(50,50,50);
            doc.text(line, COL_C_X, cy);
            cy += LINE_H;
          }
        });
      });

      doc.setDrawColor(sc.bar[0], sc.bar[1], sc.bar[2]); doc.setLineWidth(1.2);
      doc.line(MARGIN_L, pageFragmentTop, MARGIN_L, Math.max(cy, pageFragmentTop + 17));

      y = Math.max(cy, cardTopY + 17) + 3;
      sessionsWritten++;
    });

    let patEndPage = doc.internal.getNumberOfPages();
    if (duplex) {
      const pagesUsed = patEndPage - patStartPage + 1;
      if (pagesUsed % 2 !== 0) { doc.addPage(); patEndPage = doc.internal.getNumberOfPages(); }
    }
    patientRanges.push({ name: pd.nombre, startPage: patStartPage, endPage: patEndPage });
  });

  const totalEsperado = patientData.reduce((s,p) => s + p.sesiones.length, 0);
  if (sessionsWritten !== totalEsperado) {
    throw new Error('Se escribieron ' + sessionsWritten + ' sesiones pero se esperaban ' + totalEsperado + '.');
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    let owner = null;
    for (let pi = patientRanges.length - 1; pi >= 0; pi--) {
      if (p >= patientRanges[pi].startPage) { owner = patientRanges[pi]; break; }
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(140,140,140);
    if (owner && p <= owner.endPage) {
      const hoja = p - owner.startPage + 1;
      const totHojas = owner.endPage - owner.startPage + 1;
      doc.text('Espacio Mimar T  ·  ' + owner.name + '  ·  Jornada ' + f, MARGIN_L, FOOTER_Y);
      doc.text('Hoja ' + hoja + ' de ' + totHojas, PAGE_W - MARGIN_R, FOOTER_Y, { align: 'right' });
    } else {
      doc.text('Espacio Mimar T  ·  Jornada ' + f, MARGIN_L, FOOTER_Y);
      doc.text('Pág. ' + p + ' / ' + totalPages, PAGE_W - MARGIN_R, FOOTER_Y, { align: 'right' });
    }
  }

  return { doc, patientRanges, totalPages, sessionsWritten };
}

module.exports = { generarJornadaPDF };
