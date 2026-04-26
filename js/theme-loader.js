import { db, getDoc, doc } from "/js/firebase-web.js";

const CACHE_KEY_TEMA = "mimar_tema";
const CACHE_KEY_ANUNCIO = "mimar_anuncio";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export async function cargarTemaYAnuncio() {
    aplicarTemaCache();
    mostrarAnuncioCache();
    try {
        const [temaSnap, anuncioSnap] = await Promise.all([
            getDoc(doc(db, "configuracion", "apariencia")),
            getDoc(doc(db, "configuracion", "anuncio"))
        ]);

        if (temaSnap.exists()) {
            const tema = temaSnap.data().tema || "";
            localStorage.setItem(CACHE_KEY_TEMA, JSON.stringify({ tema, ts: Date.now() }));
            aplicarTema(tema);
        }

        if (anuncioSnap.exists()) {
            const d = anuncioSnap.data();
            localStorage.setItem(CACHE_KEY_ANUNCIO, JSON.stringify({ texto: d.texto || "", activo: !!d.activo, ts: Date.now() }));
            mostrarAnuncio(d.texto || "", !!d.activo);
        }
    } catch(e) {
        console.warn("[theme-loader] No se pudo cargar configuración:", e?.code || e?.message);
    }
}

function aplicarTemaCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY_TEMA);
        if (!raw) return;
        const { tema, ts } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL) aplicarTema(tema);
    } catch(e) {}
}

function mostrarAnuncioCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY_ANUNCIO);
        if (!raw) return;
        const { texto, activo, ts } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL) mostrarAnuncio(texto, activo);
    } catch(e) {}
}

function aplicarTema(tema) {
    if (tema) document.body.setAttribute("data-tema", tema);
    else document.body.removeAttribute("data-tema");
}

function mostrarAnuncio(texto, activo) {
    if (!activo || !texto.trim()) return;
    if (document.getElementById("mimar-anuncio-banner")) return;
    const banner = document.createElement("div");
    banner.id = "mimar-anuncio-banner";
    banner.className = "mimar-anuncio-banner";
    banner.innerHTML = `${texto} <button class="mimar-anuncio-cerrar" onclick="this.parentElement.remove()" aria-label="Cerrar">×</button>`;
    document.body.insertBefore(banner, document.body.firstChild);
}
