
/**
 * SQL metnini, tırnak ve yorumların dışındaki `;` karakterlerinden böler.
 *
 * Her parça sonundaki `;` ile birlikte döner. Tetikleyici (trigger) gövdeleri
 * gibi içinde `;` olan ifadeler birden fazla parçaya bölünebilir; çağıran taraf
 * parçaları "eksik ifade" hatası almayana kadar birleştirmelidir.
 */
export function splitSqlSegments(sql: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index + 2);
      index = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      index++;

      while (index < sql.length) {
        if (sql[index] === close) {
          // Çift tırnak ('') kaçış dizisidir; okumaya devam et.
          if (close !== ']' && sql[index + 1] === close) {
            index += 2;
            continue;
          }
          break;
        }
        index++;
      }

      index++;
      continue;
    }

    if (char === ';') {
      segments.push(sql.slice(start, index + 1));
      start = index + 1;
    }

    index++;
  }

  if (sql.slice(start).trim()) {
    segments.push(sql.slice(start));
  }

  return segments;
}

/** Yalnızca boşluk ve yorumdan oluşan metin mi? */
export function isBlankSql(sql: string): boolean {
  return (
    sql
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/;/g, '')
      .trim() === ''
  );
}
