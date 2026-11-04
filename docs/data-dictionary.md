# Diccionario de Datos / Data Dictionary

Este documento especifica la estructura, formato, tipos de datos, fórmulas matemáticas y semántica de las exportaciones CSV generadas por GDSS r-FAST-CR para análisis estadístico, psicométrico y de teoría de elección social en software como R, Python (Pandas/SciPy) o Julia.

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

## 2. `matrix_long.csv` (Matriz Longitudinal de Votos y Argumentos)

Formato longitudinal (*long format* o *tidy data*), donde cada fila representa la evaluación ordinal y argumentación de un participante hacia una opción específica dentro de una ronda determinada, enriquecida con sus coeficientes de concordancia individuales. Cumple estrictamente con el principio Zero-PII (sin información de identificación personal).

### Columnas

| Columna | Tipo de dato | Formato / Ejemplo | Descripción semántica |
|---|---|---|---|
| `room_id` | `CUID` (String) | `clw8k2j1a000008l0h9x6e2qz` | Identificador único global de la sala de votación (CUID alfanumérico). Permite vincular boletas con metadatos de la sesión y realizar joins relacionales con `matrix_wide_metrics.csv`. |
| `round` | `Integer` | `1`, `2`, `3` | Número de la ronda iterativa en la que se emitió el voto ($1 \le r \le \eta$). |
| `method` | `String` | `BORDA`, `SCHULZE`, `KEMENY_YOUNG` | Regla de elección social o método de agregación configurado en la sala. |
| `blind_code` | `String` | `Participante 01`, `Participante 12` | Código ciego asignado aleatoriamente al participante. Reemplaza la identidad real para garantizar anonimato en investigación ciega y cumplimiento Zero-PII. |
| `option_id` | `CUID` (String) | `clw8k2m9b000108l0b1k8g7pw` | Identificador único de la opción o alternativa evaluada en la sala. |
| `position` | `Integer` | `1`, `2`, ..., $n$ | Posición ordinal asignada por el participante en su boleta ($1 = \text{primera preferencia}$). Admite valores secuenciales de 1 al total de opciones. |
| `justification_text` | `String` (Texto) | `Es la alternativa más viable a corto plazo.` | Texto cualitativo de la razón o justificación argumentativa aportada por el participante para respaldar su decisión. Escapado según norma RFC 4180 con protección contra inyección de fórmulas. |
| `voter_tau_b` | `Float` | `0.8165`, `-0.2000`, `1.0000` | Coeficiente Kendall $\tau_b$ individual del participante contra el orden del grupo en esta ronda. |
| `voter_cix` | `Float` | `0.9082`, `0.4000`, `1.0000` | Índice de concordancia normalizado individual $CIX = (\tau_b + 1) / 2 \in [0, 1]$. |
| `stuart_tau_c` | `Float` | `0.7500`, `-0.1875` | Coeficiente de sensibilidad Stuart Kendall $\tau_c$ individual del participante. |
| `stuart_cix` | `Float` | `0.8750`, `0.4063` | Índice de concordancia normalizado basado en Stuart $\tau_c$. |
| `gamma_decided_pairs` | `Float` | `1.0000`, `-0.3333` | Coeficiente de sensibilidad Gamma de Goodman-Kruskal sobre pares decididos. |
| `gamma_cix` | `Float` | `1.0000`, `0.3333` | Índice de concordancia normalizado basado en Gamma. |
| `room_status` | `String` | `CONCLUDED`, `CANCELLED` | Estado de la sala **en el momento de exportar**. Permite distinguir actividades completadas con éxito de aquellas canceladas por el anfitrión. Para el estado de cada ronda usar `round_status`. |

#### Columnas agregadas (PT-26, al final; las 14 anteriores no cambian de nombre ni de orden)

