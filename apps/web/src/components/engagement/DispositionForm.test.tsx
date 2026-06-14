// @vitest-environment jsdom
//
// FR-102 UI tests — DispositionForm and GeoCapture components.
// API hooks are mocked so tests run without a network.
// Covers UI-01..UI-07 from FR-102-tests.md §UI Test Scenarios.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mock use-tasks hook ───────────────────────────────────────────────────────

vi.mock('@/features/engagement/use-tasks', () => ({
  useUpdateTask: vi.fn(),
}));

import { useUpdateTask } from '@/features/engagement/use-tasks';
import type { TaskDto } from '@/features/engagement/use-tasks';

const mockUseUpdateTask = useUpdateTask as ReturnType<typeof vi.fn>;

// ── Mock api client ───────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  isApiClientError: (e: unknown): e is { fields?: Array<{ field: string; issue?: string }>; status?: number } =>
    typeof e === 'object' && e !== null && 'fields' in e,
}));

import { DispositionForm } from './DispositionForm';
import { GeoCapture } from './GeoCapture';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASK_ID = 'task-uuid-001';

function makeTaskDto(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    task_id: TASK_ID,
    lead_id: 'lead-001',
    type: 'call',
    owner_id: 'user-001',
    due_at: new Date(Date.now() + 3_600_000).toISOString(),
    priority: 'normal',
    sla_policy_id: null,
    status: 'done',
    disposition: 'connected',
    result_note: null,
    geo: null,
    next_action_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function defaultMutationSuccess() {
  const mutateAsync = vi.fn().mockResolvedValue(makeTaskDto());
  mockUseUpdateTask.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  });
  return mutateAsync;
}

beforeEach(() => {
  mockUseUpdateTask.mockReset();
  defaultMutationSuccess();
});

// ── DispositionForm ───────────────────────────────────────────────────────────

describe('DispositionForm', () => {
  // UI-01: All 8 disposition enum values present in the dropdown
  it('UI-01: renders all 8 disposition options in the select', () => {
    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={vi.fn()} />);

    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);

    const expected = [
      'connected', 'no_answer', 'wrong_number', 'not_interested',
      'visited', 'rescheduled', 'callback_requested', 'docs_promised',
    ];
    for (const val of expected) {
      expect(options).toContain(val);
    }
  });

  // UI-02: DateTimePicker appears when rescheduled selected; not rendered for connected
  it('UI-02: next_action_at field appears when rescheduled is selected', () => {
    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={vi.fn()} />);

    // Before selection: no datetime input for next action
    expect(screen.queryByLabelText(/schedule follow-up/i)).toBeNull();

    // Select 'rescheduled'
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rescheduled' } });
    expect(screen.getByLabelText(/schedule follow-up/i)).toBeDefined();
  });

  it('UI-02b: next_action_at field is NOT rendered when connected is selected', () => {
    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'connected' } });
    expect(screen.queryByLabelText(/schedule follow-up/i)).toBeNull();
  });

  // UI-03: Submit button disabled until disposition selected
  it('UI-03: submit button is disabled when no disposition is selected', () => {
    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={vi.fn()} />);

    const submitBtn = screen.getByRole('button', { name: /log outcome/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('UI-03b: submit button enabled after disposition is selected', () => {
    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'connected' } });

    const submitBtn = screen.getByRole('button', { name: /log outcome/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(false);
  });

  // UI-06: API VALIDATION_ERROR maps to inline field error
  it('UI-06: shows inline error when API returns VALIDATION_ERROR with fields', async () => {
    const mutateAsync = vi.fn().mockRejectedValue({
      fields: [{ field: 'disposition', issue: 'disposition must be one of: ...' }],
    });
    mockUseUpdateTask.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    });

    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'connected' } });
    fireEvent.click(screen.getByRole('button', { name: /log outcome/i }));

    await waitFor(() => {
      const alertEl = screen.getAllByRole('alert');
      const messages = alertEl.map((el) => el.textContent ?? '').join(' ');
      expect(messages).toContain('disposition must be one of');
    });
  });

  // UI-07: Success toast shown after 200 OK
  it('UI-07: shows "Outcome logged" success message after successful PATCH', async () => {
    const onSuccess = vi.fn();
    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={onSuccess} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'connected' } });
    fireEvent.click(screen.getByRole('button', { name: /log outcome/i }));

    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status.textContent).toContain('Outcome logged');
    });
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ task_id: TASK_ID }));
  });

  // GeoCapture shown for call/visit tasks
  it('GeoCapture is rendered for call task type', () => {
    render(<DispositionForm taskId={TASK_ID} taskType="call" onSuccess={vi.fn()} />);
    // GeoCapture renders the capture button when no geo
    expect(screen.getByRole('button', { name: /capture location/i })).toBeDefined();
  });

  it('GeoCapture is NOT rendered for doc_request task type', () => {
    render(<DispositionForm taskId={TASK_ID} taskType="doc_request" onSuccess={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /capture location/i })).toBeNull();
  });
});

