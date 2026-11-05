/**
 * lib/export/dictionary.ts
 * README_data_dictionary.md of the export ZIP (plan de mejora P3.1): every
 * column of every file with its type, unit and range. Only the columns that
 * the export really has are listed (some depend on the room settings or mode).
 * A test checks that no column is left without a description.
 */

import type { CsvTable } from './format';

export interface ColumnDoc {
  type: string;
  unit?: string;
  range?: string;
  description: string;
}

const T_ROUND = 'segundos desde que se abrió la ronda (puede ser negativo si ocurrió en la sala de espera)';

const COMMON: Record<string, ColumnDoc> = {
  room_id: { type: 'texto', description: 'Identificador de la sala (en modo publicación: `room`).' },
  round: { type: 'entero', range: '≥ 1', description: 'Número de ronda.' },
  blind_code: { type: 'texto', description: 'Código ciego del participante (`Participante NN`). Único identificador de personas en el export.' },
  option_id: { type: 'texto', description: 'Opción (ver `options.csv`; en modo publicación: `opt_NN`).' },
  t_since_round_open_s: { type: 'decimal', unit: 's', description: `Momento del registro, en ${T_ROUND}.` },
  created_at: { type: 'fecha ISO 8601 UTC', description: 'Momento del registro (solo modo investigación).' },
};

