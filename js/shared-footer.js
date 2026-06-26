(async function () {
    const FOOTER_TEXT = "Todos los derechos reservados";
    const BRAND_TEXT = "Espacio Mimar T";
    const STYLE_ID = "shared-site-footer-style";
    const ADMIN_PAGES = new Set(["admin.html", "login-admin.html", "upload.html", "panel.html", "cargarclientes.html"]);
    const SHARED_FLOW_PAGES = new Set(["politica.html"]);
    const MAINTENANCE_MODE_ENABLED = false;
    const MAINTENANCE_PAGE = "maintenance.html";
    const FLOW_CONFIG_DOC = "jornadaEspecial";
    const FLOW_NORMAL_LANDING = "index.html";
    const JORNADA_LANDINGS = new Set(["jornadacrio.html", "jornadaradio.html", "jornadadetox.html"]);
    const JORNADA_TYPE_PAGES = { crio: "jornadacrio.html", radio: "jornadaradio.html", detox: "jornadadetox.html" };
    const FLOW_APP_NAME = "shared-footer-router";

    function getCurrentPage() {
        return (window.location.pathname.split("/").pop() || FLOW_NORMAL_LANDING).toLowerCase();
    }

    function isAdminPage() {
        return ADMIN_PAGES.has(getCurrentPage());
    }

    function isSharedFlowPage() {
        return SHARED_FLOW_PAGES.has(getCurrentPage());
    }

    function isMaintenancePage() {
        return getCurrentPage() === MAINTENANCE_PAGE;
    }

    function shouldCheckLandingFlow() {
        const currentPage = getCurrentPage();
        if (isAdminPage() || isSharedFlowPage()) return false;
        return currentPage === FLOW_NORMAL_LANDING || JORNADA_LANDINGS.has(currentPage);
    }

    function getLandingRedirect(flowMode, jornadaType) {
        const currentPage = getCurrentPage();
        if (flowMode === "jornada") {
            const correctPage = JORNADA_TYPE_PAGES[jornadaType] || "jornadacrio.html";
            if (currentPage === FLOW_NORMAL_LANDING) return correctPage;
            if (JORNADA_LANDINGS.has(currentPage) && currentPage !== correctPage) return correctPage;
        }
        if (flowMode !== "jornada" && JORNADA_LANDINGS.has(currentPage)) {
            return FLOW_NORMAL_LANDING;
        }
        return "";
    }

    async function loadFlowMode() {
        try {
            const { firebaseConfig, initializeApp, getApp, getFirestore, doc, getDoc } = await import("/js/firebase-web.js");

            let app;
            try {
                app = getApp(FLOW_APP_NAME);
            } catch (error) {
                app = initializeApp(firebaseConfig, FLOW_APP_NAME);
            }

            const db = getFirestore(app);
            const snap = await getDoc(doc(db, "configuracion", FLOW_CONFIG_DOC));

            if (!snap.exists()) return { mode: "normal", type: "" };

            const data = snap.data();
            return {
                mode: data?.flowMode === "jornada" ? "jornada" : "normal",
                type: data?.jornadaType || "crio"
            };
        } catch (error) {
            console.warn("No se pudo cargar el modo de flujo global:", error);
            return { mode: "normal", type: "" };
        }
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            .shared-site-footer {
                margin-top: 40px;
                padding: 48px 24px 8px;
                text-align: center;
                background: #080f0b;
                border-top: 1px solid rgba(60,179,113,0.15);
            }

            .shared-site-footer__text {
                margin: 0;
                color: rgba(255,255,255,0.45);
                font-size: 12px;
                line-height: 1.5;
                font-weight: 600;
                letter-spacing: 0.02em;
            }

            .shared-site-footer__brand {
                color: rgba(255,255,255,0.6);
                font-weight: 700;
            }

            .shared-site-footer__sep {
                display: inline-block;
                margin: 0 6px;
                color: rgba(255,255,255,0.25);
            }

            @media (max-width: 480px) {
                .shared-site-footer {
                    margin-top: 22px;
                    padding-bottom: 6px;
                }

                .shared-site-footer__text {
                    font-size: 11px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function removeLegacyFooters() {
    }

    function getMountNode() {
        return document.querySelector(
            "body > .page-wrap, body > .container, body > .login-box, body > .box, body > .wrapper, body > .calendario, body > .panel, body > main"
        ) || document.body;
    }

    function appendFooter() {
        if (document.querySelector("[data-shared-site-footer]")) return;
        if (document.querySelector(".site-footer") || document.getElementById("footerContainer")) return;
        if (document.querySelector("footer.footer")) return;

        const mount = getMountNode();
        const footer = document.createElement("footer");
        footer.className = "shared-site-footer";
        footer.setAttribute("data-shared-site-footer", "true");
        footer.innerHTML = `
            <div style="max-width:800px; margin:0 auto; display:flex; flex-direction:column; align-items:center; gap:14px; padding-bottom:28px; border-bottom:1px solid rgba(60,179,113,0.15); text-align:center;">
                <img src="/img/logo.png" alt="${BRAND_TEXT}" style="height:56px; width:auto; filter:brightness(0.95);" onerror="this.style.display='none'">
                <p style="font-family:'Cormorant Garamond',Georgia,serif; font-size:1.15rem; font-style:italic; color:rgba(255,255,255,0.88); margin:0;">Estética avanzada con criterio profesional.</p>
                <p style="font-size:0.7rem; letter-spacing:0.1em; text-transform:uppercase; color:rgba(255,255,255,0.45); margin:0;">Comandante Andresito · Misiones · Argentina</p>
                <div style="font-size:0.7rem; color:rgba(255,255,255,0.45); line-height:1.8;">Gimena Knack · Farmacéutica MP 1212 · Dermatocosmiatra RC 2319</div>
                <a href="https://wa.me/5493764291807" target="_blank" rel="noopener" style="font-size:0.82rem; color:#3cb371; text-decoration:none;">WhatsApp → +54 9 3764 29-1807</a>
            </div>
            <p class="shared-site-footer__text">
                <span>&copy; 2026</span>
                <span class="shared-site-footer__sep">&middot;</span>
                <span class="shared-site-footer__brand">${BRAND_TEXT}</span>
                <span class="shared-site-footer__sep">&middot;</span>
                <span>${FOOTER_TEXT}</span>
            </p>
        `;
        mount.appendChild(footer);
    }

    injectStyles();
    if (MAINTENANCE_MODE_ENABLED) {
        if (!isAdminPage() && !isMaintenancePage()) {
            window.location.replace(`/${MAINTENANCE_PAGE}`);
            return;
        }
    }
    else if (shouldCheckLandingFlow()) {
        const { mode: flowMode, type: jornadaType } = await loadFlowMode();
        const redirectTarget = getLandingRedirect(flowMode, jornadaType);
        if (redirectTarget && getCurrentPage() !== redirectTarget) {
            window.location.replace(`/${redirectTarget}`);
            return;
        }
    }
    removeLegacyFooters();
    appendFooter();
})();
