// Biblioteca de recomendaciones post-sesión — fuente para el modal
// "✨ Enviar recomendación post-sesión" de la Grilla y de la Ficha 360°.
//
// ARCHIVO GENERADO a partir de admin.html: los textos de las plantillas
// que ya existían (agua, faja, MIO UP, FRAXIS, Drenapress, plataforma
// vibratoria, criolipólisis, Plisagge Vela, facial antes/después, kit
// facial, mesoterapia y depilación) son copia EXACTA de las constantes
// msg* de la tarjeta de turno de la Agenda (verTurnos), que audita
// tests/recomendaciones-sin-saludos. tests/recomendaciones-post-sesion
// falla si las dos copias se separan: si se edita un texto, editarlo en
// los dos lugares. HIFU no se copia: se delega a js/recomendaciones-hifu.js.
//
// Igual que el resto de las recomendaciones del panel: sin saludos ni
// despedidas, con el título "Recomendaciones para {nombre}".
import { construirMensajeHifu, ORDEN_PLANTILLAS_HIFU, PLANTILLAS_HIFU } from "./recomendaciones-hifu.js";

export const TITULO_SIN_NOMBRE = 'Recomendaciones posteriores a tu sesión';

export function tituloRecomendacion(nombrePaciente) {
  const nombre = (nombrePaciente || '').toString().trim();
  return nombre ? `Recomendaciones para ${nombre}` : TITULO_SIN_NOMBRE;
}

