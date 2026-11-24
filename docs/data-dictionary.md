# Diccionario de Datos / Data Dictionary

Este documento especifica la estructura, formato, tipos de datos, fórmulas matemáticas y semántica de las exportaciones CSV generadas por GDSS r-FAST-CR para análisis estadístico, psicométrico y de teoría de elección social en software como R, Python (Pandas/SciPy) o Julia.

> **Export normalizado (ZIP).** Desde el plan de mejora de los reportes, el panel del grupo descarga un ZIP con un archivo por granularidad (`groups`, `options`, `participants`, `rounds`, `votes_long`, `voter_round_metrics`, `option_round_scores`, `round_metrics`, `reasons`, `events`), un `README_data_dictionary.md` generado con cada columna, su tipo, unidad y rango, y un `manifest.json` con el hash SHA-256 de cada archivo, la fecha y las versiones. Hay dos modos: **investigación** (datos completos, fechas ISO 8601 en UTC) y **publicación** (sin fechas absolutas, solo segundos desde la apertura de cada ronda; sin identificadores internos ni nombre del grupo; sin texto de las razones salvo que se marque que su publicación fue aprobada). La lista del curso nunca entra al ZIP. Rutas: `/api/rooms/<id>/export/v2` (ZIP, `?mode=publication`, `&include_text=1`) y `/api/rooms/<id>/export/v2/<archivo>.csv`. Las columnas de cada archivo (tipo, unidad y rango) están en el `README_data_dictionary.md` de cada ZIP, que se genera con las columnas que ese export realmente trae; este documento explica las métricas y los eventos. Los archivos anteriores (`matrix_long`, `matrix_wide_metrics` y las primeras versiones de `reasons` y `events`) se retiraron el 2026-11-05.

> **"Sala" ahora es "Grupo" (formato `r-fast-cr-export/2`, 2026-11-24).** `rooms.csv` pasó a llamarse `groups.csv`, y las columnas `room_id`, `room_name` y `room_status` pasaron a `group_id`, `group_name` y `group_status` (en el modo publicación el alias del grupo es `group`). En `events.csv`, `room_cancelled` es `group_cancelled` y los motivos de `join_failed` `room_unavailable`, `room_concluded` y `room_full` son `group_unavailable`, `group_concluded` y `group_full`. Los scripts escritos para el formato 1 deben renombrar esas columnas. Las rutas de la API (`/api/rooms/...`) no cambiaron.

> **Razones moderadas (2026-11-24).** El anfitrión puede ocultar razones inadecuadas sin saber quién las escribió. En `reasons.csv`, `moderated` = true y `moderated_at` indican cuáles y cuándo: no se mostraron en la retroalimentación y su autor recibió un aviso; su selección contó igual. En el modo publicación, el texto de una razón moderada siempre sale vacío.

> **Terminología.** En la plataforma, el orden de opciones que envía un participante se llama *selección* (no "voto"). Los nombres de archivos y columnas conservan `vote` (`votes_long.csv`, `vote_version`, `vote_submitted`) porque son el contrato con los scripts de análisis.

---

## 1. Métricas de Consenso y Concordancia Ordinal

### 1.1 Métrica Principal: Tau-c de Stuart Normalizado (CIX)
Desde el procedimiento `r-fast-cr-5` (enmienda E-14, 2026-11-15) el nivel de acuerdo individual y colectivo se basa en el coeficiente **$\tau_c$ de Stuart** entre la selección individual estricta ($1..n$) y el orden colectivo del grupo:

$$\tau_c = \frac{2 \cdot q \cdot (C - D)}{n^2 \cdot (q - 1)}$$

donde:
- $n$: Número de opciones evaluadas ($3 \le n \le 8$).
- $C$: Número de pares concordantes entre la selección del participante y el orden colectivo.
- $D$: Número de pares discordantes.
- $q = \min(\text{lugares distintos de la selección}, \text{lugares distintos del orden colectivo}) = \min(n, k_{\text{grupo}})$, donde $k_{\text{grupo}}$ es el número de rangos medios distintos en el orden del grupo. Como la selección es estricta, tiene $n$ lugares distintos.