export const COLUMN_DOCS: Record<string, Record<string, ColumnDoc>> = {
  'rooms.csv': {
    room_name: { type: 'texto', description: 'Título de la sala (solo modo investigación).' },
    method: { type: 'categoría', range: 'BORDA, SCHULZE, KEMENY', description: 'Método de agregación del ranking colectivo.' },
    concordance_variant: { type: 'categoría', range: 'WITHOUT_TIES, WITH_TIES', description: 'Variante de concordancia: sin empates (tau-b) o con empates (agrega tau-c y gamma).' },
    tie_break_rule: { type: 'categoría', range: 'PAIRWISE_MAJORITY (salas nuevas); NONE, LEXICOGRAPHIC, REASON_BALANCE (salas anteriores)', description: 'Regla para desempatar opciones con igual puntaje. Desde r-fast-cr-4 es fija: mayoría pareada entre las empatadas en la ronda y, si sigue el empate, título de la opción.' },
    tie_break_fallback: { type: 'categoría', range: 'TITLE, SEEDED_RANDOM o vacío', description: 'Último recurso si la regla no separa: título de la opción (PAIRWISE_MAJORITY) o sorteo con semilla guardada en `round_metrics.tie_seed` (REASON_BALANCE).' },
    consensus_threshold: { type: 'decimal', range: '0–1', description: 'CIX colectivo que se considera consenso.' },
    max_rounds: { type: 'entero', range: '≥ 1', description: 'Rondas máximas configuradas.' },
    late_participants_policy: { type: 'categoría', range: 'ALLOWED, CLOSED_COHORT', description: 'Si se aceptan participantes nuevos después de la ronda 1.' },
    early_close: { type: 'booleano', description: 'La ronda se cierra sola cuando todos enviaron su selección.' },
    consent_required: { type: 'booleano', description: 'La sala pide consentimiento informado antes de la primera selección.' },
    access_mode: { type: 'categoría', range: 'OPEN_PIN, ROSTER', description: 'Ingreso con nombre y PIN propio, o con código personal de una lista.' },
    room_status: { type: 'categoría', range: 'DRAFT, ROUND_OPEN, PROCESSING, ROUND_FEEDBACK, CONCLUDED, CANCELLED', description: 'Estado de la sala al exportar.' },
    procedure_version: { type: 'texto', description: 'Versión del procedimiento de cálculo del último informe.' },
    app_version: { type: 'texto', description: 'Versión de la aplicación que generó el export.' },
    timezone: { type: 'texto', range: 'UTC', description: 'Zona horaria de todas las fechas del export.' },
  },
  'options.csv': {
    display_order_default: { type: 'entero', range: '1–m', description: 'Orden en que el anfitrión cargó la opción. Cada participante la vio en su propio orden aleatorio (`votes_long.displayed_position`).' },
  },
  'participants.csv': {
    joined_round: { type: 'entero', range: '≥ 1', description: 'Ronda en que ingresó por primera vez.' },
    first_joined_at: { type: 'fecha ISO 8601 UTC', description: 'Primer ingreso (solo modo investigación).' },
    first_joined_t_since_round_open_s: { type: 'decimal', unit: 's', description: `Primer ingreso, en ${T_ROUND} de ingreso.` },
    voted_rounds: { type: 'lista de enteros separada por ;', description: 'Rondas en que dejó una selección completa.' },
    status: { type: 'categoría', range: 'ACTIVE, NEVER_VOTED, EXCLUDED', description: 'Situación final del participante.' },
    excluded_from_round: { type: 'entero o vacío', description: 'Ronda en que fue retirado, si lo fue.' },
    exclusion_reason: { type: 'categoría o vacío', range: 'EXPELLED, REMOVED_FROM_LIST', description: 'Motivo del retiro.' },
    consent_accepted: { type: 'booleano o vacío', description: 'Aceptó el consentimiento (vacío si la sala no lo pedía).' },
    consent_at: { type: 'fecha ISO 8601 UTC', description: 'Aceptación del consentimiento (solo modo investigación).' },
  },
  'rounds.csv': {
    opened_at: { type: 'fecha ISO 8601 UTC', description: 'Apertura de la ronda (solo modo investigación).' },
    opened_t_since_first_round_s: { type: 'decimal', unit: 's', description: 'Apertura de la ronda, en segundos desde que se abrió la ronda 1.' },
    configured_minutes: { type: 'entero o vacío', unit: 'min', description: 'Duración configurada al abrir la ronda.' },
    extension_minutes: { type: 'entero', unit: 'min', range: '≥ 0', description: 'Minutos agregados durante la ronda.' },
    closed_at: { type: 'fecha ISO 8601 UTC', description: 'Cierre de la ronda (solo modo investigación).' },
    duration_s: { type: 'decimal', unit: 's', description: 'Duración real de la ronda (cierre − apertura).' },
    closed_reason: { type: 'categoría o vacío', range: 'HOST, TIMEOUT, ALL_VOTED', description: 'Quién o qué cerró la ronda.' },
    n_joined: { type: 'entero', description: 'Participantes que habían ingresado al cierre.' },
    n_voted: { type: 'entero', description: 'Participantes con selección completa.' },
    effective_voters: { type: 'entero o vacío', description: 'Selecciones que entraron al cálculo.' },
    n_excluded: { type: 'entero o vacío', description: 'Selecciones que quedaron fuera del cálculo (participante retirado).' },
    status: { type: 'categoría', range: 'REPORTED, UNREPORTED o un estado de sala', description: 'Si la ronda tiene informe.' },
  },
  'votes_long.csv': {
    position: { type: 'entero', range: '1–m', description: 'Lugar que el participante dio a la opción (1 = la preferida).' },
    displayed_position: { type: 'entero o vacío', range: '1–m', description: 'Lugar en que se le mostró la opción antes de ordenar (vacío en selecciones anteriores a este registro).' },
    submitted_at: { type: 'fecha ISO 8601 UTC', description: 'Último envío de la selección (solo modo investigación).' },
    vote_version: { type: 'entero', range: '≥ 1', description: 'Cuántas versiones distintas envió en la ronda.' },
    changed_vs_prev_round: { type: 'booleano o vacío', description: 'La opción cambió de lugar respecto de su selección de la ronda anterior (vacío si no la envió antes).' },
  },
  'voter_round_metrics.csv': {
    counted_in_round: { type: 'booleano', description: 'La selección entró al cálculo de la ronda.' },
    tau_b: { type: 'decimal', range: '−1 a 1', description: 'Tau-b de Kendall entre la selección y el ranking colectivo final.' },
    cix: { type: 'decimal', range: '0–1', description: 'Concordancia individual: (tau_b + 1) / 2.' },
    tau_c: { type: 'decimal', range: '−1 a 1', description: 'Tau-c de Stuart (solo variante con empates).' },
    gamma: { type: 'decimal', range: '−1 a 1', description: 'Gamma de Goodman-Kruskal (solo variante con empates).' },
    tau_b_weak_order: { type: 'decimal', range: '−1 a 1', description: 'Tau-b contra el ranking antes del desempate (opciones empatadas comparten lugar).' },
    cix_weak_order: { type: 'decimal', range: '0–1', description: '(tau_b_weak_order + 1) / 2.' },
    kendall_distance_to_prev_round: { type: 'entero o vacío', range: '0 a m(m−1)/2', description: 'Pares de opciones que cambiaron de orden respecto de su selección anterior.' },
    reasons_for_count: { type: 'entero', description: 'Razones a favor escritas en la ronda.' },
    reasons_against_count: { type: 'entero', description: 'Razones en contra escritas en la ronda.' },
  },
  'option_round_scores.csv': {
    borda_score: { type: 'entero', range: '0 a n(m−1)', description: 'Puntaje de Borda con las selecciones contadas (m − lugar en cada selección).' },
    final_rank: { type: 'decimal', range: '1–m', description: 'Lugar en el ranking colectivo final (rango medio si quedó empatada).' },
    tied_with: { type: 'lista de option_id separada por ;', description: 'Opciones que compartían su lugar antes del desempate.' },
  },
  'round_metrics.csv': {
    effective_voters: { type: 'entero', description: 'Selecciones que entraron al cálculo.' },
    mean_tau: { type: 'decimal', range: '−1 a 1', description: 'Promedio de tau_b de las selecciones contadas.' },
    collective_cix: { type: 'decimal', range: '0–1', description: 'CIX colectivo: (mean_tau + 1) / 2.' },
    delta_cix: { type: 'decimal', range: '−1 a 1', description: 'collective_cix de la ronda menos el de la anterior (0 en la ronda 1).' },
    collective_ranking: { type: 'texto', description: 'Ranking final: `option_id:lugar > …`.' },
    tie_detected: { type: 'booleano', description: 'Hubo opciones con igual puntaje.' },
    tie_resolved_by: { type: 'categoría o vacío', range: 'PAIRWISE_MAJORITY, PAIRWISE_MAJORITY+TITLE, NONE, LEXICOGRAPHIC, REASON_BALANCE, REASON_BALANCE+SEEDED_RANDOM, REASON_BALANCE+LIST_ORDER', description: 'Cómo se resolvió el empate (+TITLE: la mayoría no separó a todas y decidió el título; LIST_ORDER: informes anteriores a r-fast-cr-3).' },
    tie_seed: { type: 'entero o vacío', description: 'Semilla del sorteo de desempate, para reproducirlo.' },
    consensus_reached: { type: 'booleano', description: 'collective_cix ≥ consensus_threshold.' },
    stop_reason: { type: 'categoría o vacío', range: 'CONSENSUS, MAX_ROUNDS, CONTINUE, INSUFFICIENT_VOTES, CANCELLED', description: 'Qué pasó después de la ronda.' },
    procedure_version: { type: 'texto', description: 'Versión del procedimiento con que se calculó el informe.' },
    concordance_variant: { type: 'categoría', range: 'WITHOUT_TIES, WITH_TIES', description: 'Variante de concordancia usada.' },
    mean_tau_weak_order: { type: 'decimal', range: '−1 a 1', description: 'mean_tau contra el ranking antes del desempate.' },
    collective_cix_weak_order: { type: 'decimal', range: '0–1', description: '(mean_tau_weak_order + 1) / 2.' },
  },
  'reasons.csv': {
    reason_id: { type: 'texto', description: 'Identificador de la razón (en modo publicación: `rs_NNNN`).' },
    side: { type: 'categoría', range: 'FOR, AGAINST, LEGACY', description: 'A favor, en contra, o justificación única de versiones antiguas.' },
    order: { type: 'entero', range: '≥ 0', description: 'Orden de la razón dentro de su lado.' },
    text: { type: 'texto', description: 'Texto de la razón. Vacío si el export se generó sin textos libres.' },
  },
  'events.csv': {
    event_id: { type: 'texto', description: 'Identificador del evento (en modo publicación: `ev_NNNN`).' },
    report_round: { type: 'entero o vacío', description: 'Ronda del informe al que se refiere el evento (report_delivered, report_read, report_section_opened).' },
    type: { type: 'categoría', description: 'Tipo de evento (ver la tabla de eventos más abajo).' },
    actor: { type: 'categoría', range: 'HOST, PARTICIPANT, SYSTEM', description: 'Quién originó el evento.' },
    // flattened data keys
    reason: { type: 'categoría', description: 'round_closed: HOST, TIMEOUT, ALL_VOTED. join_failed: wrong_pin, locked_out, retired, room_unavailable, late_join_closed, room_full, invalid_code, removed_member.' },
    minutes: { type: 'entero', unit: 'min', description: 'Duración configurada o agregada (round_opened, deadline_extended); con una fecha de cierre, los minutos hasta ella.' },
    reopened: { type: 'booleano', description: 'round_opened: la ronda se reabrió tras selecciones insuficientes.' },
    timing: { type: 'categoría', range: 'duration, date', description: 'round_opened / deadline_extended: el anfitrión eligió una duración o la fecha y hora de cierre en el calendario (minutes es entonces la diferencia, redondeada).' },
    from_status: { type: 'categoría', description: 'room_cancelled: estado previo de la sala.' },
    had_joined: { type: 'booleano', description: 'member_removed: la persona ya había ingresado.' },
    count: { type: 'entero', description: 'member_added: códigos creados.' },
    effective_voters: { type: 'entero', description: 'round_processed / insufficient_votes: selecciones contadas.' },
    next_status: { type: 'categoría', description: 'round_processed: estado al que pasó la sala.' },
    version: { type: 'entero', description: 'vote_submitted: versión de la selección; consent_accepted: versión del texto.' },
    changed_vs_prev_version: { type: 'booleano', description: 'vote_submitted: la selección difiere de la versión anterior de la misma ronda.' },
    reasons_for: { type: 'entero', description: 'vote_submitted: razones a favor enviadas.' },
    reasons_against: { type: 'entero', description: 'vote_submitted: razones en contra enviadas.' },
    returning: { type: 'booleano', description: 'participant_joined: reingreso de alguien que ya estaba.' },
    roster: { type: 'booleano', description: 'participant_joined: ingreso con código de lista.' },
    mode: { type: 'categoría', range: 'pin, roster', description: 'join_failed: forma de ingreso intentada.' },
    device_tag: { type: 'texto (12 hex) o vacío', description: 'Etiqueta aleatoria del navegador para contar reintentos de un mismo dispositivo. No identifica a la persona.' },
    surface: { type: 'categoría', range: 'feedback, vote', description: 'Pantalla donde se vio el informe.' },
    visible_ms: { type: 'entero', unit: 'ms', range: '> 0', description: 'report_read: tiempo que el informe estuvo realmente visible.' },
    sections_opened: { type: 'entero', description: 'report_read: opciones del informe desplegadas en ese tiempo.' },
    editing: { type: 'booleano', description: 'ballot_viewed: el formulario se abrió para editar una selección ya enviada.' },
    method: { type: 'categoría', range: 'buttons, drag, touch', description: 'ranking_reordered: cómo se movió la opción.' },
    from_position: { type: 'entero', range: '1–m', description: 'ranking_reordered: lugar antes del movimiento.' },
    to_position: { type: 'entero', range: '1–m', description: 'ranking_reordered: lugar después del movimiento.' },
    reorder_index: { type: 'entero', range: '≥ 1', description: 'ranking_reordered: número de movimiento del participante en la ronda.' },
  },
};

