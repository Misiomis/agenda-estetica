# Pruebas de integración — Cloud Functions de Mimar T Inteligente

Estas pruebas corren contra el **Firebase Local Emulator Suite**, nunca
contra producción. Verifican `functions/index.js`: la bandeja de actividad
(`activityLog`, punto 2), el campo derivado `cumpleMesDia` y el resumen de
cumpleaños (`resumenesCumpleanos`, punto 4).

## Cómo correrlas

1. Levantar el emulador desde la raíz del repo:
   ```
   firebase emulators:start --only firestore,functions,auth --project estetica-8d067
   ```
   (En Windows, si `firebase` no encuentra Java, anteponer al PATH el JBR de
   Android Studio: `PATH="/c/Program Files/Android/Android Studio/jbr/bin:$PATH"`.)

2. Con el emulador arriba ("All emulators ready"), en otra terminal:
   ```
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 GCLOUD_PROJECT=estetica-8d067 node tests/functions-emulator/test-activity-log.js
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 GCLOUD_PROJECT=estetica-8d067 node tests/functions-emulator/test-cumpleanos.js
   ```
   (Ajustar el puerto si `firebase.json` lo cambió — ver el bloque `emulators.firestore.port`.)

3. Cada script imprime PASS/FAIL por caso y termina con código de salida
   distinto de cero si algo falló.

## Notas

- Los datos que crean estos scripts (reservas/clientes/consultas de prueba)
  quedan solo en el emulador — se pueden borrar con:
  ```
  curl -X DELETE "http://localhost:8090/emulator/v1/projects/estetica-8d067/databases/(default)/documents"
  ```
- Si se corren dos veces seguidas sin limpiar el emulador, `test-activity-log.js`
  puede fallar en los casos de `clients` porque reutiliza un DNI fijo
  (`99999999`) que ya no estaría en estado "recién creado" — no es un bug de
  las Functions, es solo que hace falta limpiar el emulador entre corridas.
- Última corrida limpia: 11/11 OK (activity-log) y 6/6 OK (cumpleanos).