// ── GeoCapture ────────────────────────────────────────────────────────────────

describe('GeoCapture', () => {
  // UI-04: After getCurrentPosition resolves, preview text contains lat/lng values
  it('UI-04: shows lat/lng preview after geolocation success', async () => {
    const mockGetCurrentPosition = vi.fn().mockImplementation(
      (success: (p: GeolocationPosition) => void) => {
        success({
          coords: {
            latitude: 19.076,
            longitude: 72.877,
            accuracy: 12,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as unknown as GeolocationPosition);
      },
    );

    Object.defineProperty(global.navigator, 'geolocation', {
      value: { getCurrentPosition: mockGetCurrentPosition },
      configurable: true,
    });

    const onChange = vi.fn();
    render(<GeoCapture value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /capture location/i }));

    await waitFor(() => {
      // Preview rendered via data-testid="geo-preview"
      const preview = screen.getByTestId('geo-preview');
      expect(preview.textContent).toContain('19.07600');
      expect(preview.textContent).toContain('72.87700');
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 19.076, lng: 72.877, accuracy_m: 12 }));
  });

  // UI-05: Permission denied renders StatusChip with "Location unavailable"
  it('UI-05: shows "Location unavailable" StatusChip on PERMISSION_DENIED', async () => {
    const mockGetCurrentPosition = vi.fn().mockImplementation(
      (_success: unknown, error: (e: GeolocationPositionError) => void) => {
        error({ code: 1, message: 'PERMISSION_DENIED' } as GeolocationPositionError);
      },
    );

    Object.defineProperty(global.navigator, 'geolocation', {
      value: { getCurrentPosition: mockGetCurrentPosition },
      configurable: true,
    });

    const onChange = vi.fn();
    render(<GeoCapture value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /capture location/i }));

    await waitFor(() => {
      const statusEl = screen.getByRole('status');
      expect(statusEl.textContent).toContain('Location unavailable');
    });

    // onChange called with null (no geo attached)
    expect(onChange).toHaveBeenCalledWith(null);
  });

  // Renders lat/lng when value is pre-populated
  it('shows pre-populated geo value as preview', () => {
    const geo = { lat: 12.9716, lng: 77.5946, accuracy_m: 5 };
    render(<GeoCapture value={geo} onChange={vi.fn()} />);

    const preview = screen.getByTestId('geo-preview');
    expect(preview.textContent).toContain('12.97160');
    expect(preview.textContent).toContain('77.59460');
  });

  // GeoCapture degrades gracefully when geolocation API is unavailable
  it('shows Location unavailable when navigator.geolocation is not available', async () => {
    Object.defineProperty(global.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });

    render(<GeoCapture value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /capture location/i }));

    await waitFor(() => {
      const statusEl = screen.getByRole('status');
      expect(statusEl.textContent).toContain('Location unavailable');
    });
  });
});
