// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChip } from './StatusChip';

describe('StatusChip', () => {
  it('renders the label', () => {
    render(<StatusChip label="Verified" tone="success" />);
    expect(screen.getByText('Verified')).toBeTruthy();
  });

  it('applies the tone class', () => {
    render(<StatusChip label="Mismatch" tone="danger" />);
    const chip = screen.getByText('Mismatch');
    expect(chip.className).toContain('text-red-800');
  });

  it('defaults to the neutral tone', () => {
    render(<StatusChip label="Pending" />);
    expect(screen.getByText('Pending').className).toContain('text-muted-foreground');
  });
});
