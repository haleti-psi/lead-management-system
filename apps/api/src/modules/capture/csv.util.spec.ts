import { parseCsv, serializeCsv } from './csv.util';

/** FR-010 — CSV reader/writer used by the bulk-import processor. */
describe('parseCsv', () => {
  it('parses simple rows with LF and CRLF endings', () => {
    expect(parseCsv('a,b,c\n1,2,3\r\n4,5,6\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted cells with embedded commas, quotes, and newlines', () => {
    const text = 'name,note\n"Kumar, Ramesh","said ""hello""\nsecond line"';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Kumar, Ramesh', 'said "hello"\nsecond line'],
    ]);
  });

  it('keeps empty cells and drops blank trailing lines', () => {
    expect(parseCsv('a,,c\n\n')).toEqual([['a', '', 'c']]);
  });

  it('round-trips through serializeCsv', () => {
    const rows = [
      ['row_number', 'column', 'code', 'message'],
      ['2', 'identity.name', 'VALIDATION_ERROR', 'Name, is "required".'],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });
});
