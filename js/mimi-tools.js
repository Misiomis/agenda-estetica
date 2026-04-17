import { db, collection, getDocs, query, where, doc, getDoc } from "/js/firebase-web.js";

const CF_CONFIRM_URL = "https://us-central1-estetica-8d067.cloudfunctions.net/enviarConfirmacionTurno";
const MIMI_STATE_KEY = "mimiOperationalStateV1";
const MIMI_STATE_TTL_MS = 10 * 60 * 1000;
const RESUME_COOLDOWN_MS = 90 * 1000;
const SEARCH_DAYS_DEFAULT = 14;
const SEARCH_DAYS_EXTENDED = 28;

const CONFIG_DIAS = {
  lunes: { normal: ["16:00", "17:00", "18:00", "19:00"], fraccionado: ["20:00", "20:30"] },
  martes: { normal: ["07:00", "08:00", "09:00", "10:00", "11:00", "16:00", "17:00", "18:00", "19:00"], fraccionado: ["12:00", "12:30", "20:00", "20:30"] },
  miercoles: { normal: ["15:00", "16:00", "17:00", "18:00", "19:00"], fraccionado: ["20:00", "20:30"] },
  jueves: { normal: ["08:00", "09:00", "10:00", "11:00"], fraccionado: ["12:00", "12:30"] },
  viernes: { normal: ["15:00", "16:00", "17:00", "18:00", "19:00"], fraccionado: [] },
  sabado: { normal: ["08:00", "09:00", "10:00", "11:00"], fraccionado: ["12:00", "12:30"] },
};

const EXCEPCIONES_HORARIOS = {
  "2026-03-26": { normal: ["08:00", "09:00", "10:00", "11:00", "16:00"], fraccionado: ["12:00", "12:30"] },
  "2026-03-28": { normal: ["11:00"], fraccionado: [] },
  "2026-04-01": { normal: ["21:00"], fraccionado: [] },
  "2026-04-02": { normal: ["11:30"], fraccionado: [] },
  "2026-04-04": { normal: ["18:00"], fraccionado: [] },
  "2026-04-09": { normal: ["21:00"], fraccionado: [] },
  "2026-04-10": { normal: ["08:00", "09:00", "10:00", "11:00"], fraccionado: ["12:00"], replaceBase: true },
  "2026-04-22": { normal: ["21:00"], fraccionado: [] },
  "2026-04-25": { normal: ["17:00"], fraccionado: [] },
};

const PROHIBITED_TERMS = [
  "depilacion", "depilación", "depilar", "laser", "láser", "cera",
  "uñas", "unas", "manicura", "pedicura", "nail", "masaje", "masajes",
  "botox", "relleno", "rellenos", "inyectable", "inyectables", "cirugia", "cirugía",
];

const SERVICES = [
  {
    canonical: "Consulta",
    aliases: ["consulta", "evaluacion", "evaluación", "primera consulta"],
    durationMinutes: 60,
    prep: "Es el punto de partida ideal para que Gimena evalúe tu caso y te arme un plan personalizado.",
  },
  {
    canonical: "Tratamiento Facial",
    aliases: ["facial", "tratamiento facial", "acne", "acné", "manchas", "cicatrices"],
    durationMinutes: 60,
    prep: "Para los faciales, vení con la cara lavada y sin maquillaje si podés.",
  },
  {
    canonical: "Tratamientos Corporales",
    aliases: ["corporal", "corporales", "tratamiento corporal", "tratamientos corporales", "celulitis", "flacidez"],
    durationMinutes: 60,
    prep: "Para los corporales, lo ideal es ropa cómoda y holgada para que Gimena trabaje mejor la zona.",
  },
  {
    canonical: "Tratamiento Manchas Corporales",
    aliases: ["manchas corporales", "manchas en el cuerpo", "tono corporal"],
    durationMinutes: 60,
    prep: "No tengo una preparación técnica especial cargada para ese tratamiento; Gimena te la confirma según tu piel.",
  },
  {
    canonical: "Tonificación Muscular MioUp",
    aliases: ["mio", "mio up", "mioup", "tonificacion muscular", "tonificación muscular"],
    durationMinutes: 30,
    prep: "Es una sesión corta de 30 minutos. Si querés, te busco un horario puntual para MioUp.",
  },
  {
    canonical: "Lipocell Cryo 360",
    aliases: ["lipocell", "cryo", "lipocell cryo 360", "criolipolisis", "criolipólisis"],
    durationMinutes: 60,
    prep: "No tengo una preparación previa específica cargada en el sistema; Gimena te la confirma según la zona a trabajar.",
  },
  {
    canonical: "Hidratación y Revitalización de Labios",
    aliases: ["labios", "hidratacion de labios", "hidratación de labios", "revitalizacion de labios", "revitalización de labios"],
    durationMinutes: 60,
    prep: "Si querés, después te indico la recomendación puntual de Gimena, pero la sesión dura una hora.",
  },
  {
    canonical: "Facial LED Regenerativo",
    aliases: ["led", "facial led", "facial led regenerativo", "led regenerativo", "cabina led"],
    durationMinutes: 30,
    prep: "Es un tratamiento suave y sin dolor. Si podés, vení con el rostro limpio para aprovechar mejor la sesión.",
  },
];

