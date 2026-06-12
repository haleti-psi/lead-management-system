// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { z } from 'zod';
import { EntityForm, FormField } from './EntityForm';
import { ApiClientError } from '@/lib/api';

const Schema = z.object({ name: z.string().min(1, 'Name is required') });
type Values = z.infer<typeof Schema>;

function Harness(props: {
  onSubmit: (v: Values) => Promise<void>;
  onError?: (e: unknown) => void;
}): JSX.Element {
  return (
    <EntityForm<Values>
      schema={Schema}
      defaultValues={{ name: '' }}
      onSubmit={props.onSubmit}
      onError={props.onError}
      submitLabel="Save"
    >
      <FormField name="name" label="Name" required />
    </EntityForm>
  );
}

describe('EntityForm', () => {
  it('blocks submit and shows an inline Zod error for invalid input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Name is required');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits parsed values when valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Acme' }));
  });

  it('maps a server VALIDATION_ERROR field onto the inline error', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiClientError({
        code: 'VALIDATION_ERROR',
        message: 'Invalid',
        status: 400,
        retryable: false,
        fields: [{ field: 'name', issue: 'Already taken' }],
      }),
    );
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Already taken');
  });

  it('hands a non-validation error to onError', async () => {
    const error = new ApiClientError({
      code: 'RATE_LIMITED',
      message: 'slow down',
      status: 429,
      retryable: true,
    });
    const onSubmit = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    render(<Harness onSubmit={onSubmit} onError={onError} />);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });
});
