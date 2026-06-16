// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AdminHomePage } from './AdminHomePage';

function renderPage(): void {
  render(
    <MemoryRouter>
      <AdminHomePage />
    </MemoryRouter>,
  );
}

describe('AdminHomePage', () => {
  it('renders links to each admin section with correct hrefs', () => {
    renderPage();

    const expected: ReadonlyArray<[RegExp, string]> = [
      [/master data/i, '/admin/master'],
      [/product configuration/i, '/admin/products'],
      [/schemes & governance/i, '/admin/config'],
      [/partners/i, '/admin/partners'],
      [/break-glass/i, '/admin/break-glass'],
      [/communication templates/i, '/admin/templates'],
    ];

    for (const [name, href] of expected) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
    }
  });

  it('shows the page heading', () => {
    renderPage();
    expect(
      within(screen.getByRole('heading', { level: 1 })).getByText('Configuration'),
    ).toBeTruthy();
  });
});