const STEP_LABELS = {
  1: "Paso 1",
  2: "Paso 2",
  3: "Paso 3",
};

const AVAILABILITY_DATE_HINTS = [
  "esta semana",
  "semana que viene",
  "fin de semana",
  "finde",
  "proximo horario",
  "próximo horario",
  "primer horario",
  "proximo turno",
  "próximo turno",
  "primer turno",
  "primer turno libre",
  "cuando puedas",
  "cuando tenga lugar",
  "cuando tengas lugar",
  "cuando hay turno",
  "cuándo hay turno",
  "para cuando hay turno",
  "para cuándo hay turno",
  "cuando hay horario",
  "cuándo hay horario",
  "para cuando hay horario",
  "para cuándo hay horario",
];

const AVAILABILITY_INTENT_TERMS = [
  "disponibilidad",
  "disponible",
  "horario",
  "horarios",
  "horario libre",
  "horarios libres",
  "horario disponible",
  "horarios disponibles",
  "hora libre",
  "horas libres",
  "hora disponible",
  "turno libre",
  "turnos libres",
  "hay lugar",
  "tenes lugar",
  "tenés lugar",
  "hay turno",
  "hay turnos",
  "cuando puedo",
  "cuándo puedo",
  "cuando hay turno",
  "cuándo hay turno",
  "para cuando hay turno",
  "para cuándo hay turno",
  "hueco",
  "huecos",
  "espacio",
  "espacios",
  "agenda libre",
  "agenda disponible",
];

const DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" });
const DATE_FORMATTER_WITH_WEEKDAY = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

let calendarExceptionsCache = { loadedAt: 0, closures: new Map(), timedBlocks: new Set() };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitWords(value) {
  return normalize(value).split(" ").filter(Boolean);
}

