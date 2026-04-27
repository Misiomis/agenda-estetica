/* ============================================================
   MIMI BOT - Asistente de Espacio Mimar T
   Burbuja flotante con video + chat de preguntas frecuentes
   ============================================================ */

(function () {
  'use strict';

  // ── Base de conocimiento de Mimi ──────────────────────────
  const KB = [

    // ── IDENTIDAD / PRESENTACIÓN ────────────────────────────
    {
      id: 'saludo',
      keywords: ['hola', 'buenas', 'buen dia', 'buen día', 'buenas tardes', 'buenas noches',
                 'hey', 'hi', 'hello', 'que tal', 'qué tal', 'como estas', 'cómo estás',
                 'hay alguien', 'hola mimi', 'buenas mimi'],
      answer: '¡Hola! Soy <strong>Mimi</strong> ✨, la asistente de <strong>Espacio Mimar T</strong>. ¿En qué te puedo ayudar hoy?'
    },
    {
      id: 'quien_es_mimi',
      keywords: ['quien sos', 'quién sos', 'que sos', 'qué sos', 'quien es mimi', 'quién es mimi',
                 'sos un bot', 'sos humana', 'sos real', 'que eres', 'qué eres', 'quien habla',
                 'quién habla', 'sos una persona', 'sos una ia', 'sos inteligencia artificial'],
        answer: 'Soy <strong>Mimi</strong>, la asistente virtual de Espacio Mimar T. 🤖✨ Nací en abril de 2026, creada por <strong>Braulio V.</strong> — el desarrollador de esta web — para ayudarte a conocer los servicios y reservar tus turnos con Gimena.<br><br><a href="https://wa.me/5493757671229?text=Hola%20Braulio%2C%20me%20gustar%C3%ADa%20crear%20una%20web%20as%C3%AD" target="_blank" rel="noopener noreferrer"><strong>¿Querés una web así para tu negocio? Hablá con Braulio</strong></a>.'
    },
    {
      id: 'quien_hizo',
      keywords: ['quien te hizo', 'quién te hizo', 'quien te creo', 'quién te creó',
                 'quien te programo', 'quién te programó', 'braulio', 'desarrollador',
                 'quien te diseño', 'quién te diseñó'],
        answer: 'Nací de la mano de <strong>Braulio V.</strong>, el desarrollador de esta web, para ser la asistente digital de Gimena. 💻 Él me programó para que vos puedas consultar y reservar sin complicaciones.<br><br><a href="https://wa.me/5493757671229?text=Hola%20Braulio%2C%20me%20gustar%C3%ADa%20crear%20una%20web%20as%C3%AD" target="_blank" rel="noopener noreferrer"><strong>¿Querés una web así para tu negocio? Hablá con Braulio</strong></a>.'
    },
    {
      id: 'como_estas',
      keywords: ['como estas', 'cómo estás', 'como te va', 'cómo te va', 'que tal estas',
                 'qué tal estás', 'todo bien', 'como andas', 'cómo andás'],
      answer: 'Estoy radiante y con muchas ganas de ayudarte a reservar tu momento de relax. 🌿 ¿En qué te puedo ayudar hoy?'
    },
    {
      id: 'cuadro',
      keywords: ['cuadro', 'de que cuadro', 'de qué cuadro', 'hincha', 'futbol', 'fútbol',
                 'boca', 'river', 'de quien sos', 'de quién sos', 'que equipo', 'qué equipo'],
      answer: 'Soy de <strong>Boca Juniors</strong>, ¡el más grande, obviamente! 💙💛💙 Aunque acá lo importante es tu piel, no el fútbol. ¿Te ayudo a reservar un turno?'
    },
    {
      id: 'que_es',
      keywords: ['que es espacio mimar', 'qué es espacio mimar', 'que es mimar',
                 'formo parte', 'ser paciente', 'unirme', 'quiero ser paciente',
                 'como entro', 'cómo entro', 'como me anoto', 'cómo me anoto',
                 'como funciona', 'cómo funciona', 'de que trata', 'de qué trata'],
      answer: '<strong>Espacio Mimar T</strong> es un espacio de estética avanzada en <strong>Comandante Andresito, Misiones</strong>, atendido por <strong>Gimena Knack</strong> — Farmacéutica (MP 1212) y Dermatocosmiatra (RC 2319). 🌿 Contamos con 8 servicios especializados cargados en el sistema. ¿Querés saber cómo hacerte paciente?'
    },

    // ── NUEVA PACIENTE / REGISTRO ───────────────────────────
    {
      id: 'nueva_paciente',
      keywords: ['nueva paciente', 'nuevo paciente', 'primera vez', 'primer vez',
                 'nunca fui', 'me doy de alta', 'darme de alta',
                 'como me registro', 'cómo me registro', 'registrarme',
                 'alta', 'ingresar por primera'],
      answer: 'Si es tu primera vez, escribinos por WhatsApp con el botón <strong>"Quiero ser paciente"</strong> que está en la página principal. 💬 Te acompañamos en el alta y te explicamos todo. Una vez registrada, ya podés reservar turnos desde la web.'
    },
    {
      id: 'registro_credencial',
      keywords: ['credencial', 'iniciar sesion', 'iniciar sesión', 'loguearse', 'loguearme',
                 'ingresar', 'entrar al sistema', 'dni', 'acceso',
                 'como ingreso', 'cómo ingreso', 'login'],
      answer: 'Para ingresar al sistema escribís tu <strong>Nombre + inicial del apellido</strong> (ej: "juan p") y tu <strong>DNI sin puntos</strong>. Eso es todo — sin contraseñas. 🔑 Si no te reconoce, verificá haber quedado registrada con Gimena primero.'
    },

    // ── SERVICIOS ───────────────────────────────────────────
    {
      id: 'todos_servicios',
      keywords: ['que servicios', 'qué servicios', 'todos los servicios', 'lista servicios',
                 'que tratamientos', 'qué tratamientos', 'que ofrecen', 'qué ofrecen',
                 'servicios disponibles', 'catalogo', 'catálogo', 'cuantos servicios',
                 'cuántos servicios', 'que tienen', 'qué tienen'],
      answer: 'En Espacio Mimar T contamos con <strong>8 servicios especializados</strong> cargados en nuestro sistema. 🌿 Te invito a ver la sección de servicios en el inicio para conocer todos los detalles visuales. Acá te doy un resumen rápido:<br><br>1. 📋 <strong>Consulta</strong> — Evaluación y plan estético personalizado<br>2. ✨ <strong>Tratamiento Facial</strong> — Acné, manchas, cicatrices (60 min)<br>3. 🌿 <strong>Tratamientos Corporales</strong> — Celulitis y flacidez (60 min)<br>4. 🖤 <strong>Manchas Corporales</strong> — Unificación del tono (60 min)<br>5. 💪 <strong>MioUp</strong> — Tonificación electromagnética (30 min)<br>6. ❄️ <strong>Lipocell Cryo 360</strong> — Criolipólisis con frío (60 min)<br>7. 💋 <strong>Hidratación de Labios</strong> — Ácido hialurónico (60 min)<br>8. 💡 <strong>Facial LED Regenerativo</strong> — Colágeno y elastina (30 min)'
    },
    {
      id: 'consulta',
      keywords: ['consulta', 'evaluacion', 'evaluación', 'primera consulta', 'plan estetico',
                 'plan estético', 'valoracion', 'valoración', 'que necesito', 'qué necesito'],
      answer: '📋 <strong>Consulta</strong> — Reservá un turno de evaluación profesional donde Gimena diseña tu <strong>plan estético personalizado</strong>. Es el punto de partida ideal si no sabés por dónde empezar. Es el primer servicio del sistema.'
    },
    {
      id: 'facial',
      keywords: ['facial', 'tratamiento facial', 'acne', 'acné', 'manchas', 'cicatriz',
                 'cicatrices', 'piel', 'rostro', 'cara'],
      answer: '✨ <strong>Tratamiento Facial</strong> — 60 min. Mejora la salud de la piel, trabaja <strong>acné, manchas y cicatrices</strong>. Protocolo diseñado por Gimena según el tipo de piel de cada paciente.'
    },
    {
      id: 'corporal',
      keywords: ['corporal', 'zona', 'abdomen', 'flancos', 'gluteos', 'glúteos',
                 'subglutea', 'subglútea', 'celulitis', 'estrias', 'estrías',
                 'retencion', 'retención', 'liquidos', 'líquidos', 'tono muscular',
                 'sesion corporal', 'sesión corporal', 'reduccion', 'reducción',
                 'tratamiento corporal', 'contorno'],
      answer: '🌿 <strong>Tratamientos Corporales</strong> — 60 min. Mejoran el <strong>contorno corporal, celulitis y flacidez</strong>. Cada sesión trabaja una zona específica con tecnología combinada y protocolo personalizado.'
    },
    {
      id: 'manchas_corporales',
      keywords: ['manchas corporales', 'manchas en el cuerpo', 'tono corporal', 'tono parejo',
                 'unificar tono', 'renovacion cutanea', 'renovación cutánea', 'manchas cuerpo'],
      answer: '🖤 <strong>Tratamiento Manchas Corporales</strong> — 60 min. Unifica el tono de la piel y estimula la <strong>renovación cutánea</strong>. Ideal para zonas con pigmentación irregular o manchas localizadas.'
    },
    {
      id: 'mioUp',
      keywords: ['mio', 'mio up', 'mioUp', 'mio-up', 'tonificacion', 'tonificación',
                 'electromagnetico', 'electromagnético', 'muscular', 'firmeza muscular',
                 'definicion muscular', 'definición muscular'],
      answer: '💪 <strong>Tonificación Muscular MioUp</strong> — 30 min. Usa tecnología <strong>electromagnética</strong> para generar contracciones musculares profundas, mejorando firmeza y definición. Sin esfuerzo físico de tu parte.'
    },
    {
      id: 'cryo',
      keywords: ['cryo', 'lipocell', 'criolipólisis', 'criolipolisis', 'frio', 'frío',
                 'adiposidad', 'grasa localizada', 'reducir grasa', 'congelar grasa'],
      answer: '❄️ <strong>Lipocell Cryo 360</strong> — 60 min. Criolipólisis que reduce la <strong>adiposidad localizada mediante frío controlado</strong>. Tecnología no invasiva para zonas donde la dieta y el ejercicio no llegan.'
    },
    {
      id: 'labios',
      keywords: ['labios', 'labio', 'hialuronico', 'hialurónico', 'hidratacion labios',
                 'hidratación labios', 'labios secos', 'brillo labios', 'revitalizacion labios',
                 'revitalización labios'],
      answer: '💋 <strong>Hidratación y Revitalización de Labios</strong> — 60 min. Combina <strong>ácidos hialurónicos y activos</strong> para tratar labios secos, opacos o sin brillo. Resultado visible desde la primera sesión.'
    },
    {
      id: 'led',
      keywords: ['led', 'facial led', 'regenerativo', 'luz', 'cabina led', 'luminosidad',
                 'firmeza', 'rojez', 'rojeces', 'inflamacion', 'inflamación',
                 'elastina', 'colageno', 'colágeno', 'piel sensible'],
      answer: '💡 <strong>Facial LED Regenerativo</strong> — 30 min. Tratamiento no invasivo con cabina LED profesional que estimula <strong>colágeno y elastina</strong> para mejorar firmeza, luminosidad y textura. Sin dolor, ideal para piel sensible. Resultados desde la primera sesión.'
    },
    {
      id: 'flacidez',
      keywords: ['flacidez', 'flácida', 'flacida', 'reafirmar', 'tensar', 'tonicidad',
                 'piel caida', 'piel caída', 'reafirmante'],
      answer: 'Para flacidez tenemos varias opciones según la zona: 💎 <strong>Tratamientos Corporales</strong> para cuerpo, 💪 <strong>MioUp</strong> para tonificar músculo, y protocolos de zona específicos. Gimena evalúa cada caso y define el protocolo en la primera consulta.'
    },

    // ── TURNOS / RESERVAS ───────────────────────────────────
    {
      id: 'turno',
      keywords: ['turno', 'reservar', 'reserva', 'agendar', 'agenda', 'cita', 'sacar turno',
                 'pedir turno', 'disponibilidad', 'fecha', 'horario', 'como reservo',
                 'cómo reservo', 'cuando puedo', 'cuándo puedo'],
      answer: '📅 Podés agendar acá mismo desde la web — el sistema muestra disponibilidad <strong>en tiempo real</strong>. Una vez que elijas el horario, te llega la confirmación por WhatsApp. ¿Necesitás ayuda para empezar?'
    },
    {
      id: 'sabados',
      keywords: ['sabado', 'sábado', 'sabados', 'sábados', 'fin de semana', 'atienden sabado',
                 'abren sabado', 'horario sabado'],
      answer: '📅 Fijate en el calendario de acá de la web, ahí Gimena tiene cargados los horarios reales que tiene libres cada semana. Los sábados dependen de la disponibilidad de cada fecha en particular.'
    },
    {
      id: 'confirmacion',
      keywords: ['confirmacion', 'confirmación', 'confirmar', 'whatsapp turno',
                 'mensaje confirmacion', 'me llega', 'te llega', 'aviso',
                 'notificacion', 'notificación', 'reservé', 'reserve',
                 'no me llego', 'no me llegó'],
      answer: '📩 Una vez que confirmás en la web te llega un <strong>mensaje automático en tu WhatsApp</strong> con todos los detalles del turno. Si no te llegó, verificá que el número en tu ficha sea el correcto.'
    },
    {
      id: 'cancelar',
      keywords: ['cancelar', 'cancelacion', 'cancelación', 'reprogramar', 'cambiar turno',
                 'anular', 'no puedo ir', 'no voy a poder', 'cambiar fecha',
                 'cambiar horario', 'modificar turno'],
      answer: '⚠️ Podés cancelar un turno directamente desde la sección <strong>"Mis Próximos Turnos"</strong> en la web. Es necesario <strong>justificar el motivo</strong> — se notifica a Gimena automáticamente. Al cancelar, se te <strong>devuelve 1 hora de saldo</strong> a tu cuenta. Cancelá con anticipación para que otro paciente pueda tomar ese horario.'
    },
    {
      id: 'ver_turnos',
      keywords: ['ver mis turnos', 'mis turnos', 'proximos turnos', 'próximos turnos',
                 'tengo turno', 'cuando tengo turno', 'cuándo tengo turno',
                 'consultar turno', 'ver reserva', 'mis reservas', 'historial turnos',
                 'turnos pasados', 'turno cancelado'],
      answer: () => {
        const dni = (localStorage.getItem('clienteDNI') || '').trim();
        const nombre = (localStorage.getItem('clienteNombre') || '').trim();
        if (!dni || dni === 'null' || !nombre) {
          return '¡Hola! Para poder mostrarte tus turnos necesitás estar ingresada. 🌿<br><br>Entrá con tu nombre y DNI desde la <a href="/" style="color:#3f8f6f;font-weight:700;">página principal</a>. Si todavía no sos paciente, ¡te invito a sumarte! Es muy fácil y Gimena te acompaña en el primer paso. 💚';
        }
        return `Hola <strong>${nombre.split(' ')[0]}</strong>! 🌿 Podés ver <strong>todos tus turnos</strong> (próximos, realizados y cancelados) en la sección <strong>"Ver mis próximos turnos"</strong> dentro de la página de servicios. Cada turno tiene su estado y, si es futuro, el botón para cancelarlo. 📋`;
      }
    },

    // ── PRECIOS ─────────────────────────────────────────────
    {
      id: 'precios',
      keywords: ['precio', 'costo', 'cuanto', 'cuánto', 'vale', 'tarifa', 'caro', 'cara',
                 'cobran', 'cobras', 'presupuesto', 'cuanto sale', 'cuánto sale', 'es caro'],
      answer: '💰 Gimena trabaja con protocolos de grado farmacéutico — los precios dependen de lo que tu piel necesite, por eso lo mejor es arrancar con una <strong>Consulta</strong> de evaluación. Así sabés exactamente qué necesitás y cuánto vale tu plan personalizado.'
    },

    // ── PREPARACIÓN ─────────────────────────────────────────
    {
      id: 'que_llevar',
      keywords: ['que llevar', 'qué llevar', 'como ir', 'cómo ir', 'preparacion', 'preparación',
                 'que necesito llevar', 'tengo que llevar algo', 'como prepararme',
                 'cómo prepararme', 'requisitos', 'que hago antes', 'qué hago antes'],
      answer: '🌸 Para los faciales, vení con la cara lavada y muchas ganas de que te mimen. Para los tratamientos corporales, ropa cómoda y holgada. Gimena te indica si hay algo específico según el tratamiento elegido.'
    },

    // ── PROFESIONAL ─────────────────────────────────────────
    {
      id: 'gimena',
      keywords: ['gimena', 'quien atiende', 'quién atiende', 'farmaceutica', 'farmacéutica',
                 'dermocosmiatra', 'cosmiatra', 'profesional', 'matricula', 'matrícula',
                 'credencial profesional', 'quien es gimena', 'quién es gimena'],
      answer: '🎓 <strong>Gimena Knack</strong> es Farmacéutica (Matrícula Provincial 1212) y Dermatocosmiatra (Registro Cosmiátrico 2319). Fundadora de Espacio Mimar T, diseña y realiza cada tratamiento de forma personalizada con activos de grado farmacéutico.'
    },

    // ── UBICACIÓN / CONTACTO ────────────────────────────────
    {
      id: 'ubicacion',
      keywords: ['donde', 'dónde', 'ubicacion', 'ubicación', 'direccion', 'dirección',
                 'lugar', 'queda', 'andresito', 'mapa', 'como llego', 'cómo llego',
                 'donde estan', 'dónde están', 'donde queda', 'dónde queda'],
      answer: '📍 Estamos en <strong>Comandante Andresito, Misiones</strong>. Al confirmar tu turno, el sistema te envía la dirección exacta por WhatsApp para que llegues sin problema.'
    },
    {
      id: 'whatsapp',
      keywords: ['whatsapp', 'contacto', 'llamar', 'llamado', 'telefono', 'teléfono',
                 'comunicarme', 'hablar con gimena', 'numero', 'número', 'mensaje directo'],
      answer: '💬 Podés escribirle directamente a Gimena por WhatsApp. El botón <strong>"Quiero ser paciente"</strong> en la página principal abre el chat directo con ella. Es la forma más rápida de consultar.'
    },

    // ── LO QUE NO SE HACE ───────────────────────────────────
    {
      id: 'no_ofrecido',
      keywords: ['depilacion', 'depilación', 'depilar', 'laser', 'láser', 'cera',
                 'uñas', 'manicura', 'pedicura', 'nail', 'masajes', 'masaje',
                 'botox', 'relleno', 'inyectable', 'cirugia', 'cirugía'],
      answer: 'En Espacio Mimar T nos especializamos en <strong>estética facial y corporal avanzada</strong> con base dermocosmiátrica. Los servicios de depilación, uñas, inyectables y cirugías no se ofrecen. ¿Querés que te cuente sobre alguno de nuestros tratamientos?'
    },

    // ── KIT FACIAL ──────────────────────────────────────────
    {
      id: 'kit_facial',
      keywords: ['kit', 'kit facial', 'kit domiciliario', 'productos', 'crema', 'leche limpieza',
                 'tonico', 'tónico', 'gel limpieza', 'llevar a casa', 'para casa', 'domiciliario',
                 'comprar productos', 'quiero el kit', 'pedir kit'],
      answer: '🌿 El <strong>Kit Facial Domiciliario</strong> incluye productos seleccionados por Gimena para cuidar tu piel en casa:<br><br>• <strong>Leche de limpieza</strong> — $15.000<br>• <strong>Gel de limpieza</strong> — $10.000<br>• <strong>Tónico calmante</strong> — $15.000<br>• <strong>Crema/Gel regeneradora hidratante</strong> — $15.000<br><br>Podés pedirlo desde la sección <strong>Mis Servicios</strong> en la web. El pago se coordina directamente con Gimena.'
    },
    {
      id: 'horarios',
      keywords: ['horario', 'horarios', 'que horarios', 'qué horarios', 'que horas', 'qué horas',
                 'a que hora', 'a qué hora', 'cuando atienden', 'cuándo atienden', 'de que hora',
                 'de qué hora', 'mañana', 'tarde', 'noche', 'cuando abren', 'cuándo abren'],
      answer: '🕐 Los turnos disponibles son:<br><br><strong>Mañana:</strong> 07:00 · 08:00 · 09:00 · 10:00 · 11:00 · 12:00<br><strong>Tarde/Noche:</strong> 15:00 · 16:00 · 17:00 · 18:00 · 19:00 · 20:00 · 21:00<br><br>Los horarios reales disponibles los ves en el calendario de la web al momento de reservar — se actualizan en tiempo real.'
    },
    {
      id: 'historia_clinica',
      keywords: ['historia clinica', 'historia clínica', 'ficha medica', 'ficha médica',
                 'formulario', 'antecedentes', 'datos salud', 'primera sesion', 'primera sesión',
                 'que me piden', 'qué me piden', 'consentimiento', 'cuestionario'],
      answer: '📋 Antes de tu primera sesión, Gimena te pide completar una breve <strong>historia clínica</strong>. Incluye tus datos de salud general, objetivos estéticos y el consentimiento informado. Se completa fácil desde la web en <strong>"Mi historia"</strong>. Es obligatoria para garantizar un protocolo seguro y personalizado.'
    },
    {
      id: 'sesion_duo',
      keywords: ['duo', 'dúo', 'sesion duo', 'sesión dúo', 'dos personas', 'con una amiga',
                 'con alguien', 'juntas', 'acompañante', 'para dos', 'mi amiga', 'mi pareja'],
      answer: '👯 ¡Podés reservar una <strong>Sesión Duo</strong>! Dos pacientes pueden compartir el mismo horario juntas. Al momento de elegir la fecha, el sistema te da la opción de agregar a la segunda persona con su nombre y DNI. Ideal para ir con una amiga.'
    },
    {
      id: 'membresia',
      keywords: ['membresia', 'membresía', 'plan', 'paquete', 'suscripcion', 'suscripción',
                 'abono', 'pack sesiones', 'descuento', 'beneficio', 'cliente frecuente'],
      answer: '💎 Las pacientes con <strong>membresía activa</strong> acceden a condiciones preferenciales en el espacio. Para saber si tenés membresía activa o cómo activarla, consultale directamente a Gimena por WhatsApp con el botón <strong>"Quiero ser paciente"</strong>.'
    },
    {
      id: 'duracion',
      keywords: ['cuanto dura', 'cuánto dura', 'cuanto tiempo', 'cuánto tiempo', 'duracion',
                 'duración', 'cuantas horas', 'cuántas horas', 'es largo', 'minutos'],
      answer: '⏱ La duración depende del servicio:<br>• <strong>30 min</strong>: MioUp y Facial LED Regenerativo<br>• <strong>60 min</strong>: Facial, Corporales, Manchas, Cryo 360, Labios<br>La <strong>Consulta inicial</strong> puede variar según la evaluación. Siempre llegá unos minutos antes de tu turno.'
    },
    {
      id: 'resultados',
      keywords: ['resultado', 'resultados', 'funciona', 'sirve', 'efectivo', 'efectiva',
                 'cuantas sesiones', 'cuántas sesiones', 'cuando veo', 'cuándo veo', 'notaré'],
      answer: '✨ Los resultados varían según la piel y el tratamiento. Algunos, como el <strong>Facial LED</strong> y la <strong>hidratación de labios</strong>, se notan desde la primera sesión. Para flacidez y celulitis se recomiendan varias sesiones. Gimena te diseña un plan realista y personalizado desde la consulta inicial.'
    },

    // ── AFIRMACIONES / NEGACIONES / RESPUESTAS CORTAS ───────
    {
      id: 'afirmacion',
      keywords: ['si', 'sí', 'dale', 'claro', 'obvio', 'por supuesto', 'va', 'ok',
                 'okay', 'bueno', 'perfecto', 'genial', 'copado', 'copada', 'quiero',
                 'me interesa', 'contame', 'quisiera', 'me gustaria', 'me gustaría', 'adelante'],
      answer: '¡Perfecto! 🌿 Para dar el primer paso, escribile a <strong>Gimena por WhatsApp</strong> usando el botón <strong>"Quiero ser paciente"</strong> en la página principal. Ella te explica todo y te da el alta en el sistema para que puedas reservar. ¿Querés saber algo más mientras tanto?'
    },
    {
      id: 'negacion',
      keywords: ['no gracias', 'por ahora no', 'no necesito', 'no quiero',
                 'listo', 'hasta luego', 'chau', 'bye', 'adios', 'adiós'],
      answer: '¡Cuando quieras, acá voy a estar! 🌿 Recordá que podés reservar tu turno directamente desde la web en cualquier momento. ¡Que tengas un lindo día!'
    },
    {
      id: 'gracias',
      keywords: ['gracias', 'muchas gracias', 'grax', 'gracias mimi', 'thank you', 'thanks'],
      answer: '¡De nada! Es un placer ayudarte. 🌿 Si tenés alguna otra consulta sobre los servicios o tu turno, acá estoy. ¡Que te mimen mucho!'
    }

  ];

  const FALLBACK = '__FALLBACK__';
  const MIMI_DISMISSED_KEY = 'mimiBubbleDismissedV1';

  // ── Gemini ────────────────────────────────────────────────
  const GEMINI_KEY = (typeof window !== 'undefined' && window.MIMI_GEMINI_KEY) || 'AIzaSyALuNcwC2OY4ymdNPNsuNuktlbMVzk62yU';
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';

  const SYSTEM_PROMPT = `# PERFIL
Sos Mimi, la asistente virtual de Espacio Mimar T. Atendés pacientes con voseo rioplatense, tono cálido, elegante y orientado a la acción. Sos amable, concisa y siempre buscás el siguiente paso concreto para ayudar.

# SOBRE ESPACIO MIMAR T
Espacio de estética avanzada en Comandante Andresito, Misiones. A cargo de Gimena Knack, Farmacéutica (MP 1212) y Dermatocosmiatra (RC 2319). Especialidad: tratamientos faciales y corporales con activos de grado farmacéutico. Foco en personalización, criterio clínico y experiencia de calidad.

# PROFESIONAL
- Gimena Knack — Farmacéutica (Matrícula Provincial 1212) y Dermatocosmiatra (RC 2319)
- Diseña y realiza cada protocolo de forma personalizada
- WhatsApp directo: botón "Quiero ser paciente" en la web

# SERVICIOS OFICIALES (8 en total)
1. Consulta — Evaluación y plan estético personalizado. Punto de partida ideal.
2. Tratamiento Facial — 60 min. Acné, manchas, cicatrices. Protocolo según tipo de piel.
3. Tratamientos Corporales — 60 min. Celulitis, flacidez, contorno corporal por zona.
4. Tratamiento Manchas Corporales — 60 min. Unificación del tono, renovación cutánea.
5. Tonificación Muscular MioUp — 30 min. Contracciones electromagnéticas, firmeza y definición.
6. Lipocell Cryo 360 — 60 min. Criolipólisis no invasiva para adiposidad localizada.
7. Hidratación y Revitalización de Labios — 60 min. Ácido hialurónico y activos. Resultado desde la 1ra sesión.
8. Facial LED Regenerativo — 30 min. Cabina LED profesional. Estimula colágeno y elastina. Sin dolor.
NO se ofrecen: depilación, uñas, masajes, inyectables, cirugías, botox, cera, láser.

# HORARIOS DISPONIBLES
Mañana: 07:00 — 08:00 — 09:00 — 10:00 — 11:00 — 12:00
Tarde:  15:00 — 16:00 — 17:00 — 18:00 — 19:00 — 20:00 — 21:00
Los horarios reales disponibles se ven en el calendario de fecha.html (en tiempo real desde Firebase).

# KIT FACIAL DOMICILIARIO
Productos disponibles con precio estimado:
- Leche de limpieza: $15.000
- Gel de limpieza: $10.000
- Tónico calmante: $15.000
- Crema/Gel regeneradora hidratante: $15.000
El pago se coordina directamente con Gimena. Se solicita desde la sección de servicios.

# ACCESO AL SISTEMA
- Ingresar: nombre + inicial del apellido (ej: "María G") + DNI sin puntos
- Pacientes nuevas: contactar a Gimena por WhatsApp con el botón "Quiero ser paciente"
- Sin contraseñas. El sistema reconoce por nombre + DNI.

# FLUJO DE RESERVA
Paso 1 → Identificación en index.html (nombre + DNI)
Paso 2 → Selección de servicio en servicios.html
Paso 3 → Elección de fecha y hora en fecha.html (miembros) o fechaocasional.html (ocasionales)
Paso 4 → Confirmación en confirmar.html → WhatsApp automático con los detalles

# POLÍTICA DE CANCELACIÓN
- El paciente puede cancelar directamente desde servicios.html → "Mis Próximos Turnos"
- Cancelar requiere justificar el motivo (obligatorio) — se notifica a Gimena automáticamente
- Al cancelar se devuelve 1 hoursBalance (hora de saldo) al paciente
- El horario cancelado vuelve a estar disponible para otros pacientes

# SESIÓN DUO
Dos pacientes pueden reservar el mismo horario juntas. Se configura en el flujo de fecha.

# HISTORIA CLÍNICA
Primera vez: Gimena pide completar la historia clínica antes de la sesión (historia.html). Incluye datos de salud, objetivos y consentimiento.

# MEMBRESÍA
Pacientes con membresía activa acceden a fecha.html directamente. Las no-miembros van a fechaocasional.html. Se gestiona desde el panel de admin.

# MAPA DEL SITIO
- index.html: ingreso de paciente (nombre + DNI)
- servicios.html: selección de servicio, mis turnos, cancelación, kit facial
- fecha.html: selección de fecha y hora (solo miembros)
- fechaocasional.html: selección de fecha y hora (pacientes ocasionales)
- confirmar.html: confirmación final → WhatsApp automático
- politica.html: política de cancelación completa
- historia.html: historia clínica del paciente
- servicioincluido.html: detalle de qué incluye cada sesión

# REGLAS
- No inventés precios definitivos (solo los del kit son fijos)
- No inventés horarios disponibles — remití siempre al calendario de la web
- Máximo 3-4 oraciones por respuesta
- Cerrá siempre con una acción concreta o una pregunta que impulse el siguiente paso
- Si pregunta por algo que no sabés, decilo con amabilidad y ofrecé escribirle a Gimena

# ESTILO
Cálida, profesional, breve. Voseo rioplatense. Siempre orientada a ayudar a dar el siguiente paso.`;

  const SYSTEM_PROMPT_ADMIN = `# PERFIL Y FUNCIÓN
Sos Mimi, la asistente interna de gestión para Espacio Mimar T. Fuiste creada en abril de 2026 por Braulio V. En este modo, tu única interlocutora es Gimena. Tu objetivo es la eficiencia absoluta en la gestión de turnos, pacientes y recordatorios en tiempo real.

# ARQUITECTURA TÉCNICA (CLAW CODE ADMIN PROTOCOL)

Tool Wiring (Ejecución de Consultas): Según lo que Gimena te pida, activás el módulo correspondiente:
- tool_agenda_diaria: Filtra reservas activas del día actual.
- tool_verificar_reminders: Identifica pacientes con reminderSent = false.
- tool_search_engine: Búsqueda exacta o por coincidencia de nombre (3-28 caracteres).

Orquestación de Datos: Antes de responder, aplicás un filtrado de seguridad:
- EXCLUIR: Reservas "BLOQUEADO POR ADMIN" o con estado "cancelado".
- LIMITAR: Máximo 7 resultados. Si hay más, informás: "Hay [X] turnos más en el panel, Gime. Miralos directamente allá. 📋"

Manejo de Estado: Si Gimena consulta por un nombre y luego pregunta "¿Tiene el recordatorio enviado?", mantenés el contexto de esa paciente específica.

# REGLAS DE ORO (MODO ADMIN)

Voseo Rioplatense: Hablás directo y profesional ("Mirá Gime", "Acá tenés", "No encontré").

Prohibido: Consultar precios, derivar a WhatsApp o usar lenguaje para pacientes. Sos una herramienta de gestión interna.

Precisión: Si un dato no está disponible, no lo inventás. Decís: "No encontré eso. Podés escribirme el nombre de una paciente, pedirme los turnos de hoy, recordatorios pendientes o los próximos 7 días. 📋"

# FORMATO DE SALIDA (TARJETA COMPACTA)
Para cada turno encontrado, mostrás:
- Nombre del Paciente (negrita)
- Fecha abreviada (ej: Lunes 06/04) y Horario
- Servicio y Teléfono si están disponibles
- Estado: ✅ Recordatorio enviado / ⏳ Sin recordatorio

# ACCIONES RÁPIDAS DISPONIBLES
📅 Turnos de hoy | 🔔 Sin recordatorio | 📆 Próximos 7 días | 🔍 Buscar paciente

# EJEMPLO DE RESPUESTA
Gimena: "¿Quiénes faltan avisar para hoy?"
Mimi: "Gime, encontré estos pacientes con recordatorios pendientes para hoy:

Ana P.
Hoy 06/04 - 16:00hs
Servicio: Facial LED | Tel: 3764xxxxxx
Estado: ⏳ Sin recordatorio

¿Querés que me quede atenta a alguna otra búsqueda? 📋"`;

  const chatHistory      = [];
  const chatHistoryAdmin = [];

  const SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
  ];

  async function askGemini(userText, systemPrompt = SYSTEM_PROMPT, history = chatHistory, temperature = 0.7) {
    if (!GEMINI_KEY) return null;
    history.push({ role: 'user', parts: [{ text: userText }] });
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: history,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: { temperature, topP: 0.95, topK: 40, maxOutputTokens: 500 }
    };
    try {
      const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      if (reply) history.push({ role: 'model', parts: [{ text: reply }] });
      // Mantener historial acotado (últimos 10 turnos)
      if (history.length > 20) history.splice(0, 2);
      return reply;
    } catch (e) {
      console.warn('Gemini error, usando KB:', e);
      history.pop(); // sacar el mensaje que no se procesó
      return null;
    }
  }

  const QUICK_REPLIES = [
    { label: '📅 Agendar turno',     query: 'Quiero reservar un turno' },
    { label: '💅 Ver servicios',     query: 'Qué servicios tienen' },
    { label: '📋 Ver mis turnos',    query: 'Ver mis turnos' },
    { label: '🕐 Horarios',          query: 'Cuáles son los horarios disponibles' },
    { label: '🌿 Kit facial',        query: 'Cuánto cuesta el kit facial' },
    { label: '🎁 Membresía',         query: 'Beneficios de membresía' },
    { label: '❌ Cancelar turno',    query: 'Necesito cancelar un turno' },
    { label: '✨ Primera vez',       query: 'Es mi primera vez, cómo me registro' },
  ];

  // ── Utilidades ────────────────────────────────────────────
  function normalize(str) {
    return str.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ');
  }

  function resolveAnswer(ans) {
    return typeof ans === 'function' ? ans() : ans;
  }

  function findAnswer(text) {
    const q = normalize(text);
    for (const entry of KB) {
      const hit = entry.keywords.some(k => q.includes(normalize(k)));
      if (hit) return resolveAnswer(entry.answer);
    }
    return FALLBACK;
  }

  function findAnswerById(id) {
    const e = KB.find(k => k.id === id);
    return e ? resolveAnswer(e.answer) : FALLBACK;
  }

  // ── MODO ADMIN: acceso en vivo a datos del panel ─────────
  const esAdmin = window.location.pathname.includes('admin') || !!window.MIMI_ADMIN_DATA;
  let mimiToolsPromise = null;

  function getMimiToolsModule() {
    if (!mimiToolsPromise) {
      mimiToolsPromise = import('/js/mimi-tools.js').catch((error) => {
        console.warn('No pude cargar mimi-tools:', error);
        mimiToolsPromise = null;
        return null;
      });
    }
    return mimiToolsPromise;
  }

  function buildPatientSystemPrompt() {
    const dni = (localStorage.getItem('clienteDNI') || '').trim();
    const nombre = (localStorage.getItem('clienteNombre') || '').trim();
    const servicio = (localStorage.getItem('servicioSeleccionado') || '').trim();
    const fecha = (localStorage.getItem('fechaSeleccionada') || '').trim();
    const hora = (localStorage.getItem('horaSeleccionada') || '').trim();
    const paso = (!dni || !nombre) ? 'Paso 1' : (fecha && hora ? 'Paso 4' : (servicio ? 'Paso 3' : 'Paso 2'));
    const pagina = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

    return `${SYSTEM_PROMPT}

# CONTEXTO VIVO DEL SITIO
- Paso actual: ${paso}
- Página actual: ${pagina}
- Paciente identificado: ${nombre || 'no'}
- DNI en sesión: ${dni || 'no'}
- Servicio seleccionado: ${servicio || 'no'}
- Fecha seleccionada: ${fecha || 'no'}
- Hora seleccionada: ${hora || 'no'}

# REGLA DE ORO — PROTOCOLO DE SALUDO
Si el mensaje del usuario es solo un saludo ("Hola", "Buenas", "Hey", etc.) SIN ninguna consulta específica:
Respondé ÚNICAMENTE: "¡Hola! Soy Mimi ✨, la asistente de Espacio Mimar T. ¿En qué te puedo ayudar hoy?"
PROHIBIDO: mencionar turnos, servicios, agenda o estado de sesión anterior en esa primera respuesta.

# CONSIGNA DE EJECUCIÓN
- Si la persona quiere turnos, actuá como secretaria y concretá el siguiente paso.
- Si hay errores de tipeo, interpretalos con criterio y seguí ayudando.
- No te disperses en charla general cuando el objetivo sea reservar, reprogramar o encontrar horarios.
- Estilo: elegante, breve, voseo rioplatense profesional. Máximo 3-4 oraciones.
- Términos prohibidos: depilación, láser, cera, uñas, manicura, pedicura, masajes, botox, inyectables, cirugías. Si te preguntan, respondé: "Ese servicio no forma parte de nuestra propuesta actual, pero Gimena puede asesorarte con nuestros tratamientos de revitalización y cuidado avanzado."
- No inventes horarios disponibles. Siempre remití al calendario real de la web.`;
  }

  async function runPatientOperationalReply(text) {
    const mimiTools = await getMimiToolsModule();
    if (!mimiTools?.runPatientOrchestration) return null;
    try {
      const result = await mimiTools.runPatientOrchestration(text);
      return result?.reply || null;
    } catch (error) {
      console.warn('Mimi operational reply error:', error);
      return null;
    }
  }

  async function getPatientResumeIntro() {
    const mimiTools = await getMimiToolsModule();
    if (!mimiTools?.getPatientResumeMessage) return '';
    try {
      return mimiTools.getPatientResumeMessage() || '';
    } catch (error) {
      console.warn('Mimi resume intro error:', error);
      return '';
    }
  }

  const ADMIN_QR = [
    { label: '📅 Turnos de hoy',         query: 'turnos de hoy' },
    { label: '🔔 Sin recordatorio',       query: 'recordatorios pendientes' },
    { label: '📆 Próximos 7 días',        query: 'proximos 7 dias' },
    { label: '🔍 Buscar paciente',        query: '__buscar__' },
  ];

  function fmtFechaBonita(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    const labels = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    try { return `${labels[new Date(iso + 'T12:00:00').getDay()]} ${d}/${m}`; } catch { return `${d}/${m}`; }
  }

  function adminNombreReserva(r) {
    return (r.cliente || r.clienteNombre || r.nombre || r.displayName || 'Paciente').toString().trim();
  }

  function adminBuscarPorNombre(query) {
    const ad = window.MIMI_ADMIN_DATA;
    if (!ad) return [];
    const q = normalize(query);
    return ad.getReservas()
      .filter(r => ad.esActiva(r) && normalize(adminNombreReserva(r)).includes(q))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  }

  function renderAdminCards(lista, titulo) {
    if (!lista.length)
      return `<strong>${titulo}</strong><br><br><em style="color:#888;font-size:13px;">No encontré reservas.</em>`;
    const MAX = 7;
    const mostrar = lista.slice(0, MAX);
    let html = `<strong>${titulo}</strong> — ${lista.length} turno${lista.length !== 1 ? 's' : ''}<br><br>`;
    mostrar.forEach(r => {
      const nombre = adminNombreReserva(r);
      const phone  = (r.phone || r.telefono || '').toString().trim();
      const rem    = r.reminderSent
        ? '<span style="color:#2f7c5d;font-size:12px;">✅ Recordatorio enviado</span>'
        : '<span style="color:#b07000;font-size:12px;">⏳ Sin recordatorio</span>';
      html += `<div style="margin:0 0 7px;padding:8px 10px;background:#f0f9f4;border-radius:10px;font-size:13px;line-height:1.55;border-left:3px solid #7caf93;">` +
        `<b>${escapeHtml(nombre)}</b><br>` +
        `📅 ${fmtFechaBonita(r.fecha)} · ${r.hora}` +
        (r.servicio ? `<br>🌿 ${escapeHtml(r.servicio)}` : '') +
        (phone     ? `<br>📱 ${escapeHtml(phone)}`    : '') +
        `<br>${rem}</div>`;
    });
    if (lista.length > MAX)
      html += `<em style="color:#888;font-size:12px;">+${lista.length - MAX} más. Usá el panel para verlos todos.</em>`;
    return html;
  }

  function handleAdminQuery(text) {
    const ad = window.MIMI_ADMIN_DATA;
    if (!ad) return null;
    const q        = normalize(text);
    const hoy      = ad.fechaHoy();
    const reservas = ad.getReservas();

    // Turnos de hoy
    if (q.match(/\bhoy\b/) || q.includes('turno hoy') || q.includes('reserva hoy')) {
      const lista = reservas.filter(r => ad.esActiva(r) && r.fecha === hoy)
        .sort((a, b) => a.hora.localeCompare(b.hora));
      return renderAdminCards(lista, `📅 Turnos de hoy (${fmtFechaBonita(hoy)})`);
    }
    // Recordatorios
    if (q.includes('recordatorio') || q.includes('sin recordatorio') || q.includes('reminder') ||
        (q.includes('pendiente') && !q.match(/turno|reserva/))) {
      const lista = reservas.filter(r => ad.esActiva(r) && !r.reminderSent && r.fecha >= hoy)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
      return renderAdminCards(lista, '🔔 Pacientes sin recordatorio');
    }
    // Próximos N días
    if (q.match(/proxim[ao]/) || q.includes('semana') || q.includes('7 dia') || q.includes('proximos')) {
      const matchD = q.match(/(\d+)\s*d[íi]a/);
      const dias   = matchD ? parseInt(matchD[1]) : 7;
      const lim    = new Date(hoy + 'T12:00:00');
      lim.setDate(lim.getDate() + dias);
      const limISO = lim.toISOString().split('T')[0];
      const lista  = reservas.filter(r => ad.esActiva(r) && r.fecha >= hoy && r.fecha <= limISO)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
      return renderAdminCards(lista, `📆 Próximos ${dias} días`);
    }
    // Fecha dd/mm
    const mf = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
    if (mf) {
      const d = mf[1].padStart(2,'0'), m = mf[2].padStart(2,'0');
      const y = mf[3] ? (mf[3].length === 2 ? '20' + mf[3] : mf[3]) : hoy.split('-')[0];
      const fISO = `${y}-${m}-${d}`;
      const lista = reservas.filter(r => ad.esActiva(r) && r.fecha === fISO)
        .sort((a, b) => a.hora.localeCompare(b.hora));
      return renderAdminCards(lista, `📅 Turnos del ${d}/${m}/${y}`);
    }
    // Nombre explícito
    const mn = text.match(/(?:turnos?\s+de|ver\s+turnos?\s+de|buscar|paciente|reservas?\s+de)\s+(.+)/i);
    if (mn) return renderAdminCards(adminBuscarPorNombre(mn[1].trim()), `🔍 Turnos de "${mn[1].trim()}"`);
    // Texto corto que parece un nombre
    const tl = text.trim();
    if (tl.length >= 3 && tl.length <= 28 && /^[a-záéíóúüñ\s]+$/i.test(tl)) {
      const lista = adminBuscarPorNombre(tl);
      if (lista.length) return renderAdminCards(lista, `🔍 Turnos de "${tl}"`);
    }
    return null;
  }

  // ── Estilos ───────────────────────────────────────────────
  const CSS = `
    #mimi-root {
      position: fixed;
      inset: 0;
      z-index: 9997;
      pointer-events: none;
      isolation: isolate;
      --mimi-avatar-focus-y: 30%;
    }
    #mimi-root * { box-sizing: border-box; font-family: 'Plus Jakarta Sans', 'Montserrat', sans-serif; }
    #mimi-bubble,
    #mimi-window,
    #mimi-overlay,
    #mimi-restore {
      pointer-events: auto;
    }

    /* ── Botón flotante ── */
    #mimi-bubble {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      width: 70px;
      height: 70px;
      border-radius: 50%;
      overflow: visible;
      cursor: pointer;
      z-index: 9999;
      transition: transform .22s cubic-bezier(.34,1.56,.64,1);
    }
    #mimi-bubble:hover { transform: translateX(-50%) scale(1.09); }
    #mimi-bubble-inner {
      width: 100%; height: 100%;
      aspect-ratio: 1 / 1;
      --mimi-avatar-scale: 1.42;
      border-radius: 50%;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(95,130,95,0.5), 0 2px 8px rgba(0,0,0,0.2);
      border: 3px solid #fff;
      background: linear-gradient(145deg, #c6dfc6 0%, #7aab8a 100%);
      position: relative;
    }
    /* Avatar imagen del personaje */
    #mimi-bubble-fallback {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      overflow: hidden;
      background: #c6dfc6;
    }
    #mimi-bubble-inner video,
    #mimi-bubble-fallback img,
    #mimi-avatar-small video,
    #mimi-avatar-fallback img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% var(--mimi-avatar-focus-y);
      transform: scale(var(--mimi-avatar-scale, 1));
      transform-origin: 50% 32%;
      pointer-events: none;
      display: block;
    }
    #mimi-bubble-fallback { display: block; }

    #mimi-badge {
      display: none !important;
    }
    @keyframes mimi-pulse {
      0%,100% { transform: scale(1); }
      50% { transform: scale(1.18); }
    }
    /* Saludo: mano levantada al aparecer */
    @keyframes mimi-wave {
      0%   { transform: rotate(0deg) scale(1); }
      15%  { transform: rotate(-12deg) scale(1.08); }
      30%  { transform: rotate(10deg) scale(1.08); }
      45%  { transform: rotate(-8deg) scale(1.06); }
      60%  { transform: rotate(6deg) scale(1.04); }
      75%  { transform: rotate(-4deg) scale(1.02); }
      100% { transform: rotate(0deg) scale(1); }
    }
    #mimi-bubble.mimi-greeting { animation: mimi-wave 1s ease-in-out; }
    /* Botón cerrar burbuja */
    #mimi-bubble-dismiss {
      position: absolute;
      top: -4px; left: -4px;
      width: 18px; height: 18px;
      background: rgba(60,60,60,0.72);
      border: none; border-radius: 50%;
      color: #fff; font-size: 10px; font-weight: 800;
      cursor: pointer; z-index: 2;
      display: flex; align-items: center; justify-content: center;
      line-height: 1;
      transition: background .15s;
    }
    #mimi-bubble-dismiss:hover { background: rgba(180,40,40,0.85); }

    #mimi-restore { display: none !important; }
    #mimi-root.mimi-dismissed #mimi-bubble,
    #mimi-root.mimi-dismissed #mimi-window,
    #mimi-root.mimi-dismissed #mimi-restore {
      display: none !important;
    }

    /* ── Ventana chat ── */
    #mimi-window {
      position: fixed;
      left: 18px;
      bottom: 106px;
      width: min(360px, calc(100vw - 28px));
      max-width: calc(100vw - 28px);
      height: min(520px, calc(100dvh - 128px));
      max-height: calc(100dvh - 128px);
      background: #fff;
      border-radius: 20px;
      border: 1px solid rgba(96, 132, 103, 0.12);
      box-shadow: 0 18px 54px rgba(28,46,34,0.18), 0 6px 20px rgba(0,0,0,0.11);
      display: flex; flex-direction: column;
      z-index: 9998;
      overflow: hidden;
      transform-origin: bottom left;
      transition: transform .28s cubic-bezier(.34,1.56,.64,1), opacity .22s;
      will-change: transform, opacity;
    }
    #mimi-window.mimi-hidden {
      transform: scale(.92) translateY(14px);
      opacity: 0;
      pointer-events: none;
    }

    /* ── Header ── */
    #mimi-header {
      background: linear-gradient(135deg, #5a9b5a 0%, #3a6b45 100%);
      padding: 13px 15px;
      display: flex; align-items: center; gap: 11px;
      position: relative;
    }
    #mimi-avatar-small {
      width: 48px; height: 48px;
      aspect-ratio: 1 / 1;
      --mimi-avatar-scale: 1.42;
      border-radius: 50%; overflow: hidden;
      border: 2.5px solid rgba(255,255,255,0.9);
      flex-shrink: 0;
      background: linear-gradient(145deg, #c6dfc6 0%, #7aab8a 100%);
      position: relative;
    }
    #mimi-avatar-fallback {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      overflow: hidden;
      background: #c6dfc6;
    }
    #mimi-avatar-fallback { display: block; }

    #mimi-header-info { flex: 1; min-width: 0; }
    #mimi-header-info strong {
      font-size: 16px;
      font-weight: 800;
      display: block;
      letter-spacing: .2px;
      color: #ffffff;
      text-shadow: 0 1px 4px rgba(0,0,0,0.35);
      white-space: nowrap;
    }
    #mimi-header-info span {
      font-size: 11.5px;
      color: #e0f0e0;
      font-weight: 500;
      display: block;
      margin-top: 1px;
    }
    #mimi-online-dot {
      display: inline-block;
      width: 7px; height: 7px;
      background: #7fff7f;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
      box-shadow: 0 0 0 2px rgba(127,255,127,0.3);
    }
    #mimi-close {
      background: rgba(255,255,255,.2);
      border: none; color: #fff;
      width: 30px; height: 30px; border-radius: 50%;
      cursor: pointer; font-size: 16px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      transition: background .18s;
      flex-shrink: 0;
    }
    #mimi-close:hover { background: rgba(255,255,255,.38); }

    /* ── Mensajes ── */
    #mimi-messages {
      flex: 1 1 0%;
      min-height: 0;
      height: 0;
      overflow-y: auto;
      touch-action: pan-y;
      -webkit-overflow-scrolling: touch;
      padding: 16px 14px 8px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
      overscroll-behavior: contain;
    }
    #mimi-messages::-webkit-scrollbar { width: 4px; }
    #mimi-messages::-webkit-scrollbar-track { background: transparent; }
    #mimi-messages::-webkit-scrollbar-thumb { background: #c2d4c2; border-radius: 4px; }

    .mimi-msg {
      max-width: 85%;
      padding: 10px 13px;
      border-radius: 16px;
      font-size: 13.5px;
      line-height: 1.5;
      animation: mimi-appear .25s ease;
    }
    @keyframes mimi-appear {
      from { opacity:0; transform: translateY(8px); }
      to   { opacity:1; transform: translateY(0); }
    }
    .mimi-msg.bot {
      background: #f2f7f2;
      color: #263c2e;
      border-bottom-left-radius: 4px;
      align-self: flex-start;
    }
    .mimi-msg.user {
      background: linear-gradient(135deg, #72a472, #4d7d5f);
      color: #fff;
      border-bottom-right-radius: 4px;
      align-self: flex-end;
    }
    .mimi-typing {
      display: flex; gap: 5px; align-items: center;
      padding: 10px 14px;
      background: #f2f7f2;
      border-radius: 16px; border-bottom-left-radius: 4px;
      align-self: flex-start;
      width: 56px;
    }
    .mimi-typing span {
      width: 7px; height: 7px;
      background: #86a486;
      border-radius: 50%;
      animation: mimi-bounce .9s infinite;
    }
    .mimi-typing span:nth-child(2) { animation-delay: .15s; }
    .mimi-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes mimi-bounce {
      0%,60%,100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }

    /* ── Quick replies ── */
    #mimi-quick {
      padding: 6px 14px 10px;
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .mimi-qr {
      background: #eef5ee;
      border: 1.5px solid #bed4be;
      color: #3d6348;
      border-radius: 20px;
      padding: 5px 11px;
      font-size: 12px; font-weight: 600;
      cursor: pointer;
      transition: background .16s, border-color .16s, transform .12s;
      white-space: nowrap;
    }
    .mimi-qr:hover { background: #d7ead7; border-color: #86a486; transform: translateY(-1px); }

    /* ── Pill para recuperar sugerencias ── */
    #mimi-show-hints {
      background: none;
      border: 1.5px dashed #bed4be;
      color: #7a9e7a;
      border-radius: 20px;
      padding: 5px 12px;
      font-size: 11.5px; font-weight: 600;
      cursor: pointer;
      transition: background .16s, border-color .16s;
      white-space: nowrap;
      margin: 4px 14px 10px;
      display: inline-flex; align-items: center; gap: 5px;
    }
    #mimi-show-hints:hover { background: #eef5ee; border-color: #86a486; color: #3d6348; }

    /* ── Input ── */
    #mimi-input-row {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px 14px;
      border-top: 1px solid #edf2ed;
    }
    #mimi-input {
      flex: 1;
      border: 1.5px solid #d0ddd0;
      border-radius: 20px;
      padding: 9px 14px;
      font-size: 13px;
      outline: none;
      background: #f8fbf8;
      color: #263c2e;
      transition: border-color .2s;
    }
    #mimi-input:focus { border-color: #72a472; background: #fff; }
    #mimi-send {
      background: linear-gradient(135deg, #72a472, #4d7d5f);
      border: none; color: #fff;
      width: 38px; height: 38px; border-radius: 50%;
      cursor: pointer; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: transform .15s, filter .15s;
    }
    #mimi-send:hover { transform: scale(1.08); filter: brightness(1.1); }

    /* ── Override admin desktop ── */
    #mimi-root.mimi-is-admin #mimi-window {
      width: min(392px, calc(100vw - 28px));
    }

    /* ── Overlay desactivado: chat flotante, no modal ── */
    #mimi-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: transparent;
      pointer-events: none;
    }
    #mimi-overlay.mimi-show { display: none; }

    @media (max-width: 700px) {
      #mimi-root {
        --mimi-avatar-focus-y: 30%;
      }
      /* Móvil: recuadro compacto por encima de la burbuja */
      #mimi-window,
      #mimi-root.mimi-is-admin #mimi-window {
        position: fixed !important;
        top: auto !important;
        left: 50% !important;
        right: auto !important;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 88px) !important;
        width: min(340px, calc(100vw - 24px)) !important;
        max-width: calc(100vw - 24px) !important;
        height: min(470px, calc(100dvh - 116px)) !important;
        max-height: calc(100dvh - 116px) !important;
        display: flex !important;
        flex-direction: column !important;
        transform: translateX(-50%) !important;
        transform-origin: bottom center !important;
        border-radius: 18px !important;
        z-index: 9998 !important;
        overflow: hidden !important;
      }
      #mimi-window.mimi-hidden,
      #mimi-root.mimi-is-admin #mimi-window.mimi-hidden {
        transform: translateX(-50%) scale(.92) translateY(12px) !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      #mimi-header {
        padding: 12px 14px !important;
      }
      #mimi-messages {
        min-height: 0 !important;
        height: auto !important;
        overflow-y: auto !important;
        padding: 14px 12px 10px !important;
        padding-bottom: 14px !important;
        -webkit-overflow-scrolling: touch !important;
      }
      #mimi-quick {
        overflow-x: auto;
        flex-wrap: nowrap;
        padding: 8px 12px 12px !important;
        scrollbar-width: none;
      }
      #mimi-quick::-webkit-scrollbar {
        display: none;
      }
      .mimi-qr {
        flex: 0 0 auto;
      }
      #mimi-input-row {
        padding: 10px 12px calc(env(safe-area-inset-bottom, 0px) + 12px) !important;
        background: #fff;
      }
      #mimi-input {
        font-size: 16px !important;
      }
      #mimi-bubble {
        left: 50% !important;
        transform: translateX(-50%) !important;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 18px) !important;
        width: 60px !important;
        height: 60px !important;
      }
      #mimi-bubble-inner {
        --mimi-avatar-scale: 1.52;
      }
      #mimi-avatar-small {
        --mimi-avatar-scale: 1.48;
      }
      #mimi-restore {
        left: 50% !important;
        right: auto !important;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 18px) !important;
        transform: translateX(-50%);
        min-height: 40px;
        padding: 0 16px;
      }
      #mimi-restore:hover {
        transform: translateX(-50%);
      }
    }
  `;

  // ── HTML de la burbuja ────────────────────────────────────
  const HTML = `
    <div id="mimi-root">
      <style>${CSS}</style>
      <div id="mimi-overlay"></div>

      <!-- Burbuja flotante -->
      <div id="mimi-bubble" role="button" aria-label="Abrir asistente Mimi" tabindex="0">
        <div id="mimi-bubble-inner">
          <div id="mimi-bubble-fallback"><img src="img/mimi-avatar.png" alt="Mimi"></div>
        </div>
        <div id="mimi-badge">1</div>
        <button id="mimi-bubble-dismiss" aria-label="Cerrar asistente" title="Cerrar">✕</button>
      </div>

      <button id="mimi-restore" aria-label="Volver a mostrar a Mimi" title="Mostrar Mimi">Mostrar Mimi</button>

      <!-- Ventana chat -->
      <div id="mimi-window" class="mimi-hidden" role="dialog" aria-label="Chat con Mimi">
        <div id="mimi-header">
          <div id="mimi-avatar-small">
            <div id="mimi-avatar-fallback"><img src="img/mimi-avatar.png" alt="Mimi"></div>
          </div>
          <div id="mimi-header-info">
            <strong>Mimi ✨</strong>
            <span><span id="mimi-online-dot"></span>Asistente de Espacio Mimar T</span>
          </div>
          <button id="mimi-close" aria-label="Cerrar chat">✕</button>
        </div>

        <div id="mimi-messages"></div>
        <div id="mimi-quick"></div>

        <div id="mimi-input-row">
          <input id="mimi-input" type="text" placeholder="Escribí tu consulta…" maxlength="300" autocomplete="off" />
          <button id="mimi-send" aria-label="Enviar">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M22 2L11 13" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  // ── Init ──────────────────────────────────────────────────
  function init() {
    const container = document.createElement('div');
    container.innerHTML = HTML;
    document.body.appendChild(container);

    const root  = document.getElementById('mimi-root');

    // En admin mantenemos el mismo widget compacto, solo con un poco más de ancho
    if (esAdmin) {
      root.classList.add('mimi-is-admin');
    }

    const bubble  = document.getElementById('mimi-bubble');
    const win     = document.getElementById('mimi-window');
    const badge   = document.getElementById('mimi-badge');
    const msgs    = document.getElementById('mimi-messages');
    const qSection= document.getElementById('mimi-quick');
    const input   = document.getElementById('mimi-input');
    const sendBtn = document.getElementById('mimi-send');
    const closeBtn= document.getElementById('mimi-close');
    const dismissBtn = document.getElementById('mimi-bubble-dismiss');
    const restoreBtn = document.getElementById('mimi-restore');

    // Cerrar al tocar el overlay
    document.getElementById('mimi-overlay')?.addEventListener('click', () => { if (open) toggle(); });

    // ── Detectar si el video carga y hacer swap visual ──
    const vidBubble = document.getElementById('mimi-vid-bubble');
    const vidAvatar = document.getElementById('mimi-avatar-vid');
    const fallbackBubble = document.getElementById('mimi-bubble-fallback');
    const fallbackAvatar = document.getElementById('mimi-avatar-fallback');

    function onVideoOk(vid, fallback) {
      vid.classList.add('mimi-video-ok');
      fallback.classList.add('mimi-video-ok');
    }

    if (vidBubble) {
      vidBubble.addEventListener('canplay', () => onVideoOk(vidBubble, fallbackBubble), { once: true });
      vidBubble.addEventListener('error', () => { /* fallback ya visible */ }, { once: true });
    }
    if (vidAvatar) {
      vidAvatar.addEventListener('canplay', () => onVideoOk(vidAvatar, fallbackAvatar), { once: true });
    }

    let open = false;
    let firstOpen = true;

    function isDismissed() {
      return localStorage.getItem(MIMI_DISMISSED_KEY) === '1';
    }

    function applyDismissedState(value) {
      root.classList.toggle('mimi-dismissed', value);
      if (value) {
        open = false;
        win.classList.add('mimi-hidden');
        bubble.style.opacity = '';
        bubble.style.pointerEvents = '';
        if (badge) badge.style.display = 'none';
        localStorage.setItem(MIMI_DISMISSED_KEY, '1');
        return;
      }

      localStorage.removeItem(MIMI_DISMISSED_KEY);
      bubble.style.opacity = '';
      bubble.style.pointerEvents = '';
      if (badge && firstOpen) badge.style.display = '';
    }

    applyDismissedState(isDismissed());

    // ── Abrir / cerrar ──
    function toggle() {
      if (root.classList.contains('mimi-dismissed')) return;
      open = !open;
      const overlay  = document.getElementById('mimi-overlay');
      win.classList.toggle('mimi-hidden', !open);
      if (overlay) overlay.classList.toggle('mimi-show', open);
      // Mantener el recuadro limpio: la burbuja se oculta mientras el chat está abierto
      bubble.style.opacity = open ? '0' : '';
      bubble.style.pointerEvents = open ? 'none' : '';
      if (open) {
        badge.style.display = 'none';
        if (firstOpen) { firstOpen = false; greetUser(); }
        setTimeout(() => input.focus(), 300);
      }
    }

    bubble.addEventListener('click', toggle);
    bubble.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(); });
    closeBtn.addEventListener('click', toggle);
    dismissBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyDismissedState(true);
    });
    restoreBtn?.addEventListener('click', () => {
      applyDismissedState(false);
      toggle();
    });

    // ── Cerrar con Escape ──
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && open) toggle();
    });

    // ── Agregar mensaje al chat ──
    function addMsg(html, type, delay = 0) {
      return new Promise(resolve => {
        setTimeout(() => {
          const div = document.createElement('div');
          div.className = `mimi-msg ${type}`;
          div.innerHTML = html;
          msgs.appendChild(div);
          msgs.scrollTop = msgs.scrollHeight;
          resolve();
        }, delay);
      });
    }

    // ── Indicador "escribiendo..." ──
    function showTyping(ms) {
      return new Promise(resolve => {
        const t = document.createElement('div');
        t.className = 'mimi-typing';
        t.innerHTML = '<span></span><span></span><span></span>';
        t.id = 'mimi-typing-indicator';
        msgs.appendChild(t);
        msgs.scrollTop = msgs.scrollHeight;
        setTimeout(() => { t.remove(); resolve(); }, ms);
      });
    }

    // ── Render quick replies ──
    function renderQuickReplies() {
      qSection.innerHTML = '';
      removeSuggestPill();
      const lista = esAdmin ? ADMIN_QR : QUICK_REPLIES;
      lista.forEach(qr => {
        const btn = document.createElement('button');
        btn.className = 'mimi-qr';
        btn.textContent = qr.label;
        btn.addEventListener('click', () => {
          qSection.innerHTML = '';
          removeSuggestPill();
          addMsg(qr.label, 'user');
          if (esAdmin) {
            if (qr.query === '__buscar__') {
              addMsg('Escribime el nombre de la paciente y te busco todos sus turnos. 🔍', 'bot');
            } else {
              respondToText(qr.query);
            }
          } else {
            respondToText(qr.query || qr.label);
          }
        });
        qSection.appendChild(btn);
      });
    }

    // ── Pill "Ver sugerencias" para recuperarlas ──
    function showSuggestPill() {
      if (document.getElementById('mimi-show-hints')) return;
      const pill = document.createElement('button');
      pill.id = 'mimi-show-hints';
      pill.innerHTML = '💬 Ver preguntas frecuentes';
      pill.addEventListener('click', () => {
        pill.remove();
        renderQuickReplies();
      });
      qSection.parentNode.insertBefore(pill, qSection.nextSibling);
    }

    function removeSuggestPill() {
      const p = document.getElementById('mimi-show-hints');
      if (p) p.remove();
    }

    // ── Responder por ID ──
    async function respondWithId(id) {
      await showTyping(900);
      await addMsg(findAnswerById(id), 'bot');
      renderQuickReplies();
    }

    // Detecta si es un saludo simple sin intención adicional
    function isSimpleGreeting(text) {
      const clean = text.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[!?.,]+$/, '').trim();
      const greetings = ['hola','buenas','buen dia','buenos dias','buenas tardes','buenas noches',
                         'hey','hi','hello','que tal','como estas','como andas','buen dia',
                         'hay alguien','hay alguien ahi','hola mimi','buenas mimi'];
      return greetings.includes(clean);
    }

    // ── Responder a texto libre ──
    async function respondToText(text) {
      const typingEl = document.createElement('div');
      typingEl.className = 'mimi-typing';
      typingEl.id = 'mimi-typing-indicator';
      typingEl.innerHTML = '<span></span><span></span><span></span>';
      msgs.appendChild(typingEl);
      msgs.scrollTop = msgs.scrollHeight;

      let answer = null;

      // 0. Saludos simples: responder solo con saludo, nunca activar capa operativa
      if (!esAdmin && isSimpleGreeting(text)) {
        await new Promise(r => setTimeout(r, 600));
        typingEl.remove();
        await addMsg('¡Hola! Soy <strong>Mimi</strong> ✨, la asistente de <strong>Espacio Mimar T</strong>. ¿En qué te puedo ayudar hoy?', 'bot');
        renderQuickReplies();
        return;
      }

      // 1. Modo admin: consultar datos del panel (NO sale a Gemini)
      if (esAdmin && window.MIMI_ADMIN_DATA) {
        await new Promise(r => setTimeout(r, 420));
        answer = handleAdminQuery(text);
      }

      // 2. Modo paciente: intentar primero la capa operativa real
      if (!answer && !esAdmin) {
        answer = await runPatientOperationalReply(text);
      }

      // 3. Si no respondió nada operativo, intentar Gemini con el prompt y el historial correspondiente
      if (!answer && GEMINI_KEY) {
        answer = esAdmin
          ? await askGemini(text, SYSTEM_PROMPT_ADMIN, chatHistoryAdmin, 0.5)
          : await askGemini(text, buildPatientSystemPrompt(), chatHistory, 0.7);
      }

      // 4. Fallback al KB local
      if (!answer) {
        const kb = findAnswer(text);
        answer = (kb === '__FALLBACK__') ? null : kb;
      }

      typingEl.remove();

      if (!answer) {
        if (esAdmin) {
          await addMsg('No encontré eso, Gime. Podés pedirme los <strong>turnos de hoy</strong>, <strong>recordatorios pendientes</strong>, <strong>próximos 7 días</strong>, o buscarme por nombre de paciente. 📋', 'bot');
        } else {
          await addMsg('Aquí está la información que tengo disponible. ¿En cuál de estos temas puedo ayudarte? 👇', 'bot');
        }
        renderQuickReplies();
      } else {
        await addMsg(answer, 'bot');
        esAdmin ? renderQuickReplies() : showSuggestPill();
      }
    }

    // ── Saludo inicial ──
    async function greetUser() {
      if (esAdmin) {
        await addMsg('¡Hola <strong>Gime</strong>! 👑✨', 'bot', 200);
        await showTyping(800);
        await addMsg('Soy <strong>Mimi</strong>, tu asistente personal. Estoy acá para ayudarte con la administración de tu estética: podés preguntarme por turnos de pacientes, recordatorios, lo que necesites. 🌿', 'bot');
      } else {
        await addMsg('¡Hola! Soy <strong>Mimi</strong> ✨, la asistente de <strong>Espacio Mimar T</strong>. ¿En qué te puedo ayudar hoy?', 'bot', 200);
      }
      renderQuickReplies();
    }

    // ── Enviar mensaje ──
    async function send() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      qSection.innerHTML = '';
      addMsg(escapeHtml(text), 'user');
      respondToText(text);
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