Los pares empatados en el orden colectivo no cuentan como concordantes ni discordantes.

#### Índice de Concordancia Normalizado (CIX)
$$CIX = \frac{\tau_c + 1}{2}$$

#### Convención de Empate Total
Si el orden del grupo tiene un solo lugar ($q \le 1$): $\tau_c = 0 \implies CIX = 0.50$.

#### Nivel de Acuerdo de la Ronda ($\tau^*$)
$$\tau^* = \frac{1}{m_{\text{efectivo}}} \sum_{j=1}^{m_{\text{efectivo}}} CIX_j$$

$\tau^*$ es el valor que se compara con el acuerdo requerido del grupo y el que se guarda en `obtained_tau` (`round_metrics.collective_cix`). El CIX individual es el que ve cada participante como "Tu nivel de concordancia".

> [!NOTE]
> **Equivalencia de escala:** un umbral $\tau_{\text{umbral}} = 0.80$ en la escala CIX equivale a $\tau_c = 0.60$ ($\tau_c = 2 \cdot CIX - 1$).

> [!NOTE]
> **Grupos sin empates (todos los grupos nuevos desde `r-fast-cr-4`).** La selección y el orden colectivo son estrictos, así que $q = n$ y $\tau_c = \frac{2(C - D)}{n(n-1)}$, que coincide exactamente con $\tau_b$ y con $\gamma$. El cambio de coeficiente solo da valores distintos cuando el orden colectivo tiene empates (variante `WITH_TIES` de grupos anteriores, o las columnas `*_weak_order`).

#### Informes anteriores a `r-fast-cr-5`
Hasta `r-fast-cr-4`, el CIX y $\tau^*$ se calcularon con **$\tau_b$ de Kendall**:

$$\tau_b = \frac{C - D}{\sqrt{(T - t_{\text{boleta}}) \cdot (T - t_{\text{grupo}})}}, \qquad CIX = \frac{\tau_b + 1}{2}$$

con $T = n(n-1)/2$, $t_{\text{boleta}} = 0$ y $t_{\text{grupo}}$ los pares empatados en el orden colectivo (convención de empate total: $\tau_b = 0$, CIX = 0.50). Los informes de rondas cerradas son inmutables y conservan ese valor. La columna `round_metrics.concordance_index` indica con qué coeficiente se calculó cada ronda (`TAU_C` o `TAU_B`), y `cix`, `mean_tau` y `collective_cix` siempre corresponden a ese coeficiente.

---

### 1.2 Métricas Secundarias para Análisis de Sensibilidad
Se guardan y exportan para estudios comparativos; no intervienen en el criterio de parada:

1. **Kendall $\tau_b$** (fórmula de arriba): columna `tau_b` de `voter_round_metrics.csv`, siempre presente.
2. **Goodman & Kruskal's Gamma (pares decididos):**
   $$\gamma = \frac{C - D}{C + D}$$
   evaluado únicamente sobre pares no empatados en el orden colectivo. Convención de empate total ($C + D = 0$): $\gamma = 0$, $CIX_{\text{gamma}} = 0.50$. Columna `gamma`, solo en la variante con empates.

Cuando no existen empates en el orden colectivo, las tres métricas ($\tau_c$, $\tau_b$, $\gamma$) coinciden numéricamente de forma exacta.

---

## 2. Eventos de uso en `events.csv` (plan de mejora P2)

Además de los eventos del servidor (apertura y cierre de rondas, ingresos, envíos), la pantalla del participante envía estos, en lotes; cada uno guarda el momento en que ocurrió, no el de llegada. Solo llevan identificadores, conteos y duraciones: **nunca el texto escrito, el PIN ni el código personal**.

