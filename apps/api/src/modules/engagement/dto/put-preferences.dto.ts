import { z } from 'zod';

import { CommChannel, ConsentPurpose, SubjectType } from '@lms/shared';

const PreferenceItemSchema = z.object({
  channel: z.nativeEnum(CommChannel, {
    errorMap: () => ({ message: 'channel must be one of: in_app, email, sms, whatsapp' }),
  }),
  purpose: z.nativeEnum(ConsentPurpose, {
    errorMap: () => ({ message: 'purpose must be a valid consent purpose' }),
  }),
  opted_in: z.boolean({ required_error: 'opted_in must be a boolean' }),
});

/**
 * FR-103 — Zod schema for PUT /api/v1/preferences (batch upsert).
 * Also used for PUT /api/v1/c/{token}/preferences (same shape; guard
 * enforces subject_type=customer and subject_ref match for the token).
 */
export const PutPreferencesDto = z.object({
  subject_type: z.nativeEnum(SubjectType, {
    errorMap: () => ({ message: "subject_type must be 'user' or 'customer'" }),
  }),
  subject_ref: z
    .string({ required_error: 'subject_ref must be a valid UUID' })
    .uuid('subject_ref must be a valid UUID'),
  preferences: z
    .array(PreferenceItemSchema)
    .min(1, 'preferences must contain 1 to 50 items')
    .max(50, 'preferences must contain 1 to 50 items'),
});

export type PutPreferencesDto = z.infer<typeof PutPreferencesDto>;
