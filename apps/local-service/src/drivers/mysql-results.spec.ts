import type { FieldPacket } from 'mysql2/promise';

import { normalizeResults } from './mysql.driver';

const field = (name: string) => ({ name }) as FieldPacket;

describe('normalizeResults (MySQL)', () => {
  it('handles a single SELECT', () => {
    const [statement] = normalizeResults([{ id: 1 }], [field('id')]);

    expect(statement.rows).toEqual([{ id: 1 }]);
    expect(statement.fields?.map((f) => f.name)).toEqual(['id']);
  });

  it('handles a single write', () => {
    const results = normalizeResults({ affectedRows: 4 }, undefined);

    expect(results).toEqual([
      { rows: [], fields: undefined, affectedRows: 4 },
    ]);
  });

  it('splits multi-statement results', () => {
    const results = normalizeResults(
      [{ affectedRows: 2 }, [{ a: 1 }, { a: 2 }]],
      [undefined, [field('a')]],
    );

    expect(results).toHaveLength(2);
    expect(results[0].affectedRows).toBe(2);
    expect(results[1].rows).toHaveLength(2);
  });
});
