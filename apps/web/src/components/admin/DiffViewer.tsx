import { formatDiffValue, normaliseDiff } from './config-governance-utils';

/**
 * FR-132 — readable view of a `configuration_versions.diff` JSONB. The diff is
 * opaque (its schema varies by `config_type`), so {@link normaliseDiff} flattens
 * it to `{ field, before?, after? }` rows rendered as a before → after table.
 * Presentational only; colour is paired with the "Before"/"After" headers so the
 * change direction does not rely on colour alone (WCAG 1.4.1).
 */
export function DiffViewer({ diff }: { diff: unknown }): JSX.Element {
  const rows = normaliseDiff(diff);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No change details were recorded for this version.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Configuration change details</caption>
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Field
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Before
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.field} className="align-top">
              <th scope="row" className="px-3 py-2 font-medium">
                {row.field}
              </th>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground line-through decoration-destructive/60">
                {formatDiffValue(row.before)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-foreground">
                {formatDiffValue(row.after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