const CUERPOS = {
  // = msg1 en admin.html
  agua: `Recordá que el consumo de agua es el complemento indispensable de tu sesión y un pilar fundamental para tu salud. Para maximizar los resultados y permitir que tu cuerpo procese el tratamiento de forma óptima, mantenete hidratada/o durante todo el día✨💧`,
  // = msg2 en admin.html
  faja: `Recordá que el uso de tu faja es fundamental para consolidar los resultados. El esquema recomendado es de 3 horas diarias durante 5 días a la semana, o bien 5 horas diarias durante 3 días. ¡Tu constancia hace la diferencia!✨`,
  // = msgMioUp en admin.html
  mio_up: `✨ Recomendaciones después de tu sesión de MIO UP ✨\nPara lograr mejores resultados y cuidar correctamente tu cuerpo, te recomendamos:\n• Tomar abundante agua 💧\n• Mantener una alimentación equilibrada 🍎\n• Evitar el sedentarismo y acompañar con movimiento físico cuando sea posible 🚶\n• Respetar la frecuencia sugerida de las sesiones ⏳\n• Descansar correctamente 😴\n\n⚠️ Importante:\nMIO UP trabaja estimulando intensamente la musculatura y mejorando tonicidad y firmeza, pero los resultados NO se observan con una sola sesión.\n👉 Se necesitan varias sesiones en la misma zona para notar cambios progresivos y sostenidos.\nLa constancia es clave para lograr mejores resultados.\nCada cuerpo responde de manera diferente, por eso el tratamiento se adapta de forma personalizada según tus objetivos ❤️`,
  // = msgFraxisFacial en admin.html
  fraxis_facial: `✨ Recomendaciones después de tu sesión de FRAXIS – Radiofrecuencia Fraccionada FACIAL ✨\n\nLuego de la sesión es normal sentir la piel sensible, caliente o levemente enrojecida 🔥\n\nPara acompañar correctamente la recuperación te recomendamos:\n\n💧 Mantener buena hidratación\n☀️ Usar protector solar y reaplicarlo durante el día\n🚫 Evitar exposición solar directa\n🚫 No utilizar ácidos, exfoliantes ni productos irritantes por algunos días\n🚫 Evitar calor excesivo, sauna o agua muy caliente durante 24/48 hs\n🤍 No frotar ni raspar la piel\n\n✨ Importante:\nLos resultados son progresivos y la piel continúa regenerándose en los días posteriores.\n\n👉 Dependiendo del objetivo y del estado de la piel, suelen requerirse varias sesiones para lograr resultados más notorios y sostenidos.\n\n📍Espacio MimarT\n"Un lugar pensado para vos"`,
  // = msgFraxisCorp en admin.html
  fraxis_corporal: `✨ Recomendaciones después de tu sesión de FRAXIS – Radiofrecuencia Fraccionada CORPORAL ✨\n\nDespués de la sesión puede aparecer leve sensibilidad, calor o enrojecimiento en la zona tratada 🔥\n\nPara favorecer los resultados te recomendamos:\n\n💧 Tomar abundante agua\n🥗 Mantener una alimentación equilibrada\n🚶 Acompañar con actividad física cuando sea posible\n🚫 Evitar calor excesivo durante 24/48 hs\n🤍 No frotar intensamente la zona tratada\n✨ Respetar la frecuencia indicada de las sesiones\n\n⚠️ Importante:\nLos resultados son progresivos y requieren constancia.\n\n👉 Para observar cambios visibles y sostenidos generalmente se necesitan varias sesiones en la misma zona.\n\nCada protocolo se adapta de forma personalizada según las necesidades y objetivos de cada paciente 💚\n\n📍Espacio MimarT\n"Un lugar pensado para vos"`,
  // = msgDrenapress en admin.html
  drenapress: `Cuidados posteriores a tu sesión de presoterapia de cuerpo completo con Drenapress, que trabaja mediante botas, faja abdominal y mangas.\n\nEntre sus beneficios, ayuda a:\n\n💚 Favorecer la circulación y el drenaje linfático.\n💚 Disminuir la retención de líquidos y la sensación de pesadez.\n💚 Mejorar el aspecto de la celulitis y las estrías.\n💚 Acompañar tratamientos de adiposidad localizada y modelación corporal.\n💚 Brindar una agradable sensación de bienestar y liviandad.\n\nTrabajamos con un equipo de fabricación nacional, desarrollado bajo un sistema de calidad certificado. Su fabricante está habilitado por ANMAT, cumple con Buenas Prácticas de Fabricación y con la norma IEC 60601-1 de seguridad eléctrica para equipos médicos.\n\n💧 Después de la sesión, recordá beber abundante agua para acompañar el proceso.`,
  // = msgVibratoria en admin.html
  vibratoria: `✨ Plataforma Vibratoria Profesional – Beneficios ✨\n\nLa plataforma vibratoria es un excelente complemento dentro de un plan integral de salud, estética y entrenamiento.\n\n¿Cuáles son sus beneficios?\n\n🌿 Activa la circulación sanguínea y linfática.\n🌿 Favorece el drenaje de líquidos retenidos.\n🌿 Ayuda a mejorar el aspecto de la celulitis cuando se combina con otros tratamientos.\n🌿 Estimula la musculatura mediante contracciones involuntarias.\n🌿 Contribuye a tonificar y fortalecer los músculos.\n🌿 Puede ayudar a mejorar el equilibrio, la coordinación y la estabilidad.\n🌿 Favorece la movilidad y la flexibilidad.\n🌿 Ayuda a aliviar la sensación de piernas cansadas.\n🌿 Puede colaborar en la salud ósea cuando se utiliza de forma adecuada y acompañada por actividad física.\n🌿 Es un excelente complemento para programas de descenso de peso y remodelación corporal.\n🌿 Brinda una agradable sensación de bienestar y relajación.\n\n💚 Importante: La plataforma vibratoria no reemplaza el ejercicio físico ni quema grasa por sí sola. Los mejores resultados se logran al combinarla con actividad física, una alimentación equilibrada, buena hidratación y tratamientos personalizados.\n\nIdeal para hombres y mujeres que buscan mejorar su salud, su bienestar y potenciar sus resultados estéticos.`,
  // = msgPostCryo en admin.html
  criolipolisis: `Cuidados y qué va a pasar en tu cuerpo en los próximos días luego de tu sesión de Criolipólisis.\n\n❄️ En las primeras horas\nEs normal que notes:\n• Enrojecimiento\n• Leve inflamación\n• Sensación de adormecimiento u hormigueo\n• Algún pequeño hematoma por la succión\nTodo esto es parte del proceso y suele desaparecer en pocas horas o días ✨\n\n💫 Durante la primera semana\nPodés sentir la zona un poco más sensible o más "compacta".\nEso significa que el tejido adiposo comenzó a responder al frío ❄️🔥\n\n🌿 ¿Qué está pasando por dentro?\nEl tratamiento genera un estímulo controlado sobre las células grasas.\nTu cuerpo, de forma natural y progresiva, comienza a eliminarlas.\nEs un proceso biológico gradual, no inmediato 🤍\n\n⏳ ¿Cuándo se notan cambios?\n✨ Desde la semana 3–4 pueden empezar a verse resultados.\n✨ El cambio más visible suele apreciarse entre la semana 6 y 8.\n✨ La mejora continúa progresivamente.\n\n🌸 Para potenciar los resultados:\n💧 Tomar mucha agua\n🥗 Alimentación equilibrada\n🚶 Actividad física\n🚫 Evitar alcohol\n💆 Se puede complementar con drenaje o presoterapia si se indica.`,
  // = msgPlisaggeVela en admin.html
  plisagge_vela: `Cuidados posteriores a tu sesión de modelación corporal y tratamiento de adiposidad localizada con Plisagge Vela.\n\nEste tratamiento ayuda a acompañar la reducción de adiposidad localizada, mejorar el aspecto de la celulitis, favorecer la circulación y el drenaje, y contribuir a una piel con mejor apariencia y vitalidad.\n\n💧 Después de tu sesión, recordá tomar abundante agua y mantener una buena hidratación.\n\n☀️ Durante las 24 horas posteriores a la sesión, evitá depilación láser, IPL o cualquier procedimiento que pueda irritar la zona tratada.\n\n🩱 Utilizá la faja si te fue indicada para este tratamiento y seguí las pautas de uso del profesional que te atendió.\n\nPodés continuar con tus actividades habituales con normalidad.`,
  // = msgPreFacial en admin.html
  facial_antes: `ANTES DE TU SESIÓN · TRATAMIENTO FACIAL\nMimar T · de Gimena Knack\n\nPara que podamos trabajar tu piel en las mejores condiciones, tené en cuenta estas recomendaciones:\n\n48–72 HS ANTES\n• Evitá la exposición solar directa o intensa.\n• No realices exfoliaciones ni manipules la piel.\n• Evitá procedimientos que puedan dejar la zona sensibilizada.\n\nEL DÍA DE TU TURNO\n• Si es posible, vení con la piel limpia y sin maquillaje.\n• Evitá probar productos nuevos antes de la sesión.\n\nIMPORTANTE\nSi estás utilizando medicación, tratamientos dermatológicos o tenés la piel irritada o sensibilizada, comentanos antes de comenzar.\n\nEstas indicaciones nos ayudan a adaptar el tratamiento y cuidar mejor tu piel.\n\nMimar T · de Gimena Knack\nFarmacéutica y Dermatocosmiatra`,
  // = msgPostFacial en admin.html
  facial_despues: `CUIDADOS POST TRATAMIENTO FACIAL\nMimar T · de Gimena Knack\n\nDurante los próximos días es importante cuidar la piel y acompañar su recuperación.\n\nDURANTE LAS PRIMERAS 48–72 HS EVITÁ:\n• Exposición solar directa.\n• Maquillaje y productos con alcohol o perfume.\n• Exfoliaciones o manipulación de la piel.\n• Calor excesivo: sauna, gimnasio o pileta.\n\nTENÉ EN CUENTA\nPuede ser normal sentir un leve enrojecimiento, tirantez o descamación.\n\nSiguiendo estas indicaciones, en pocos días la piel podrá verse más luminosa, confortable y saludable.\n\nDurante los próximos 7 a 10 días, continuá con el kit post tratamiento indicado.\n\nMimar T · de Gimena Knack\nFarmacéutica y Dermatocosmiatra`,
  // = msgKitFacial en admin.html
  kit_facial: `CÓMO USAR TU KIT POST TRATAMIENTO\nMimar T · de Gimena Knack\n\nUsalo durante 7 a 10 días. Luego, continuá con una rutina adecuada para mantener los resultados.\n\n1 · LECHE O GEL DE LIMPIEZA\nMañana, tarde y noche.\nAplicar, masajear suavemente y retirar con agua.\n\n2 · TÓNICO CALMANTE\nUsar después de la limpieza.\nPodés aplicarlo varias veces al día, incluso sobre el protector solar, si sentís ardor, picazón o necesidad de calmar la piel.\n\n3 · CREMA / GEL REGENERADORA E HIDRATANTE\nUsar por la noche, después del tónico calmante.\n\n4 · PROTECTOR SOLAR FPS 50\nUsar durante el día.\nReeaplicar cada 3 horas en caso de exposición continua al sol.\n\nIMPORTANTE\nAl finalizar, devolvé los envases y la bolsita y solicitá el tuyo para continuar con la rutina domiciliaria en casa.\n\nLos esterilizamos y reciclamos para cuidar el medio ambiente.\n\nMimar T · de Gimena Knack\nFarmacéutica y Dermatocosmiatra`,
  // = msgMesoFacial en admin.html
  mesoterapia: `🌸 Mimar T\n\nUn mimo para tu piel, un momento para vos. 💗\n\nRecomendaciones y cuidados postratamiento facial con mesoterapia personalizada\n\nGracias por elegirnos, por confiar en nuestro trabajo y, sobre todo, por decidir dedicarte un momento para vos. 💕\n\nNos encanta acompañarte en este camino de cuidado y bienestar, brindándote una atención cálida, profesional y personalizada.\n\nEl tratamiento de limpieza, hidratación y mesoterapia facial personalizada está pensado especialmente para las necesidades de tu piel y se realiza en equipo, con Gimena Knack, farmacéutica y dermatocosmiatra, y la Dra. Cecilia Rodríguez, cirujana plástica.\n\nAhora comienza una etapa igual de importante: los cuidados en casa.\n\nPreparamos este kit con mucho cariño para acompañar la recuperación de tu piel y ayudarte a mantener los beneficios del tratamiento.\n\n🌿 Cómo usar tu kit postratamiento\n\nComo este kit es un obsequio de nuestro Espacio y está pensado para que tu tratamiento sea lo más efectivo posible, evitá utilizar otro tipo de productos durante los próximos 7 a 10 días.\n\nUtilizalo durante los próximos 7 a 10 días, siguiendo estos sencillos pasos.\n\n1. Leche o gel de limpieza\n\nMañana, tarde y noche.\n\nAplicá suavemente sobre el rostro, masajeá sin frotar y retirá con agua.\n\n2. Tónico calmante\n\nDespués de cada limpieza.\n\nAyuda a refrescar y calmar la piel.\n\nPodés aplicarlo varias veces al día, incluso sobre el protector solar, si sentís sensibilidad, picazón o necesidad de alivio.\n\n3. Crema o gel regenerador e hidratante\n\nPor la noche, después del tónico.\n\nAplicá una capa fina con movimientos suaves para mantener tu piel hidratada y acompañar su recuperación.\n\n4. Protector solar FPS 50 ☀️\n\nTodas las mañanas, como último paso.\n\nAdquirí el protector solar en un lugar seguro y habilitado, como una farmacia.\n\nReaplicalo cada 3 horas si estás expuesta continuamente al sol.\n\nLa protección solar es fundamental para cuidar tu piel después del tratamiento.\n\n💗 Cuidados importantes\n\nDurante los primeros días:\n\n- Evitá exponerte directamente al sol y al calor intenso.\n- No utilices exfoliantes, ácidos, retinol ni productos irritantes.\n- Evitá frotar o manipular la piel.\n- No realices otros tratamientos faciales sin consultarnos.\n- Seguí las indicaciones médicas específicas después de la mesoterapia personalizada.\n\nEs posible que sientas algo de sensibilidad o presentes un leve enrojecimiento transitorio. Si aparece dolor intenso, inflamación creciente o alguna reacción que te preocupe, comunicate con nosotras.\n\nRecordá que cada piel tiene sus propios tiempos. Tratala con suavidad, paciencia y cariño. 🌷\n\n♻️ Cuidamos tu piel y también nuestro planeta\n\nCuando termines tu kit, te pedimos que nos devuelvas los envases.\n\nLos acondicionamos para su reutilización segura, siempre que el material lo permita, contribuyendo a reducir residuos y cuidar el medio ambiente.\n\nAl finalizar estos primeros días, podés solicitar tu kit de rutina domiciliaria personalizada para continuar cuidando tu piel y mantener los resultados.\n\n💕 Gracias por elegir mimarte\n\nA cada paciente que confía en nuestras manos y en nuestro trabajo, gracias de corazón.\n\nNos llena de alegría acompañarte en la decisión de cuidarte, regalarte tiempo y sentirte bien.\n\nCreemos que el verdadero cuidado va mucho más allá de la estética: es escucharte, valorarte y dedicarte ese ratito que tantas veces dejás para después.\n\nGracias por permitirnos ser parte de ese momento tan especial.\n\nCon cariño de parte del equipo de Espacio Mimart.\n\nPorque cuidarte también es una forma de quererte. 🌸`,
  // = msgPostDepi en admin.html
  depilacion: `Cuidados después de tu sesión de depilación láser\n\nLa piel puede presentar enrojecimiento, calor o leve inflamación alrededor del folículo durante las primeras horas. Es completamente normal y suele resolverse rápido 🤍\n\n🚫 PRIMERAS 24-48 hs — por favor evitá:\n• Gimnasio, running, bicicleta u actividad física intensa\n• Sudoración excesiva\n• Duchas muy calientes, sauna, jacuzzi o pileta\n• Contacto con cloro o fuentes de calor intenso\n\n☀️ SOL: usá protector solar FPS 50+ en todas las zonas expuestas. Sin exposición solar directa.\n\n✋ No frotar, rascar ni exfoliar la zona durante 3 a 5 días.\n\n🚫 Evitá aplicar sobre la zona durante las primeras 48 hs: alcohol, perfume, desodorante irritante, ácidos ni retinoides.\n\nSi sentís calor o inflamación: compresas frías suaves (nunca hielo directo sobre la piel). Si la piel quedó muy sensible, podés aplicar una crema reparadora/calmante durante los primeros 2-3 días.\n\n✂️ ENTRE SESIONES: solo rasuradora cuando sea necesario. Sin cera, pinza ni depiladora eléctrica.\n\n⚠️ Escribinos si notás dolor intenso, ardor que no disminuye, ampollas, inflamación importante o cualquier signo de infección. Ante cualquier reacción, comunicate con nosotros antes de aplicar productos por tu cuenta.\n\nEspacio MimarT 🤍\nUn lugar pensado para vos.`,
  limpieza_peeling: `CUIDADOS DESPUÉS DE TU LIMPIEZA FACIAL, PEELING O DERMAPLANING
Mimar T · de Gimena Knack

Tu piel acaba de recibir un tratamiento que la deja más receptiva y también más sensible. Estos cuidados ayudan a que el resultado dure y la piel se recupere bien.

PRIMERAS 72 HS
• No exfolies ni uses ácidos, retinol o productos con alcohol.
• Evitá maquillarte las primeras 24 hs.
• No toques ni manipules la piel, aunque notes alguna imperfección.
• Evitá calor intenso: sauna, vapor, gimnasio o agua muy caliente en el rostro.

TODOS LOS DÍAS
☀️ Protector solar FPS 50 por la mañana, reaplicándolo cada 3 horas si estás al aire libre.
💧 Hidratación: crema o gel hidratante mañana y noche, y buena ingesta de agua.

TENÉ EN CUENTA
Puede aparecer un leve enrojecimiento, tirantez o descamación fina los primeros días: es parte del proceso. Si notás ardor intenso, inflamación o algo que te preocupe, escribinos antes de aplicar productos por tu cuenta.

Mimar T · de Gimena Knack
Farmacéutica y Dermatocosmiatra`,
  radiofrecuencia: `✨ Cuidados después de tu sesión de radiofrecuencia ✨

Es normal sentir la zona tibia o levemente enrojecida durante algunas horas: es la respuesta del tejido al calor que estimula el colágeno 🔥

Para acompañar el tratamiento te recomendamos:

💧 Tomar abundante agua durante el día
🚫 Evitar calor excesivo (sauna, agua muy caliente, exposición solar intensa) durante 24 hs
☀️ Usar protector solar si la zona tratada fue el rostro
🤍 No frotar ni exfoliar la zona tratada por 48 hs
🥗 Mantener una alimentación equilibrada y actividad física cuando sea posible

⚠️ Importante:
El tensado es progresivo: el colágeno sigue formándose durante las semanas siguientes. Para resultados visibles y sostenidos se necesitan varias sesiones respetando la frecuencia indicada.

📍Espacio MimarT
"Un lugar pensado para vos"`,
  drenaje_masajes: `🌿 Cuidados después de tu sesión de drenaje linfático, masajes o tratamiento detox

Tu cuerpo quedó en pleno proceso de eliminación de líquidos y toxinas. Para aprovecharlo al máximo:

💧 Tomá abundante agua durante el resto del día (al menos 2 litros)
🧂 Reducí la sal y los ultraprocesados en las próximas 24 hs
🍵 Sumá infusiones naturales y frutas o verduras frescas
🚶 Una caminata suave ayuda a sostener el efecto del drenaje
🚫 Evitá el alcohol y las bebidas azucaradas hoy
😴 Descansá bien: el cuerpo también se recupera mientras dormís

Es normal que aumenten las ganas de ir al baño en las horas siguientes: es una señal de que el tratamiento está funcionando 💚

Los mejores resultados llegan con constancia y respetando la frecuencia de sesiones indicada.

Espacio MimarT 🤍
Un lugar pensado para vos.`,
};