| Columna | Tipo de dato | Formato / Ejemplo | Descripción semántica |
|---|---|---|---|
| `reasons_for_count` | `Integer` | `0`, `2` | Cantidad de razones a favor que el participante escribió para esta opción en esta ronda (0 a 5). |
| `reasons_against_count` | `Integer` | `0`, `1` | Cantidad de razones en contra (0 a 5). El texto está en `reasons.csv`. |
| `vote_version` | `Integer` o vacío | `1`, `3` | Número de la última versión distinta de la boleta en la ronda (`VoteRevision`). Vacío para votos anteriores al historial. |
| `submitted_at` | `ISO 8601` (UTC) | `2026-11-04T15:02:11.123Z` | Hora en que se guardó la versión efectiva de la boleta. |
| `joined_round` | `Integer` | `1`, `2` | Ronda en que el participante ingresó por primera vez. Mayor que 1 solo en salas con participantes tardíos: no tiene ronda previa con la que comparar cambios. |
| `excluded_from_round` | `true` / `false` / vacío | `false` | `true` si la boleta no entró al cálculo de su ronda (participante retirado o boleta incompleta). Vacío si la ronda no tiene informe. |
| `tie_break_rule` | `String` | `NONE`, `LEXICOGRAPHIC`, `REASON_BALANCE` | Regla de desempate declarada por la sala. |
| `tie_break_applied` | `true` / `false` / vacío | `false` | `true` si en esta ronda había empates y la regla los resolvió. Vacío si la ronda no tiene informe. |
| `concordance_variant` | `String` | `WITH_TIES`, `WITHOUT_TIES` | Variante de concordancia usada: tau-b con empates o Kendall estándar sin empates (solo con regla de desempate). |
| `round_status` | `String` | `REPORTED`, `ROUND_OPEN`, `UNREPORTED` | `REPORTED`: la ronda tiene informe inmutable. Para la ronda actual sin informe, el estado de la sala al exportar. `UNREPORTED`: ronda anterior que quedó sin informe (por ejemplo, votos insuficientes y cancelación). |

---

## 3. `matrix_wide_metrics.csv` (Métricas de Consenso por Ronda)

Formato transversal por ronda (*round-level aggregated metrics*), diseñado para análisis longitudinales de series temporales, pruebas de hipótesis pareadas y seguimiento del avance del consenso grupal entre rondas consecutivas.

### Columnas

| Columna | Tipo de dato | Formato / Ejemplo | Descripción semántica |
|---|---|---|---|
| `room_id` | `CUID` (String) | `clw8k2j1a000008l0h9x6e2qz` | Identificador único de la sala de votación. Clave foránea para vincular directamente con `matrix_long.csv`. |
| `round` | `Integer` | `1`, `2`, `3` | Número secuencial de la ronda de votación ($1 \le r \le \eta$). |
| `method` | `String` | `BORDA`, `SCHULZE`, `KEMENY_YOUNG` | Método de agregación utilizado para calcular el orden del grupo. |
| `effective_voters` | `Integer` | `15` | Participantes con voto emitido y completo en esta ronda ($m_{\text{efectivo}}$). Requiere $m_{\text{efectivo}} \ge 3$ para procesar resultados. |
| `collective_tau` | `Float` | `0.7850` | Nivel de acuerdo del grupo ($\tau^*$). Promedio de los índices de concordancia Kendall Tau-b normalizados (CIX), en escala $[0, 1]$. |
| `delta_tau` | `Float` | `0.1250`, `-0.0400`, `0.0000` | Variación del consenso grupal respecto a la ronda inmediatamente anterior ($\Delta \tau = \tau^*_r - \tau^*_{r-1}$). En la ronda 1 su valor es `0.0000`. |
| `stuart_tau_c` | `Float` | `0.5400` | Promedio del coeficiente Stuart Kendall $\tau_c$ del grupo ($\in [-1, 1]$) para análisis de sensibilidad. |
| `stuart_cix` | `Float` | `0.7700` | Nivel de acuerdo grupal promedio según la métrica Stuart $\tau_c$ normalizada ($[0, 1]$). |
| `gamma_decided_pairs` | `Float` | `0.6200` | Promedio del coeficiente Gamma de pares decididos del grupo ($\in [-1, 1]$). |
| `gamma_cix` | `Float` | `0.8100` | Nivel de acuerdo grupal promedio según la métrica Gamma normalizada ($[0, 1]$). |
| `collective_ranking` | `String` | `opt_A:1.0 > opt_B:2.5 > opt_C:2.5` | Orden colectivo resultante del motor de agregación. Cada elemento sigue el formato `option_id:midRank`, encadenados por el operador de preferencia `>`. Opciones con igual `midRank` representan empates en rangos medios, serializadas por ID de forma determinística. |
| `room_status` | `String` | `CONCLUDED`, `CANCELLED` | Estado de la sala al exportar. Permite aislar analíticamente salas concluidas de canceladas. |

