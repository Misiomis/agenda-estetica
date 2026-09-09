// Mirror del algoritmo de imprimirGrillaJornada() en admin.html.
// Se mantiene aparte para poder correrlo en Node (sin navegador/Firestore)
// con datos sintéticos y verificar el PDF real que produce: cantidad exacta
// de páginas, sin turnos partidos entre hojas, sin contenido cortado.
// IMPORTANTE: si se cambia la lógica de layout en admin.html, hay que
// reflejar el mismo cambio acá para que la prueba siga siendo representativa.

const { jsPDF } = require('jspdf');

// reservas: [{ fecha, hora, nombre, servicio, boxId, estado }]
// boxes: [{ id, title, sub }]
function generarGrillaPDF(fecha, reservas, boxes) {
  const getBoxId = (r) => r.boxId || '';
  const _nd = (r) => (r.nombre || r.paciente || '—').trim();
  const esReservaActiva = (r) => (r.estado || '').toLowerCase() !== 'cancelado';

  const reservasDia = reservas
    .filter(r => r.fecha === fecha && esReservaActiva(r))
    .sort((a, b) => (a.hora || '') < (b.hora || '') ? -1 : 1);

  if (!reservasDia.length) throw new Error('Sin reservas activas para esta fecha.');

  const colBoxes = (boxes && boxes.length)
    ? boxes.map(b => ({ id: b.id, label: b.title + (b.sub ? ' · ' + b.sub : '') }))
    : [{ id: 'b1', label: 'Box 1' }, { id: 'b2', label: 'Box 2' }, { id: 'b3', label: 'Box 3' }, { id: 'b4', label: 'Box 4' }];

  const timesSet = new Set();
  reservasDia.forEach(r => { if (r.hora) timesSet.add(r.hora); });
  const sortedTimes = [...timesSet].sort();

  const cellMap = new Map();
  reservasDia.forEach(r => { const bid = getBoxId(r); if (bid && r.hora) cellMap.set(r.hora + '|' + bid, r); });

  const SPLIT = '13:00';
  const tmMañana = sortedTimes.filter(t => t < SPLIT);
  const tmTarde = sortedTimes.filter(t => t >= SPLIT);
  const hasMañana = tmMañana.length > 0;
  const haTarde = tmTarde.length > 0;

  const MESES_PDF = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS_PDF = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const p = (fecha || '').split('-');
  const dt = p[0] && p[1] && p[2] ? new Date(+p[0], +p[1] - 1, +p[2]) : null;
  const fechaFull = dt ? (DIAS_PDF[dt.getDay()] + ', ' + parseInt(p[2]) + ' de ' + (MESES_PDF[+p[1] - 1] || p[1]) + ' de ' + p[0]) : fecha;
  const fechaExport = '01/01/2026';
  const horaExport = '00:00';

  const noBoxRes = reservasDia.filter(r => !getBoxId(r));

  const PAGE_W = 297, PAGE_H = 210, MARGIN_L = 14, MARGIN_R = 14, MARGIN_T = 12, MARGIN_B = 12;
  const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
  const CONTENT_BOTTOM = PAGE_H - MARGIN_B;
  const HORA_W = 24;
  const BOX_W = (CONTENT_W - HORA_W) / colBoxes.length;
  const CELL_PAD = 2.2;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const mmPerPt = (pt) => pt * 0.3528 * 1.43;

  function drawHeader(turno, nTurnos) {
    let y = MARGIN_T;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(17, 17, 17);
    doc.text('Espacio Mimar T', MARGIN_L, y + 4);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(fechaFull, MARGIN_L, y + 10.5);
    if (turno) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(17, 17, 17);
      doc.text(turno, PAGE_W - MARGIN_R, y + 4, { align: 'right' });
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(85, 85, 85);
    doc.text(nTurnos + ' turno' + (nTurnos !== 1 ? 's' : '') + '   ·   ' + fechaExport + ' ' + horaExport, PAGE_W - MARGIN_R, y + 10.5, { align: 'right' });
    doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.7);
    doc.line(MARGIN_L, y + 13.5, PAGE_W - MARGIN_R, y + 13.5);
    return y + 17.5;
  }

  const THEAD_PT = colBoxes.some(b => b.label.length > 16) ? 7.5 : 9;

  function medirLayout(times, cellPt, incluirNoBox) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(THEAD_PT);
    let theadLines = 1;
    colBoxes.forEach(b => {
      const lines = doc.splitTextToSize(b.label.toUpperCase(), BOX_W - CELL_PAD * 2);
      theadLines = Math.max(theadLines, lines.length);
    });
    const theadH = Math.max(7, theadLines * mmPerPt(THEAD_PT) + CELL_PAD * 2);

    const servPt = Math.max(6, cellPt - 1.5);
    const rowHeights = times.map(hora => {
      let maxLines = 0;
      colBoxes.forEach(b => {
        const r = cellMap.get(hora + '|' + b.id);
        if (!r) return;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(cellPt);
        const nomLines = doc.splitTextToSize(_nd(r), BOX_W - CELL_PAD * 2).length;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(servPt);
        const srvLines = doc.splitTextToSize(r.servicio || '—', BOX_W - CELL_PAD * 2).length;
        const neededMm = CELL_PAD * 2 + nomLines * mmPerPt(cellPt) + 0.8 + srvLines * mmPerPt(servPt);
        maxLines = Math.max(maxLines, neededMm);
      });
      return Math.max(maxLines, mmPerPt(cellPt) + CELL_PAD * 2);
    });

    let noBoxH = 0;
    if (incluirNoBox && noBoxRes.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.max(6.5, cellPt - 1.5));
      const noBoxTxt = noBoxRes.map(r => (r.hora || '—') + ' ' + _nd(r)).join('     ·     ');
      const noBoxLines = doc.splitTextToSize(noBoxTxt, CONTENT_W).length;
      noBoxH = 4 + noBoxLines * mmPerPt(Math.max(6.5, cellPt - 1.5)) + 3;
    }

    const total = theadH + rowHeights.reduce((s, h) => s + h, 0) + noBoxH;
    return { cellPt, servPt, theadH, rowHeights, noBoxH, total };
  }

  const FONT_CANDIDATES = [11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6];
  function elegirLayout(times, availableH, incluirNoBox) {
    let last = null;
    for (let i = 0; i < FONT_CANDIDATES.length; i++) {
      const layout = medirLayout(times, FONT_CANDIDATES[i], incluirNoBox);
      last = layout;
      if (layout.total <= availableH) return layout;
    }
    return last;
  }

  function drawShift(times, turno, nTurnos, incluirNoBox) {
    let y = drawHeader(turno, nTurnos);
    const availableH = CONTENT_BOTTOM - y;
    const layout = elegirLayout(times, availableH, incluirNoBox);
    if (layout.total > availableH + 0.5) {
      throw new Error('El turno ' + (turno || '') + ' tiene ' + times.length + ' horario(s) y no entra en una sola página aun con la tipografía mínima (' +
        FONT_CANDIDATES[FONT_CANDIDATES.length - 1] + 'pt). Reducí la cantidad de boxes impresos o dividí la jornada.');
    }

    doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.6);
    doc.setFillColor(255, 255, 255);
    doc.rect(MARGIN_L, y, HORA_W, layout.theadH);
    doc.rect(MARGIN_L + HORA_W, y, CONTENT_W - HORA_W, layout.theadH);
    let xBox = MARGIN_L + HORA_W;
    colBoxes.forEach(() => { doc.rect(xBox, y, BOX_W, layout.theadH); xBox += BOX_W; });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(THEAD_PT); doc.setTextColor(17, 17, 17);
    doc.text('HORA', MARGIN_L + HORA_W / 2, y + layout.theadH / 2 + 1.2, { align: 'center' });
    xBox = MARGIN_L + HORA_W;
    colBoxes.forEach(b => {
      const lines = doc.splitTextToSize(b.label.toUpperCase(), BOX_W - CELL_PAD * 2);
      const startY = y + layout.theadH / 2 - ((lines.length - 1) * mmPerPt(THEAD_PT) / 2) + 1.2;
      doc.text(lines, xBox + BOX_W / 2, startY, { align: 'center' });
      xBox += BOX_W;
    });
    y += layout.theadH;

    times.forEach((hora, i) => {
      const rowH = layout.rowHeights[i];
      doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.6);
      doc.rect(MARGIN_L, y, HORA_W, rowH);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(17, 17, 17);
      doc.text(hora, MARGIN_L + HORA_W / 2, y + rowH / 2 + 1.4, { align: 'center' });

      let xC = MARGIN_L + HORA_W;
      colBoxes.forEach(b => {
        doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3);
        doc.rect(xC, y, BOX_W, rowH);
        const r = cellMap.get(hora + '|' + b.id);
        if (r) {
          let cy = y + CELL_PAD + mmPerPt(layout.cellPt) * 0.75;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(layout.cellPt); doc.setTextColor(20, 20, 20);
          const nomLines = doc.splitTextToSize(_nd(r), BOX_W - CELL_PAD * 2);
          doc.text(nomLines, xC + CELL_PAD, cy);
          cy += nomLines.length * mmPerPt(layout.cellPt) + 0.8;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(layout.servPt); doc.setTextColor(85, 85, 85);
          const srvLines = doc.splitTextToSize(r.servicio || '—', BOX_W - CELL_PAD * 2);
          doc.text(srvLines, xC + CELL_PAD, cy);
        }
        xC += BOX_W;
      });
      y += rowH;
    });

    if (incluirNoBox && noBoxRes.length) {
      y += 3;
      doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.3);
      doc.line(MARGIN_L, y, PAGE_W - MARGIN_R, y);
      y += 4;
      const noBoxPt = Math.max(6.5, layout.cellPt - 1.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(noBoxPt); doc.setTextColor(100, 100, 100);
      const noBoxTxt = noBoxRes.map(r => (r.hora || '—') + ' ' + _nd(r)).join('     ·     ');
      const noBoxLines = doc.splitTextToSize(noBoxTxt, CONTENT_W);
      doc.text(noBoxLines, MARGIN_L, y + mmPerPt(noBoxPt) * 0.75);
    }
  }

  let sessionsWritten = 0;
  const expectedPages = (hasMañana && haTarde) ? 2 : 1;

  if (hasMañana) { drawShift(tmMañana, 'Turno Mañana', tmMañana.length, !haTarde); sessionsWritten += tmMañana.length; }
  if (haTarde) { if (hasMañana) doc.addPage(); drawShift(tmTarde, 'Turno Tarde', tmTarde.length, true); sessionsWritten += tmTarde.length; }
  if (!hasMañana && !haTarde) { drawShift(sortedTimes, '', reservasDia.length, true); sessionsWritten += sortedTimes.length; }

  const totalPages = doc.internal.getNumberOfPages();
  if (totalPages !== expectedPages || sessionsWritten !== sortedTimes.length) {
    throw new Error('Control de integridad falló: páginas ' + totalPages + '/' + expectedPages + ', horarios ' + sessionsWritten + '/' + sortedTimes.length);
  }

  return { doc, totalPages, expectedPages, sortedTimes, tmMañana, tmTarde, reservasDia, noBoxRes };
}

module.exports = { generarGrillaPDF };
