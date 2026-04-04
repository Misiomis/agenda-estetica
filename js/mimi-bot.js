/* ============================================================
   MIMI BOT - Asistente de Espacio Mimar T
   Burbuja flotante con video + chat de preguntas frecuentes
   ============================================================ */

(function () {
  'use strict';

  // ── Base de conocimiento de Mimi ──────────────────────────
  const KB = [

    // ── SALUDOS / PRESENTACIÓN ──────────────────────────────
    {
      id: 'saludo',
      keywords: ['hola', 'buenas', 'buen dia', 'buen día', 'buenas tardes', 'buenas noches',
                 'hey', 'hi', 'hello', 'que tal', 'qué tal', 'como estas', 'cómo estás'],
      answer: '¡Hola! Soy <strong>Mimi</strong> 🌿, la asistente de <strong>Espacio Mimar T</strong>. Podés preguntarme sobre nuestros tratamientos, cómo reservar, si sos nueva paciente o cualquier otra consulta. ¿En qué te puedo ayudar?'
    },
    {
      id: 'que_es',
      keywords: ['que es espacio mimar', 'qué es espacio mimar', 'que es mimar',
                 'formo parte', 'ser paciente', 'unirme', 'quiero ser paciente',
                 'como entro', 'cómo entro', 'como me anoto', 'cómo me anoto',
                 'como funciona', 'cómo funciona', 'de que trata', 'de qué trata',
                 'que ofrecen', 'qué ofrecen', 'que hacen', 'qué hacen'],
      answer: '<strong>Espacio Mimar T</strong> es un espacio de estética avanzada en <strong>Comandante Andresito, Misiones</strong>, atendido por <strong>Gimena Knack</strong> — Farmacéutica (MP 1212) y Dermatocosmiatra (RC 2319). 🌿 Ofrecemos tratamientos faciales y corporales personalizados con respaldo profesional. ¿Querés saber cómo hacerte paciente?'
    },

    // ── NUEVA PACIENTE / REGISTRO ───────────────────────────
    {
      id: 'nueva_paciente',
      keywords: ['nueva paciente', 'nuevo paciente', 'primera vez', 'primer vez',
                 'nunca fui', 'nunca fui', 'me doy de alta', 'darme de alta',
                 'como me registro', 'cómo me registro', 'registrarme',
                 'alta', 'ingresar por primera'],
      answer: 'Si es tu primera vez, escribinos por WhatsApp con el botón <strong>"Quiero ser paciente"</strong> que está en la página principal. 💬 Te acompañamos en el alta y te explicamos todo. Una vez registrada, ya podés reservar turnos desde la web.'
    },
    {
      id: 'registro_credencial',
      keywords: ['credencial', 'iniciar sesion', 'iniciar sesión', 'loguearse', 'loguearme',
                 'ingresar', 'entrar al sistema', 'nombre', 'dni', 'acceso',
                 'como ingreso', 'cómo ingreso', 'login'],
      answer: 'Para ingresar al sistema escribís tu <strong>Nombre + inicial del apellido</strong> (ej: "juan p") y tu <strong>DNI sin puntos</strong>. Eso es todo — sin contraseñas. 🔑 Si no te reconoce, verificá haber quedado registrada con Gimena primero.'
    },

    // ── SERVICIOS ───────────────────────────────────────────
    {
      id: 'led',
      keywords: ['led', 'facial led', 'regenerativo', 'luz', 'cabina led', 'luminosidad',
                 'firmeza', 'acne', 'acné', 'rojez', 'rojeces', 'manchas', 'inflamacion',
                 'inflamación', 'elastina', 'colageno', 'colágeno', 'piel sensible', 'facial'],
      answer: '✨ <strong>Facial LED Regenerativo</strong> — 30 min. Tratamiento no invasivo con cabina LED profesional que estimula colágeno y elastina para mejorar <strong>firmeza, luminosidad y textura</strong>. También ayuda con acné, inflamación, rojeces y manchas. Sin dolor ni recuperación, ideal para piel sensible. Resultados desde la primera sesión.'
    },
    {
      id: 'corporal',
      keywords: ['corporal', 'zona', 'abdomen', 'flancos', 'gluteos', 'glúteos',
                 'subglutea', 'subglútea', 'celulitis', 'estrias', 'estrías',
                 'retencion', 'retención', 'liquidos', 'líquidos', 'tono muscular',
                 'sesion corporal', 'sesión corporal', 'reduccion', 'reducción'],
      answer: '🌿 <strong>Sesión Corporal Combinada por Zona</strong> — 60 min. Combina distintas tecnologías para tratar <strong>flacidez, celulitis, estrías, retención de líquidos y tono muscular</strong>. Cada sesión trabaja <strong>una sola zona</strong> (abdomen, flancos, glúteos o zona subglútea). Se recomiendan <strong>mínimo 6 sesiones por zona</strong> para resultados visibles y duraderos.'
    },
    {
      id: 'brazos',
      keywords: ['brazo', 'brazos', 'reafirmacion brazo', 'reafirmación brazo',
                 'flacidez brazo', 'brazo flacido', 'brazo flácido', 'contorno brazo',
                 'firmeza brazo', 'reafirmacion integral'],
      answer: '💎 <strong>Reafirmación Integral de Brazos</strong> — 60 min. Protocolo personalizado que trabaja <strong>firmeza, textura y contorno del brazo</strong>. El abordaje se adapta a cada caso: si predomina flacidez, cambios en la piel o variaciones de volumen. Sesiones y frecuencia se definen en la evaluación con Gimena.'
    },
    {
      id: 'todos_servicios',
      keywords: ['que servicios', 'qué servicios', 'todos los servicios', 'lista servicios',
                 'que tratamientos', 'qué tratamientos', 'que ofrecen', 'qué ofrecen',
                 'servicios disponibles', 'catalogo', 'catálogo'],
      answer: 'Estos son nuestros tratamientos actuales:<br><br>✨ <strong>Facial LED Regenerativo</strong> — 30 min<br>🌿 <strong>Sesión Corporal Combinada por Zona</strong> — 60 min<br>💎 <strong>Reafirmación Integral de Brazos</strong> — 60 min<br><br>Todos son personalizados por Gimena según tu tipo de piel y objetivos. ¿Querés info de alguno en particular?'
    },

    // ── FLACIDEZ / OBJETIVOS ────────────────────────────────
    {
      id: 'flacidez',
      keywords: ['flacidez', 'flácida', 'flacida', 'reafirmar', 'tensar', 'tonicidad',
                 'piel caida', 'piel caída', 'reafirmante'],
      answer: 'Para flacidez tenemos dos opciones según la zona: 💎 <strong>Reafirmación Integral de Brazos</strong> (para el brazo) y 🌿 <strong>Sesión Corporal por Zona</strong> (para abdomen, glúteos, flancos, etc.). Gimena evalúa cada caso y define el protocolo más adecuado en la primera consulta.'
    },

    // ── TURNOS / RESERVAS ───────────────────────────────────
    {
      id: 'turno',
      keywords: ['turno', 'reservar', 'reserva', 'agendar', 'agenda', 'cita', 'sacar turno',
                 'pedir turno', 'disponibilidad', 'fecha', 'horario', 'como reservo',
                 'cómo reservo', 'cuando puedo', 'cuándo puedo'],
      answer: '📅 Reservás directamente desde la web — el sistema muestra disponibilidad <strong>en tiempo real</strong>. Ingresás, elegís servicio, fecha y horario, y confirmás. El sistema te guía en cada paso.'
    },
    {
      id: 'confirmacion',
      keywords: ['confirmacion', 'confirmación', 'confirmar', 'whatsapp turno',
                 'mensaje confirmacion', 'me llega', 'te llega', 'aviso',
                 'notificacion', 'notificación', 'reservé', 'reserve',
                 'no me llego', 'no me llegó', 'llego el mensaje', 'llegó el mensaje'],
      answer: '📩 Una vez que confirmás en la web te llega un <strong>mensaje automático en tu WhatsApp</strong> con todos los detalles del turno. Si no te llegó, verificá que el número cargado en tu ficha sea el correcto.'
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

    // ── PRECIOS / MEMBRESÍA ─────────────────────────────────
    {
      id: 'precios',
      keywords: ['precio', 'costo', 'cuanto', 'cuánto', 'vale', 'tarifa',
                 'cobran', 'cobras', 'presupuesto', 'cuanto sale', 'cuánto sale'],
      answer: 'Los precios se informan en el consultorio, ya que cada protocolo se define según la <strong>evaluación personalizada de Gimena</strong> en la primera visita. Cada caso es diferente y el plan se arma a medida.'
    },
    {
      id: 'membresia',
      keywords: ['membresia', 'membresía', 'plan', 'paquete', 'sesiones', 'combo',
                 'cuantas sesiones', 'cuántas sesiones', 'como funciona el plan',
                 'cómo funciona el plan'],
      answer: 'Los tratamientos se trabajan en <strong>planes de sesiones</strong> — por ejemplo, la Sesión Corporal requiere un mínimo de 6 sesiones por zona para resultados visibles. 📋 La cantidad exacta y frecuencia se define con Gimena en la evaluación inicial.'
    },

    // ── PROFESIONAL ─────────────────────────────────────────
    {
      id: 'gimena',
      keywords: ['gimena', 'quien atiende', 'quién atiende', 'farmaceutica', 'farmacéutica',
                 'dermocosmiatra', 'cosmiatra', 'profesional', 'matricula', 'matrícula',
                 'credencial profesional', 'quien es', 'quién es'],
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
    }

  ];

  const FALLBACK = 'No tengo información específica sobre eso. 🌿 Te recomiendo consultarle directamente a <strong>Gimena por WhatsApp</strong> para que te pueda orientar mejor. ¿Te ayudo con algo más?';

  const QUICK_REPLIES = [
    { label: 'Facial LED Regenerativo', id: 'led' },
    { label: 'Sesión Corporal por Zona', id: 'corporal' },
    { label: 'Reafirmación de Brazos', id: 'brazos' },
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

    /* ── Ventana chat ── */
    #mimi-window {
      position: fixed;
      bottom: 104px;
      right: 20px;
      width: min(360px, calc(100vw - 32px));
      max-height: min(530px, calc(100dvh - 130px));
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
      flex: 1; overflow-y: auto;
      padding: 16px 14px 8px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
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

    @media (max-width: 600px) {
      #mimi-window {
        top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
        width: 100% !important; max-height: 100dvh !important; height: 100dvh !important;
        border-radius: 0 !important;
      }
      #mimi-bubble { right: 12px; bottom: 16px; width: 60px; height: 60px; }
    }
  `;

  // ── HTML de la burbuja ────────────────────────────────────
  const HTML = `
    <div id="mimi-root">
      <style>${CSS}</style>

      <!-- Burbuja flotante -->
      <div id="mimi-bubble" role="button" aria-label="Abrir asistente Mimi" tabindex="0">
        <div id="mimi-bubble-inner">
          <div id="mimi-bubble-fallback"><img src="img/mimi-avatar.png" alt="Mimi"></div>
          <video id="mimi-vid-bubble" autoplay loop muted playsinline>
            <source src="img/Bot.mp4" type="video/mp4">
          </video>
        </div>
        <div id="mimi-badge">1</div>
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

    const bubble  = document.getElementById('mimi-bubble');
    const win     = document.getElementById('mimi-window');
    const badge   = document.getElementById('mimi-badge');
    const msgs    = document.getElementById('mimi-messages');
    const qSection= document.getElementById('mimi-quick');
    const input   = document.getElementById('mimi-input');
    const sendBtn = document.getElementById('mimi-send');
    const closeBtn= document.getElementById('mimi-close');

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
      win.classList.toggle('mimi-hidden', !open);
      // En móvil: bloquear scroll del fondo para que el contenido de la página no se vea
      if (window.innerWidth <= 600) {
        document.body.style.overflow = open ? 'hidden' : '';
      }
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
      QUICK_REPLIES.forEach(qr => {
        const btn = document.createElement('button');
        btn.className = 'mimi-qr';
        btn.textContent = qr.label;
        btn.addEventListener('click', () => {
          qSection.innerHTML = '';
          removeSuggestPill();
          addMsg(qr.label, 'user');
          respondWithId(qr.id);
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
      const answer = findAnswer(text);
      await showTyping(800 + Math.random() * 400);
      await addMsg(answer, 'bot');
      // Tras texto libre NO vuelven automáticamente — muestra el pill
      showSuggestPill();
    }

    // ── Saludo inicial ──
    async function greetUser() {
      await addMsg('¡Hola! Soy <strong>Mimi</strong> 🌿, tu asistente de <strong>Espacio Mimar T</strong>. ¿En qué te puedo ayudar hoy?', 'bot', 200);
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
