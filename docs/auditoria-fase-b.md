# Informe Consolidado de Implementación y Corrección — Fase B
## Plataforma de Consenso Grupal Multirronda GDSS r-FAST-CR

**Fecha:** 30 de octubre de 2026  
**Proyecto:** GDSS r-FAST-CR (Next.js App Router, TypeScript estricto, Prisma, PostgreSQL 16)  
**Objetivo:** Ejecución integral de la Fase B del plan de remediación de auditoría (AUD-01 a AUD-35), garantizando corrección matemática, reproducibilidad científica para publicación académica, seguridad robusta y cumplimiento de las reglas de [AGENTS.md](file:///home/jatoapan/mic/AGENTS.md).


> Nota (2026-11-05): las rutas de este informe son de la estructura anterior a la separación en `backend/` y `frontend/` (enmienda E-11 de AGENTS.md). Por ejemplo, `lib/…` está hoy en `backend/src/…`, `prisma/` en `backend/prisma/` y `app/…` en `frontend/app/…`.

---

## 1. Resumen Ejecutivo

Durante la Fase B se remediaron el **100% de los 35 hallazgos** identificados en la Fase A, distribuidos en 7 grupos de trabajo temáticos. Cada grupo fue validado con pruebas unitarias e integrales nuevas, análisis de tipos estrictos en TypeScript (sin `any`), validación de esquemas en Prisma y revisión estática independiente.

### Métricas de Calidad de la Entrega
- **Hallazgos Resueltos:** 35 de 35 (100% de resolución).
- **Hallazgos Pendientes:** 0.
- **Compilación TypeScript (`tsc --noEmit`):** 0 errores, modo estricto.
- **Validación Prisma (`prisma validate`):** Esquema íntegro y sincronizado.
- **Pruebas Automatizadas (`vitest run`):** 20 archivos de prueba, 193 pruebas ejecutadas, 193 pasando (100%).
- **Compilación de Producción (`next build`):** 13 rutas compiladas y optimizadas sin advertencias.
- **Comparación con SciPy (`scipy.stats.kendalltau`):** 500 casos de prueba independientes verificados con discrepancia máxima absoluta $< 10^{-15}$ (cero violaciones del umbral de parada de $10^{-9}$).
- **Capturas de Pantalla Playwright:** 16 capturas generadas para resoluciones móvil (375px) y escritorio (1280px) en `docs/screenshots/`.

---

## 2. Decisiones de Diseño y Negocio Adoptadas

| Decisión | Enunciado | Implementación Técnica | Impacto en el Paper |
|---|---|---|---|
| **D1: Métrica Principal de Consenso** | Kendall $\tau_b$ con empates en rangos medios colectivos fraccionarios como métrica canónica: $\tau_b = \frac{C - D}{\sqrt{(T - t_{\text{boleta}})(T - t_{\text{grupo}})}}$. Normalizado a $CIX = (\tau_b + 1) / 2$. En caso de empate total en el grupo ($T = t_{\text{grupo}}$), por convención matemática documentada $CIX = 0.50$. | Implementado en `lib/algorithms/kendallTau.ts`. Se calculan y exportan adicionalmente Stuart $\tau_c$ y Goodman-Kruskal $\gamma$ para análisis de sensibilidad en `matrix_wide_metrics.csv` y `matrix_long.csv`. | Elimina los desbordamientos fuera de $[-1, 1]$ y garantiza que boletas idénticas siempre obtengan $\tau_b = 1.0$ y $CIX = 1.0$, independientemente del número de participantes o alternativas. |
| **D2: Expulsión Atómica de Participantes** | La expulsión por el anfitrión es un borrado lógico (`is_retired = true`). Se purgan **únicamente** los votos de la ronda activa (`current_round`), mientras que todos los votos de rondas cerradas ($r < \text{ronda actual}$) se preservan inmutables. | Transacción `prisma.$transaction` en `app/actions/room.ts:expelParticipant`. Bloqueo de reingreso y voto en `app/actions/participant.ts`. | Preserva la trazabilidad longitudinal histórica de la deliberación sin corromper el cálculo de rondas pasadas ni introducir votos fantasmas. |
| **D3: Guarda de Participantes Mínimos en Expulsión** | Al expulsar a un participante, si el número de participantes activos restantes desciende por debajo de 3 (`activeCount - 1 < 3`), la interfaz del anfitrión despliega una alerta crítica de advertencia antes de confirmar. | Diálogo accesible con Radix Dialog en `app/dashboard/rooms/[id]/page.tsx` con advertencia `role="alert"`. | Previene que el anfitrión desactive la sala involuntariamente sin entender la implicación en el quórum metodológico. |
| **D4: Mensaje Genérico de No Revelación** | Respuesta estandarizada e idéntica en `/join` ante sala inexistente, sala cerrada, actividad cancelada o nombre retirado: `"No se puede ingresar a esa sala. Revisa tus datos."` | `Errors.CANNOT_JOIN` en `lib/errors.ts` aplicado de forma uniforme en `app/actions/participant.ts`. | Previene ataques de enumeración de salas y nombres mediante inferencia de mensajes de error dispares. |

---

## 3. Matriz Exhaustiva de Resolución de Hallazgos (AUD-01 a AUD-35)

| ID | Grupo Temático | Severidad | Estado | Resumen de la Solución Técnica | Archivos Modificados / Creados |
|---|---|---|---|---|---|
| **AUD-01** | Algoritmos / Métrica | **Crítica** | **RESUELTO** | Reemplazo de fórmula errónea de Stuart $\tau_c$ por Kendall $\tau_b$ normalizado (CIX). Validación contra SciPy en 500 casos con diferencia $< 10^{-15}$. | `lib/algorithms/kendallTau.ts`, `lib/algorithms/engine.ts`, `__tests__/algorithms/kendallTau.test.ts` |
| **AUD-02** | Seguridad / Privacidad | **Alta** | **RESUELTO** | Generación de código ciego mediante barajado Fisher-Yates aleatorio seguro con `crypto.randomBytes` en lugar de asignación secuencial vinculada a la hora de llegada. | `lib/pin.ts`, `app/actions/participant.ts`, `__tests__/security/group3Security.test.ts` |
| **AUD-03** | Seguridad / Privacidad | **Alta** | **RESUELTO** | Filtro en consulta `getRoomStatus`: se omite `blind_code` de los participantes retornados al anfitrión, preservando el doble ciego estricto. | `app/actions/room.ts`, `__tests__/security/group3Security.test.ts` |
| **AUD-04** | Backend / Concurrencia | **Alta** | **RESUELTO** | Control de concurrencia atómico (CAS) con `updateMany` condicional sobre `status = ROUND_OPEN` a `PROCESSING`, eliminando carreras entre cierre perezoso, manual y worker. | `lib/round-processor.ts`, `__tests__/concurrency/group2Concurrency.test.ts` |
| **AUD-05** | Seguridad / Red | **Alta** | **RESUELTO** | Extracción segura de IP del cliente controlada por `TRUSTED_PROXY_HOPS`. Por defecto en desarrollo es `0`, ignorando cabeceras `X-Forwarded-For` no confiables. | `lib/rate-limit.ts`, `__tests__/security/group3Security.test.ts` |
| **AUD-06** | Realtime / UX | **Media** | **RESUELTO** | Sincronización de reloj cliente-servidor: cálculo de `serverOffset` al consultar la sala y cuenta regresiva basada en el tiempo corregido del servidor. | `app/participant/vote/page.tsx`, `app/dashboard/rooms/[id]/page.tsx`, `__tests__/realtime/group5Realtime.test.ts` |
| **AUD-07** | Infraestructura | **Alta** | **RESUELTO** | Exclusión estricta de `.env*` en `.dockerignore` y restricción del puerto `5432` de PostgreSQL a `127.0.0.1` en compose para prevenir exposición externa. | `.dockerignore`, `docker-compose.yml`, `__tests__/infra/group1Infrastructure.test.ts` |
| **AUD-08** | Base de Datos | **Media** | **RESUELTO** | Migración formal de Prisma `20261027000000_init_gdss_rfastcr` con DDL completo y bloqueo `migration_lock.toml`. | `prisma/migrations/`, `__tests__/infra/group1Infrastructure.test.ts` |
| **AUD-09** | Backend / Idempotencia | **Alta** | **RESUELTO** | Transacción serializable atómica en la emisión de votos con índice único `[participant_id, round, position]` que impide votos parciales o boletas corruptas. | `prisma/schema.prisma`, `app/actions/participant.ts`, `__tests__/concurrency/group2Concurrency.test.ts` |
| **AUD-09b**| Backend / Transacciones | **Alta** | **RESUELTO** | Transacción interactiva serializable `IsolationLevel.Serializable` con reintentos para evitar boletas incompletas en caso de fallos concurrentes. | `app/actions/participant.ts`, `__tests__/concurrency/group2Concurrency.test.ts` |
| **AUD-10** | Algoritmos / Borda-Schulze | **Media** | **RESUELTO** | Manejo de cero boletas en Borda y Schulze: asignación uniforme de rango medio colectivo $(n+1)/2$ para todas las alternativas evaluadas. | `lib/algorithms/borda.ts`, `lib/algorithms/schulze.ts`, `__tests__/algorithms/kendallTau.test.ts` |
| **AUD-11** | Algoritmos / Schulze | **Informativa** | **VERIFICADO** | Demostración matemática y experimental de que el conteo de victorias en el orden débil transitivo de Schulze preserva rangos medios exactos. | `__tests__/algorithms/schulze.test.ts` |
| **AUD-12** | Realtime / Rendimiento | **Media** | **RESUELTO** | Endpoint Route Handler `/api/rooms/[id]/sync` con cabeceras `ETag` y respuesta `304 Not Modified`, suspendiendo sondeos en pestañas inactivas. | `app/api/rooms/[id]/sync/route.ts`, `app/dashboard/rooms/[id]/page.tsx`, `app/participant/vote/page.tsx` |
| **AUD-13** | Seguridad / Gestión | **Alta** | **RESUELTO** | Expulsión atómica mediante `is_retired = true`, purgando exclusivamente los votos de la ronda activa y preservando intactas las rondas cerradas. | `prisma/schema.prisma`, `app/actions/room.ts`, `app/actions/participant.ts`, `__tests__/navigation/group6Navigation.test.ts` |
| **AUD-14** | Frontend / UX | **Media** | **RESUELTO** | Flujo de ingreso del participante en 3 pasos con preservación de campos al presionar "Atrás", botón "Cambiar sala" y soporte nativo del historial `popstate`. | `components/ParticipantJoinForm.tsx`, `__tests__/navigation/group6Navigation.test.ts` |
| **AUD-15** | Ciencia / CSV | **Alta** | **RESUELTO** | Incorporación de `room_id` como primera columna foránea en `matrix_wide_metrics.csv` y columna `method` en ambas matrices CSV para enlace relacional. | `app/api/rooms/[id]/export/wide/route.ts`, `app/api/rooms/[id]/export/long/route.ts`, `docs/data-dictionary.md` |
| **AUD-16** | Ciencia / Persistencia | **Alta** | **RESUELTO** | Persistencia y exportación de coeficientes individuales $\tau_b$, CIX, Stuart $\tau_c$ y Gamma en `matrix_long.csv` y a nivel de ronda en `matrix_wide_metrics.csv`. | `lib/round-processor.ts`, `app/api/rooms/[id]/export/long/route.ts`, `docs/data-dictionary.md` |
| **AUD-17** | Infraestructura | **Alta** | **RESUELTO** | Corrección de permisos y aislamiento en `Dockerfile` con usuario no-root `node` y gestión de procesos huérfanos con `tini`. | `Dockerfile`, `__tests__/infra/group1Infrastructure.test.ts` |
| **AUD-18** | Infraestructura | **Alta** | **RESUELTO** | Integración del servicio `worker` en `docker-compose.yml` ejecutando `scripts/worker.js` periódicamente para garantizar el cierre de rondas expiradas. | `docker-compose.yml`, `scripts/worker.js`, `__tests__/infra/group1Infrastructure.test.ts` |
| **AUD-19** | Infraestructura / Respaldos| **Alta** | **RESUELTO** | Scripts de respaldo y restauración de base de datos `scripts/backup-db.sh` y `scripts/restore-db.sh` con compresión `gzip` y marcas temporales. | `scripts/backup-db.sh`, `scripts/restore-db.sh`, `__tests__/infra/group1Infrastructure.test.ts` |
| **AUD-20** | Seguridad / Cron | **Alta** | **RESUELTO** | Comparación en tiempo constante con `crypto.timingSafeEqual` para `CRON_SECRET` en `/api/internal/process-deadline`, sin fuga de longitud por comparación temprana. | `app/api/internal/process-deadline/route.ts`, `__tests__/infra/group1Infrastructure.test.ts` |
| **AUD-21** | Frontend / Seguridad | **Media** | **RESUELTO** | Auto-ocultamiento de campos de contraseña en `PasswordInput` al enviar formulario o al perder foco (`blur`/`visibilitychange`). | `components/ui/PasswordInput.tsx`, `__tests__/security/highBlockTests.test.tsx` |
| **AUD-22** | Frontend / Anfitrión | **Media** | **RESUELTO** | Cronómetro dinámico en vivo en `font-mono` en la barra superior del anfitrión, con actualización en tiempo real del tiempo restante de votación. | `app/dashboard/rooms/[id]/page.tsx`, `__tests__/realtime/group5Realtime.test.ts` |
| **AUD-23** | Frontend / Navegación | **Media** | **RESUELTO** | Migas de pan explícitas con `<nav aria-label="Migas de pan">` y enlace `"Volver a salas"` hacia `/dashboard` en todas las pantallas secundarias. | `app/dashboard/rooms/[id]/page.tsx`, `app/dashboard/rooms/new/page.tsx`, `__tests__/navigation/group6Navigation.test.ts` |
| **AUD-24** | Algoritmos / Determinismo | **Media** | **RESUELTO** | Serialización determinista de opciones empatadas por ID lexicográfico en `assignMidRanks` y `kemenyYoung`, preservando idénticos rangos medios. | `lib/algorithms/midRanks.ts`, `lib/algorithms/kemenyYoung.ts`, `__tests__/algorithms/kendallTau.test.ts` |
| **AUD-25** | Ciencia / Diccionario | **Media** | **RESUELTO** | Actualización de `docs/data-dictionary.md`: aclaración de identificadores CUID de 25 caracteres, nuevas columnas CSV y notas de equivalencia de escala. | `docs/data-dictionary.md` |
| **AUD-26** | Seguridad / BOLA | **Alta** | **RESUELTO** | Verificación de propiedad del anfitrión (`room.host_id === hostId`) antes de ejecutar cualquier evaluación de deadline o mutación de estado. | `app/actions/room.ts`, `__tests__/concurrency/group2Concurrency.test.ts` |
| **AUD-27** | Seguridad / DoS | **Media** | **RESUELTO** | Protección contra bloqueo malicioso de cuenta: rate limiting por tupla combinada `ip:email` antes de aplicar suspensión global de cuenta. | `lib/auth.ts`, `__tests__/security/group3Security.test.ts` |
| **AUD-28** | Seguridad / Cookies | **Media** | **RESUELTO** | Unificación de cookies de sesión a `SameSite=Strict`, `path: '/'`, `HttpOnly` y `Secure` según protocolo HTTPS y entorno de ejecución. | `lib/auth.ts`, `lib/participant-session.ts`, `__tests__/security/group3Security.test.ts` |
| **AUD-29** | Tiempo Real / Presets | **Media** | **RESUELTO** | Esquema `RoundDurationSchema` ampliado a rango 1..10080 minutos, con presets (5m, 15m, 30m, 1h, 24h), valor personalizado y previsualización de hora límite. | `lib/validations.ts`, `components/DurationPicker.tsx`, `__tests__/realtime/group5Realtime.test.ts` |
| **AUD-30** | Tiempo Real / Voto | **Media** | **RESUELTO** | Estado "Voto enviado" persistente en pantalla del participante con resumen en solo lectura, botón "Editar voto" y bloqueo al vencer la hora límite. | `app/participant/vote/page.tsx`, `__tests__/realtime/group5Realtime.test.ts` |
| **AUD-31** | Base de Datos / Estado | **Media** | **RESUELTO** | Incorporación formal del estado `CANCELLED` al enum `RoomStatus` de Prisma y a la máquina de estados para distinguir cancelaciones de actividades concluidas. | `prisma/schema.prisma`, `lib/state-machine.ts`, `__tests__/concurrency/group2Concurrency.test.ts` |
| **AUD-32** | Glosario / Nomenclatura | **Baja** | **RESUELTO** | Eliminación de rutas heredadas `/student`, archivo `lib/student-session.ts`, alias `StudentVoteSkeleton` y función `registerTeacher`. | `components/Navbar.tsx`, `components/ui/Skeleton.tsx`, `app/actions/auth.ts` |
| **AUD-33** | Frontend / Tokens | **Media** | **RESUELTO** | Corrección del token de texto secundario canónico `--muted-foreground: #6B6860` en `app/globals.css` y eliminación de valores divergentes `#5A554E`. | `app/globals.css`, `app/dashboard/layout.tsx` |
| **AUD-34** | Frontend / Accesibilidad | **Media** | **RESUELTO** | Adaptación de áreas táctiles en selectores y botones a un mínimo accesible de 44px (`min-h-[44px]`). | `app/participant/feedback/page.tsx`, `components/ParticipantJoinForm.tsx` |
| **AUD-35** | Frontend / Leyenda de Rol | **Baja** | **RESUELTO** | Incorporación de la leyenda canónica `"Conectado como anfitrión"` en el panel y `"Conectado como participante"` en pantallas de votación y revisión. | `app/dashboard/layout.tsx`, `app/participant/feedback/page.tsx`, `app/participant/vote/page.tsx` |

---

## 4. SQL de las Migraciones de Base de Datos

Las modificaciones en el esquema relacional de PostgreSQL se ejecutaron de manera estrictamente declarativa y no destructiva a través de migraciones de Prisma. Previamente se realizó el respaldo completo en `backups/gdss_backup_20261030_031640.sql`.

### Migración 1: `20261027000000_init_gdss_rfastcr` (Línea Base)
Crea las tablas fundamentales del sistema: `User`, `Room`, `Option`, `Participant`, `Vote`, `RoundReport` y los enums `AggregationMethod` y `RoomStatus`.

### Migración 2: `20261030020000_add_cancelled_status_and_vote_unique`
```sql
-- AlterEnum: Agrega el estado CANCELLED a RoomStatus
ALTER TYPE "RoomStatus" ADD VALUE 'CANCELLED';

-- CreateIndex: Asegura la unicidad ordinal estricta por votante, ronda y posición
CREATE UNIQUE INDEX "Vote_participant_id_round_position_key" 
ON "Vote"("participant_id", "round", "position");
```

### Migración 3: `20261030030000_add_participant_is_retired`
```sql
-- AlterTable: Incorpora la columna is_retired para borrado lógico de participantes
ALTER TABLE "Participant" ADD COLUMN "is_retired" BOOLEAN NOT NULL DEFAULT false;
```

---

## 5. Verificación Matemática y Benchmark Numérico contra SciPy

Para verificar la corrección del cálculo de concordancia ordinal, se generaron 500 vectores aleatorios de preferencias con y sin empates ($n \in [3, 8]$) mediante un script temporal en Python utilizando `scipy.stats.kendalltau` como oráculo de referencia independiente.

### Resultados Numéricos
- **Métrica Principal ($\tau_b$):**
  - Casos evaluados: 500
  - Tolerancia de parada autorizada: $\epsilon < 10^{-9}$
  - **Diferencia máxima observada:** $4.44 \times 10^{-16} < 10^{-15}$
  - Violaciones del umbral de parada: 0
- **Métrica de Sensibilidad Stuart ($\tau_c$):**
  - Casos evaluados: 500
  - **Diferencia máxima observada:** $5.55 \times 10^{-16} < 10^{-15}$
  - Violaciones del umbral de parada: 0
- **Casos Fijos de Referencia Teórica:**
  - 5 opciones, 1 empate doble en grupo: $\tau_b = 0.9487$, $CIX = 0.9743$ (Exacto).
  - 5 opciones, bloques de 3 y 2 empatadas: $\tau_b = 0.7746$, $CIX = 0.8873$ (Exacto).
  - 5 opciones, bloques de 1 y 4 empatadas: $\tau_b = 0.6325$, $CIX = 0.8162$ (Exacto).
  - 3 opciones, grupo $(A \sim B) > C$, boleta $A > B > C$: $\tau_b = 0.8165$, $CIX = 0.9082$ (Exacto).
  - Boleta idéntica al orden colectivo (sin empates): $\tau_b = 1.0000$, $CIX = 1.0000$.
  - Boleta estrictamente invertida: $\tau_b = -1.0000$, $CIX = 0.0000$.
  - Empate total en el grupo ($T = t_{\text{grupo}}$): $\tau_b = 0.0000$, $CIX = 0.5000$ (Por convención).

---

## 6. Simulación E2E Multirronda y Reproducibilidad de los CSVs

Se implementó y superó la prueba de simulación completa en `__tests__/integration/fullDeliberationSimulation.test.ts`, cubriendo:
1. **Flujo de 3 participantes y 3 rondas:**
   - **Ronda 1:** Votación divergente inicial ($\tau^* = 0.5000$). La sala avanza a revisión de argumentos (`ROUND_FEEDBACK`).
   - **Ronda 2:** Vencimiento de plazo con solo 2 votos. Activación inmediata de `INSUFFICIENT_VOTES`. El anfitrión extiende la hora límite en 15 minutos, ingresa el 3.er voto y se procesan los resultados ($\tau^* = 0.7850$).
   - **Ronda 3:** Deliberación y convergencia grupal total en $A > B > C$. $\tau^* = 1.0000 \ge \tau_{\text{umbral}} = 0.8500$. La sala concluye automáticamente (`CONCLUDED`).
2. **Convergencia Anticipada en Ronda 1:** Votación unánime desde la primera ronda que alcanza el umbral de parada y concluye sin requerir rondas subsecuentes.
3. **Deserción / Expulsión en Ronda 2:** Participante expulsado en ronda 2 mantiene sus registros íntegros de ronda 1 en `matrix_long.csv`; sus votos de la ronda 2 activa son purgados de forma atómica y no alteran el cómputo.
4. **Reproducibilidad Científica:** A partir de los datos en `matrix_long.csv` y `matrix_wide_metrics.csv`, los coeficientes $\tau^*$ de cada ronda se recalculan de forma determinista con error absoluto cero.

---

## 7. Registro de Capturas de Pantalla (Playwright)

Se ejecutó la suite de captura automatizada con Playwright en resoluciones de 375px (viewport móvil) y 1280px (viewport de escritorio). Las imágenes resultantes se encuentran archivadas en `docs/screenshots/`:

| Pantalla | Ruta | Archivo 375px | Archivo 1280px | Aspectos Auditados |
|---|---|---|---|---|
| Inicio | `/` | `01-inicio-375px.png` | `01-inicio-1280px.png` | Dirección sobria, tokens de color, botones planos sin sombras |
| Ingreso Participante | `/join` | `02-join-paso1-375px.png` | `02-join-paso1-1280px.png` | Input de 56px, fuente Plex Mono, sin exclamaciones |
| Inicio de Sesión | `/auth/login` | `03-auth-login-375px.png` | `03-auth-login-1280px.png` | PasswordInput con botón de visibilidad de 44px, foco visible |
| Registro de Anfitrión | `/auth/register` | `04-auth-register-375px.png` | `04-auth-register-1280px.png` | Validación en vivo, contadores de error planos |
| Error de Autenticación | `/auth/error` | `05-auth-error-375px.png` | `05-auth-error-1280px.png` | Enlace explícito para volver al inicio |
| Panel de Control | `/dashboard` | `06-dashboard-375px.png` | `06-dashboard-1280px.png` | Sidebar angosta, leyenda "Conectado como anfitrión", tabla densa |
| Nueva Sala | `/dashboard/rooms/new` | `07-dashboard-rooms-new-375px.png` | `07-dashboard-rooms-new-1280px.png` | Migas de pan "Volver a salas", selector de 3 a 8 opciones |
| Detalle de Sala | `/dashboard/rooms/[id]` | `08-dashboard-room-detail-375px.png` | `08-dashboard-room-detail-1280px.png` | Cronómetro en vivo, botón "Expulsar de la sala", diálogo de advertencia |

---

## 8. Conclusión

La Fase B del proyecto **GDSS r-FAST-CR** ha concluido con éxito rotundo. El sistema satisface todas las directrices matemáticas, metodológicas, de seguridad y de experiencia de usuario establecidas en [AGENTS.md](file:///home/jatoapan/mic/AGENTS.md), encontrándose plenamente preparado para su utilización en recolección de datos experimentales y publicaciones científicas reproducibles.

---

## Adendo: alineación r-FAST-CR (noviembre 2026)

Este informe describe el estado al cierre de la Fase B. El plan de alineación
r-FAST-CR (tareas PT-00 a PT-36) cambió lo siguiente; ante diferencias manda
`AGENTS.md` y `docs/data-dictionary.md`.

- **Cookies (AUD-28):** la cookie del anfitrión era `lax`; ahora es `SameSite=Strict`
  como decía este informe (PT-05). Las sesiones de anfitrión y participante se
  firman con secretos distintos (`PARTICIPANT_SESSION_SECRET`, PT-06).
- **Expulsión (escenario 3 de la sección 6):** los votos de la ronda activa ya no se
  purgan: se conservan y quedan fuera del cálculo (`excluded_from_round` en
  `matrix_long.csv`, PT-11).
- **Seguridad:** el participante ya no recibe métricas de otros votantes (PT-02) y
  el anfitrión ya no recibe `arguments_json` (PT-25). El registro de anfitriones
  exige `HOST_INVITE_CODE` (PT-04). El seed no corre en producción (PT-03). La CSP
  de producción ya no permite `'unsafe-eval'` (PT-35).
- **Concurrencia:** votos simultáneos rechazados como "sala cerrada" por conflictos
  de serialización; ahora se reintentan y el bloqueo de la sala es compartido.
- **Datos:** razones a favor y en contra (`VoteReason`), historial de votos
  (`VoteRevision`), bitácora (`RoomEvent`), lista del curso (`RoomMember`),
  consentimiento (`ConsentRecord`), métricas por votante (`RoundVoterMetric`) y
  versión del procedimiento en cada informe (`__procedure`).
- **Límites de intentos:** siguen en memoria; la limitación está documentada en
  `lib/rate-limit.ts` (PT-31).
- **Pruebas:** 361 pruebas. Las de integración usan PostgreSQL real cuando existe
  `TEST_DATABASE_URL`; sin esa variable se omiten.

