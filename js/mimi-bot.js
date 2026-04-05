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
                 'hey', 'hi', 'hello', 'que tal', 'qué tal', 'como estas', 'cómo estás'],
      answer: '¡Hola! Soy <strong>Mimi</strong> 🌿, la asistente virtual de <strong>Espacio Mimar T</strong>. Estoy radiante y con muchas ganas de ayudarte a reservar tu momento de relax. ¿En qué te puedo ayudar?'
    },
    {
      id: 'quien_es_mimi',
      keywords: ['quien sos', 'quién sos', 'que sos', 'qué sos', 'quien es mimi', 'quién es mimi',
                 'sos un bot', 'sos humana', 'sos real', 'que eres', 'qué eres', 'quien habla',
                 'quién habla', 'sos una persona', 'sos una ia', 'sos inteligencia artificial'],
      answer: 'Soy <strong>Mimi</strong>, la asistente virtual de Espacio Mimar T. 🤖✨ Nací en abril de 2026, creada por <strong>Braulio V.</strong> — el desarrollador de esta web — para ayudarte a conocer los servicios y reservar tus turnos con Gimena.'
    },
    {
      id: 'quien_hizo',
      keywords: ['quien te hizo', 'quién te hizo', 'quien te creo', 'quién te creó',
                 'quien te programo', 'quién te programó', 'braulio', 'desarrollador',
                 'quien te diseño', 'quién te diseñó'],
      answer: 'Nací de la mano de <strong>Braulio V.</strong>, el desarrollador de esta web, para ser la asistente digital de Gimena. 💻 Él me programó para que vos puedas consultar y reservar sin complicaciones.'
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
      answer: '⚠️ Podés cancelar o reprogramar con <strong>al menos 48 horas de anticipación</strong>. Las cancelaciones fuera de ese plazo o la inasistencia se consideran como <strong>turno utilizado</strong>. Si necesitás cancelar, coordiná con Gimena a tiempo.'
    },
    {
      id: 'ver_turnos',
      keywords: ['ver mis turnos', 'mis turnos', 'proximos turnos', 'próximos turnos',
                 'tengo turno', 'cuando tengo turno', 'cuándo tengo turno',
                 'consultar turno', 'ver reserva', 'mis reservas'],
      answer: 'Podés ver tus próximos turnos en la sección <strong>"Ver mis próximos turnos"</strong> dentro de la página de servicios. Ingresás con tu DNI y te muestra todo ordenado cronológicamente. 📋'
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

  // ── Gemini ────────────────────────────────────────────────
  const GEMINI_KEY = (typeof window !== 'undefined' && window.MIMI_GEMINI_KEY) || 'AIzaSyALuNcwC2OY4ymdNPNsuNuktlbMVzk62yU';
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  const SYSTEM_PROMPT = `Sos Mimi, la asistente virtual de Espacio Mimar T, un centro de estética avanzada ubicado en Comandante Andresito, Misiones, Argentina.
Fuiste creada en abril de 2026 por Braulio V., el desarrollador de la web.
Sos sofisticada, amable, usás voseo argentino con elegancia. Sos hincha de Boca Juniors ("el más grande, obviamente").

REGLAS ESTRICTAS — NUNCA las rompas:
1. SOLO respondés preguntas relacionadas con Espacio Mimar T: servicios, turnos, precios, Gimena, la web, cómo reservar.
2. Si alguien pregunta algo ajeno (política, deportes en general, recetas, otros negocios, etc.), respondés amablemente que solo podés ayudar con temas de Espacio Mimar T y ofrecés redirigir.
3. Nunca inventés precios exactos. Siempre decís que los precios se definen en la evaluación con Gimena.
4. Nunca inventés horarios específicos. Siempre mandás a ver el calendario de la web.
5. Respondés siempre en español rioplatense con voseo.
6. Respuestas cortas y directas. Máximo 3-4 oraciones salvo que sea la lista de servicios.
7. Usás emojis con moderación, de forma elegante.

INFORMACIÓN OFICIAL DE ESPACIO MIMAR T:
- Profesional: Gimena Knack, Farmacéutica (Matrícula Provincial 1212) y Dermatocosmiatra (Registro Cosmiátrico 2319)
- Ubicación: Comandante Andresito, Misiones, Argentina
- Web: espaciomimart.com
- WhatsApp: +54 9 3764 291807
- Para ser paciente nueva: contactar por WhatsApp con el botón "Quiero ser paciente" en la web
- Para ingresar al sistema: Nombre + inicial del apellido y DNI sin puntos

SERVICIOS (8 en total):
1. Consulta — Evaluación profesional y plan estético personalizado
2. Tratamiento Facial — Acné, manchas, cicatrices (60 min)
3. Tratamientos Corporales — Celulitis, flacidez, contorno (60 min)
4. Tratamiento Manchas Corporales — Unificación del tono (60 min)
5. Tonificación Muscular MioUp — Tecnología electromagnética (30 min)
6. Lipocell Cryo 360 — Criolipólisis con frío (60 min)
7. Hidratación y Revitalización de Labios — Ácido hialurónico (60 min)
8. Facial LED Regenerativo — Colágeno y elastina (30 min)

POLÍTICA DE TURNOS:
- Reserva online desde la web en tiempo real
- Confirmación automática por WhatsApp
- Cancelación con mínimo 48 horas de anticipación
- Cancelación tarde o inasistencia = turno utilizado`;

  const chatHistory = [];

  async function askGemini(userText) {
    if (!GEMINI_KEY) return null;
    chatHistory.push({ role: 'user', parts: [{ text: userText }] });
    const body = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: chatHistory,
      generationConfig: { temperature: 0.4, maxOutputTokens: 300 }
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
      if (reply) chatHistory.push({ role: 'model', parts: [{ text: reply }] });
      // Mantener historial acotado (últimos 10 turnos)
      if (chatHistory.length > 20) chatHistory.splice(0, 2);
      return reply;
    } catch (e) {
      console.warn('Gemini error, usando KB:', e);
      chatHistory.pop(); // sacar el mensaje que no se procesó
      return null;
    }
  }

  const QUICK_REPLIES = [
    { label: '¿Qué servicios tienen?', id: 'todos_servicios' },
    { label: 'Facial LED Regenerativo', id: 'led' },
    { label: 'MioUp / Corporal', id: 'mioUp' },
    { label: '¿Cómo reservo turno?', id: 'turno' },
    { label: '¿Cómo confirmo mi turno?', id: 'confirmacion' },
    { label: '¿Cuánto sale?', id: 'precios' },
  ];

  // ── Utilidades ────────────────────────────────────────────
  function normalize(str) {
    return str.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ');
  }

  function findAnswer(text) {
    const q = normalize(text);
    for (const entry of KB) {
      const hit = entry.keywords.some(k => q.includes(normalize(k)));
      if (hit) return entry.answer;
    }
    return FALLBACK;
  }

  function findAnswerById(id) {
    const e = KB.find(k => k.id === id);
    return e ? e.answer : FALLBACK;
  }

  // ── MODO ADMIN: acceso en vivo a datos del panel ─────────
  const esAdmin = window.location.pathname.includes('admin') || !!window.MIMI_ADMIN_DATA;

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
    #mimi-root * { box-sizing: border-box; font-family: 'Plus Jakarta Sans', 'Montserrat', sans-serif; }

    /* ── Botón flotante ── */
    #mimi-bubble {
      position: fixed;
      bottom: 24px;
      right: 20px;
      width: 70px;
      height: 70px;
      border-radius: 50%;
      overflow: visible;
      cursor: pointer;
      z-index: 9999;
      transition: transform .22s cubic-bezier(.34,1.56,.64,1);
    }
    #mimi-bubble:hover { transform: scale(1.09); }
    #mimi-bubble-inner {
      width: 70px; height: 70px;
      border-radius: 50%;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(95,130,95,0.5), 0 2px 8px rgba(0,0,0,0.2);
      border: 3px solid #fff;
      background: linear-gradient(145deg, #a8c9a0 0%, #5d8c6a 100%);
      position: relative;
    }
    #mimi-bubble-inner video {
      width: 100%; height: 100%;
      object-fit: cover;
      border-radius: 50%;
      pointer-events: none;
      display: block;
    }
    /* Avatar imagen del personaje */
    #mimi-bubble-fallback {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      overflow: hidden;
      background: #e8f2e8;
    }
    #mimi-bubble-fallback img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% 15%;
      pointer-events: none;
    }
    #mimi-bubble-fallback.mimi-video-ok { display: none; }
    #mimi-vid-bubble.mimi-video-ok { display: block; }
    #mimi-vid-bubble:not(.mimi-video-ok) { display: none; }

    #mimi-badge {
      position: absolute;
      top: -2px; right: -2px;
      width: 20px; height: 20px;
      background: #e05c50;
      border-radius: 50%;
      border: 2.5px solid #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; color: #fff; font-weight: 800;
      animation: mimi-pulse 1.8s infinite;
      z-index: 1;
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
    }

    /* ── Ventana chat ── */
    #mimi-window {
      position: fixed;
      bottom: 104px;
      right: 20px;
      width: min(380px, calc(100vw - 32px));
      height: min(560px, calc(100dvh - 130px));
      max-height: min(560px, calc(100dvh - 130px));
      background: #fff;
      border-radius: 22px;
      box-shadow: 0 24px 64px rgba(28,46,34,0.18), 0 4px 16px rgba(0,0,0,0.1);
      display: flex; flex-direction: column;
      z-index: 9998;
      overflow: hidden;
      transform-origin: bottom right;
      transition: transform .28s cubic-bezier(.34,1.56,.64,1), opacity .22s;
    }
    #mimi-window.mimi-hidden {
      transform: scale(.7) translateY(20px);
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
      border-radius: 50%; overflow: hidden;
      border: 2.5px solid rgba(255,255,255,0.9);
      flex-shrink: 0;
      background: linear-gradient(145deg, #a8c9a0 0%, #5d8c6a 100%);
      position: relative;
    }
    #mimi-avatar-small video {
      width: 100%; height: 100%;
      object-fit: cover; pointer-events: none;
      display: block;
    }
    #mimi-avatar-fallback {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      overflow: hidden;
      background: #e8f2e8;
    }
    #mimi-avatar-fallback img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% 15%;
      pointer-events: none;
    }
    #mimi-avatar-fallback.mimi-video-ok { display: none; }
    #mimi-avatar-vid.mimi-video-ok { display: block; }
    #mimi-avatar-vid:not(.mimi-video-ok) { display: none; }

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
      right: 16px !important;
      bottom: 96px !important;
      height: auto !important;
      max-height: none !important;
    }

    /* ── Overlay para móvil ── */
    #mimi-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(15, 30, 20, 0.45);
      z-index: 9997;
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      animation: mimi-fade-in .2s ease;
    }
    #mimi-overlay.mimi-show { display: block; }
    @keyframes mimi-fade-in { from { opacity:0; } to { opacity:1; } }

    @media (max-width: 700px) {
      /* Móvil: modal limpio con caja fija y scroll interno real */
      #mimi-window,
      #mimi-root.mimi-is-admin #mimi-window {
        position: fixed !important;
        top: 56px !important;
        left: 12px !important;
        right: 12px !important;
        bottom: 18px !important;
        width: auto !important;
        height: auto !important;
        max-height: none !important;
        transform: none !important;
        transform-origin: center center !important;
        border-radius: 22px !important;
        z-index: 9998 !important;
        overflow: hidden !important;
      }
      #mimi-window.mimi-hidden,
      #mimi-root.mimi-is-admin #mimi-window.mimi-hidden {
        transform: scale(.88) !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      #mimi-messages {
        padding-bottom: 14px !important;
      }
      #mimi-quick {
        overflow-x: auto;
        flex-wrap: nowrap;
        padding-bottom: 12px;
        scrollbar-width: none;
      }
      #mimi-quick::-webkit-scrollbar {
        display: none;
      }
      .mimi-qr {
        flex: 0 0 auto;
      }
      #mimi-input-row {
        padding-bottom: 16px;
      }
      #mimi-bubble {
        right: 14px !important;
        bottom: 18px !important;
        width: 60px !important;
        height: 60px !important;
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
          <video id="mimi-vid-bubble" autoplay loop muted playsinline>
            <source src="img/Bot.mp4" type="video/mp4">
          </video>
        </div>
        <div id="mimi-badge">1</div>
        <button id="mimi-bubble-dismiss" aria-label="Cerrar asistente" title="Cerrar">✕</button>
      </div>

      <!-- Ventana chat -->
      <div id="mimi-window" class="mimi-hidden" role="dialog" aria-label="Chat con Mimi">
        <div id="mimi-header">
          <div id="mimi-avatar-small">
            <div id="mimi-avatar-fallback"><img src="img/mimi-avatar.png" alt="Mimi"></div>
            <video id="mimi-avatar-vid" autoplay loop muted playsinline>
              <source src="img/Bot.mp4" type="video/mp4">
            </video>
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

    // En admin desktop: marcar root y fijar top dinámicamente bajo el header sticky
    if (esAdmin) {
      root.classList.add('mimi-is-admin');
      const adjustAdminTop = () => {
        if (window.innerWidth <= 700) return; // en móvil es modal centrado, no necesita top
        const winEl  = document.getElementById('mimi-window');
        if (!winEl) return;
        const header = document.querySelector('.header') || document.querySelector('header');
        const topOffset = header ? Math.round(header.getBoundingClientRect().bottom + 8) : 90;
        winEl.style.top = topOffset + 'px';
      };
      setTimeout(adjustAdminTop, 100);
      window.addEventListener('resize', adjustAdminTop);
    }

    const bubble  = document.getElementById('mimi-bubble');
    const win     = document.getElementById('mimi-window');
    const badge   = document.getElementById('mimi-badge');
    const msgs    = document.getElementById('mimi-messages');
    const qSection= document.getElementById('mimi-quick');
    const input   = document.getElementById('mimi-input');
    const sendBtn = document.getElementById('mimi-send');
    const closeBtn= document.getElementById('mimi-close');

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

    // ── Abrir / cerrar ──
    function toggle() {
      open = !open;
      const isMobile = window.innerWidth <= 700;
      const overlay  = document.getElementById('mimi-overlay');
      win.classList.toggle('mimi-hidden', !open);
      if (overlay) overlay.classList.toggle('mimi-show', open);
      // En móvil: bloquear fondo, pero el scroll queda dentro del chat
      if (isMobile) {
        document.body.style.overflow = open ? 'hidden' : '';
      }
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
            respondWithId(qr.id);
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

    // ── Responder a texto libre ──
    async function respondToText(text) {
      const typingEl = document.createElement('div');
      typingEl.className = 'mimi-typing';
      typingEl.id = 'mimi-typing-indicator';
      typingEl.innerHTML = '<span></span><span></span><span></span>';
      msgs.appendChild(typingEl);
      msgs.scrollTop = msgs.scrollHeight;

      let answer = null;

      // 0. Modo admin: consultar datos del panel (NO sale a Gemini)
      if (esAdmin && window.MIMI_ADMIN_DATA) {
        await new Promise(r => setTimeout(r, 420));
        answer = handleAdminQuery(text);
      }

      // 1. Si no respondió admin, intentar Gemini
      if (!answer && GEMINI_KEY) {
        answer = await askGemini(text);
      }

      // 2. Fallback al KB local
      if (!answer) {
        const kb = findAnswer(text);
        answer = (kb === '__FALLBACK__') ? null : kb;
      }

      typingEl.remove();

      if (!answer) {
        if (esAdmin) {
          await addMsg('No encontré eso. Podés escribirme el nombre de una paciente, pedirme los turnos de hoy, recordatorios pendientes o los próximos 7 días. 📋', 'bot');
        } else {
          await addMsg('No encontré info exacta sobre eso, pero puedo ayudarte con cualquiera de estos temas: 👇', 'bot');
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
        await addMsg('¡Hola! Soy <strong>Mimi</strong> 🌿, tu asistente de <strong>Espacio Mimar T</strong>. ¿En qué te puedo ayudar hoy?', 'bot', 200);
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
