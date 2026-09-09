# Pruebas de regresión — identidad de paciente y estado de sesión

Verifican, con datos **sintéticos** (nunca reservas reales), la causa real de
la auditoría de "historiales incompletos al imprimir": el buscador de
sesiones, "Preparar jornada" y "Exportar historial PDF" en `admin.html`
usaban **criterios distintos** para decidir qué sesiones pertenecen a un
mismo paciente y si una sesión ya se realizó o sigue pendiente.

## Cómo correrlas

```bash
npm install
npm run test:identidad-paciente
```

Genera `out-caso-miriam.pdf` (ignorado por git) — el PDF de jornada real que
produce el código corregido para el caso reproducido — y corre 15
verificaciones sobre el agrupamiento, la clasificación de estado y el PDF
resultante.

## Qué reproduce cada caso

- **CASO A** — una paciente con DNI único cargada en algunas reservas con un
  apellido/nombre adicional (p. ej. "Ana Test" en 7 reservas y "Ana Segundo
  Test" en las otras 3). Reproduce el patrón real encontrado el 2026-09-08
  en la colección `reservas`: 10 sesiones activas bajo un mismo DNI, el
  buscador (clave por DNI) las agrupaba todas, "Preparar jornada" (clave por
  nombre literal, sin DNI) sólo encontraba las 7 que coincidían textualmente
  con el registro del día de jornada. El test demuestra la fragmentación con
  la clave vieja y confirma que la clave actual (`_pacienteMatchKey`, DNI
  primero) recupera las 10 en ambos lugares.
- **CASO B** — reservas sin el campo `nombre` propio (sólo `clienteNombre`),
  también un patrón real encontrado en la colección: con la clave vieja,
  **todas** las reservas sin ese campo caían en una misma clave vacía `""`,
  mezclando los historiales de pacientes distintos. Auditando la colección
  real (sólo lectura, sin modificar nada) esto afectaba a 44 pacientes
  distintos (138 sesiones) bajo una única clave compartida.
- **CASO E** — el buscador ya comparaba contra el FIN del turno (inicio +
  `duracionMinutos`) con huso horario `-03:00` explícito; jornada e
  historial comparaban sólo contra el INICIO, sin huso horario explícito.
  Un turno *en curso* podía dar "pendiente" en un lugar y "realizada" en
  otro en el mismo instante — coincide con lo reportado para el turno del
  8/9. Ahora las tres exportaciones llaman a la misma función
  (`_esSesionPendiente` en `admin.html`).
- **CASO C** — estados no estándar (`"activo"`, vacío) no se descartan
  silenciosamente del conteo ni del agrupamiento.
- **CASO D** — round-trip completo con el CASO A: agrupar → clasificar →
  generar el PDF real de jornada (vía `gen-jornada.js`) → parsear con
  `pdf-parse` y comprobar que las 10 sesiones aparecen, en orden
  cronológico, con el pie de página correcto en todas las hojas.

## Qué NO prueba esto

Estas pruebas corren en Node contra funciones **espejo** de las de
`admin.html` (igual que `tests/pdf-jornada`), no contra Firestore ni un
navegador real. No reemplazan una verificación manual en el panel real; ver
el informe de auditoría para el detalle de qué quedó comprobado contra
datos reales (sólo lectura) y qué falta probar en el panel en vivo.

## ⚠️ Mantenimiento

Si se cambia `_pacienteMatchKey`, `esReservaActiva`, `_esSesionPendiente` o
la lógica de agrupamiento del buscador/jornada/historial en `admin.html`,
hay que reflejar el mismo cambio en los mirrors de este archivo — si no,
esta prueba deja de ser representativa y puede pasar en verde con un bug
real en la app.
