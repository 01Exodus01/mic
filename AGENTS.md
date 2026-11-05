# GDSS r-FAST-CR

Plataforma web de consenso grupal multirronda para cualquier grupo (clase, club,
equipo, empresa). Los datos se usan en un paper: corrección matemática y
reproducibilidad pesan tanto como la seguridad.

## Stack
Next.js App Router, TypeScript estricto (sin `any`), Prisma, PostgreSQL 16,
Tailwind, shadcn/ui (Radix), zod, Docker.

## Reglas generales
- Texto visible en español, directo, sin signos de exclamación.
- Todo identificador técnico en inglés: archivos, rutas, funciones, variables,
  tipos, modelos, tablas, columnas, enums y cabeceras de CSV.
- Roles en código: host y participant. Nunca teacher, student, docente, alumno.
- Secretos solo en `.env`; `.env.example` sin valores reales. Los secretos deben
  tener al menos 32 caracteres y el arranque falla si faltan. Nunca hardcodear
  ni usar valores de reserva. Secretos obligatorios: `NEXTAUTH_SECRET`,
  `PARTICIPANT_SESSION_SECRET` (distinto del anterior) y `WORKER_SECRET`.
  `HOST_INVITE_CODE` habilita el registro de anfitriones; sin él, el registro
  queda cerrado.
- Tras cada cambio: `prisma validate`, `npx tsc --noEmit`, lint, `npx vitest run`
  y `build`.
- Un commit por grupo de cambios, con tests nuevos por cada corrección de lógica
  o seguridad.
- Consultar Context7 para APIs de Next.js, Tailwind y librerías.
- No agregar dependencias sin avisar. Toda dependencia usada debe estar en
  package.json.

## Reglas intocables
- `lib/algorithms` no se modifica sin aprobación explícita, con el test que
  demuestre el error antes y después. Solo se renombran identificadores si se pide.
  Los valores esperados de sus tests no se cambian para "hacerlos pasar".
  Aprobación explícita vigente (enmienda E-5): regla de desempate declarada por
  sala y variante de concordancia (PT-16, PT-17) y limpieza de `kendallTauC.ts`
  (PT-33). Con la regla "ninguna" el resultado debe ser idéntico al actual.
- La BD solo cambia con migraciones de Prisma (nunca SQL manual directo).
  Mostrar el SQL antes de aplicar. Prohibido DROP de tablas con datos.
- Las columnas de los CSV son un contrato con R/Python. Cambiarlas exige
  actualizar `docs/data-dictionary.md` y avisar.
- Las rondas cerradas (informes de ronda) son inmutables.
- Todo cambio en el cálculo (`lib/algorithms`, qué boletas cuentan, desempate,
  variante de concordancia) exige subir `PROCEDURE_VERSION` en
  `lib/round-processor.ts`; cada informe la guarda en `__procedure` (PT-29).

## Reglas de negocio
- Mínimo de participantes: constante única MIN_PARTICIPANTS = 3, no editable ni
  visible como campo. La sala tiene un solo campo "Número de participantes" (3 a 40).
  El servidor ignora cualquier mínimo que llegue del cliente.
- Acuerdo requerido: entero de 1 a 100 (%), convertido siempre a fracción
  dividiendo entre 100.
- Rondas máximas: entero de 1 a 10, sin valor oculto.
- Cohorte configurable por sala (enmienda E-3). Por defecto, cerrada: solo quien
  votó en la ronda 1 participa en las siguientes. Si la sala permite
  participantes tardíos, se puede ingresar o votar por primera vez en cualquier
  ronda abierta y queda registrada la ronda de ingreso. En ambos casos, sin
  arrastre de votos de rondas anteriores.
- Desempate configurable por sala (enmienda E-1). Por defecto, regla "ninguna":
  los empates del orden del grupo se conservan (rangos medios) y la concordancia
  es tau-b. Solo si la sala declara una regla al crearse (lexicográfica por el
  orden de las opciones, o saldo de razones a favor menos en contra; si con el
  saldo sigue el empate, un sorteo con semilla guardada en el informe) se desempata,
  y entonces el orden del grupo es estricto. Nunca se desempata de forma
  arbitraria ni sin dejarlo registrado: el informe de ronda guarda qué grupos
  estaban empatados y qué regla actuó.
