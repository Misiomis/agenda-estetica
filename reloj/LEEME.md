# Reloj de recepción · Mimar T

Módulo listo para incorporar a la agenda existente. Usa HTML, CSS y JavaScript
nativos: para utilizarlo no necesitás React, npm install ni un proceso de compilación.

## Instalación

1. Extraé el ZIP. Incluye una carpeta llamada `reloj`.
2. Copiá esa carpeta dentro de `Agenda estetica`, junto a
   `admin.html` y a la carpeta existente `js`.
3. Publicá la carpeta con el mismo procedimiento que ya usás para la agenda.
4. Abrí `/reloj/` en ese mismo sitio.
5. Ingresá con la cuenta administradora de la agenda, si todavía no hay una sesión.
6. Presioná **Activar alarmas**. Se reproduce una campana de prueba.

La estructura final debe contener estas rutas:

| Ruta dentro de Agenda estetica | Procedencia |
| --- | --- |
| admin.html | Tu archivo actual |
| js/firebase-web.js | Tu conexión Firebase actual |
| reloj/index.html | Esta entrega |
| reloj/reloj.js | Esta entrega |
| reloj/reloj.css | Esta entrega |
| reloj/config.js y los demás archivos del ZIP | Esta entrega |

En VS Code abrí la carpeta completa de la agenda. Para probar localmente,
utilizá el servidor con el que ya trabajás, por ejemplo Live Server desde la raíz
del proyecto. Hacer doble clic sobre index.html no sirve para cargar los módulos
y la conexión compartida.

La carpeta `js` y su archivo `firebase-web.js` deben permanecer
en su ubicación actual. No hay que copiarlos dentro de reloj.

## Primera prueba

- Abrí el reloj con internet y verificá que indique **Agenda al día**.
- Compará un turno mostrado con tu agenda: nombre, hora, tratamiento y box.
- Tocá **Probar sonido** y ajustá el volumen del reloj y el volumen de Windows.
- Activá las alarmas. Por defecto avisan cinco minutos antes y a la hora del ingreso.
- Para familiarizarte sin datos reales, abrí `/reloj/?demo=1`.
  La demostración usa pacientes ficticios y nunca conecta con Firestore.
  Su botón **Simular un ingreso en 10 s** permite comprobar el aviso completo.

## Qué incluye

- Hora y fecha de Argentina, independiente de la zona horaria del navegador.
- Cuenta regresiva y tarjeta del próximo ingreso.
- Todos los turnos del día, ordenados cronológicamente.
- Ingresos simultáneos y los dos nombres de las reservas dúo.
- Sincronización por onSnapshot, sin recargar la página.
- Reprogramación automática de avisos cuando cambia fecha u hora.
- Cancelaciones y sesiones cerradas excluidas de las alarmas.
- Aviso visual con nombre, tratamiento y box; botón **Entendido**.
- Sonido regulable, tres tonos y aviso previo configurable.
- Avisos de escritorio opcionales, sin nombres ni tratamientos en la notificación.
- Pantalla completa y diseño adaptable a PC, tablet y celular.
- Instalación como aplicación web cuando el navegador la permite.
- Registro de avisos para evitar repeticiones al recargar y entre pestañas del
  mismo navegador y origen.

El filtro **Mostrar** cambia solamente la lista del día. Las agendas que generan
alarmas se eligen en **Ajustes → Agendas que activan avisos**.

## Integración con tu agenda

La integración se basa en los archivos admin.html, fecha.html, confirmar.html
y los paneles de depilación que compartiste.

Se importa el módulo existente desde `../js/firebase-web.js`,
relativo a reloj/reloj.js. Se reutilizan sus instancias de db y auth y sus
exportaciones modulares: collection, query, where, onSnapshot y onAuthStateChanged.
Para el formulario de acceso se utiliza signInWithEmailAndPassword, que tu panel
admin ya importa. Si el módulo exporta doc, también se leen los nombres de los
boxes desde configuracion/boxesLabels.

