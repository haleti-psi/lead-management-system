import * as React from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isApiClientError } from '@/lib/api';
import {
  useCreateProductConfig,
  useUpdateProductConfig,
} from '@/hooks/use-product-configs';
import type {
  ChecklistItem,
  CreateProductConfigBody,
  EligibilityMappingField,
  FieldSchemaField,
  FieldSchemaGroup,
  ProductConfig,
  UpdateProductConfigBody,
} from '@/types/product-config';
import {
  APPLICANT_SCOPE_OPTIONS,
  DOC_TYPE_OPTIONS,
  FIELD_TYPE_OPTIONS,
  PAN_TIMING_OPTIONS,
  PRODUCT_CODE_OPTIONS,
  createProductConfigSchema,
} from './product-config-form-schema';

/** Shared select styling (mirrors EntityForm's FormSelect). */
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/** A single SLA threshold editor row (key → positive integer hours). */
interface SlaRow {
  key: string;
  hours: string;
}

interface FormState {
  product_code: string;
  name: string;
  pan_required_at: string;
  groups: FieldSchemaGroup[];
  items: ChecklistItem[];
  sla: SlaRow[];
  mappings: EligibilityMappingField[];
}

/** Path-keyed error bag (e.g. `name`, `field_schema.groups.0.fields.1.key`). */
type Errors = Record<string, string>;

function emptyField(): FieldSchemaField {
  return { key: '', label: '', type: 'text', mandatory: false };
}
function emptyGroup(): FieldSchemaGroup {
  return { id: '', label: '', fields: [emptyField()] };
}
function emptyItem(): ChecklistItem {
  return { doc_type: 'id', mandatory: true, applicant_scope: 'applicant' };
}
function emptyMapping(): EligibilityMappingField {
  return { lms_field: '', los_field: '' };
}

function initialState(config?: ProductConfig): FormState {
  if (!config) {
    return {
      product_code: '',
      name: '',
      pan_required_at: '',
      groups: [emptyGroup()],
      items: [emptyItem()],
      sla: [],
      mappings: [],
    };
  }
  return {
    product_code: config.product_code,
    name: config.name,
    pan_required_at: config.pan_required_at,
    groups: config.field_schema.groups.map((g) => ({
      ...g,
      fields: g.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })),
    })),
    items: config.document_checklist.items.map((i) => ({ ...i })),
    sla: config.sla_config
      ? Object.entries(config.sla_config).map(([key, hours]) => ({ key, hours: String(hours) }))
      : [],
    mappings: config.eligibility_mapping ? config.eligibility_mapping.fields.map((m) => ({ ...m })) : [],
  };
}

/**
 * FR-040 §UI — create or edit a product configuration. A new config is a maker
 * step that lands in `draft`; editing an ACTIVE config never mutates the live row,
 * it submits a NEW draft version. Either way the change enters the FR-132
 * maker-checker flow as a pending `configuration_versions` row — it does NOT go
 * live until a checker approves it, which the copy here makes explicit.
 *
 * The form pre-validates with the same Zod schema the backend uses, then surfaces
 * any server `VALIDATION_ERROR.fields[]` inline; other errors raise a toast.
 */
