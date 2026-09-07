import { dayKey, clockParts } from "./motor.js";

export function demoBookings(now = Date.now()) {
  const minute = Math.floor(now / 60_000) * 60_000;
  const make = (id, offset, name, service, box, source = "reservas") => {
    const start = minute + offset * 60_000;
    const parts = clockParts(start);
    return { id, source, data: {
      fecha: dayKey(start), hora: parts.hour + ":" + parts.minute,
      clienteNombre: name, servicio: service, box, duracionMinutos: 40,
      estado: "confirmado"
    }};
  };
  return [
    make("ejemplo-1", -100, "Lucía Benítez", "Limpieza facial", "b3"),
    make("ejemplo-2", -40, "Paula Acosta", "Masaje relajante", "b4"),
    make("ejemplo-3", 8, "Valentina Ríos", "Tratamiento corporal", "b2"),
    make("ejemplo-4", 8, "Camila Duarte", "Consulta inicial", "b1", "consultas"),
    make("ejemplo-5", 45, "Sofía Medina", "Depilación láser", null, "reservasDepi"),
    make("ejemplo-6", 70, "Julia Fernández", "Hidratación facial", "b3")
  ];
}
