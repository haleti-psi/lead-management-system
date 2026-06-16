import * as React from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { EntityForm, FormField, FormSelect } from '@/components/forms/EntityForm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useCreateMaster, useUpdateMaster } from '@/hooks/use-master-data';
import type {
  BusinessCalendarView,
  DayHours,
  Holiday,
  PatchBusinessCalendarBody,
  WorkingHours,
} from '@/types/master-data';
import { masterFormError } from './form-utils';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Weekday = (typeof WEEKDAYS)[number];
const WEEKDAY_LABEL: Readonly<Record<Weekday, string>> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const BOOL_OPTIONS = [
  { value: 'yes', label: 'Active' },
  { value: 'no', label: 'Inactive' },
];

/** A sensible default Mon–Fri 09:30–18:00 week (used for a new calendar). */
function defaultWorkingHours(): WorkingHours {
  const weekday: DayHours = { start: '09:30', end: '18:00' };
  return { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: null, sun: null };
}

/** FR-131 — business-calendar create/edit. Scalars (code/name/timezone) run
 * through the shared EntityForm; the per-weekday schedule and holiday list use
 * dedicated editors and are validated on submit (every weekday key is required,
 * times must be HH:MM, holiday dates YYYY-MM-DD). */
const scalarSchema = z.object({
  code: z.string().trim().min(1, 'code is required and must be unique.').max(40, 'code must not exceed 40 characters.'),
  name: z.string().trim().min(1, 'name is required.').max(120, 'name must not exceed 120 characters.'),
  timezone: z.string().trim().min(1, 'timezone is required.'),
});
type CreateValues = z.infer<typeof scalarSchema>;
const editSchema = scalarSchema.extend({ isActive: z.enum(['yes', 'no']) });
type EditValues = z.infer<typeof editSchema>;

export function BusinessCalendarForm({
  calendar,
  onClose,
}: {
  calendar?: BusinessCalendarView;
  onClose: () => void;
}): JSX.Element {
  const create = useCreateMaster('business-calendars');
  const update = useUpdateMaster('business-calendars');

  const [hours, setHours] = React.useState<WorkingHours>(calendar?.workingHours ?? defaultWorkingHours());
  const [holidays, setHolidays] = React.useState<Holiday[]>(calendar?.holidays ?? []);
  const [structuralError, setStructuralError] = React.useState<string | null>(null);

  function validateStructure(): WorkingHours | null {
    for (const day of WEEKDAYS) {
      const slot = hours[day];
      if (slot && (!HHMM.test(slot.start) || !HHMM.test(slot.end))) {
        setStructuralError(`${WEEKDAY_LABEL[day]} times must be in HH:MM (24h) format.`);
        return null;
      }
    }
    for (const h of holidays) {
      if (!ISO_DATE.test(h.date) || !h.name.trim()) {
        setStructuralError('Each holiday needs a date (YYYY-MM-DD) and a name.');
        return null;
      }
    }
    setStructuralError(null);
    return hours;
  }

  async function onSubmit(v: CreateValues | EditValues): Promise<void> {
    const wh = validateStructure();
    if (!wh) return; // structural error already surfaced inline
    const cleanedHolidays = holidays.map((h) => ({ date: h.date, name: h.name.trim() }));
    const common = {
      code: v.code.trim(),
      name: v.name.trim(),
      timezone: v.timezone.trim(),
      workingHours: wh,
      ...(cleanedHolidays.length > 0 ? { holidays: cleanedHolidays } : {}),
    };
    if (calendar) {
      const body: PatchBusinessCalendarBody = { ...common, isActive: (v as EditValues).isActive === 'yes' };
      await update.mutateAsync({ id: calendar.id, body });
      toast.success('Business calendar updated.');
    } else {
      await create.mutateAsync(common);
      toast.success('Business calendar created.');
    }
    onClose();
  }

  const editors = (
    <>
      <WorkingHoursEditor hours={hours} onChange={setHours} />
      <HolidaysEditor holidays={holidays} onChange={setHolidays} />
      {structuralError ? (
        <p role="alert" aria-live="polite" className="text-sm text-destructive">
          {structuralError}
        </p>
      ) : null}
    </>
  );

  if (calendar) {
    return (
      <EntityForm
        schema={editSchema}
        defaultValues={{
          code: calendar.code,
          name: calendar.name,
          timezone: calendar.timezone,
          isActive: calendar.isActive ? 'yes' : 'no',
        }}
        onSubmit={onSubmit}
        onError={(e) => masterFormError('business calendar', e)}
        submitLabel="Save changes"
      >
        <FormField name="code" label="Code" required />
        <FormField name="name" label="Name" required />
        <FormField name="timezone" label="Timezone (IANA)" required />
        {editors}
        <FormSelect name="isActive" label="Status" options={BOOL_OPTIONS} />
      </EntityForm>
    );
  }

  return (
    <EntityForm
      schema={scalarSchema}
      defaultValues={{ code: '', name: '', timezone: 'Asia/Kolkata' }}
      onSubmit={onSubmit}
      onError={(e) => masterFormError('business calendar', e)}
      submitLabel="Create business calendar"
    >
      <FormField name="code" label="Code" required />
      <FormField name="name" label="Name" required />
      <FormField name="timezone" label="Timezone (IANA)" required />
      {editors}
    </EntityForm>
  );
}

