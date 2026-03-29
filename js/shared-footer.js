(function () {
    const FOOTER_TEXT = "Todos los derechos reservados";
    const BRAND_TEXT = "Espacio Mimar T";
    const STYLE_ID = "shared-site-footer-style";

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            .shared-site-footer {
                margin-top: 26px;
                padding: 16px 0 8px;
                text-align: center;
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

    injectStyles();
    removeLegacyFooters();
    appendFooter();
})();