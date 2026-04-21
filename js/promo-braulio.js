(() => {
    const DISMISS_KEY = 'pb_v3_gone';
    const WA_NUM = "5493757671229";
    const WA_MSG = encodeURIComponent("Hola! 👋 Vi el trabajo en Espacio Mimar T y me encantó. Me gustaría tener algo así para mi negocio. ¿Podés contarme más?");
    const WA_URL = `https://wa.me/${WA_NUM}?text=${WA_MSG}`;

    const WA_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.122.554 4.118 1.525 5.845L.057 23.928l6.253-1.44A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-4.988-1.362l-.358-.212-3.713.855.882-3.608-.233-.371A9.794 9.794 0 012.182 12C2.182 6.573 6.573 2.182 12 2.182c5.428 0 9.818 4.39 9.818 9.818 0 5.427-4.39 9.818-9.818 9.818z"/></svg>`;

    const CSS = `
        /* ── Chip fijo ── */
        #pb-chip {
            position: fixed;
            bottom: 22px;
            right: 16px;
            z-index: 999999;
            display: flex;
            align-items: center;
            gap: 0;
            background: linear-gradient(135deg, #0d2b1f 0%, #1a4a34 100%);
            border: 1px solid rgba(114,189,153,0.4);
            border-radius: 999px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.07);
            overflow: hidden;
            animation: pb-chip-in 0.55s cubic-bezier(0.34,1.46,0.64,1) both;
        }
        #pb-chip-link {
            display: flex; align-items: center; gap: 8px;
            padding: 10px 6px 10px 14px;
            text-decoration: none;
            transition: background 0.18s;
        }
        #pb-chip-link:hover { background: rgba(114,189,153,0.1); }
        #pb-chip-icon { font-size: 14px; line-height: 1; flex-shrink: 0; }
        #pb-chip-text {
            font-size: 12.5px; font-weight: 700;
            color: #a8dfc0; white-space: nowrap;
            letter-spacing: 0.02em;
            font-family: 'Montserrat', sans-serif;
        }
        #pb-chip-wa {
            display: flex; align-items: center;
            padding: 10px 12px 10px 4px;
            color: #5ae080;
        }
        #pb-chip-dismiss {
            background: rgba(255,255,255,0.07);
            border: none; border-left: 1px solid rgba(114,189,153,0.2);
            color: rgba(255,255,255,0.4);
            width: 32px; height: 100%; min-height: 40px;
            font-size: 11px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
            transition: background 0.15s, color 0.15s;
        }
        #pb-chip-dismiss:hover { background: rgba(180,40,40,0.35); color: #ffaaaa; }
        @keyframes pb-chip-in {
            from { opacity: 0; transform: translateY(20px) scale(0.88); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .pb-chip-out {
            transition: opacity 0.28s ease, transform 0.28s ease !important;
            opacity: 0 !important;
            transform: translateY(14px) scale(0.9) !important;
        }

        /* ── Footer card ── */
        .pb-footer-card { margin: 40px auto 0; max-width: 680px; padding: 0 16px 40px; }
        .pb-footer-inner {
            background: linear-gradient(135deg, #0d2b1f 0%, #1a4a34 55%, #163d2c 100%);
            border: 1px solid rgba(114,189,153,0.3); border-radius: 24px;
            padding: 26px 26px 22px; display: flex; gap: 20px; align-items: center;
            box-shadow: 0 16px 48px rgba(0,0,0,0.18); position: relative; overflow: hidden;
        }
        .pb-footer-inner::before {
            content: ""; position: absolute; top: -60px; right: -60px;
            width: 200px; height: 200px; border-radius: 50%;
            background: radial-gradient(circle, rgba(114,189,153,0.14) 0%, transparent 70%);
            pointer-events: none;
        }
        .pb-footer-badge {
            width: 58px; height: 58px; flex-shrink: 0; border-radius: 16px;
            background: linear-gradient(135deg, #72bd99, #3f8f6f);
            display: flex; align-items: center; justify-content: center;
            font-size: 24px; box-shadow: 0 8px 20px rgba(114,189,153,0.4);
        }
        .pb-footer-text { flex: 1; min-width: 0; }
        .pb-footer-tag { font-size: 10px; font-weight: 800; letter-spacing: .12em; color: #72bd99; text-transform: uppercase; margin: 0 0 5px; }
        .pb-footer-title { font-family: 'Playfair Display', Georgia, serif; font-size: 17px; color: #fff; margin: 0 0 6px; line-height: 1.3; }
        .pb-footer-desc { font-size: 12px; color: rgba(255,255,255,0.58); margin: 0 0 14px; line-height: 1.6; }
        .pb-footer-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
        .pb-footer-pill { font-size: 11px; font-weight: 600; background: rgba(114,189,153,0.14); border: 1px solid rgba(114,189,153,0.3); color: #a8dfc0; padding: 3px 10px; border-radius: 20px; }
        .pb-footer-cta {
            display: inline-flex; align-items: center; gap: 8px;
            background: #25D366; color: #fff; border: none;
            padding: 11px 20px; border-radius: 12px; font-size: 13px; font-weight: 700;
            cursor: pointer; text-decoration: none;
            box-shadow: 0 6px 18px rgba(37,211,102,0.35);
            transition: filter 0.2s, transform 0.15s;
        }
        .pb-footer-cta:hover { filter: brightness(1.08); transform: translateY(-1px); }
        @media (max-width: 560px) {
            .pb-footer-inner { flex-direction: column; text-align: center; }
            .pb-footer-pills { justify-content: center; }
            #pb-chip { bottom: 14px; right: 10px; }
        }
    `;

    function injectCSS() {
        const s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    // ── CHIP FIJO (dismiss permanente) ─────────────────────────
    function buildChip() {
        if (localStorage.getItem(DISMISS_KEY)) return;

        const chip = document.createElement('div');
        chip.id = 'pb-chip';
        chip.innerHTML = `
            <a id="pb-chip-link" href="${WA_URL}" target="_blank" rel="noopener" aria-label="Contactar al desarrollador">
                <span id="pb-chip-icon">💻</span>
                <span id="pb-chip-text">¿Tu negocio también?</span>
                <span id="pb-chip-wa">${WA_SVG}</span>
            </a>
            <button id="pb-chip-dismiss" aria-label="No mostrar más">✕</button>
        `;
        document.body.appendChild(chip);

        document.getElementById('pb-chip-dismiss').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            localStorage.setItem(DISMISS_KEY, '1');
            chip.classList.add('pb-chip-out');
            setTimeout(() => chip.remove(), 320);
        };
    }

    // ── FOOTER CARD ────────────────────────────────────────────
    function buildFooterCard() {
        if (document.querySelector('.pb-footer-card')) return;
        if (localStorage.getItem(DISMISS_KEY)) return;
        const footer = document.querySelector('.footer, footer, #footer');
        if (!footer) return;
        const div = document.createElement('div');
        div.className = 'pb-footer-card';
        div.innerHTML = `
            <div class="pb-footer-inner">
                <div class="pb-footer-badge">💻</div>
                <div class="pb-footer-text">
                    <p class="pb-footer-tag">Desarrollado a medida</p>
                    <p class="pb-footer-title">¿Tu negocio merece algo así?</p>
                    <p class="pb-footer-desc">Agenda online con recordatorios automáticos, panel de gestión, integración con WhatsApp y diseño premium personalizado.</p>
                    <div class="pb-footer-pills">
                        <span class="pb-footer-pill">✦ Estéticas</span>
                        <span class="pb-footer-pill">✦ Peluquerías</span>
                        <span class="pb-footer-pill">✦ Gastronomía</span>
                        <span class="pb-footer-pill">✦ Salud & Bienestar</span>
                    </div>
                    <a class="pb-footer-cta" href="${WA_URL}" target="_blank" rel="noopener">
                        ${WA_SVG} Quiero algo así →
                    </a>
                </div>
            </div>
        `;
        footer.parentNode.insertBefore(div, footer);
    }

    // ── INIT ───────────────────────────────────────────────────
    function init() {
        injectCSS();
        buildFooterCard();
        buildChip();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
