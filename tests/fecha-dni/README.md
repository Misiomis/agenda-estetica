# Pruebas de regresión — identificación por DNI en `fecha.html`

Reproducen, en un Chrome real sin extensiones (Puppeteer), el flujo completo
de reserva de "Consulta inicial": elegir día → elegir horario → abrir el
modal → cargar DNI → autocompletado → Paso 2. Usan datos **reales de solo
lectura** contra Firestore (DNI de una paciente real, `11419953`) para
reproducir exactamente el patrón que rompía el flujo — nunca escriben ni
modifican una reserva o un perfil real.

## Cómo correrlas

Necesitan dos terminales (o backgrounding manual):

```bash
npm run test:fecha-dni:serve   # sirve el proyecto en http://localhost:8934
npm run test:fecha-dni         # en otra terminal, con el server arriba
```

La primera vez, Puppeteer necesita un Chrome. Si no encuentra una instalación
del sistema en las rutas típicas de Windows, corré una vez:

```bash
npx puppeteer browsers install chrome
```

## Qué reproduce cada caso

- **Caso 1** — DNI `11419953` (perfil real: "Victoria A", nombre con inicial
  de apellido, `fechaNacimiento` guardada como `"11/10/1954"` — formato
  `DD/MM/YYYY`, no el `YYYY-MM-DD` que esperaba el selector). Comprueba que
  el nombre se autocompleta y bloquea, que la edad se calcula igual (antes
  quedaba vacía porque el selector no reconocía ese formato de fecha), y que
  el flujo avanza a Paso 2 — antes se quedaba trabado ahí porque "Victoria A"
  no pasaba la validación de "nombre Y apellido" (contaba solo palabras de
  más de 1 letra) y el campo estaba bloqueado sin forma de corregirlo.
- **Caso 2** — mismo DNI escrito con espacios en vez de puntos
  (`"11 419 953"`) — confirma que la normalización ahora saca espacios, no
  solo puntos.
- **Caso 3** — DNI inexistente: el nombre queda editable, y un nombre con
  apellido abreviado a una inicial ("Rosa P") pasa la validación igual que
  un perfil ya guardado con esa misma convención.
- **Caso 4** — cambia el DNI rápidamente antes de que la primera búsqueda
  termine; confirma que el resultado final corresponde siempre al ÚLTIMO DNI
  cargado, no a una respuesta vieja que llega tarde.

También se registra la consola del navegador en todos los casos — sirve
para confirmar que "A listener indicated an asynchronous response..." no
aparece en un Chrome limpio (si aparece alguna vez, es una extensión del
navegador de quien lo usa, no el código de esta página).

## Lo que estas pruebas NO cubren

No llegan a tocar "Confirmar turno" (evitan crear una reserva real). La
confirmación de extremo a extremo — incluido el permiso denegado real
encontrado en `calendarExceptions` — se verificó aparte, manualmente, sin
dejar datos de prueba (la escritura falla antes de crear nada). Ver el
informe de la tarea para el detalle.

## ⚠️ Mantenimiento

Si cambia el flujo de `fecha.html` (ids de campos, textos de botones, orden
de pasos), hay que reflejar el cambio acá para que la prueba siga siendo
representativa.