- Métrica por variante (enmienda E-2). Variante "con empates" (por defecto):
  tau-b. Variante "sin empates": Kendall estándar, válida solo con una regla de
  desempate distinta de "ninguna"; el informe guarda la variante usada. cix sigue
  siendo (τ+1)/2.
- Consentimiento configurable por sala (enmienda E-4). Si se activa al crear la
  sala, el anfitrión escribe el texto (no hay texto legal por defecto), se
  muestra en el primer ingreso, hay que aceptarlo para votar (lo exige el
  servidor), se guarda la aceptación con hora y versión del texto, y se puede
  volver a leer después. El texto queda fijo al iniciar la sala. Si no se activa,
  el paso no existe.
- La configuración de la sala (desempate, variante, acceso, participantes
  tardíos, consentimiento, cierre anticipado) no cambia una vez iniciada.
- Estado de sala cancelada: CANCELLED, distinto de CONCLUDED. Las actividades
  canceladas se distinguen en los datos y los CSV.
- Participante retirado por el anfitrión: borrado lógico. Sus votos de rondas
  cerradas se conservan; queda excluido de rondas futuras y no puede reingresar
  con ese nombre.

## Seguridad
- Toda entrada se valida en el servidor con un esquema zod compartido con el
  cliente. La UI nunca es la única barrera.
- Sanitizar: recortar, normalizar Unicode, quitar caracteres de control. Nunca
  `dangerouslySetInnerHTML`. La seguridad viene de escapar al renderizar, no de
  bloquear caracteres.
- Razones opcionales (enmienda E-6): por opción, de 0 a 5 a favor y de 0 a 5 en
  contra, cada una de 1 a 200 caracteres sobre el texto recortado, sin mínimo; las
  vacías se descartan. Se guardan y muestran textuales: no se resumen, no se
  deduplican ni se reordenan por similitud. Sigue siendo obligatorio ordenar
  todas las opciones.
