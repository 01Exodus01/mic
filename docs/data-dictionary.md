# Diccionario de Datos / Data Dictionary

Este documento especifica la estructura, formato, tipos de datos, fórmulas matemáticas y semántica de las exportaciones CSV generadas por GDSS r-FAST-CR para análisis estadístico, psicométrico y de teoría de elección social en software como R, Python (Pandas/SciPy) o Julia.

> **Export normalizado (ZIP).** Desde el plan de mejora de los reportes, el panel de la sala descarga un ZIP con un archivo por granularidad (`rooms`, `options`, `participants`, `rounds`, `votes_long`, `voter_round_metrics`, `option_round_scores`, `round_metrics`, `reasons`, `events`), un `README_data_dictionary.md` generado con cada columna, su tipo, unidad y rango, y un `manifest.json` con el hash SHA-256 de cada archivo, la fecha y las versiones. Hay dos modos: **investigación** (datos completos, fechas ISO 8601 en UTC) y **publicación** (sin fechas absolutas, solo segundos desde la apertura de cada ronda; sin identificadores internos ni nombre de sala; sin texto de las razones salvo que se marque que su publicación fue aprobada). La lista del curso nunca entra al ZIP. Rutas: `/api/rooms/<id>/export/v2` (ZIP, `?mode=publication`, `&include_text=1`) y `/api/rooms/<id>/export/v2/<archivo>.csv`. Las columnas de cada archivo (tipo, unidad y rango) están en el `README_data_dictionary.md` de cada ZIP, que se genera con las columnas que ese export realmente trae; este documento explica las métricas y los eventos. Los archivos anteriores (`matrix_long`, `matrix_wide_metrics` y las primeras versiones de `reasons` y `events`) se retiraron el 2026-11-05.

> **Terminología.** En la plataforma, el orden de opciones que envía un participante se llama *selección* (no "voto"). Los nombres de archivos y columnas conservan `vote` (`votes_long.csv`, `vote_version`, `vote_submitted`) porque son el contrato con los scripts de análisis.

---

## 1. Métricas de Consenso y Concordancia Ordinal

### 1.1 Métrica Principal: Kendall Tau-b Normalizado (CIX)
La métrica principal del nivel de acuerdo individual y colectivo se basa en el coeficiente **Kendall $\tau_b$** entre la boleta individual estricta ($1..n$) y el orden débil colectivo del grupo (con posibles empates en rangos medios fraccionarios):

$$\tau_b = \frac{C - D}{\sqrt{(T - t_{\text{boleta}}) \cdot (T - t_{\text{grupo}})}}$$

donde:
- $n$: Número de opciones o alternativas evaluadas ($3 \le n \le 8$).
- $T = \frac{n(n-1)}{2}$: Número total de pares no ordenados posibles.
- $C$: Número de pares concordantes entre la boleta del participante y el orden colectivo del grupo.
- $D$: Número de pares discordantes.
- $t_{\text{boleta}} = 0$: Pares empatados en la boleta individual (la boleta del participante es estrictamente ordinal, sin empates permitidos).
- $t_{\text{grupo}}$: Pares empatados en el orden colectivo del grupo (donde el rango medio de ambas opciones es idéntico). Por tanto, $T - t_{\text{grupo}} = C + D$.

#### Índice de Concordancia Normalizado (CIX)
El coeficiente se normaliza al intervalo $[0, 1]$ mediante la transformación afín:

$$CIX = \frac{\tau_b + 1}{2}$$

#### Convención de Empate Total
Si todas las alternativas resultan empatadas en el orden del grupo ($T = t_{\text{grupo}}$, es decir, $C + D = 0$), se aplica por convención matemática documentada:
$$\tau_b = 0 \implies CIX = 0.50$$

#### Nivel de Acuerdo de la Ronda ($\tau^*$)
El nivel de acuerdo colectivo de la ronda es el promedio simple de los índices de concordancia de todos los votantes efectivos:

$$\tau^* = \frac{1}{m_{\text{efectivo}}} \sum_{j=1}^{m_{\text{efectivo}}} CIX_j$$

