# Pruebas de regresión — PDF de "Preparar jornada"

Verifican, con datos sintéticos (nunca reservas reales), que la paginación
del PDF de jornada (`generarPDFJornada` en `admin.html`) no:

- corta nombres, palabras o renglones a mitad de línea,
- muestra el nombre o el número de hoja equivocado en el pie de página,
- pierde ni duplica sesiones al paginar.

## Cómo correrlas

```bash
npm install
npm run test:pdf-jornada
```

Genera un PDF real por cada caso en esta carpeta (`out-*.pdf`, ignorados
por git) y lo abre con `pdf-parse` para comprobar, página por página, que
el nombre y el "Hoja X de Y" del pie corresponden al paciente real de esa
página, que ninguna página queda huérfana y que no faltan/sobran sesiones.

Casos cubiertos: nombre muy largo con tildes/ñ, detalle de sesión enorme
(fuerza que UNA sesión se parta en varias páginas), 45 sesiones para un
mismo paciente, 6 pacientes consecutivos, contenido justo en el límite de
una página, e impresión a doble cara (página en blanco intercalada).

## ⚠️ Mantenimiento

`gen-jornada.js` es un **espejo** de la lógica real de `generarPDFJornada`
en `admin.html` (se reescribió deliberadamente aparte para poder correrla
en Node sin navegador ni Firestore). Si se cambia el layout/paginación en
`admin.html`, hay que reflejar el mismo cambio acá — si no, esta prueba
deja de ser representativa y puede pasar en verde con un bug real en la
app.

La versión de `jspdf` en `package.json` está fijada a `2.5.2` a propósito,
para que coincida exactamente con la que carga `admin.html` por CDN
(`jspdf@2.5.2/dist/jspdf.umd.min.js`). Si se actualiza esa versión en el
CDN, actualizar también acá.