- Límites: nombre 3 a 30
  (letras Unicode, números, espacios y - _ . '); título de sala 5 a 100; título
  de opción 3 a 80; descripción de opción 10 a 300 (opcional); PIN de sala
  6 alfanuméricos; PIN personal 4 dígitos; contraseña de registro 8 a 72 bytes;
  opciones 3 a 8, sin títulos duplicados.
- Autorización en cada Server Action y ruta API: el anfitrión solo accede a sus
  salas (filtro por host_id en la consulta); el participante solo a su sala y sus
  votos.
- Sesiones separadas por rol: sesión de anfitrión (NextAuth) y de participante
  (cookie HttpOnly, SameSite=Strict, Secure en producción), firmadas con secretos
  distintos. Cada rol tiene su
  propio "Salir", y la interfaz muestra siempre "Conectado como anfitrión" o
  "Conectado como participante". Una sesión nunca da acceso al otro rol.
- Rate limiting en ingreso de participante, PIN personal, consulta de PIN de sala
  y login. La IP del cliente solo se toma de cabeceras de proxy con
  TRUSTED_PROXY_HOPS explícito.
- Mensajes que no revelan información: "No se puede ingresar a esa sala. Revisa
  el PIN." No distinguir sala inexistente de sala cerrada antes de autenticar.
- Anonimato: el anfitrión nunca ve qué persona escribió qué razón. Sin mostrar
  el código ciego junto al nombre, sin horas de ingreso y con códigos ciegos
  asignados al azar. El código ciego solo aparece en los CSV.
- En salas con lista (enmienda E-7), la etiqueta del estudiante y el código
  personal identifican personas: la etiqueta solo vive en la lista de la sala,
  nunca en votos, CSV ni logs; el código se guarda solo como hash. El anfitrión
  ve quién ingresó y quién votó en cada ronda, nunca el contenido de un voto.
- CSV: prevenir inyección de fórmulas (celdas que empiezan con = + - @ tras
  recortar espacios) y anteponer BOM UTF-8.
- Cabeceras de seguridad HTTP configuradas sin romper Next.js.
- Los PIN y contraseñas nunca van a logs, toasts ni mensajes de error.

## Tiempo y sincronización
- El servidor es la fuente de verdad del tiempo. El cliente recibe la hora límite
  y la hora del servidor, corrige el desfase y cuenta hacia atrás; nunca confía en
  el reloj del dispositivo.
- Cronómetro visible de cuenta regresiva para anfitrión y participantes. Al llegar
  a cero se bloquea el envío y se muestra "Votación cerrada".
- Duración al abrir ronda y al extender: presets (5, 15, 30 minutos, 1 hora,
  24 horas, 3 días, 1 semana, 2 semanas) más valor personalizado en minutos,
  horas, días o semanas, con rango validado (1 minuto a 30 días, 43200 minutos).
  Se muestra la nueva hora límite antes de confirmar.
- Extender la hora límite NO es una transición de estado: con la sala en
  ROUND_OPEN solo se actualiza el plazo.
- Las pantallas abiertas se actualizan solas ante cambios del anfitrión (plazo,
  cierre, cancelación, expulsión, reinicio de PIN) y ante nuevos votos, sin
  recargar. Debe recuperarse al volver la conexión o reactivarse la pestaña.
- Cierre de ronda atómico: un solo cierre por ronda aunque coincidan el cierre
  perezoso, el worker y el cierre manual. Ningún voto queda fuera del informe
  de su ronda.
- Ante estados obsoletos, mensajes claros ("La votación ya se cerró"), nunca
  errores técnicos.

## DISEÑO (prioridad sobre cualquier "estilo Kahoot" o "estilo Linear/Vercel" del spec)

### Dirección visual
Instrumento claro y sobrio, no "SaaS startup". Propósito general.
Anfitrión = panel de datos sobrio. Participante = móvil primero, una acción por
pantalla. Modo claro únicamente; prohibido modo oscuro en v1.

### Tokens (definidos en globals.css / tailwind config)
- Fondo #F6F4EF | Texto #14171A | Borde #D9D5CC | Texto secundario #6B6860
- UN solo acento: #E4572E
- Estados: ok #2F7D4F, alerta #B7791F, error #B42318
- Fuentes: Fraunces (títulos), IBM Plex Sans (UI), IBM Plex Mono (PIN, porcentajes,
  rangos, tablas, cronómetro)
- Espaciado 4/8/12/16/24/40/64. Radio máx 6px (999px solo chips)
- Sombras: ninguna, salvo el elemento que se arrastra
- Las opciones se distinguen por número y título, NUNCA por color

### Prohibido
- Gradientes, glassmorphism, blur, glow, modo oscuro
- Paletas multicolor y colores fuera de los tokens
- Emojis como íconos o en títulos; íconos solo lucide, trazo 1.5
- Inter/Roboto/Space Grotesk/Geist por defecto
- Hero centrado con badge, grids de 3 tarjetas idénticas con ícono
- Sombra + borde + radio grande en todas las tarjetas
- Animaciones decorativas, hover que escala, indicadores pulsantes
- Microcopy cursi o de relleno ("¡Voto guardado!", "Potencia tu experiencia")

### Formularios
- Validación en vivo con un solo esquema zod compartido: campo intacto sin error;
  tras salir del campo muestra el error; después valida en cada tecla; al enviar
  marca todos los campos inválidos y lleva el foco al primero.
- Error en texto plano bajo cada campo, con aria-invalid, aria-describedby y
  role="alert". Errores del servidor junto al campo correspondiente.
- Contadores en vivo ("120/200") con maxLength. Nunca se borra lo escrito si el
  envío falla.
- Sin valores ocultos: si el usuario borra un campo, queda vacío y se marca
  "Campo obligatorio"; no se restaura solo.
- Campos secretos con PasswordInput: botón ver/ocultar dentro del campo (Eye /
  EyeOff, aria-pressed, área táctil de 44px), se oculta al enviar y al perder el
  foco de la pantalla. Autocomplete correcto por campo.
- Botón de envío deshabilitado solo si muestra el motivo al lado.

### Participante (375px primero)
- Ingreso: un campo grande por paso. Sala abierta: PIN de sala, nombre, PIN
  personal. Sala con lista (enmienda E-7): PIN de sala y código personal. PIN en
  Plex Mono, inputs de 56px. Cada paso con botón "Atrás" (conserva los valores)
  y "Cambiar sala".
- Ranking: lista vertical con handle de arrastre y número grande (1 a n) a la
  izquierda; alternativa con botones subir/bajar de 44px mínimo.
- Razones (enmienda E-6): bajo cada opción, dos listas "A favor" y "En contra"
  con botones para agregar y quitar, contador de 200 por razón y tope de 5 por
  lado. Enviar depende solo de haber ordenado todas las opciones.
- Botón "Enviar voto" fijo abajo, con motivo visible si está deshabilitado.
- Voto enviado: estado distinguible con mensaje persistente, resumen en solo
  lectura (orden y razones) y botón "Editar voto" que vuelve a habilitar lo ya
  escrito. Nunca se borra lo escrito. Pasada la hora límite, sin edición.
- Botón "Salir" visible que cierra solo la sesión de participante.
- Espera o votación cerrada: texto plano con la hora límite, sin spinner infinito.

### Anfitrión (escritorio)
- Sidebar fija angosta + contenido max-width 1100px alineado a la izquierda.
- Migas de pan y "Volver a salas" en pantallas secundarias.
- Estado de la sala siempre visible como etiqueta de texto, con cronómetro.
- Una sola acción principal por estado; las secundarias en texto plano.
- "Faltan votos": bloque de alerta con "Extender hora límite" y "Cancelar
  actividad", sin modal decorativo.
- Participantes: tabla con nombre y si votó. Acciones por fila: "Restablecer PIN"
  y "Expulsar de la sala", ambas con diálogo accesible de confirmación.
- Participación por ronda: tabla de personas contra rondas con solo estados
  (no había ingresado, ingresó, votó, no votó, retirado, quitada). Nunca votos,
  razones ni códigos ciegos.
- Salas con lista: gestión de la lista (agregar, pegar, subir CSV, quitar,
  regenerar código); los códigos se muestran una sola vez.
- Diálogos con Radix/shadcn (role="dialog", foco atrapado, cierre con Escape).
- Resultados: tabla densa + barra simple de nivel de acuerdo contra el requerido.
  Rangos con un decimal. Gráficos de una sola serie, sin 3D ni donut.
- Exportaciones: botones planos (matrix_long.csv, matrix_wide_metrics.csv,
  razones.csv, eventos.csv). Las columnas nuevas van al final, sin renombrar ni
  reordenar las existentes.

### Navegación y estados
- Ninguna pantalla depende del botón de retroceso del navegador: botón "Volver"
  con destino explícito en cada pantalla secundaria.
- 404 y errores con botón claro para volver al inicio. Estados vacío, carga
  (skeleton, no spinner centrado) y error en cada pantalla.
- Confirmación solo antes de acciones destructivas (cancelar, expulsar).
- Accesibilidad: foco visible, contraste mínimo AA, etiquetas en todos los
  campos, navegación por teclado.

## LENGUAJE DE LA INTERFAZ (propósito general)
- Roles en la UI: "Anfitrión" y "Participante". Nunca "docente", "estudiante",
  "alumno", "profesor" ni "aula".
- Prohibidos fuera de "Detalle técnico": quórum, cohorte, deadline, m_efectivo,
  τ*, mid-rank, Zero-PII, beatpath, weak order, Tau-c.
- Glosario:

| Interno | Texto en pantalla |
|---|---|
| DRAFT | Borrador |
| ROUND_OPEN | Votación abierta |
| INSUFFICIENT_VOTES | Faltan votos |
| PROCESSING | Calculando resultados |
| ROUND_FEEDBACK | Revisión de argumentos |
| CONCLUDED | Finalizada |
| CANCELLED | Cancelada |
| option | Opción |
| deadline | Hora límite |
| effective voters | Votos recibidos |
| max participants | Número de participantes |
| tau* | Nivel de acuerdo (en %) |
| tau threshold | Acuerdo requerido (en %) |
| max rounds | Máximo de rondas |
| justification | Razón |
| collective ranking | Orden del grupo |
| tie (weak order) | Empatadas (ej. "1.º y 2.º empatadas") |
| blind code | Participante 04 (solo donde sea anónimo para el grupo) |
| Borda / Schulze / Kemeny | Nombre + una línea, ej. "Borda: suma puntos según la posición" |

- "Faltan votos": "Votaron X de Y participantes. Se necesitan al menos 3 para
  calcular el resultado."
- Frases cortas, sin jerga, sin signos de exclamación.
- Los términos técnicos (nivel exacto, votos recibidos, rangos medios) pueden
  aparecer solo dentro de la sección plegable "Detalle técnico" del anfitrión.

## Rutas
- Acceso: `/`, `/auth/login`, `/auth/register`, `/auth/error`.
- Anfitrión: `/dashboard`, `/dashboard/rooms/new`, `/dashboard/rooms/[id]`.
- Participante: `/join`, `/room/[pin]`, `/participant/vote`, `/participant/feedback`.
- No hay rutas heredadas (`/student`, `/sala`). No crear nuevas con nombres en español.

## Proceso
1. Una pantalla o módulo a la vez; screenshot con Playwright a 375px y 1280px
   antes de seguir.
2. Cada pantalla que se toca aplica diseño, glosario, validación y navegación a la vez.
3. Usar shadcn/ui ajustado a los tokens; no inventar componentes.
4. Cambios de comportamiento en el estado de la sala, el cierre de rondas o el
   tiempo se prueban con dos contextos de navegador (anfitrión y participante).
5. Detenerse y esperar aprobación al terminar cada paso.
6. Si algo del spec contradice este archivo, manda este archivo; avisar de la
   contradicción.

## Enmiendas

La especificación en PDF (`Especificación Técnica_ Plataforma GDSS r-FAST-CR.pdf`)
queda desactualizada en los puntos que cubren estas enmiendas; manda este archivo.

| ID | Fecha | Regla | Motivo |
|---|---|---|---|
| E-1 | 2026-11-04 | Desempate configurable por sala, registrado en el informe | La metodología r-FAST-CR permite una regla de desempate declarada; decisión aprobada por Jorge (D-1) |
| E-2 | 2026-11-04 | Métrica según variante: tau-b con empates, Kendall estándar sin empates | Ofrecer la variante "sin empates" de la metodología; aprobada por Jorge (D-2) |
| E-3 | 2026-11-04 | Cohorte configurable; por defecto cerrada | Permitir participantes tardíos cuando la sala lo declare |
| E-4 | 2026-11-04 | Consentimiento configurable, texto del anfitrión | La tutora pidió una declaratoria de consentimiento; el texto lo redacta el equipo |
| E-5 | 2026-11-04 | Aprobación explícita para cambiar `lib/algorithms` en PT-16, PT-17 y PT-33 | Necesaria para E-1 y E-2 |
| E-6 | 2026-11-04 | Razones opcionales, a favor y en contra, 0 a 5 por lado, 1 a 200 caracteres, textuales | La metodología pide razones a favor y en contra sin mínimo |
| E-7 | 2026-11-04 | Acceso con lista del curso y código personal, además del modo abierto con PIN | Evitar que cualquiera con el PIN de sala ingrese |
| E-8 | 2026-11-04 | Plazo máximo de ronda: 30 días | Actividades de curso de varias semanas (PT-28) |
| E-9 | 2026-11-04 | Expulsar conserva los votos y los excluye del cálculo | No perder datos (PT-11) |
| E-10 | 2026-11-04 | Cierre anticipado opcional cuando votan todos | Configurable por sala (PT-27) |

### Especificación en PDF superada

Además de las enmiendas, la especificación queda superada en: razones (ahora a
favor y en contra, opcionales), desempate y variante de concordancia, acceso con
lista y código, participantes tardíos, consentimiento, cierre anticipado,
plazos de hasta 30 días, expulsión sin borrado, bitácora de sala, historial de
votos y los CSV adicionales (`docs/data-dictionary.md`). Ante una diferencia,
mandan este archivo y el diccionario de datos.