#### Columnas agregadas (PT-26, al final)

| Columna | Tipo de dato | Formato / Ejemplo | Descripción semántica |
|---|---|---|---|
| `tie_break_rule` | `String` | `NONE`, `LEXICOGRAPHIC`, `REASON_BALANCE` | Regla de desempate con que se calculó la ronda. |
| `concordance_variant` | `String` | `WITH_TIES`, `WITHOUT_TIES` | Variante de concordancia de la ronda. |
| `procedure_version` | `String` o vacío | `r-fast-cr-2` | Versión del procedimiento de cálculo guardada en el informe (PT-29). Vacía en informes anteriores a ese registro. |

---

## 3b. `reasons.csv` (Razones textuales, PT-26)

Una fila por razón, con el texto tal como lo escribió el participante (solo se recortan espacios en los extremos).

| Columna | Tipo de dato | Descripción |
|---|---|---|
| `room_id` | `CUID` | Sala. |
| `round` | `Integer` | Ronda. |
| `blind_code` | `String` | Código ciego del participante (nunca nombre ni etiqueta de la lista). |
| `option_id` | `CUID` | Opción a la que se refiere la razón. |
| `side` | `String` | `FOR` (a favor), `AGAINST` (en contra) o `LEGACY` (razón única escrita antes de las razones a favor y en contra). |
| `order` | `Integer` | Orden de la razón dentro de su lado, desde 0. |
| `text` | `String` | Texto de la razón (1 a 200 caracteres). |

## 3c. `events.csv` (Bitácora de la sala, PT-26)

Una fila por evento. Nunca contiene el contenido de un voto.

| Columna | Tipo de dato | Descripción |
|---|---|---|
| `room_id` | `CUID` | Sala. |
| `created_at` | `ISO 8601` (UTC) | Hora del evento. |
| `round` | `Integer` o vacío | Ronda en que ocurrió. |
| `type` | `String` | `room_started`, `round_closed`, `round_processed`, `insufficient_votes`, `round_opened`, `deadline_extended`, `room_cancelled`, `pin_reset`, `participant_expelled`, `participant_joined`, `vote_submitted`, `report_viewed`, `member_added`, `member_removed`, `member_code_regenerated`, `consent_accepted`. |
| `actor` | `String` | `HOST`, `PARTICIPANT` o `SYSTEM`. |
| `blind_code` | `String` o vacío | Participante involucrado, por código ciego. |
| `data` | `JSON` o vacío | Metadatos planos del evento (por ejemplo `{"version":2,"changed":true}` en `vote_submitted`). |

---

## 4. Tratamiento de Participantes Retirados y Cancelaciones

- **Participantes Retirados (`is_retired = true`):** El retiro de un participante por el anfitrión es un borrado lógico. Desde PT-11 **ningún voto se borra**: los de rondas cerradas siguen tal como entraron al informe, y los de la ronda activa se conservan pero quedan fuera del cálculo (`excluded_from_round = true`).
- **Lista del curso:** la etiqueta de cada persona (matrícula o usuario) vive solo en la base de datos y nunca aparece en ningún CSV.
- **Cancelaciones (`CANCELLED`):** Si una actividad es cancelada, todos los reportes de rondas previamente cerradas y sus votos emitidos se conservan. El estado `CANCELLED` se refleja explícitamente en la columna `room_status` de ambos archivos CSV.

---

## 5. Consideraciones Técnicas

- **Codificación:** UTF-8 con BOM antepuesto (`\uFEFF`) para compatibilidad directa con Excel en macOS/Windows, y terminador de línea CRLF (`\r\n`).
- **Separador:** Coma (`,`).
- **Prevención de Inyección de Fórmulas:** Celdas que inician con `=`, `+`, `-` o `@` tras recortar espacios se neutralizan anteponiendo comilla simple (`'`).
- **Escapado CSV:** Campos que contengan comas, comillas dobles o saltos de línea se encierran entre comillas dobles (`"..."`), y las comillas internas se duplican (`""`) de acuerdo a RFC 4180.
- **Reproducibilidad:** Todas las métricas numéricas generadas son determinísticas y auditables contra el motor de agregación en `lib/algorithms`.