| `type` | Cuándo | Campos de `data` |
|---|---|---|
| `report_read` | El informe estuvo realmente en pantalla (página visible y, en la pantalla de selección, el bloque de resultados abierto). Se envía al ocultar o dejar la página, cerrar el bloque o cambiar de informe; nunca con 0 ms. | `report_round`, `surface` (`feedback` o `vote`), `visible_ms`, `sections_opened` |
| `report_section_opened` | Se desplegó una opción del informe: se mostraron las razones de los demás. | `report_round`, `surface`, `option_id` |
| `ballot_viewed` | Apareció el formulario de selección editable (referencia para medir el primer reordenamiento). | `editing` |
| `ranking_reordered` | Un cambio de orden antes de enviar. | `method` (`buttons`, `drag`, `touch`), `option_id`, `from_position`, `to_position`, `reorder_index` |
| `reason_field_added` | Se agregó un campo de razón. | `option_id`, `side` (`for` / `against`) |
| `reason_typing_started` | Primera vez que se escribe en las razones de esa opción y lado, en la ronda. | `option_id`, `side` |
| `vote_submitted` | Envío de la selección (ya existía); ahora con cuántas razones se mandaron. | `version`, `changed`, `reasons_for`, `reasons_against` |
| `join_failed` | Ingreso rechazado a un grupo que existe. | `reason` (`wrong_pin`, `locked_out`, `retired`, `group_unavailable`, `group_concluded`, `late_join_closed`, `group_full`, `invalid_code`, `removed_member`), `mode` (`pin` / `roster`), `device_tag` |
| `round_scheduled` | El anfitrión programó cuándo se abre y se cierra la ronda siguiente (antes de la Ronda 1 o entre rondas). La ronda programada se abre sola y queda como `round_opened` con `actor` `SYSTEM` y `scheduled` = true. | `opens_at`, `closes_at`, `minutes`, `timing` |
| `round_schedule_cancelled` | El anfitrión quitó la programación. | — |
| `reason_hidden` / `reason_shown` | El anfitrión ocultó una razón por contenido inadecuado, o la volvió a mostrar. Nunca se guarda el texto. | `option_id`, `side` |

`report_viewed` (el servidor entregó el informe) sigue existiendo, pero **no es una lectura**: en el export normalizado se llama `report_delivered`, y la lectura real es `report_read`. `participant_joined` lleva `returning` (reingreso) y `device_tag`. `device_tag` es una etiqueta aleatoria que guarda el navegador para contar reintentos de un mismo dispositivo; no identifica a nadie ni se liga al nombre o código escrito.

---

## 3. Tratamiento de Participantes Retirados y Cancelaciones

- **Participantes Retirados (`is_retired = true`):** El retiro de un participante por el anfitrión es un borrado lógico. Desde PT-11 **ninguna selección se borra**: las de rondas cerradas siguen tal como entraron al informe, y las de la ronda activa se conservan pero quedan fuera del cálculo (`voter_round_metrics.counted_in_round = false`; el participante aparece en `participants.csv` con `status = EXCLUDED`).
- **Lista del curso:** la etiqueta de cada persona (matrícula o usuario) vive solo en la base de datos y nunca aparece en ningún CSV.
- **Cancelaciones (`CANCELLED`):** Si una actividad es cancelada, todos los reportes de rondas previamente cerradas y sus selecciones enviadas se conservan. El estado `CANCELLED` se refleja en la columna `group_status` de `groups.csv`.

---

## 4. Consideraciones Técnicas

- **Codificación:** UTF-8 con BOM antepuesto (`\uFEFF`) para compatibilidad directa con Excel en macOS/Windows, y terminador de línea CRLF (`\r\n`).
- **Separador:** Coma (`,`).
- **Prevención de Inyección de Fórmulas:** Celdas que inician con `=`, `+`, `-` o `@` tras recortar espacios se neutralizan anteponiendo comilla simple (`'`).
- **Escapado CSV:** Campos que contengan comas, comillas dobles o saltos de línea se encierran entre comillas dobles (`"..."`), y las comillas internas se duplican (`""`) de acuerdo a RFC 4180.
- **Reproducibilidad:** Todas las métricas numéricas generadas son determinísticas y auditables contra el motor de agregación en `backend/src/algorithms`.