> [!NOTE]
> **Equivalencia de escala:** Un umbral de parada de consenso $\tau_{\text{umbral}} = 0.80$ en la escala CIX equivale a una correlación de Kendall $\tau = 0.60$ en la escala estándar de correlación ($\tau = 2 \cdot CIX - 1$).

---

### 1.2 Métricas Secundarias para Análisis de Sensibilidad
Estas métricas se persisten y exportan en los archivos de datos para estudios comparativos de sensibilidad metodológica (no intervienen en el criterio de parada de la sala):

1. **Stuart Kendall $\tau_c$:**
   $$\tau_c = \frac{2 \cdot m \cdot (C - D)}{n^2 \cdot (m - 1)}$$
   con $m = \min(\text{categorías boleta}, \text{categorías grupo}) = \min(n, k_{\text{grupo}})$, donde $k_{\text{grupo}}$ es el número de rangos medios distintos en el orden del grupo. Convención de empate total ($m \le 1$): $\tau_c = 0$, $CIX_{\text{stuart}} = 0.50$.

2. **Goodman & Kruskal's Gamma (Pares Decididos):**
   $$\gamma = \frac{C - D}{C + D}$$
   evaluado únicamente sobre pares no empatados en el orden colectivo. Convención de empate total ($C + D = 0$): $\gamma = 0$, $CIX_{\text{gamma}} = 0.50$.

Cuando no existen empates en el orden colectivo ($t_{\text{grupo}} = 0$), las tres métricas ($\tau_b$, $\tau_c$, $\gamma$) coinciden numéricamente de forma exacta.

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
| `join_failed` | Ingreso rechazado a una sala que existe. | `reason` (`wrong_pin`, `locked_out`, `retired`, `room_unavailable`, `late_join_closed`, `room_full`, `invalid_code`, `removed_member`), `mode` (`pin` / `roster`), `device_tag` |

`report_viewed` (el servidor entregó el informe) sigue existiendo, pero **no es una lectura**: en el export normalizado se llama `report_delivered`, y la lectura real es `report_read`. `participant_joined` lleva `returning` (reingreso) y `device_tag`. `device_tag` es una etiqueta aleatoria que guarda el navegador para contar reintentos de un mismo dispositivo; no identifica a nadie ni se liga al nombre o código escrito.

---

## 3. Tratamiento de Participantes Retirados y Cancelaciones

- **Participantes Retirados (`is_retired = true`):** El retiro de un participante por el anfitrión es un borrado lógico. Desde PT-11 **ninguna selección se borra**: las de rondas cerradas siguen tal como entraron al informe, y las de la ronda activa se conservan pero quedan fuera del cálculo (`voter_round_metrics.counted_in_round = false`; el participante aparece en `participants.csv` con `status = EXCLUDED`).
- **Lista del curso:** la etiqueta de cada persona (matrícula o usuario) vive solo en la base de datos y nunca aparece en ningún CSV.
- **Cancelaciones (`CANCELLED`):** Si una actividad es cancelada, todos los reportes de rondas previamente cerradas y sus selecciones enviadas se conservan. El estado `CANCELLED` se refleja en la columna `room_status` de `rooms.csv`.

---

## 4. Consideraciones Técnicas

- **Codificación:** UTF-8 con BOM antepuesto (`\uFEFF`) para compatibilidad directa con Excel en macOS/Windows, y terminador de línea CRLF (`\r\n`).
- **Separador:** Coma (`,`).
- **Prevención de Inyección de Fórmulas:** Celdas que inician con `=`, `+`, `-` o `@` tras recortar espacios se neutralizan anteponiendo comilla simple (`'`).
- **Escapado CSV:** Campos que contengan comas, comillas dobles o saltos de línea se encierran entre comillas dobles (`"..."`), y las comillas internas se duplican (`""`) de acuerdo a RFC 4180.
- **Reproducibilidad:** Todas las métricas numéricas generadas son determinísticas y auditables contra el motor de agregación en `backend/src/algorithms`.