La cuenta permitida está en `config.js → adminEmails` y coincide
con el correo de esAdmin() de las reglas que proporcionaste.

Agendas activadas inicialmente:

| Colección | Uso |
| --- | --- |
| reservas | Reservas de estética, incluyendo las jornadas que estén aquí |
| consultas | Consultas iniciales |
| reservasDepi | Reservas del panel de depilación actual |

La variante antigua reservas_depi está disponible en Ajustes, desactivada de
inicio. Activala solamente si contiene reservas diferentes: si es una copia de
reservasDepi, leer ambas agendas produciría dos reservas distintas para el mismo turno.

Cada escucha consulta únicamente los documentos cuyo campo **fecha** está entre
hoy y mañana, en formato YYYY-MM-DD. Incluir mañana permite avisar antes de un
turno de medianoche. Al cambiar de día, las escuchas se renuevan automáticamente.
Estas consultas usan el índice habitual de fecha; no requieren un índice compuesto.
Si ese campo fue excluido de índices en tu proyecto, habrá que volver a habilitarlo.
Firestore contabiliza las lecturas según el uso y el plan de tu proyecto.

Campos utilizados:

| Dato | Campos reconocidos |
| --- | --- |
| Fecha consultada | fecha: YYYY-MM-DD |
| Hora | hora o hour; HH:mm, H:mm, H.mm y sufijo hs |
| Paciente | clienteNombre, nombre, cliente, displayName, title o nombrePaciente |
| Reserva dúo | duo, duoNombre1 y duoNombre2 |
| Tratamiento | servicio, tratamiento o serviceName |
| Box | boxLabel, box y boxes; admite b1 a b4 y números 1 a 4 |
| Duración opcional | duracionMinutos o duracion, expresada en minutos |
| Estado | estado, status y las banderas de cancelación o realización contempladas en motor.js |

Cuando un box o una duración no están indicados, el reloj no los deduce a partir
del tratamiento. Una reserva con fecha u hora inválida no dispara una alarma y
la pantalla informa que necesita revisión.

## Cómo se comportan las alarmas

**Esta versión funciona con el reloj abierto y el equipo despierto.** Una PWA
instalada sigue estando sujeta a las limitaciones del navegador. No es un
despertador del sistema operativo ni un servicio que continúe funcionando con
la aplicación cerrada, la PC suspendida o apagada.

Los temporizadores de una pestaña en segundo plano pueden demorarse. Para la
recepción conviene dejar el reloj visible en su propia ventana. La opción de
mantener la pantalla encendida usa Screen Wake Lock si está disponible; no
garantiza impedir toda suspensión del sistema, especialmente con la ventana oculta.

El navegador requiere una interacción para habilitar audio. Por eso, después de
abrir o recargar el reloj, se debe presionar **Activar alarmas**. Si el navegador
suspende el audio, **Probar sonido** intenta habilitarlo nuevamente.

La hora proviene del reloj del equipo y se presenta en Argentina, UTC−3. Mantené
activada la sincronización automática de fecha y hora de Windows.

- Los avisos se calculan a partir de la fecha y hora de la reserva, no de una
  cuenta regresiva que se va restando y puede acumular desvíos.
- Se revisan los eventos recientes dentro de una ventana de **90 segundos**.
  Si la conexión o el temporizador se demoran brevemente, se puede recuperar el aviso.
- Al volver después de una suspensión prolongada, los avisos de hace más de
  90 segundos se omiten para evitar que suenen todos los turnos atrasados.
- Los datos recibidos desde caché no habilitan alarmas hasta que el servidor
  confirme esa agenda. Sin conexión se pausan los avisos.
- Una agenda con error de lectura queda pausada; las demás agendas verificadas
  pueden continuar y la pantalla identifica cuáles fallaron.
- Cambiar el horario crea un nuevo evento; cancelar o eliminar la reserva retira
  sus eventos pendientes. Si su aviso estaba abierto, también se retira.
