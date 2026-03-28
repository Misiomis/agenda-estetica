# Jornada Especial - Configuracion rapida

Este flujo permite usar el mismo dominio y redirigir al registro autonomo de jornada solo en fechas definidas.

## 1) Configuracion en Firestore

Crear/editar el documento:

- Coleccion: configuracion
- Documento: jornadaEspecial

Campos sugeridos:

```json
{
  "active": true,
  "redirectTo": "jornada.html",
  "serviceName": "Jornada Unica de Criolipolisis",
  "allowedDates": ["2026-04-02"],
  "zones": ["Abdomen", "Rollito espalda", "Banana subglutea", "Caderas"],
  "sourceTag": "jornada_crio_2026_04_02",
  "startAt": "2026-03-30T00:00:00-03:00",
  "endAt": "2026-04-03T23:59:59-03:00"
}
```

Notas:
- startAt y endAt pueden guardarse como Timestamp de Firestore o string ISO.
- active permite prender/apagar manualmente sin deploy.

## 2) Flujo activo

- index.html detecta configuracion y redirige a jornada.html durante la ventana activa.
- jornada.html registra/actualiza paciente ocasional via Cloud Function.
- fecha.html limita el calendario a allowedDates cuando jornadaModo=1.

## 3) Bypass manual

Para entrar al flujo normal aunque la jornada este activa:

- index.html?modo=normal

## 4) Desactivar jornada

Opciones:
- active = false
- o mover endAt al pasado