const EVENT_TYPES: Array<[string, string]> = [
  ['round_opened', 'Se abrió una ronda (incluye el inicio de la sala).'],
  ['round_closed', 'Se cerró la ronda (no recibe más selecciones).'],
  ['round_processed', 'Se calculó el informe de la ronda.'],
  ['insufficient_votes', 'La ronda no tuvo selecciones suficientes para un informe.'],
  ['deadline_extended', 'El anfitrión agregó minutos.'],
  ['room_cancelled', 'El anfitrión canceló la sala.'],
  ['pin_reset', 'El anfitrión cambió el PIN de un participante.'],
  ['participant_expelled', 'El anfitrión retiró a un participante.'],
  ['participant_joined', 'Ingreso o reingreso de un participante.'],
  ['join_failed', 'Ingreso rechazado a una sala existente (nunca se guarda el PIN ni el código escrito).'],
  ['consent_accepted', 'El participante aceptó el consentimiento.'],
  ['vote_submitted', 'Envío de la selección (orden de las opciones y razones).'],
  ['report_delivered', 'El servidor entregó el informe de una ronda a la pantalla del participante. No es una lectura.'],
  ['report_read', 'El informe estuvo visible en pantalla `visible_ms` milisegundos.'],
  ['report_section_opened', 'El participante desplegó una opción del informe (vio las razones de los demás).'],
  ['ballot_viewed', 'Apareció el formulario de selección editable.'],
  ['ranking_reordered', 'Un cambio de orden antes de enviar.'],
  ['reason_field_added', 'Se agregó un campo de razón.'],
  ['reason_typing_started', 'Primera escritura en las razones de una opción y lado en la ronda (el texto no se registra).'],
  ['member_added', 'Se agregaron personas a la lista.'],
  ['member_removed', 'Se quitó a una persona de la lista.'],
  ['member_code_regenerated', 'Se cambió el código personal de una persona de la lista.'],
];