- El aviso previo y el aviso al ingreso tienen identidades distintas.
- Si varios turnos coinciden, se muestran juntos y se reproduce una campana común.
- **Entendido** solo cierra el aviso local: no marca al paciente como atendido,
  no descuenta sesiones y no escribe en Firestore.

El registro usa transacciones de IndexedDB para que dos pestañas del mismo
navegador no reproduzcan el mismo evento. Distintos equipos, perfiles, navegadores
u orígenes tienen registros separados: cada uno puede sonar. Los identificadores
antiguos se limpian después de siete días.

El registro garantiza que un evento reclamado no se vuelva a reclamar en ese
navegador mientras se conserve el registro. Si se cierra el proceso justo después
de registrar el aviso y antes de reproducirlo, ese aviso podría no sonar. Esta
versión no promete entrega infalible ni precisión de un despertador nativo.

## Reglas de Firestore y datos

Este módulo solo lee las colecciones necesarias. No modifica tus reglas,
reservas, pacientes, historias ni saldos. Los ajustes y los identificadores de
avisos quedan en el navegador; no se guardan nombres de pacientes en ese registro.
El módulo tampoco activa ni cambia la persistencia de Firestore configurada por
tu archivo compartido.

Tus reglas actuales permiten lectura pública de reservas y clients, y acceso
abierto a varias colecciones de depilación. El ingreso administrativo de esta
pantalla no corrige ese acceso público en la base. Para restringirlo habrá que
revisar las reglas junto con los flujos públicos de la agenda.

No hace falta cambiar las reglas para que funcione este reloj con la cuenta
administradora indicada.

## Archivos

| Archivo | Responsabilidad |
| --- | --- |
| index.html | Pantallas, formularios y diálogos |
| reloj.css | Diseño y adaptación a diferentes tamaños |
| reloj.js | Interfaz, sesión, suscripciones y coordinación |
| motor.js | Fechas, normalización y cálculo de avisos |
| alarmas.js | Audio y registro atómico de avisos |
| config.js | Cuenta, rutas, colecciones y valores iniciales |
| demo.js | Datos ficticios para comprobar el funcionamiento |
| manifest.webmanifest e iconos | Instalación de la aplicación |
| sw.js | Caché de la interfaz, con alcance limitado a /reloj/ |
| tests/motor.test.mjs | Pruebas del cálculo de reservas y alarmas |

El service worker conserva solo archivos de la interfaz. No intercepta Firestore,
no guarda reservas y no implementa alarmas en segundo plano. Su ámbito se limita
a la carpeta reloj; no reemplaza un service worker existente de toda la agenda.

Después de actualizar los archivos, cerrá las ventanas del reloj y volvé a abrirlo.
Si modificás su caché, incrementá la versión de CACHE en sw.js.

## Verificación de esta entrega

- 14 pruebas del motor: zona horaria, horas inválidas, campos reales, dúos,
  estados, avisos previos, reprogramaciones, cancelaciones, reconexiones,
  simultaneidad y medianoche.
- 5 pruebas de almacenamiento y sonido: reclamación simultánea entre dos
  conexiones, recarga, horario cambiado, separación de demo y volumen cero.
- Integración con DOM y Firebase simulados: inicio de sesión, consultas acotadas,
  visualización, texto seguro, activación, avisos, cancelación, recuperación de
  snapshots recientes y cierre de sesión.
- Validación estática de JavaScript, manifiesto y archivos referenciados.

No se probaron credenciales ni reservas en tu Firebase real: no adjuntaste
js/firebase-web.js y esta entrega reutiliza ese archivo de tu proyecto. La
verificación de interfaz fue mediante DOM simulado, sin prueba visual en un navegador.

Las pruebas del motor se pueden repetir, con Node.js 20 o posterior, desde esta
carpeta mediante:

    node --test tests/motor.test.mjs

## Referencias técnicas

- Firebase, escuchas en tiempo real: https://firebase.google.com/docs/firestore/query-data/listen
- MDN, reproducción automática de audio: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- Chrome, temporizadores en segundo plano: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
