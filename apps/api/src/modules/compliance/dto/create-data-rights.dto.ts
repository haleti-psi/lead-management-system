import { z } from 'zod';

import { RightsType } from '@lms/shared';

/**
 * FR-112 — `POST /data-rights` request body (LLD §Validation CreateDataRightsDto).
 * Validated by {@link ZodValidationPipe} at the controller boundary.
 *
 * Also used for the customer-link path `POST /c/{token}/data-rights`;
 * the controller sets `customerProfileId` from the token and validates
 * `leadId` scope separately.
 */
export const CreateDataRightsDto = z.object({
  customerProfileId: z
    .string({ required_error: 'customer_profile_id must be a valid UUID.' })
    .uuid('customer_profile_id must be a valid UUID.'),

  leadId: z
    .string()
    .uuid('lead_id must be a valid UUID.')
    .nullish()
    .transform((v) => v ?? null),

  requestType: z.nativeEnum(RightsType, {
    errorMap: () => ({
      message:
        'request_type must be one of: access, correction, update, erasure, withdrawal, grievance.',
    }),
  }),
});

export type CreateDataRightsDto = z.infer<typeof CreateDataRightsDto>;
