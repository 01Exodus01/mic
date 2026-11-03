/**
 * lib/validations.ts
 * Centralized Zod schemas and sanitization functions for GDSS r-FAST-CR.
 * Shared between client UI (live validation) and Server Actions / API routes.
 */

import { z } from 'zod';
import { AggregationMethod } from '@prisma/client';

/**
 * Fixed methodology constant: minimum participants required to compute consensus.
 * Hardcoded in business logic, not stored per-room in the database.
 */
export const MIN_PARTICIPANTS = 3;

// ─────────────────────────────────────────────
// Text Sanitization Utilities
// ─────────────────────────────────────────────

/**
 * Normalizes unicode (NFKC), trims outer whitespace, collapses repeated internal spaces,
 * and removes non-printable control characters.
 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

/**
 * Collapses internal whitespace into single space.
 */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ');
}

/**
 * Sanitizes participant nickname: trims, normalizes unicode, collapses whitespace,
 * and removes control characters.
 */
export function sanitizeNickname(input: unknown): string {
  return collapseWhitespace(sanitizeText(input));
}

/**
 * Counts characters using Unicode code points / graphemes so emojis and multi-byte characters
 * count accurately.
 */
export function getUnicodeLength(input: string): number {
  return Array.from(input).length;
}

// ─────────────────────────────────────────────
// 1. PIN de Sala (Landing & Participant Join)
// ─────────────────────────────────────────────

