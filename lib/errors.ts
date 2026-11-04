/**
 * lib/errors.ts
 * Typed application errors for consistent API responses.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  QUORUM_UNMET:         (_m?: number, _min?: number) =>
    new AppError('QUORUM_UNMET', 'Faltan votos para calcular el resultado. Se necesitan al menos 3 votos válidos.', 422),
  ROOM_NOT_FOUND:       () => new AppError('ROOM_NOT_FOUND', 'Sala no encontrada.', 404),
  PARTICIPANT_NOT_FOUND: () => new AppError('PARTICIPANT_NOT_FOUND', 'Participante no encontrado en esta sala.', 404),
  WRONG_PIN:            () => new AppError('WRONG_PIN', 'PIN incorrecto.', 401),
  LOCKED_OUT:           (sec: number) =>
    new AppError('LOCKED_OUT', `Demasiados intentos fallidos. Acceso bloqueado temporalmente por ${sec} segundos.`, 429),
  ROOM_CLOSED:          () => new AppError('ROOM_CLOSED', 'La sala no está abierta para votar.', 403),
  INVALID_BALLOT:       (msg: string) => new AppError('INVALID_BALLOT', msg, 422),
  JUSTIFICATION_SHORT:  () =>
    new AppError('JUSTIFICATION_SHORT', 'La razón debe tener al menos 25 caracteres.', 422),
  JUSTIFICATION_LONG:   () =>
    new AppError('JUSTIFICATION_LONG', 'La razón no puede superar los 200 caracteres.', 422),
  INVALID_STATE:        (from: string, to: string) =>
    new AppError('INVALID_STATE', `Transición inválida: ${from} → ${to}`, 409),
  NOT_ROUND1_VOTER:     () =>
    new AppError('NOT_ROUND1_VOTER', 'Solo pueden votar en rondas posteriores quienes votaron en la ronda 1.', 403),
  NICKNAME_TAKEN:       () => new AppError('NICKNAME_TAKEN', 'El nombre ya está en uso en esta sala.', 409),
  ROOM_FULL:            (max: number) =>
    new AppError('ROOM_FULL', `La sala ha alcanzado su capacidad máxima de ${max} participantes.`, 409),
  RATE_LIMITED:         (resetIn: number) =>
    new AppError('RATE_LIMITED', `Demasiadas solicitudes. Reintenta en ${resetIn}s.`, 429),
  UNAUTHORIZED:         () => new AppError('UNAUTHORIZED', 'No autorizado.', 401),
  BUSY:                 () =>
    new AppError('BUSY', 'Llegaron muchos votos a la vez y no se pudo guardar el tuyo. Envíalo de nuevo.', 503),
  CANNOT_JOIN:          () => new AppError('CANNOT_JOIN', 'No se puede ingresar a esa sala. Revisa tus datos.', 400),
  INVALID_N_RANGE:      (n: number) =>
    new AppError('INVALID_N_RANGE', `El número de opciones debe ser entre 3 y 8 (recibido: ${n}).`, 422),
};

/**
 * Converts any error to a JSON-safe API response object.
 */
export function toApiError(err: unknown): { error: string; code: string; status: number } {
  if (err instanceof AppError) {
    return { error: err.message, code: err.code, status: err.status };
  }
  console.error('[UnhandledError]', err);
  return { error: 'Error interno del servidor.', code: 'INTERNAL_ERROR', status: 500 };
}