function levenshteinDistance(a, b) {
  const source = normalize(a);
  const target = normalize(b);
  if (!source) return target.length;
  if (!target) return source.length;

  const matrix = Array.from({ length: source.length + 1 }, () => new Array(target.length + 1).fill(0));

  for (let i = 0; i <= source.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= target.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= target.length; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[source.length][target.length];
}

function wordsAreClose(sourceWord, targetWord) {
  const source = normalize(sourceWord);
  const target = normalize(targetWord);
  if (!source || !target) return false;
  if (source === target) return true;
  if (source.length <= 3 || target.length <= 3) return false;
  if (source.includes(target) || target.includes(source)) {
    return Math.min(source.length, target.length) >= 4;
  }

  const distance = levenshteinDistance(source, target);
  const maxDistance = target.length >= 8 ? 2 : 1;
  return source[0] === target[0] && Math.abs(source.length - target.length) <= 2 && distance <= maxDistance;
}

function includesApproximateTerm(text, term) {
  const normalizedText = normalize(text);
  const normalizedTerm = normalize(term);
  if (!normalizedText || !normalizedTerm) return false;
  if (normalizedText.includes(normalizedTerm)) return true;

  const textWords = splitWords(normalizedText);
  const termWords = splitWords(normalizedTerm);
  if (!termWords.length) return false;

  return termWords.every((termWord) => textWords.some((textWord) => wordsAreClose(textWord, termWord)));
}

function hasApproximateTerm(text, terms) {
  return terms.some((term) => includesApproximateTerm(text, term));
}

function capitalize(value) {
  const txt = String(value || "").trim();
  if (!txt) return "";
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function firstName(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  const token = cleaned.split(/\s+/)[0] || "";
  return capitalize(token.toLowerCase());
}

function getCourtesyPrefix(runtime, state) {
  const name = firstName(runtime?.nombre || state?.patientName || "");
  return name ? `<strong>${escapeHtml(name)}</strong>, ` : "";
}

function dateToISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function startOfWeek(date) {
  const copy = startOfDay(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function endOfWeek(date) {
  return addDays(startOfWeek(date), 6);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function formatDateWithWeekday(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const parsed = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(parsed.getTime())) return iso;
  return capitalize(DATE_FORMATTER_WITH_WEEKDAY.format(parsed));
}

function slugHour(hour) {
  return String(hour || "").trim().replace(/\s*hs$/i, "");
}

function normalizarHora(hora) {
  const txt = slugHour(hora);
  const match = txt.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return "";
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function inferFlowStep(runtime) {
  if (!runtime.dni || !runtime.nombre) return 1;
  if (runtime.fecha && runtime.hora) return 3;
  return 2;
}

function buildRuntimeState() {
  const path = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  return {
    page: path,
    dni: (localStorage.getItem("clienteDNI") || "").trim(),
    nombre: (localStorage.getItem("clienteNombre") || "").trim(),
    servicioSeleccionado: (localStorage.getItem("servicioSeleccionado") || "").trim(),
    fecha: (localStorage.getItem("fechaSeleccionada") || "").trim(),
    hora: (localStorage.getItem("horaSeleccionada") || "").trim(),
    jornadaModo: localStorage.getItem("jornadaModo") === "1",
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(MIMI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.updatedAt) return null;
    if ((Date.now() - Number(parsed.updatedAt)) > MIMI_STATE_TTL_MS) {
      localStorage.removeItem(MIMI_STATE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveState(patch) {
  const current = loadState() || {};
  const next = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  localStorage.setItem(MIMI_STATE_KEY, JSON.stringify(next));
  return next;
}

function formatDateLong(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const parsed = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(parsed.getTime())) return iso;
  return DATE_FORMATTER.format(parsed);
}

function getServiceByName(serviceName) {
  const target = normalize(serviceName);
  if (!target) return null;
  let bestMatch = null;
  let bestScore = 0;
  const queryWords = splitWords(target);

  SERVICES.forEach((service) => {
    [service.canonical, ...service.aliases].forEach((candidate) => {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) return;
      const candidateWords = splitWords(normalizedCandidate);

      let score = 0;
      if (target.includes(normalizedCandidate)) {
        score = 120 + normalizedCandidate.length;
      } else {
        const matchedWords = candidateWords.filter((candidateWord) => queryWords.some((queryWord) => wordsAreClose(queryWord, candidateWord)));
        if (!matchedWords.length) return;

        const fullPhraseMatch = matchedWords.length === candidateWords.length;
        score = (fullPhraseMatch ? 80 : 35) + (matchedWords.length * 10) + normalizedCandidate.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = service;
      }
    });
  });

  return bestMatch;
}

function extractService(rawText, fallback = "") {
  const text = normalize(rawText);
  const found = getServiceByName(text);
  if (found) return found;
  return getServiceByName(fallback);
}

function extractDni(rawText) {
  const match = String(rawText || "").match(/\b(\d{7,8})\b/);
  return match ? match[1] : "";
}

function isProhibitedRequest(rawText) {
  const text = normalize(rawText);
  return PROHIBITED_TERMS.some((term) => includesApproximateTerm(text, term));
}

function resolveNextWeekday(targetDayIndex, baseDate = new Date()) {
  const next = new Date(baseDate);
  next.setHours(0, 0, 0, 0);
  const current = next.getDay();
  let delta = targetDayIndex - current;
  if (delta < 0) delta += 7;
  next.setDate(next.getDate() + delta);
  return next;
}

function extractDateContext(rawText) {
  const source = normalize(rawText);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (hasApproximateTerm(source, ["pasado manana", "pasado mañana"])) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + 2);
    return { iso: dt.toISOString().split("T")[0], label: formatDateLong(dt.toISOString().split("T")[0]) };
  }

  if (hasApproximateTerm(source, ["manana", "mañana"])) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + 1);
    return { iso: dt.toISOString().split("T")[0], label: formatDateLong(dt.toISOString().split("T")[0]) };
  }

  if (hasApproximateTerm(source, ["hoy"])) {
    const iso = now.toISOString().split("T")[0];
    return { iso, label: formatDateLong(iso) };
  }

  const explicit = String(rawText || "").match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (explicit) {
    const day = explicit[1].padStart(2, "0");
    const month = explicit[2].padStart(2, "0");
    const year = explicit[3]
      ? (explicit[3].length === 2 ? `20${explicit[3]}` : explicit[3])
      : String(now.getFullYear());
    const iso = `${year}-${month}-${day}`;
    return { iso, label: formatDateLong(iso) };
  }

  const weekdays = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
  };

  const weekdayMatch = Object.entries(weekdays).find(([name]) => includesApproximateTerm(source, name));
  if (!weekdayMatch) return null;
  const next = resolveNextWeekday(weekdayMatch[1], now);
  const iso = next.toISOString().split("T")[0];
  return { iso, label: formatDateLong(iso) };
}

function extractDayPeriod(rawText) {
  const text = normalize(rawText);
  if (hasApproximateTerm(text, ["manana", "mañana", "temprano", "primer horario", "primera hora"])) {
    return { id: "morning", label: "por la mañana" };
  }
  if (hasApproximateTerm(text, ["mediodia", "mediodía"])) {
    return { id: "midday", label: "al mediodía" };
  }
  if (hasApproximateTerm(text, ["tarde", "a la tarde", "despues de comer", "después de comer"])) {
    return { id: "afternoon", label: "por la tarde" };
  }
  if (hasApproximateTerm(text, ["noche", "a la noche", "ultima hora", "última hora"])) {
    return { id: "night", label: "por la noche" };
  }
  return null;
}

function matchesDayPeriod(hour, period) {
  if (!period?.id) return true;
  const normalizedHour = normalizarHora(hour);
  if (!normalizedHour) return false;
  const [hours, minutes] = normalizedHour.split(":").map(Number);
  const totalMinutes = (hours * 60) + minutes;

  if (period.id === "morning") return totalMinutes < 12 * 60;
  if (period.id === "midday") return totalMinutes >= 12 * 60 && totalMinutes <= (12 * 60) + 45;
  if (period.id === "afternoon") return totalMinutes >= 15 * 60 && totalMinutes < 20 * 60;
  if (period.id === "night") return totalMinutes >= 20 * 60;
  return true;
}

function buildSearchWindow(rawText, specificDateCtx = null) {
  if (specificDateCtx?.iso) {
    return {
      startISO: specificDateCtx.iso,
      endISO: specificDateCtx.iso,
      exact: true,
      label: specificDateCtx.label || formatDateLong(specificDateCtx.iso),
      maxDays: 1,
    };
  }

  const text = normalize(rawText);
  const today = startOfDay(new Date());

  if (hasApproximateTerm(text, ["esta semana", "semana actual"])) {
    return {
      startISO: dateToISO(today),
      endISO: dateToISO(endOfWeek(today)),
      exact: false,
      label: "esta semana",
      maxDays: 7,
    };
  }

  if (hasApproximateTerm(text, ["semana que viene", "semana proxima", "próxima semana", "la otra semana"])) {
    const nextWeekStart = startOfWeek(addDays(today, 7));
    return {
      startISO: dateToISO(nextWeekStart),
      endISO: dateToISO(addDays(nextWeekStart, 6)),
      exact: false,
      label: "la próxima semana",
      maxDays: 7,
    };
  }

  if (hasApproximateTerm(text, ["fin de semana", "finde"])) {
    const saturday = resolveNextWeekday(6, today);
    return {
      startISO: dateToISO(saturday),
      endISO: dateToISO(addDays(saturday, 1)),
      exact: false,
      label: "el próximo fin de semana",
      maxDays: 2,
    };
  }

  if (hasApproximateTerm(text, ["este mes", "en abril", "durante abril"])) {
    return {
      startISO: dateToISO(today),
      endISO: dateToISO(endOfMonth(today)),
      exact: false,
      label: "este mes",
      maxDays: SEARCH_DAYS_EXTENDED,
    };
  }

  return {
    startISO: dateToISO(today),
    endISO: dateToISO(addDays(today, SEARCH_DAYS_DEFAULT)),
    exact: false,
    label: "los próximos días",
    maxDays: SEARCH_DAYS_DEFAULT,
  };
}

function inferIntent(rawText, runtime, state, service, dateCtx) {
  const text = normalize(rawText);
  const hasDateSignal = Boolean(dateCtx || extractDayPeriod(text) || hasApproximateTerm(text, AVAILABILITY_DATE_HINTS));

  if (hasApproximateTerm(text, ["reenvia", "reenvía", "reenviar", "reintenta", "reintentar", "volver a enviar", "aviso", "whatsapp", "notificacion", "notificación"])) {
    return "notification";
  }

  if (hasApproximateTerm(text, ["cancelar", "cancelacion", "cancelación", "reprogramar", "cambiar turno", "modificar turno"])) {
    return "cancel";
  }

  if (hasApproximateTerm(text, ["duracion", "duración", "cuanto dura", "cuánto dura", "preparacion", "preparación", "que llevar", "qué llevar", "como voy", "cómo voy"])) {
    return "session_logic";
  }

  if (hasDateSignal || hasApproximateTerm(text, AVAILABILITY_INTENT_TERMS)) {
    return "availability";
  }

  if (extractDni(rawText) || hasApproximateTerm(text, ["soy paciente", "estoy registrada", "estoy registrado", "ya soy paciente", "mi dni"])) {
    return "patient_status";
  }

  if (hasApproximateTerm(text, ["reservar", "reserva", "agendar", "turno", "seguir", "continuar", "paso 1", "paso 2", "paso 3"])) {
    return "booking_flow";
  }

  if (service || state?.lastService) {
    return "service_context";
  }

  return "generic";
}

function getMergedConfigForDate(dateISO) {
  const date = new Date(`${dateISO}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const dayName = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"][date.getDay()];
  const base = CONFIG_DIAS[dayName];
  const ex = EXCEPCIONES_HORARIOS[dateISO];

  if (ex?.replaceBase === true) {
    return {
      normal: [...new Set(ex.normal || [])].sort(),
      fraccionado: [...new Set(ex.fraccionado || [])].sort(),
      dayName,
    };
  }

  if (!base && !ex) return null;
  if (!base) {
    return {
      normal: [...new Set(ex?.normal || [])].sort(),
      fraccionado: [...new Set(ex?.fraccionado || [])].sort(),
      dayName,
    };
  }

  if (!ex) {
    return {
      normal: [...base.normal],
      fraccionado: [...base.fraccionado],
      dayName,
    };
  }

  return {
    normal: [...new Set([...(base.normal || []), ...(ex.normal || [])])].sort(),
    fraccionado: [...new Set([...(base.fraccionado || []), ...(ex.fraccionado || [])])].sort(),
    dayName,
  };
}

function esReservaActiva(reserva) {
  const estados = [reserva?.estado, reserva?.status]
    .map((valor) => String(valor || "").trim().toLowerCase())
    .filter(Boolean);
  return !estados.includes("cancelado");
}

async function getCalendarExceptionsMeta() {
  const now = Date.now();
  if ((now - calendarExceptionsCache.loadedAt) < 60 * 1000) {
    return calendarExceptionsCache;
  }

  const snap = await getDocs(collection(db, "calendarExceptions"));
  const closures = new Map();
  const timedBlocks = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const idIsDate = /^\d{4}-\d{2}-\d{2}$/.test(docSnap.id);
    const fecha = String((data.fecha || "") || (idIsDate ? docSnap.id : "")).trim();
    const hora = normalizarHora(data.hora || data.hour || data.time || "");
    const active = data.active !== false;
    const type = String(data.type || "").trim().toLowerCase();
    const blocked = type === "blocked" || data.blocked === true;

    if (!fecha || !active || !blocked) return;
    if (hora) {
      timedBlocks.add(`${fecha}|${hora}`);
      return;
    }
    closures.set(fecha, String(data.reason || "Día no disponible").trim());
  });

  calendarExceptionsCache = { loadedAt: now, closures, timedBlocks };
  return calendarExceptionsCache;
}

async function getAvailability(dateISO, serviceName) {
  const mergedConfig = getMergedConfigForDate(dateISO);
  if (!mergedConfig) {
    return { ok: true, dateISO, availableHours: [], closedReason: "Ese día no tiene agenda habilitada." };
  }

  const calendarMeta = await getCalendarExceptionsMeta();
  if (calendarMeta.closures.has(dateISO)) {
    return { ok: true, dateISO, availableHours: [], closedReason: calendarMeta.closures.get(dateISO) || "Día cerrado" };
  }

  const reservationsSnap = await getDocs(query(collection(db, "reservas"), where("fecha", "==", dateISO)));
  const occupied = new Set();

  reservationsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!esReservaActiva(data)) return;
    const hour = normalizarHora(data.hora || data.hour || data.time || "");
    if (hour) occupied.add(hour);
  });

  calendarMeta.timedBlocks.forEach((key) => {
    const [fecha, hora] = key.split("|");
    if (fecha === dateISO && hora) occupied.add(hora);
  });

  const service = getServiceByName(serviceName);
  const esMioUp = service?.canonical === "Tonificación Muscular MioUp";
  const availableHours = [];

  const todayISO = dateToISO(startOfDay(new Date()));
  const isToday = dateISO === todayISO;
  const nowMinutes = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : -1;

  const slots = [
    ...mergedConfig.normal.map((hour) => ({ hour, type: "normal" })),
    ...mergedConfig.fraccionado.map((hour) => ({ hour, type: "fraccionado" })),
  ].sort((a, b) => a.hour.localeCompare(b.hour));

  slots.forEach((slot) => {
    let isBlocked = occupied.has(slot.hour);

    if (isToday && !isBlocked) {
      const normalizedSlot = normalizarHora(slot.hour);
      if (normalizedSlot) {
        const [h, m] = normalizedSlot.split(":").map(Number);
        const slotMinutes = h * 60 + m;
        if (slotMinutes <= nowMinutes + 30) isBlocked = true;
      }
    }

    if (!esMioUp && !isBlocked) {
      if (slot.hour === "12:00" && occupied.has("12:30")) isBlocked = true;
      if (slot.hour === "12:30" && occupied.has("12:00")) isBlocked = true;
      if (slot.hour === "20:00" && occupied.has("20:30")) isBlocked = true;
      if (slot.hour === "20:30" && occupied.has("20:00")) isBlocked = true;
    }

    if (isBlocked) return;
    if (!esMioUp && slot.type === "fraccionado" && !["12:00", "20:00"].includes(slot.hour)) return;
    availableHours.push(slot.hour);
  });

  return { ok: true, dateISO, availableHours, closedReason: "" };
}

function enumerateDateRange(startISO, endISO, maxDays = SEARCH_DAYS_DEFAULT) {
  const startDate = startOfDay(new Date(`${startISO}T12:00:00`));
  const endDate = startOfDay(new Date(`${endISO}T12:00:00`));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];

  const dates = [];
  const cursor = new Date(startDate);
  let count = 0;

  while (cursor <= endDate && count < maxDays) {
    dates.push(dateToISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
    count += 1;
  }

  return dates;
}

async function findAvailabilityGaps(serviceName, searchWindow, dayPeriod = null) {
  const dates = enumerateDateRange(searchWindow.startISO, searchWindow.endISO, searchWindow.maxDays || SEARCH_DAYS_DEFAULT);
  const results = [];

  for (const dateISO of dates) {
    const availability = await getAvailability(dateISO, serviceName);
    if (availability.closedReason || !availability.availableHours.length) continue;

    const filteredHours = availability.availableHours.filter((hour) => matchesDayPeriod(hour, dayPeriod));
    if (!filteredHours.length) continue;

    results.push({
      dateISO,
      label: formatDateWithWeekday(dateISO),
      hours: filteredHours,
    });

    if (results.length >= 3) break;
  }

  return { results, searchWindow, dayPeriod };
}

async function checkPatientStatus(dniCandidate) {
  const dni = String(dniCandidate || "").replace(/\D/g, "");
  if (!dni) {
    return { ok: false, found: false, reason: "missing_dni" };
  }

  const snap = await getDoc(doc(db, "clients", dni));
  if (!snap.exists()) {
    return { ok: true, found: false, dni };
  }

  const data = snap.data() || {};
  return {
    ok: true,
    found: true,
    dni,
    fullName: String(data.fullName || data.nombre || data.fullLname || "Paciente").trim(),
    active: data.active !== false,
    phone: String(data.phone || data.telefono || data.whatsapp || "").trim(),
  };
}

function calcSessionLogic(serviceName) {
  const service = getServiceByName(serviceName);
  if (!service) {
    return {
      ok: false,
      durationMinutes: null,
      prep: "Todavía no identifiqué qué tratamiento querés revisar.",
    };
  }

  return {
    ok: true,
    canonical: service.canonical,
    durationMinutes: service.durationMinutes,
    prep: service.prep,
  };
}

async function sendWhatsAppTemplate(templateId, runtime) {
  if (templateId !== "confirmacion_turno") {
    return { ok: false, error: "template_not_supported" };
  }

  if (!runtime?.dni || !runtime?.nombre || !runtime?.servicioSeleccionado || !runtime?.fecha || !runtime?.hora) {
    return { ok: false, error: "missing_runtime_context" };
  }

  if (!runtime.page.includes("confirmar")) {
    return { ok: false, error: "not_confirmation_step" };
  }

  try {
    const response = await fetch(CF_CONFIRM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: runtime.nombre,
        servicio: runtime.servicioSeleccionado,
        fecha: runtime.fecha,
        hora: `${runtime.hora} hs`,
        dni: runtime.dni,
        descontarBalance: false,
        omitirWhatsapp: false,
      }),
    });

    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, error };
  }
}

function buildStepReply(runtime, service) {
  const step = inferFlowStep(runtime);
  const prefix = getCourtesyPrefix(runtime, {});

  if (step === 1) {
    return `${prefix}estamos en <strong>${STEP_LABELS[1]}</strong>. Primero te hago ingresar con tu nombre, inicial del apellido y DNI sin puntos en <a href="/index.html"><strong>espaciomimart.com</strong></a>. Si todavía no sos paciente, te derivo al botón <strong>Quiero ser paciente</strong> para que Gimena te acompañe.`;
  }

  if (step === 2) {
    if (!runtime.servicioSeleccionado && !service) {
      return `${prefix}ya resolviste el <strong>${STEP_LABELS[1]}</strong>. Ahora te llevo a elegir tratamiento en <a href="/servicios-pro.html"><strong>Servicios</strong></a> para pasar al calendario con Gimena.`;
    }

    const nombreServicio = escapeHtml((service?.canonical || runtime.servicioSeleccionado || "tu tratamiento").trim());
    return `${prefix}ya estás en <strong>${STEP_LABELS[2]}</strong>. Nos queda elegir fecha y hora para <strong>${nombreServicio}</strong> en el calendario. Si querés, te reviso la agenda ahora mismo antes de avanzar.`;
  }

  const fecha = escapeHtml(formatDateLong(runtime.fecha));
  const hora = escapeHtml(runtime.hora);
  const servicioElegido = escapeHtml(runtime.servicioSeleccionado || service?.canonical || "tu tratamiento");
  return `${prefix}ya estás en <strong>${STEP_LABELS[3]}</strong>: te quedó lista la confirmación de <strong>${servicioElegido}</strong> para el <strong>${fecha}</strong> a las <strong>${hora} hs</strong>. Si estás en la pantalla final, confirmás y el sistema sigue con el aviso.`;
}

function buildResumeMessage() {
  const state = loadState();
  if (!state) return "";
  if (state.lastResumeAt && (Date.now() - Number(state.lastResumeAt)) < RESUME_COOLDOWN_MS) return "";

  const service = state.lastService ? escapeHtml(state.lastService) : "tu tratamiento";
  const dateText = state.lastDateLabel ? ` para el <strong>${escapeHtml(state.lastDateLabel)}</strong>` : "";

  let message = "";
  if (state.step === 3) {
    message = `¡Volviste! Nos quedamos en <strong>Paso 3</strong>, con la confirmación de <strong>${service}</strong>${dateText}. ¿Querés que sigamos desde ahí?`;
  } else if (state.step === 2) {
    message = `¡Volviste! Nos quedamos en <strong>Paso 2</strong> eligiendo fecha y hora para <strong>${service}</strong>${dateText}. ¿Seguimos?`;
  }

  if (!message) return "";
  saveState({ lastResumeAt: Date.now() });
  return message;
}

function buildAvailabilityReply(service, dateCtx, availability) {
  const serviceName = escapeHtml(service.canonical);
  const dateText = escapeHtml(dateCtx.label || formatDateLong(dateCtx.iso));

  if (availability.closedReason) {
    return `Revisé la agenda en vivo para <strong>${serviceName}</strong> el <strong>${dateText}</strong> y ese día está cerrado: ${escapeHtml(availability.closedReason)}. Si querés, te busco otra fecha.`;
  }

  if (!availability.availableHours.length) {
    return `Revisé la agenda en vivo para <strong>${serviceName}</strong> el <strong>${dateText}</strong> y ese día ya no tiene horarios disponibles. Si querés, te busco el día siguiente o la próxima fecha disponible.`;
  }

  const visible = availability.availableHours.slice(0, 5).map((hour) => `<strong>${escapeHtml(hour)}</strong>`).join(", ");
  return `Sí, para <strong>${serviceName}</strong> el <strong>${dateText}</strong> tengo lugar en ${visible}${availability.availableHours.length > 5 ? " y algunos horarios más" : ""}. Si ya sos paciente, podés seguir desde el calendario con Gimena.`;
}

function buildGapSearchReply(service, searchResult, runtime, state, relaxedSearch = null) {
  const prefix = getCourtesyPrefix(runtime, state);
  const serviceName = escapeHtml(service.canonical);
  const periodText = searchResult.dayPeriod?.label ? ` ${escapeHtml(searchResult.dayPeriod.label)}` : "";
  const rangeText = searchResult.searchWindow?.label ? ` en ${escapeHtml(searchResult.searchWindow.label)}` : "";

  if (!searchResult.results.length) {
    if (relaxedSearch?.results?.length) {
      const firstAlt = relaxedSearch.results[0];
      const firstAltHours = firstAlt.hours.slice(0, 3).map((hour) => `<strong>${escapeHtml(hour)}</strong>`).join(", ");
      return `${prefix}no encontré horarios disponibles${periodText}${rangeText} para <strong>${serviceName}</strong>, pero sí te puedo ofrecer <strong>${escapeHtml(firstAlt.label)}</strong> en ${firstAltHours}. Si querés, seguimos por ahí.`;
    }

    return `${prefix}revisé la agenda${periodText}${rangeText} para <strong>${serviceName}</strong> y por ahora no encontré horarios disponibles. Si querés, te amplio la búsqueda o te propongo otra franja.`;
  }

  const lines = searchResult.results.map((result) => {
    const hours = result.hours.slice(0, 3).map((hour) => `<strong>${escapeHtml(hour)}</strong>`).join(", ");
    return `<strong>${escapeHtml(result.label)}</strong>: ${hours}${result.hours.length > 3 ? " y más" : ""}`;
  });

  return `${prefix}te revisé la agenda${periodText}${rangeText} para <strong>${serviceName}</strong>. Te puedo ofrecer ${lines.join(" · ")}. Si uno te sirve, seguís al calendario y te acompaño hasta cerrar el turno.`;
}

export async function runPatientOrchestration(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return { reply: null };

  const runtime = buildRuntimeState();
  const state = loadState() || {};
  const service = extractService(text, state.lastService || runtime.servicioSeleccionado);
  const dateCtx = extractDateContext(text) || (/(ese dia|ese día|esa fecha|ahi|ahí)/.test(normalize(text)) && state.lastDateISO
    ? { iso: state.lastDateISO, label: state.lastDateLabel || formatDateLong(state.lastDateISO) }
    : null);
  const explicitDayPeriod = extractDayPeriod(text);
  const wantsPreviousPeriod = /(esa franja|ese horario|ahi|ahí|en ese momento)/.test(normalize(text));
  const dayPeriod = explicitDayPeriod || (wantsPreviousPeriod ? state.lastDayPeriod : null);
  const searchWindow = buildSearchWindow(text, dateCtx);
  const dni = extractDni(text) || runtime.dni || state.dni || "";
  const intent = inferIntent(text, runtime, state, service, dateCtx);
  const nextState = saveState({
    dni: dni || state.dni || "",
    lastIntent: intent,
    lastService: service?.canonical || state.lastService || runtime.servicioSeleccionado || "",
    lastDateISO: dateCtx?.iso || state.lastDateISO || "",
    lastDateLabel: dateCtx?.label || state.lastDateLabel || "",
    lastDayPeriod: dayPeriod || null,
    step: inferFlowStep({ ...runtime, servicioSeleccionado: service?.canonical || runtime.servicioSeleccionado }),
  });

  if (isProhibitedRequest(text)) {
    return {
      reply: `Eso no forma parte de Espacio Mimar T. Yo solo trabajo con los <strong>8 servicios oficiales</strong> de Gimena. Si querés, te oriento con Facial LED, Consulta, Corporales, MioUp o Lipocell.`
    };
  }

  if (intent === "patient_status") {
    if (!dni) {
      return {
        reply: `${getCourtesyPrefix(runtime, state)}si ya sos paciente, pasame tu <strong>DNI sin puntos</strong> y reviso tu estado en el sistema. Si es tu primera vez, te derivo al botón <strong>Quiero ser paciente</strong> para que Gimena te dé el alta.`
      };
    }

    const status = await checkPatientStatus(dni);
    if (!status.found) {
      return {
        reply: `No te encontré como paciente activa con el DNI <strong>${escapeHtml(dni)}</strong>. Si es tu primera vez, escribile a Gimena por <a href="https://wa.me/5493764291807"><strong>WhatsApp</strong></a> para hacer el alta y después seguimos con la reserva.`
      };
    }

    if (status.active === false) {
      return {
        reply: `Te encontré en el sistema con el DNI <strong>${escapeHtml(dni)}</strong>, pero tu ficha necesita revisión antes de seguir. Escribile a Gimena por <a href="https://wa.me/5493764291807"><strong>WhatsApp</strong></a> y ella te lo resuelve.`
      };
    }

    saveState({ patientName: status.fullName, dni: status.dni, step: inferFlowStep(runtime) });
    return {
      reply: `Sí, ya te veo como paciente activa${status.fullName ? `, <strong>${escapeHtml(status.fullName)}</strong>` : ""}. Con eso el <strong>Paso 1</strong> ya está resuelto y yo te puedo ayudar a elegir servicio, buscar horarios disponibles o seguir con la fecha y hora.`
    };
  }

  if (intent === "availability") {
    const resolvedService = service || getServiceByName(state.lastService || runtime.servicioSeleccionado || "");

    if (!resolvedService) {
      return {
        reply: `Decime <strong>qué tratamiento</strong> querés consultar y te reviso la agenda real en Firebase. Si querés, puede ser Facial LED, Consulta, Corporales, MioUp, Lipocell o Labios.`
      };
    }

    try {
      if (searchWindow.exact) {
        const availability = await getAvailability(searchWindow.startISO, resolvedService.canonical);
        saveState({ lastService: resolvedService.canonical, lastDateISO: searchWindow.startISO, lastDateLabel: dateCtx?.label || formatDateLong(searchWindow.startISO), lastDayPeriod: dayPeriod, step: 2 });
        return { reply: buildAvailabilityReply(resolvedService, dateCtx || { iso: searchWindow.startISO, label: formatDateLong(searchWindow.startISO) }, availability) };
      }

      const gaps = await findAvailabilityGaps(resolvedService.canonical, searchWindow, dayPeriod);
      let relaxed = null;
      if (!gaps.results.length && dayPeriod) {
        relaxed = await findAvailabilityGaps(resolvedService.canonical, searchWindow, null);
      }
      saveState({ lastService: resolvedService.canonical, lastDayPeriod: dayPeriod, step: 2 });
      return { reply: buildGapSearchReply(resolvedService, gaps, runtime, state, relaxed) };
    } catch (error) {
      console.warn("Mimi availability tool error:", error);
      return {
        reply: `No pude consultar la agenda en vivo en este momento. Si querés, probamos de nuevo en unos segundos o seguimos directo desde el calendario.`
      };
    }
  }

  if (intent === "session_logic") {
    const resolvedService = service || getServiceByName(state.lastService || runtime.servicioSeleccionado || "");
    const logic = calcSessionLogic(resolvedService?.canonical || "");
    if (!logic.ok || !resolvedService) {
      return {
        reply: `Decime qué tratamiento querés revisar y te digo la duración o la preparación general. Por ejemplo: <strong>Facial LED</strong> o <strong>Lipocell</strong>.`
      };
    }

    saveState({ lastService: resolvedService.canonical });
    return {
      reply: `${getCourtesyPrefix(runtime, state)}<strong>${escapeHtml(resolvedService.canonical)}</strong> dura <strong>${logic.durationMinutes} minutos</strong>. ${escapeHtml(logic.prep)} Si querés, sigo con el <strong>Paso 2</strong> y te busco los mejores horarios disponibles.`
    };
  }

  if (intent === "service_context") {
    const resolvedService = service || getServiceByName(state.lastService || runtime.servicioSeleccionado || "");
    if (!resolvedService) {
      return { reply: null, state: nextState };
    }

    try {
      const proactiveSearch = await findAvailabilityGaps(resolvedService.canonical, searchWindow, dayPeriod);
      const logic = calcSessionLogic(resolvedService.canonical);
      const summary = buildGapSearchReply(resolvedService, proactiveSearch, runtime, state);
      return {
        reply: `<strong>${escapeHtml(resolvedService.canonical)}</strong> dura <strong>${logic.durationMinutes} minutos</strong>. ${summary}`
      };
    } catch (error) {
      console.warn("Mimi service context error:", error);
      return {
        reply: `${getCourtesyPrefix(runtime, state)}te puedo ayudar con <strong>${escapeHtml(resolvedService.canonical)}</strong>. Si querés, decime <strong>esta semana</strong>, <strong>a la tarde</strong> o <strong>cuando antes</strong> y te busco la mejor opción disponible.`
      };
    }
  }

  if (intent === "cancel") {
    if (!runtime.dni || !runtime.nombre) {
      return {
        reply: `${getCourtesyPrefix(runtime, state)}para cancelar o reprogramar, primero necesito que entres con tu DNI y tu nombre en la web. Después lo hacés desde <strong>Ver mis próximos turnos</strong>, siempre con motivo y respetando la política de 48 horas.`
      };
    }

    return {
      reply: `Si necesitás cancelar, lo hacés desde <strong>Ver mis próximos turnos</strong> en la página de servicios. El sistema te va a pedir un motivo, deja el turno marcado como cancelado y libera ese horario para otra persona.`
    };
  }

  if (intent === "notification") {
    const wantsRetry = /(reenvia|reenvia|reenviar|reintenta|reintentar|volver a enviar)/.test(normalize(text));
    if (!wantsRetry) {
      return { reply: null };
    }

    const result = await sendWhatsAppTemplate("confirmacion_turno", runtime);
    if (result.ok && result.data?.whatsappSent) {
      return {
        reply: `Listo, reintenté el aviso automático y quedó despachado por WhatsApp. Si no lo ves enseguida, puede tardar unos segundos en impactar.`
      };
    }

    return {
      reply: `Estamos con un pequeño retraso en el sistema de avisos, pero no te preocupes que tu lugar ya está guardado. Te aviso apenas se normalice.`
    };
  }

  if (intent === "booking_flow") {
    return { reply: buildStepReply(runtime, service) };
  }

  if (runtime.servicioSeleccionado || state.lastService) {
    const rememberedService = getServiceByName(runtime.servicioSeleccionado || state.lastService || "");
    if (rememberedService) {
      return {
        reply: `${getCourtesyPrefix(runtime, state)}puedo seguir con <strong>${escapeHtml(rememberedService.canonical)}</strong>. Decime si querés que te busque el <strong>primer horario disponible</strong>, algo <strong>esta semana</strong> o una opción <strong>por la tarde</strong>.`
      };
    }
  }

  if (runtime.dni || state.dni) {
    return {
      reply: `${getCourtesyPrefix(runtime, state)}te puedo ayudar a buscar horarios disponibles, ubicarte en el paso correcto o indicarte cómo cancelar. Probá con algo como <strong>buscame un horario para Facial LED esta semana</strong> o <strong>quiero reprogramar</strong>.`
    };
  }

  return { reply: null, state: nextState };
}

export function getPatientResumeMessage() {
  return buildResumeMessage();
}