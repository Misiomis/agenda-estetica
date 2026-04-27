import { db, doc, onSnapshot } from "/js/firebase-web.js";

const CACHE_KEY_TEMA = "mimar_tema";
const CACHE_KEY_ANUNCIO = "mimar_anuncio";

export function cargarTemaYAnuncio() {
    aplicarTemaCache();
    mostrarAnuncioCache();

    onSnapshot(doc(db, "configuracion", "apariencia"), (snap) => {
        if (!snap.exists()) return;
        const tema = snap.data().tema || "";
        localStorage.setItem(CACHE_KEY_TEMA, JSON.stringify({ tema, ts: Date.now() }));
        aplicarTema(tema);
    }, (e) => {
        console.warn("[theme-loader] apariencia:", e?.code || e?.message);
    });

    onSnapshot(doc(db, "configuracion", "anuncio"), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        localStorage.setItem(CACHE_KEY_ANUNCIO, JSON.stringify({ texto: d.texto || "", activo: !!d.activo, ts: Date.now() }));
        mostrarAnuncio(d.texto || "", !!d.activo);
    }, (e) => {
        console.warn("[theme-loader] anuncio:", e?.code || e?.message);
    });
}

function aplicarTemaCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY_TEMA);
        if (!raw) return;
        const { tema } = JSON.parse(raw);
        aplicarTema(tema);
    } catch(e) {}
}

function mostrarAnuncioCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY_ANUNCIO);
        if (!raw) return;
        const { texto, activo } = JSON.parse(raw);
        mostrarAnuncio(texto, activo);
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
