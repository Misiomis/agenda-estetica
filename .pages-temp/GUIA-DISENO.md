# Guia de diseno visual - Espacio Mimar

## Tokens base

Usar estos tokens como punto de partida en nuevas vistas.

- Color fondo: `var(--mimar-color-bg)`
- Color superficie: `var(--mimar-color-surface)`
- Color principal: `var(--mimar-color-primary)`
- Color principal fuerte: `var(--mimar-color-primary-strong)`
- Color principal suave: `var(--mimar-color-primary-soft)`
- Texto principal: `var(--mimar-color-ink)`
- Texto secundario: `var(--mimar-color-muted)`
- Borde: `var(--mimar-color-border)`

- Radio chico: `var(--mimar-radius-sm)`
- Radio medio: `var(--mimar-radius-md)`
- Radio grande: `var(--mimar-radius-lg)`

- Sombra chica: `var(--mimar-shadow-sm)`
- Sombra media: `var(--mimar-shadow-md)`
- Sombra grande: `var(--mimar-shadow-lg)`

- Transicion rapida: `var(--mimar-transition-fast)`
- Transicion base: `var(--mimar-transition-base)`

## Reglas de estilo recomendadas

1. Limitar radios a 10, 14 o 22 para coherencia.
2. No mezclar mas de 2 sombras por componente.
3. Usar color principal solo en acciones (botones, estado activo).
4. Mantener foco visible en inputs y botones (`:focus-visible`).
5. Respetar `prefers-reduced-motion` para animaciones.

## Snippet sugerido para boton principal

```css
.btn-primary {
  background: linear-gradient(135deg, var(--mimar-color-primary) 0%, var(--mimar-color-primary-strong) 100%);
  color: #fff;
  border: none;
  border-radius: var(--mimar-radius-md);
  box-shadow: var(--mimar-shadow-md);
  transition: transform var(--mimar-transition-fast), box-shadow var(--mimar-transition-fast), filter var(--mimar-transition-fast);
}

.btn-primary:hover {
  transform: translateY(-1px);
  filter: saturate(1.04);
}

.btn-primary:focus-visible {
  outline: 3px solid rgba(86, 149, 117, 0.4);
  outline-offset: 2px;
}
```

## Snippet sugerido para tarjeta

```css
.card-surface {
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--mimar-color-border);
  border-radius: var(--mimar-radius-lg);
  box-shadow: var(--mimar-shadow-lg);
}
```
