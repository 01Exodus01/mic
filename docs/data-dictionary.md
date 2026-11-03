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
| `room_status` | `String` | `CONCLUDED`, `CANCELLED` | Estado final de la actividad. Permite distinguir actividades completadas con éxito de aquellas canceladas por el anfitrión. |

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
| `room_status` | `String` | `CONCLUDED`, `CANCELLED` | Estado final de la actividad. Permite aislar analíticamente salas concluidas de canceladas. |

---

## 4. Tratamiento de Participantes Retirados y Cancelaciones

- **Participantes Retirados (`is_retired = true`):** El retiro de un participante por el anfitrión es un borrado lógico. Sus votos en rondas cerradas ($r < \text{ronda actual}$) permanecen inmutables en la base de datos y se exportan íntegramente en `matrix_long.csv` para garantizar la reproducibilidad científica. Los votos en la ronda activa se purgan inmediatamente al ejecutar la expulsión.
- **Cancelaciones (`CANCELLED`):** Si una actividad es cancelada, todos los reportes de rondas previamente cerradas y sus votos emitidos se conservan. El estado `CANCELLED` se refleja explícitamente en la columna `room_status` de ambos archivos CSV.

---

## 5. Consideraciones Técnicas

- **Codificación:** UTF-8 con BOM antepuesto (`\uFEFF`) para compatibilidad directa con Excel en macOS/Windows, y terminador de línea CRLF (`\r\n`).
- **Separador:** Coma (`,`).
- **Prevención de Inyección de Fórmulas:** Celdas que inician con `=`, `+`, `-` o `@` tras recortar espacios se neutralizan anteponiendo comilla simple (`'`).
- **Escapado CSV:** Campos que contengan comas, comillas dobles o saltos de línea se encierran entre comillas dobles (`"..."`), y las comillas internas se duplican (`""`) de acuerdo a RFC 4180.
- **Reproducibilidad:** Todas las métricas numéricas generadas son determinísticas y auditables contra el motor de agregación en `lib/algorithms`.