// Constante de admin.html de la que se copió cada texto (la usa el test de sincronía).
export const ORIGEN_EN_ADMIN = {
  agua: 'msg1',
  faja: 'msg2',
  mio_up: 'msgMioUp',
  fraxis_facial: 'msgFraxisFacial',
  fraxis_corporal: 'msgFraxisCorp',
  drenapress: 'msgDrenapress',
  vibratoria: 'msgVibratoria',
  criolipolisis: 'msgPostCryo',
  plisagge_vela: 'msgPlisaggeVela',
  facial_antes: 'msgPreFacial',
  facial_despues: 'msgPostFacial',
  kit_facial: 'msgKitFacial',
  mesoterapia: 'msgMesoFacial',
  depilacion: 'msgPostDepi',
};

// categoria: agrupa en el selector y sirve para sugerir según el servicio.
// momento: 'antes' | 'despues' de la sesión.
export const PLANTILLAS_POST_SESION = {
  agua: { titulo: 'Hidratación: tomar agua hoy', icono: '💧', categoria: 'general', momento: 'despues' },
  faja: { titulo: 'Uso de faja', icono: '🩺', categoria: 'corporal', momento: 'despues' },
  mio_up: { titulo: 'MIO UP — después de la sesión', icono: '💪', categoria: 'corporal', momento: 'despues' },
  fraxis_facial: { titulo: 'FRAXIS facial — después de la sesión', icono: '✨', categoria: 'radiofrecuencia', momento: 'despues' },
  fraxis_corporal: { titulo: 'FRAXIS corporal — después de la sesión', icono: '🔥', categoria: 'radiofrecuencia', momento: 'despues' },
  drenapress: { titulo: 'Drenapress / Presoterapia', icono: '🌊', categoria: 'drenaje', momento: 'despues' },
  vibratoria: { titulo: 'Plataforma vibratoria', icono: '📳', categoria: 'corporal', momento: 'despues' },
  criolipolisis: { titulo: 'Criolipólisis — después de la sesión', icono: '❄️', categoria: 'criolipolisis', momento: 'despues' },
  plisagge_vela: { titulo: 'Plisagge Vela — después de la sesión', icono: '🫧', categoria: 'corporal', momento: 'despues' },
  facial_antes: { titulo: 'Tratamiento facial — antes de la sesión', icono: '🌸', categoria: 'facial', momento: 'antes' },
  facial_despues: { titulo: 'Tratamiento facial — después de la sesión', icono: '🌿', categoria: 'facial', momento: 'despues' },
  kit_facial: { titulo: 'Kit facial domiciliario — cómo usarlo', icono: '🧴', categoria: 'kit', momento: 'despues' },
  mesoterapia: { titulo: 'Mesoterapia facial + kit postratamiento', icono: '💗', categoria: 'facial', momento: 'despues' },
  depilacion: { titulo: 'Depilación láser — después de la sesión', icono: '⚡', categoria: 'depilacion', momento: 'despues' },
  limpieza_peeling: { titulo: 'Limpieza profunda / Peeling / Dermaplaning', icono: '🧖', categoria: 'facial', momento: 'despues' },
  radiofrecuencia: { titulo: 'Radiofrecuencia / Tensado — después de la sesión', icono: '🔆', categoria: 'radiofrecuencia', momento: 'despues' },
  drenaje_masajes: { titulo: 'Drenaje linfático / Masajes / Detox', icono: '🌿', categoria: 'drenaje', momento: 'despues' },
};
ORDEN_PLANTILLAS_HIFU.forEach((clave) => {
  const p = PLANTILLAS_HIFU[clave];
  PLANTILLAS_POST_SESION['hifu_' + clave] = {
    titulo: p.titulo, icono: p.icono, categoria: 'hifu', momento: clave.endsWith('_antes') ? 'antes' : 'despues',
  };
});