export function ProductConfigForm({
  config,
  onClose,
}: {
  config?: ProductConfig;
  onClose: () => void;
}): JSX.Element {
  const isEdit = config != null;
  const create = useCreateProductConfig();
  const update = useUpdateProductConfig();
  const [state, setState] = React.useState<FormState>(() => initialState(config));
  const [errors, setErrors] = React.useState<Errors>({});
  const [submitting, setSubmitting] = React.useState(false);
  const noticeId = React.useId();

  function setErr(next: z.ZodError): void {
    const bag: Errors = {};
    for (const issue of next.issues) {
      bag[issue.path.join('.')] = issue.message;
    }
    setErrors(bag);
  }

  function buildBody(): CreateProductConfigBody {
    const sla: Record<string, number> = {};
    for (const row of state.sla) {
      if (row.key.trim()) sla[row.key.trim()] = Number(row.hours);
    }
    return {
      product_code: state.product_code as CreateProductConfigBody['product_code'],
      name: state.name.trim(),
      field_schema: {
        groups: state.groups.map((g) => ({
          id: g.id.trim(),
          label: g.label.trim(),
          fields: g.fields.map((f) => ({
            key: f.key.trim(),
            label: f.label.trim(),
            type: f.type,
            mandatory: f.mandatory,
            ...(f.type === 'select' ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
          })),
        })),
      },
      document_checklist: { items: state.items },
      ...(state.sla.length > 0 ? { sla_config: sla } : {}),
      ...(state.mappings.length > 0
        ? { eligibility_mapping: { fields: state.mappings.map((m) => ({ lms_field: m.lms_field.trim(), los_field: m.los_field.trim() })) } }
        : {}),
      pan_required_at: state.pan_required_at as CreateProductConfigBody['pan_required_at'],
    };
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErrors({});
    const body = buildBody();
    const parsed = createProductConfigSchema.safeParse(body);
    if (!parsed.success) {
      setErr(parsed.error);
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        // PATCH the full payload as a new draft version (the backend overlays it
        // onto the active row and inserts a fresh draft — the live row is untouched).
        const patch: UpdateProductConfigBody = {
          name: body.name,
          field_schema: body.field_schema,
          document_checklist: body.document_checklist,
          pan_required_at: body.pan_required_at,
          ...(body.sla_config ? { sla_config: body.sla_config } : {}),
          ...(body.eligibility_mapping ? { eligibility_mapping: body.eligibility_mapping } : {}),
        };
        await update.mutateAsync({ productConfigId: config.product_config_id, body: patch });
        toast.success('New draft version submitted for checker approval.');
      } else {
        await create.mutateAsync(body);
        toast.success('Configuration submitted for checker approval.');
      }
      onClose();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR' && error.fields?.length) {
        const bag: Errors = {};
        for (const field of error.fields) bag[field.field] = field.issue;
        setErrors(bag);
        return;
      }
      if (isApiClientError(error) && error.code === 'FORBIDDEN') {
        toast.error("You don't have access to change product configuration.");
        return;
      }
      if (isApiClientError(error) && error.code === 'CONFLICT') {
        toast.error('This configuration can no longer be edited. Refresh and try again.');
        return;
      }
      toast.error('Could not save the configuration. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-5">
      <p id={noticeId} className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
        {isEdit
          ? 'Editing an active configuration creates a new draft version. It is not applied until a checker approves it.'
          : 'This configuration is saved as a draft and goes live only after a checker approves it.'}
      </p>

      {/* Identity */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product code" required error={errors['product_code']} htmlFor="pc-product-code">
          <select
            id="pc-product-code"
            className={SELECT_CLASS}
            value={state.product_code}
            disabled={isEdit}
            aria-required
            aria-invalid={errors['product_code'] ? true : undefined}
            onChange={(ev) => setState((s) => ({ ...s, product_code: ev.target.value }))}
          >
            <option value="">Select…</option>
            {PRODUCT_CODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PAN required at" required error={errors['pan_required_at']} htmlFor="pc-pan">
          <select
            id="pc-pan"
            className={SELECT_CLASS}
            value={state.pan_required_at}
            aria-required
            aria-invalid={errors['pan_required_at'] ? true : undefined}
            onChange={(ev) => setState((s) => ({ ...s, pan_required_at: ev.target.value }))}
          >
            <option value="">Select…</option>
            {PAN_TIMING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Name" required error={errors['name']} htmlFor="pc-name">
        <Input
          id="pc-name"
          value={state.name}
          maxLength={120}
          aria-required
          aria-invalid={errors['name'] ? true : undefined}
          onChange={(ev) => setState((s) => ({ ...s, name: ev.target.value }))}
        />
      </Field>

      <FieldSchemaEditor
        groups={state.groups}
        errors={errors}
        onChange={(groups) => setState((s) => ({ ...s, groups }))}
      />

      <ChecklistEditor
        items={state.items}
        errors={errors}
        onChange={(items) => setState((s) => ({ ...s, items }))}
      />

      <SlaEditor sla={state.sla} errors={errors} onChange={(sla) => setState((s) => ({ ...s, sla }))} />

      <EligibilityEditor
        mappings={state.mappings}
        errors={errors}
        onChange={(mappings) => setState((s) => ({ ...s, mappings }))}
      />

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Submit for approval
        </Button>
      </div>
    </form>
  );
}

/** A labelled control wrapper with an inline error (role="alert"). */
function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            {' *'}
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" aria-live="polite" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A bordered editor section with a title and an add-row button. */
function Section({
  title,
  description,
  onAdd,
  addLabel,
  error,
  children,
}: {
  title: string;
  description?: string;
  onAdd: () => void;
  addLabel: string;
  error?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <fieldset className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <legend className="text-sm font-semibold">
          {title}
          {description ? <span className="ml-2 font-normal text-muted-foreground">{description}</span> : null}
        </legend>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden />
          {addLabel}
        </Button>
      </div>
      {error ? (
        <p role="alert" aria-live="polite" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}

function FieldSchemaEditor({
  groups,
  errors,
  onChange,
}: {
  groups: FieldSchemaGroup[];
  errors: Errors;
  onChange: (groups: FieldSchemaGroup[]) => void;
}): JSX.Element {
  function patchGroup(gi: number, patch: Partial<FieldSchemaGroup>): void {
    onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  }
  function patchField(gi: number, fi: number, patch: Partial<FieldSchemaField>): void {
    patchGroup(gi, {
      fields: groups[gi].fields.map((f, i) => (i === fi ? { ...f, ...patch } : f)),
    });
  }

  return (
    <Section
      title="Capture fields"
      description="Field groups shown on the capture form"
      addLabel="Add group"
      onAdd={() => onChange([...groups, emptyGroup()])}
      error={errors['field_schema.groups']}
    >
      <div className="space-y-4">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Group id" htmlFor={`g-${gi}-id`} required error={errors[`field_schema.groups.${gi}.id`]}>
                <Input
                  id={`g-${gi}-id`}
                  value={group.id}
                  onChange={(e) => patchGroup(gi, { id: e.target.value })}
                />
              </Field>
              <Field label="Group label" htmlFor={`g-${gi}-label`} required error={errors[`field_schema.groups.${gi}.label`]}>
                <Input
                  id={`g-${gi}-label`}
                  value={group.label}
                  onChange={(e) => patchGroup(gi, { label: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove group ${gi + 1}`}
                disabled={groups.length <= 1}
                onClick={() => onChange(groups.filter((_, i) => i !== gi))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            {errors[`field_schema.groups.${gi}.fields`] ? (
              <p role="alert" className="text-sm text-destructive">
                {errors[`field_schema.groups.${gi}.fields`]}
              </p>
            ) : null}

            <div className="space-y-2">
              {group.fields.map((field, fi) => {
                const base = `field_schema.groups.${gi}.fields.${fi}`;
                return (
                  <div key={fi} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
                    <Field label="Key" htmlFor={`${base}-key`} required error={errors[`${base}.key`]}>
                      <Input
                        id={`${base}-key`}
                        value={field.key}
                        onChange={(e) => patchField(gi, fi, { key: e.target.value })}
                      />
                    </Field>
                    <Field label="Label" htmlFor={`${base}-label`} required error={errors[`${base}.label`]}>
                      <Input
                        id={`${base}-label`}
                        value={field.label}
                        onChange={(e) => patchField(gi, fi, { label: e.target.value })}
                      />
                    </Field>
                    <Field label="Type" htmlFor={`${base}-type`} error={errors[`${base}.type`]}>
                      <select
                        id={`${base}-type`}
                        className={SELECT_CLASS}
                        value={field.type}
                        onChange={(e) =>
                          patchField(gi, fi, { type: e.target.value as FieldSchemaField['type'] })
                        }
                      >
                        {FIELD_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label className="flex h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={field.mandatory}
                        onChange={(e) => patchField(gi, fi, { mandatory: e.target.checked })}
                      />
                      Mandatory
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove field ${fi + 1} in group ${gi + 1}`}
                      disabled={group.fields.length <= 1}
                      onClick={() =>
                        patchGroup(gi, { fields: group.fields.filter((_, i) => i !== fi) })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                    {field.type === 'select' ? (
                      <div className="sm:col-span-5">
                        <Field
                          label="Options (comma-separated)"
                          htmlFor={`${base}-options`}
                          required
                          error={errors[`${base}.options`]}
                        >
                          <Input
                            id={`${base}-options`}
                            value={(field.options ?? []).join(', ')}
                            placeholder="e.g. LCV, HCV, SCV"
                            onChange={(e) =>
                              patchField(gi, fi, {
                                options: e.target.value
                                  .split(',')
                                  .map((o) => o.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => patchGroup(gi, { fields: [...group.fields, emptyField()] })}
              >
                <Plus className="h-4 w-4" aria-hidden />
                Add field
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ChecklistEditor({
  items,
  errors,
  onChange,
}: {
  items: ChecklistItem[];
  errors: Errors;
  onChange: (items: ChecklistItem[]) => void;
}): JSX.Element {
  function patch(idx: number, p: Partial<ChecklistItem>): void {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...p } : it)));
  }
  return (
    <Section
      title="Document checklist"
      addLabel="Add document"
      onAdd={() => onChange([...items, emptyItem()])}
      error={errors['document_checklist.items']}
    >
      <div className="space-y-2">
        {items.map((item, i) => {
          const base = `document_checklist.items.${i}`;
          return (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
              <Field label="Document type" htmlFor={`${base}-doc`} error={errors[`${base}.doc_type`]}>
                <select
                  id={`${base}-doc`}
                  className={SELECT_CLASS}
                  value={item.doc_type}
                  onChange={(e) => patch(i, { doc_type: e.target.value as ChecklistItem['doc_type'] })}
                >
                  {DOC_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Applicant scope" htmlFor={`${base}-scope`} error={errors[`${base}.applicant_scope`]}>
                <select
                  id={`${base}-scope`}
                  className={SELECT_CLASS}
                  value={item.applicant_scope}
                  onChange={(e) =>
                    patch(i, { applicant_scope: e.target.value as ChecklistItem['applicant_scope'] })
                  }
                >
                  {APPLICANT_SCOPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={item.mandatory}
                  onChange={(e) => patch(i, { mandatory: e.target.checked })}
                />
                Mandatory
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove document ${i + 1}`}
                disabled={items.length <= 1}
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SlaEditor({
  sla,
  errors,
  onChange,
}: {
  sla: SlaRow[];
  errors: Errors;
  onChange: (sla: SlaRow[]) => void;
}): JSX.Element {
  function patch(idx: number, p: Partial<SlaRow>): void {
    onChange(sla.map((row, i) => (i === idx ? { ...row, ...p } : row)));
  }
  return (
    <Section
      title="SLA thresholds"
      description="Optional · hours"
      addLabel="Add threshold"
      onAdd={() => onChange([...sla, { key: '', hours: '' }])}
    >
      {sla.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SLA thresholds. Add one if this product has timing targets.</p>
      ) : (
        <div className="space-y-2">
          {sla.map((row, i) => {
            // Server validates by SLA key (e.g. sla_config.capture_to_contact_hours).
            const err = row.key.trim() ? errors[`sla_config.${row.key.trim()}`] : undefined;
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_auto]">
                <Field label="Key" htmlFor={`sla-${i}-key`}>
                  <Input
                    id={`sla-${i}-key`}
                    value={row.key}
                    placeholder="capture_to_contact_hours"
                    onChange={(e) => patch(i, { key: e.target.value })}
                  />
                </Field>
                <Field label="Hours" htmlFor={`sla-${i}-hours`} error={err}>
                  <Input
                    id={`sla-${i}-hours`}
                    type="number"
                    min={1}
                    step={1}
                    value={row.hours}
                    onChange={(e) => patch(i, { hours: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove SLA threshold ${i + 1}`}
                  onClick={() => onChange(sla.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function EligibilityEditor({
  mappings,
  errors,
  onChange,
}: {
  mappings: EligibilityMappingField[];
  errors: Errors;
  onChange: (mappings: EligibilityMappingField[]) => void;
}): JSX.Element {
  function patch(idx: number, p: Partial<EligibilityMappingField>): void {
    onChange(mappings.map((m, i) => (i === idx ? { ...m, ...p } : m)));
  }
  return (
    <Section
      title="Eligibility mapping"
      description="Optional · LMS field → LOS field"
      addLabel="Add mapping"
      onAdd={() => onChange([...mappings, emptyMapping()])}
    >
      {mappings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No mappings. Each LMS field must be one of the capture-field keys declared above.
        </p>
      ) : (
        <div className="space-y-2">
          {mappings.map((m, i) => {
            const base = `eligibility_mapping.fields.${i}`;
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="LMS field (capture key)" htmlFor={`${base}-lms`} required error={errors[`${base}.lms_field`]}>
                  <Input
                    id={`${base}-lms`}
                    value={m.lms_field}
                    onChange={(e) => patch(i, { lms_field: e.target.value })}
                  />
                </Field>
                <Field label="LOS field" htmlFor={`${base}-los`} required error={errors[`${base}.los_field`]}>
                  <Input
                    id={`${base}-los`}
                    value={m.los_field}
                    onChange={(e) => patch(i, { los_field: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove mapping ${i + 1}`}
                  onClick={() => onChange(mappings.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