/** Per-weekday working-hours grid: a checkbox toggles working/closed; start/end
 * time inputs appear when the day is open. Always yields all 7 keys. */
function WorkingHoursEditor({
  hours,
  onChange,
}: {
  hours: WorkingHours;
  onChange: (next: WorkingHours) => void;
}): JSX.Element {
  function setDay(day: Weekday, value: DayHours | null): void {
    onChange({ ...hours, [day]: value });
  }
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Working hours</legend>
      {WEEKDAYS.map((day) => {
        const slot = hours[day];
        const open = slot !== null;
        return (
          <div key={day} className="flex flex-wrap items-center gap-2">
            <label className="flex w-32 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={open}
                onChange={(e) => setDay(day, e.target.checked ? { start: '09:30', end: '18:00' } : null)}
                aria-label={`${WEEKDAY_LABEL[day]} working`}
              />
              {WEEKDAY_LABEL[day]}
            </label>
            {open ? (
              <>
                <Input
                  type="time"
                  className="w-32"
                  aria-label={`${WEEKDAY_LABEL[day]} start`}
                  value={slot.start}
                  onChange={(e) => setDay(day, { ...slot, start: e.target.value })}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  className="w-32"
                  aria-label={`${WEEKDAY_LABEL[day]} end`}
                  value={slot.end}
                  onChange={(e) => setDay(day, { ...slot, end: e.target.value })}
                />
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

/** Repeatable holiday rows ({ date, name }). */
function HolidaysEditor({
  holidays,
  onChange,
}: {
  holidays: Holiday[];
  onChange: (next: Holiday[]) => void;
}): JSX.Element {
  function update(index: number, patch: Partial<Holiday>): void {
    onChange(holidays.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  }
  function add(): void {
    onChange([...holidays, { date: '', name: '' }]);
  }
  function remove(index: number): void {
    onChange(holidays.filter((_, i) => i !== index));
  }
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Holidays</legend>
      {holidays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No holidays added.</p>
      ) : (
        holidays.map((h, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor={`holiday-date-${i}`} className="text-xs">
                Date
              </Label>
              <Input
                id={`holiday-date-${i}`}
                type="date"
                className="w-40"
                value={h.date}
                onChange={(e) => update(i, { date: e.target.value })}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor={`holiday-name-${i}`} className="text-xs">
                Name
              </Label>
              <Input
                id={`holiday-name-${i}`}
                className="min-w-40"
                value={h.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
              Remove
            </Button>
          </div>
        ))
      )}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        Add holiday
      </Button>
    </fieldset>
  );
}