export const CATEGORIAS = {
  facial: 'Facial', radiofrecuencia: 'Radiofrecuencia / Tensado', hifu: 'HIFU / Lifting sin cirugía',
  criolipolisis: 'Criolipólisis', corporal: 'Corporal / Modelación', drenaje: 'Drenaje / Masajes / Detox',
  kit: 'Kit domiciliario', depilacion: 'Depilación', general: 'General',
};

export function construirRecomendacion(clave, nombrePaciente) {
  if (clave && clave.startsWith('hifu_')) return construirMensajeHifu(clave.slice(5), nombrePaciente);
  const cuerpo = CUERPOS[clave];
  if (cuerpo == null) throw new Error('Plantilla de recomendación desconocida: ' + clave);
  return `${tituloRecomendacion(nombrePaciente)}\n\n${cuerpo}`;
}

// Reglas de sugerencia: el primer patrón que coincide con el nombre del
// servicio define qué plantillas aparecen primero (preseleccionada = la
// primera). Las demás quedan disponibles igual en el selector.
const REGLAS = [
  [/hi-?fu/i, ['hifu_facial_despues', 'hifu_corporal_despues', 'hifu_facial_antes', 'hifu_corporal_antes']],
  [/fraxis/i, ['fraxis_facial', 'fraxis_corporal']],
  [/meso/i, ['mesoterapia', 'kit_facial', 'facial_despues']],
  [/peeling|dermapl|limpieza/i, ['limpieza_peeling', 'kit_facial', 'facial_despues']],
  [/facial|rostro|cutis/i, ['facial_despues', 'limpieza_peeling', 'kit_facial', 'facial_antes']],
  [/crio/i, ['criolipolisis', 'agua', 'faja']],
  [/radiofrec|tensad|\brf\b/i, ['radiofrecuencia', 'fraxis_corporal', 'agua']],
  [/drenapress|presoter/i, ['drenapress', 'agua']],
  [/drenaj|masaj|detox|relax|linf/i, ['drenaje_masajes', 'drenapress', 'agua']],
  [/mio ?up/i, ['mio_up', 'agua']],
  [/plisagge|vela/i, ['plisagge_vela', 'faja', 'agua']],
  [/vibrat/i, ['vibratoria', 'agua']],
  [/depil|l[aá]ser/i, ['depilacion']],
  [/kit/i, ['kit_facial']],
  [/corporal|modelad|reductiv|celulit|adiposid/i, ['agua', 'faja', 'radiofrecuencia', 'drenaje_masajes']],
];

export function sugerirPlantillas(servicio) {
  const s = (servicio || '').toString();
  const sugeridas = [];
  for (const [re, claves] of REGLAS) {
    if (re.test(s)) claves.forEach((c) => { if (!sugeridas.includes(c)) sugeridas.push(c); });
  }
  if (!sugeridas.length) sugeridas.push('agua');
  return sugeridas;
}