export const RoomPinSchema = z
  .string({ required_error: 'El PIN de la sala es obligatorio.' })
  .transform((v) => sanitizeText(v).replace(/\s+/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .min(1, 'El PIN de la sala es obligatorio.')
      .regex(/^[A-Z0-9]{6}$/, 'El PIN de la sala debe tener 6 caracteres alfanuméricos.')
  );

// ─────────────────────────────────────────────
// 2. Participante: Nombre / Alias
// ─────────────────────────────────────────────

export const ParticipantNicknameSchema = z
  .string({ required_error: 'El nombre es obligatorio.' })
  .transform((v) => collapseWhitespace(sanitizeText(v)))
  .pipe(
    z
      .string()
      .min(1, 'El nombre es obligatorio.')
      .min(3, 'Mínimo 3 caracteres.')
      .max(30, 'Máximo 30 caracteres.')
      .regex(
        /^[\p{L}\p{N}\s_.'-]+$/u,
        "El nombre solo puede contener letras, números, espacios y los signos - _ . '"
      )
  );

// ─────────────────────────────────────────────
// 3. Participante: PIN Personal (4 dígitos)
// ─────────────────────────────────────────────

export const PersonalPinSchema = z
  .string({ required_error: 'El PIN personal es obligatorio.' })
  .transform((v) => sanitizeText(v).replace(/\s+/g, ''))
  .pipe(
    z
      .string()
      .min(1, 'El PIN personal es obligatorio.')
      .regex(/^\d{4}$/, 'El PIN personal debe tener exactamente 4 dígitos.')
  );

// ─────────────────────────────────────────────
// 4. Formulario de Ingreso de Participante (Join)
// ─────────────────────────────────────────────

export const ParticipantJoinSchema = z.object({
  roomPin: RoomPinSchema,
  nickname: ParticipantNicknameSchema,
  pin4: PersonalPinSchema,
});

export type ParticipantJoinInput = z.infer<typeof ParticipantJoinSchema>;

// ─────────────────────────────────────────────
// 5. Boleta de Votación y Razones
// ─────────────────────────────────────────────

export const SingleVoteEntrySchema = z.object({
  optionId: z
    .string({ required_error: 'Campo obligatorio: optionId' })
    .min(1, 'Campo obligatorio: optionId'),
  position: z
    .number({ required_error: 'Campo obligatorio: posición' })
    .int('La posición debe ser un número entero.')
    .min(1, 'La posición mínima es 1.'),
  justification: z
    .string({ required_error: 'La razón es obligatoria.' })
    .transform((v) => sanitizeText(v))
    .refine((v) => getUnicodeLength(v) >= 25, {
      message: 'Mínimo 25 caracteres.',
    })
    .refine((v) => getUnicodeLength(v) <= 200, {
      message: 'Máximo 200 caracteres.',
    }),
});

export type SingleVoteEntry = z.infer<typeof SingleVoteEntrySchema>;

// ─────────────────────────────────────────────
// 6. Autenticación de Anfitrión: Login & Registro
// ─────────────────────────────────────────────

export const HostEmailSchema = z
  .string({ required_error: 'El correo electrónico es obligatorio.' })
  .transform((v) => sanitizeText(v).toLowerCase())
  .pipe(
    z
      .string()
      .min(1, 'El correo electrónico es obligatorio.')
      .email('Ingresa un correo electrónico válido.')
      .max(100, 'Máximo 100 caracteres.')
  );

export const HostLoginSchema = z.object({
  email: HostEmailSchema,
  password: z
    .string({ required_error: 'La contraseña es obligatoria.' })
    .min(1, 'La contraseña es obligatoria.')
    .max(72, 'Máximo 72 caracteres.'),
});

export type HostLoginInput = z.infer<typeof HostLoginSchema>;

export const HostRegisterSchema = z.object({
  name: z
    .string({ required_error: 'El nombre es obligatorio.' })
    .transform((v) => collapseWhitespace(sanitizeText(v)))
    .pipe(
      z
        .string()
        .min(1, 'El nombre es obligatorio.')
        .min(3, 'Mínimo 3 caracteres.')
        .max(30, 'Máximo 30 caracteres.')
    ),
  email: HostEmailSchema,
  password: z
    .string({ required_error: 'La contraseña es obligatoria.' })
    .min(8, 'Mínimo 8 caracteres.')
    .max(72, 'Máximo 72 caracteres.'),
});

export type HostRegisterInput = z.infer<typeof HostRegisterSchema>;
export const RegisterHostSchema = HostRegisterSchema;

// ─────────────────────────────────────────────
// 7. Opciones de Sala
// ─────────────────────────────────────────────

export const OptionItemSchema = z.object({
  title: z
    .string({ required_error: 'El título de la opción es obligatorio.' })
    .transform((v) => collapseWhitespace(sanitizeText(v)))
    .pipe(
      z
        .string()
        .min(1, 'El título de la opción es obligatorio.')
        .min(3, 'Mínimo 3 caracteres.')
        .max(80, 'Máximo 80 caracteres.')
    ),
  description: z
    .string()
    .optional()
    .transform((v) => (v ? collapseWhitespace(sanitizeText(v)) : ''))
    .pipe(
      z
        .string()
        .max(300, 'Máximo 300 caracteres.')
        .refine(
          (val) => val.length === 0 || val.length >= 10,
          'Mínimo 10 caracteres si incluyes descripción.'
        )
    ),
});

// ─────────────────────────────────────────────
// 8. Creación de Nueva Sala
// ─────────────────────────────────────────────

export const CreateRoomSchema = z
  .object({
    title: z
      .string({ required_error: 'El título de la actividad es obligatorio.' })
      .transform((v) => collapseWhitespace(sanitizeText(v)))
      .pipe(
        z
          .string()
          .min(1, 'El título de la actividad es obligatorio.')
          .min(5, 'Mínimo 5 caracteres.')
          .max(100, 'Máximo 100 caracteres.')
      ),
    method: z.nativeEnum(AggregationMethod, {
      required_error: 'Selecciona una regla de decisión colectiva.',
      invalid_type_error: 'Selecciona una regla de decisión colectiva.',
    }),
    maxMembers: z
      .number({
        required_error: 'Campo obligatorio.',
        invalid_type_error: 'Campo obligatorio.',
      })
      .int('Debe ser un número entero.')
      .min(3, 'Mínimo 3 participantes.')
      .max(40, 'Máximo 40 participantes.'),
    tauThreshold: z
      .number({
        required_error: 'Campo obligatorio.',
        invalid_type_error: 'Campo obligatorio.',
      })
      .min(1, 'El acuerdo debe estar entre 1% y 100%.')
      .max(100, 'El acuerdo debe estar entre 1% y 100%.')
      .transform((val) => (val >= 1 ? Math.round((val / 100) * 1000) / 1000 : val)),
    maxRounds: z
      .number({
        required_error: 'Campo obligatorio.',
        invalid_type_error: 'Campo obligatorio.',
      })
      .int('Debe ser un número entero.')
      .min(1, 'Mínimo 1 ronda.')
      .max(10, 'Máximo 10 rondas.'),
    options: z
      .array(OptionItemSchema, {
        required_error: 'Las opciones a evaluar son obligatorias.',
      })
      .min(3, 'Se requiere un mínimo de 3 opciones a evaluar.')
      .max(8, 'El límite máximo es de 8 opciones a evaluar.')
      .refine(
        (opts) => {
          const titles = opts.map((o) => o.title.toLowerCase().trim()).filter(Boolean);
          const uniqueTitles = new Set(titles);
          return uniqueTitles.size === titles.length;
        },
        {
          message: 'No puede haber opciones con el mismo título.',
          path: ['options'],
        }
      ),
  });

export type CreateRoomParsedInput = z.infer<typeof CreateRoomSchema>;

// ─────────────────────────────────────────────
// 9. Formularios Adicionales (Duración & Restablecer PIN)
// ─────────────────────────────────────────────

export const RoundDurationSchema = z
  .number({
    required_error: 'Campo obligatorio.',
    invalid_type_error: 'Campo obligatorio.',
  })
  .int('La duración debe ser un número entero.')
  .min(1, 'La duración debe estar entre 1 y 10080 minutos.')
  .max(10080, 'La duración debe estar entre 1 y 10080 minutos.');

export const ResetPinSchema = z.object({
  newPin: PersonalPinSchema,
});
