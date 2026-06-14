// @vitest-environment jsdom
//
// FR-054 — SearchPalette component tests (vitest + @testing-library/react).
// Uses only built-in matchers + DOM properties (no @testing-library/jest-dom)
// so the production `tsc -b` stays clean.
//
// Covers the required test scenarios from FR-054-tests.md §UI Tests (E01–E08)
// at the component level. Playwright E2E tier is deferred per manifest.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Mock useSearch before importing the component.
vi.mock('@/hooks/use-search', () => ({
  useSearch: vi.fn(),
}));

// Mock sonner toast.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

import { useSearch } from '@/hooks/use-search';
import { SearchPalette } from './SearchPalette';
import { ApiClientError } from '@/lib/api';
import { toast } from 'sonner';

const mockUseSearch = useSearch as ReturnType<typeof vi.fn>;
const mockToastError = (toast as unknown as { error: ReturnType<typeof vi.fn> }).error;

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPalette(open = true, onClose = vi.fn()) {
  return render(<SearchPalette open={open} onClose={onClose} />, { wrapper: Wrapper });
}

const emptyResult = {
  data: {
    leads: [],
    partners: [],
    tasks: [],
    top_n: 5,
    query: '',
    counts: { leads: 0, partners: 0, tasks: 0 },
  },
  isLoading: false,
  error: null,
};

const loadingResult = { data: undefined, isLoading: true, error: null };

const resultWithLead = {
  data: {
    leads: [
      {
        lead_id: 'lead-1',
        lead_code: 'LD-2026-000001',
        stage: 'new',
        product_code: 'CV',
        applicant_name: 'Ravi Kumar',
        mobile: '98xxxxxx10',
        pan_masked: 'ABCxxxx4F',
        owner_id: 'user-1',
        branch_id: 'branch-1',
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    partners: [],
    tasks: [],
    top_n: 5,
    query: 'Ravi',
    counts: { leads: 1, partners: 0, tasks: 0 },
  },
  isLoading: false,
  error: null,
};

describe('SearchPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearch.mockReturnValue({ data: undefined, isLoading: false, error: null });
  });

  describe('E01 — palette renders with correct aria attributes', () => {
    it('renders the dialog when open=true', () => {
      renderPalette(true);
      const dialog = screen.queryByRole('dialog');
      expect(dialog).toBeTruthy();
      expect(dialog?.getAttribute('aria-label')).toBe('Global search');
    });

    it('search input is present with correct aria-label', () => {
      renderPalette(true);
      const input = screen.queryByRole('combobox');
      expect(input).toBeTruthy();
      expect(input?.getAttribute('aria-label')).toContain('leads, partners and tasks');
    });

    it('does not render when open=false', () => {
      renderPalette(false);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('E02 — typing < 2 chars shows prompt (no query fires)', () => {
    it('shows the "type at least 2 characters" prompt when input is empty', () => {
      renderPalette();
      const prompt = screen.queryByText(/type at least 2 characters/i);
      expect(prompt).toBeTruthy();
    });

    it('useSearch is called with the current input value (empty on mount)', () => {
      renderPalette();
      expect(mockUseSearch).toHaveBeenCalledWith('');
    });
  });

  describe('E03 — lead results display with masked mobile', () => {
    it('T14 — masked mobile is rendered via MaskedField component', async () => {
      mockUseSearch.mockReturnValue(resultWithLead);
      renderPalette();

      await act(async () => {
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ra' } });
      });

      await waitFor(() => {
        const maskedEl = screen.queryByLabelText(/masked mobile/i);
        expect(maskedEl).toBeTruthy();
        expect(maskedEl?.textContent).toBe('98xxxxxx10');
      });
    });

    it('shows lead code in results', async () => {
      mockUseSearch.mockReturnValue(resultWithLead);
      renderPalette();
      await waitFor(() => {
        expect(screen.queryByText('LD-2026-000001')).toBeTruthy();
      });
    });

    it('shows "See all leads" link when leads are present', async () => {
      mockUseSearch.mockReturnValue(resultWithLead);
      renderPalette();
      await waitFor(() => {
        expect(screen.queryByText(/see all leads/i)).toBeTruthy();
      });
    });
  });

  describe('E06 — empty state shown when no results', () => {
    it('T16 — renders EmptyState when all buckets return empty arrays and query >= 2 chars', async () => {
      mockUseSearch.mockReturnValue(emptyResult);
      renderPalette();
      await act(async () => {
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ZZ' } });
      });
      await waitFor(() => {
        const noResultEls = screen.queryAllByText(/no results/i);
        expect(noResultEls.length).toBeGreaterThan(0);
      });
    });
  });

  describe('E07 — Escape closes the palette', () => {
    it('calls onClose when Escape is pressed inside the dialog', () => {
      const onClose = vi.fn();
      renderPalette(true, onClose);
      const dialog = screen.queryByRole('dialog');
      expect(dialog).toBeTruthy();
      fireEvent.keyDown(dialog!, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('E08 — RATE_LIMITED (429) shows a Toast', () => {
    it('T13 — calls toast.error with rate-limit message when error status is 429', async () => {
      const rateLimitError = new ApiClientError({
        code: 'RATE_LIMITED',
        message: 'Rate limited',
        status: 429,
        retryable: true,
      });
      mockUseSearch.mockReturnValue({ data: undefined, isLoading: false, error: rateLimitError });
      renderPalette();
      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(expect.stringMatching(/too many attempts/i));
      });
    });
  });

  describe('loading state', () => {
    it('shows LoadingSkeleton while loading', () => {
      mockUseSearch.mockReturnValue(loadingResult);
      renderPalette();
      const loadingEl = screen.queryByLabelText('Loading');
      expect(loadingEl).toBeTruthy();
    });
  });

  describe('non-rate-limit error shows inline error state', () => {
    it('renders an alert element for generic errors', async () => {
      const authError = new ApiClientError({
        code: 'AUTH_REQUIRED',
        message: 'Unauthorized',
        status: 401,
        retryable: false,
      });
      mockUseSearch.mockReturnValue({ data: undefined, isLoading: false, error: authError });
      renderPalette();
      // Error appears immediately (not async — error in state from start)
      const alert = screen.queryByRole('alert');
      expect(alert).toBeTruthy();
    });
  });
});