export function docFor(table: string, column: string): ColumnDoc | undefined {
  return COLUMN_DOCS[table]?.[column] ?? COMMON[column];
}

/** Columns present in the tables that have no description (must be empty). */
export function undocumentedColumns(tables: CsvTable[]): string[] {
  return tables.flatMap((t) => t.headers.filter((h) => !docFor(t.name, h)).map((h) => `${t.name}:${h}`));
}

const cellText = (s: string) => s.replace(/\|/g, '\\|');

export interface DictionaryMeta {
  mode: 'research' | 'publication';
  includesFreeText: boolean;
}

export function buildDataDictionary(tables: CsvTable[], meta: DictionaryMeta): string {
  const lines: string[] = [
    '# Diccionario de datos del export r-FAST-CR',
    '',
    meta.mode === 'publication'
      ? 'Modo **publicación (anonimizado)**: sin fechas absolutas (solo tiempos relativos a la apertura de cada ronda), sin identificadores internos (alias estables), sin el nombre de la sala' +
        (meta.includesFreeText ? '. Incluye el texto de las razones porque se declaró aprobada su publicación.' : ' y sin textos libres.')
      : 'Modo **investigación**: datos completos de la sala, con fechas ISO 8601 en UTC' +
        (meta.includesFreeText ? ' y el texto de las razones.' : '; sin textos libres.'),
    '',
    'Formato: CSV en UTF-8 con BOM, separador coma, fin de línea CRLF. Decimales con punto y exactamente 4 cifras. Booleanos `true` / `false`. Celda vacía = sin dato. Los textos que empiezan con `=`, `+`, `-` o `@` llevan un apóstrofo delante para que una planilla no los ejecute como fórmula.',
    '',
    'Las personas aparecen solo por su código ciego (`blind_code`). La lista del curso (matrícula o usuario ↔ código) nunca forma parte del export. `manifest.json` trae el hash SHA-256 de cada archivo.',
    '',
    'Notación: n = selecciones contadas en la ronda, m = cantidad de opciones. Una selección es el orden de las opciones que envía un participante en una ronda.',
  ];
  for (const t of tables) {
    lines.push('', `## ${t.name}`, '', `${t.rows.length} filas.`, '', '| Columna | Tipo | Unidad | Rango | Descripción |', '|---|---|---|---|---|');
    for (const h of t.headers) {
      const d = docFor(t.name, h);
      lines.push(`| \`${h}\` | ${cellText(d?.type ?? '')} | ${cellText(d?.unit ?? '')} | ${cellText(d?.range ?? '')} | ${cellText(d?.description ?? '')} |`);
    }
  }
  lines.push('', '## Tipos de evento (`events.csv` → `type`)', '', '| Tipo | Significado |', '|---|---|');
  for (const [type, text] of EVENT_TYPES) lines.push(`| \`${type}\` | ${cellText(text)} |`);
  lines.push('');
  return lines.join('\n');
}
