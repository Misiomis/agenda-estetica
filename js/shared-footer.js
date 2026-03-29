(function () {
    const FOOTER_TEXT = "Todos los derechos reservados";
    const BRAND_TEXT = "Espacio Mimar T";
    const STYLE_ID = "shared-site-footer-style";
    const HOME_PAGES = new Set(["", "index.html"]);
    const ADMIN_PAGES = new Set(["admin.html"]);

    function getCurrentPage() {
        return (window.location.pathname.split("/").pop() || "").toLowerCase();
    }

    function isHomePage() {
        return HOME_PAGES.has(getCurrentPage());
    }

    function isAdminPage() {
        return ADMIN_PAGES.has(getCurrentPage());
    }

    function isPublicPatientPage() {
        return !isHomePage() && !isAdminPage();
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            .shared-site-footer {
                margin-top: 26px;
                padding: 16px 0 8px;
                text-align: center;
                opacity: 0.5;
            }

            .shared-site-footer__text {
                margin: 0;
                color: #87717c;
                font-size: 12px;
                line-height: 1.5;
                font-weight: 600;
                letter-spacing: 0.02em;
            }

            .shared-site-footer__brand {
                color: #72bd99;
                font-weight: 800;
            }

            .shared-site-footer__sep {
                display: inline-block;
                margin: 0 6px;
                color: #c79ab1;
            }

            .maintenance-shell {
                width: min(92vw, 540px);
                margin: 42px auto 0;
                padding: 28px 22px;
                text-align: center;
                border-radius: 24px;
                background: linear-gradient(155deg, rgba(255,255,255,0.98) 0%, rgba(255,246,251,0.96) 100%);
                border: 1px solid rgba(232, 201, 217, 0.9);
                box-shadow: 0 22px 48px rgba(121, 72, 99, 0.12);
            }

            .maintenance-logo-wrap {
                width: 112px;
                height: 112px;
                margin: 0 auto 18px;
                border-radius: 999px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: radial-gradient(circle at 30% 30%, #ffffff 0%, #f8edf3 100%);
                box-shadow: 0 18px 38px rgba(121, 72, 99, 0.14);
                overflow: hidden;
            }

            .maintenance-logo {
                width: 100%;
                height: 100%;
                object-fit: cover;
                border-radius: 999px;
            }

            .maintenance-title {
                margin: 0 0 10px;
                color: #6f3e58;
                font-size: clamp(28px, 7vw, 36px);
                line-height: 1;
                font-weight: 800;
            }

            .maintenance-copy {
                margin: 0;
                color: #735765;
                font-size: 14px;
                line-height: 1.6;
                font-weight: 600;
            }

            @media (max-width: 480px) {
                .shared-site-footer {
                    margin-top: 22px;
                    padding-bottom: 6px;
                }

                .shared-site-footer__text {
                    font-size: 11px;
                }

                .maintenance-shell {
                    margin-top: 28px;
                    padding: 24px 18px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function removeLegacyFooters() {
        const candidates = document.querySelectorAll(".footer, footer");
        candidates.forEach((node) => {
            const text = (node.textContent || "").toLowerCase();
            if (text.includes("todos los derechos reservados")) {
                node.remove();
            }
        });
    }

    function getMountNode() {
        return document.querySelector(
            "body > .page-wrap, body > .container, body > .login-box, body > .box, body > .wrapper, body > .calendario, body > .panel, body > main"
        ) || document.body;
    }

    function applyMaintenanceHome() {
        const container = document.querySelector("body > .container") || document.querySelector("body > .page-wrap") || document.body;
        if (!container || container.dataset.maintenanceApplied === "true") return;

        document.title = "Página en mantenimiento | Espacio Mimar T";
        container.dataset.maintenanceApplied = "true";
        container.innerHTML = `
            <section class="maintenance-shell" aria-label="Página en mantenimiento">
                <div class="maintenance-logo-wrap">
                    <img class="maintenance-logo" src="img/logo2.jpg" alt="Espacio Mimar T">
                </div>
                <h1 class="maintenance-title">Página en mantenimiento</h1>
                <p class="maintenance-copy">Estamos realizando ajustes para mejorar la experiencia. Por ahora, el acceso para pacientes se encuentra momentáneamente deshabilitado.</p>
            </section>
        `;
    }

    function appendFooter() {
        if (document.querySelector("[data-shared-site-footer]")) return;

        const mount = getMountNode();
        const footer = document.createElement("footer");
        footer.className = "shared-site-footer";
        footer.setAttribute("data-shared-site-footer", "true");
        footer.innerHTML = `
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

    if (isPublicPatientPage()) {
        window.location.replace("/index.html");
        return;
    }

    injectStyles();
    if (isHomePage()) {
        applyMaintenanceHome();
    }
    removeLegacyFooters();
    appendFooter();
})();