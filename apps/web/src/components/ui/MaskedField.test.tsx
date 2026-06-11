// @vitest-environment jsdom
//
// FR-002 §UI tests (D-01..D-05) for the MaskedField component.
//
// NOTE: this suite requires a DOM test environment (jsdom). The web DOM
// environment, the shared shadcn primitives, the api client, and the global
// Toast are provisioned by the web foundation wave (see apps/web/src/app/App.tsx)
// — not by FR-002 — so this suite is authored to the testing-contract
// ("Frontend unit/component: Vitest + @testing-library/react") and runs once that
// environment is present. Assertions use only built-in matchers + DOM properties
// (no @testing-library/jest-dom) so the production `tsc -b` stays clean. The
// unmask fetch is the FR-003 `POST /audit/unmask` path; here it is driven through
// the injected `onReveal` handler so the component is tested in isolation.
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { MaskedField } from './MaskedField';

describe('MaskedField', () => {
  // D-01
  it('renders the masked PAN value by default with no Reveal button', () => {
    render(<MaskedField maskedValue="ABCxxxx4F" fieldType="pan" canUnmask={false} />);
    expect(screen.getByLabelText('masked PAN').textContent).toBe('ABCxxxx4F');
    expect(screen.queryByRole('button', { name: /reveal/i })).toBeNull();
  });

  // D-02
  it('renders a Reveal button when canUnmask=true and an onReveal handler is provided', () => {
    render(
      <MaskedField
        maskedValue="98xxxxxx10"
        fieldType="mobile"
        canUnmask
        onReveal={vi.fn(async () => '9876543210')}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reveal MOBILE' })).not.toBeNull();
  });

  // D-03
  it('calls the unmask handler and displays the raw value on Reveal click', async () => {
    const onReveal = vi.fn(async () => '9876543210');
    render(<MaskedField maskedValue="98xxxxxx10" fieldType="mobile" canUnmask leadId="L1" onReveal={onReveal} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal MOBILE' }));

    await waitFor(() => {
      expect(screen.getByLabelText('masked mobile').textContent).toBe('9876543210');
    });
    expect(onReveal).toHaveBeenCalledWith({ leadId: 'L1', fieldType: 'mobile' });
  });

  // D-04
  it('shows an inline error when the unmask handler fails', async () => {
    const onReveal = vi.fn(async () => {
      throw new Error('403');
    });
    render(<MaskedField maskedValue="98xxxxxx10" fieldType="mobile" canUnmask onReveal={onReveal} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal MOBILE' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
    });
    // The masked value is preserved on failure (no raw leak).
    expect(screen.getByLabelText('masked mobile').textContent).toBe('98xxxxxx10');
  });

  // D-05
  it('shows a loading status while the unmask is in flight', async () => {
    // A handler that resolves only when released, so the loading state is observable.
    let release: (v: string) => void = () => undefined;
    const onReveal = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    render(<MaskedField maskedValue="98xxxxxx10" fieldType="mobile" canUnmask onReveal={onReveal} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal MOBILE' }));

    expect(await screen.findByRole('status')).not.toBeNull();
    release('9876543210');
    await waitFor(() => {
      expect(screen.getByLabelText('masked mobile').textContent).toBe('9876543210');
    });
  });

  it('keeps the revealed value across a parent re-render (host-wiring contract)', async () => {
    function Host(): JSX.Element {
      const [, force] = useState(0);
      return (
        <>
          <button type="button" onClick={() => force((n) => n + 1)}>
            rerender
          </button>
          <MaskedField maskedValue="ABCxxxx4F" fieldType="pan" canUnmask onReveal={async () => 'ABCDE1234F'} />
        </>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal PAN' }));
    await waitFor(() => {
      expect(screen.getByLabelText('masked PAN').textContent).toBe('ABCDE1234F');
    });
    fireEvent.click(screen.getByRole('button', { name: 'rerender' }));
    expect(screen.getByLabelText('masked PAN').textContent).toBe('ABCDE1234F');
  });
});
