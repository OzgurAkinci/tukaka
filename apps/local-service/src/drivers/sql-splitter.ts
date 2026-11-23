
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

/** Sondaki `;` ve boşlukları kaldırır (EXPLAIN gibi sarmalayıcılar için). */
export function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/[\s;]+$/, '');
}

/** PL/SQL bloğu başlatan ifadeler; bunlar `;` ile değil `/` satırıyla biter. */
const PLSQL_START =
  /^(?:DECLARE|BEGIN|CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE)\b)/i;

/** Baştaki boşluk ve yorumları atlar. */
function skipLeadingTrivia(sql: string): string {
  return sql.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, '');
}

/**
 * Oracle betiğini çalıştırılabilir ifadelere böler.
 *
 * - Düz SQL ifadeleri `;` ile ayrılır ve sondaki `;` kaldırılır (Oracle,
 *   ifade sonunda `;` kabul etmez).
 * - PL/SQL blokları (BEGIN/DECLARE/CREATE FUNCTION…) içlerinde `;` barındırır;
 *   SQL*Plus/SQL Developer gibi tek başına `/` içeren satıra kadar okunur ve
 *   sondaki `END;` korunur. `/` yoksa betiğin sonuna kadar tek blok sayılır.
 */
export function splitOracleScript(sql: string): string[] {
  const statements: string[] = [];
  let rest = sql;

  while (true) {
    rest = skipLeadingTrivia(rest);

    if (!rest.trim()) break;

    if (PLSQL_START.test(rest)) {
      const terminator = /^[ \t]*\/[ \t]*$/m.exec(rest);
      const block = terminator ? rest.slice(0, terminator.index) : rest;

      statements.push(block.trimEnd());
      rest = terminator ? rest.slice(terminator.index + terminator[0].length) : '';
      continue;
    }

    const [first] = splitSqlSegments(rest);
    const statement = stripTrailingSemicolons(first);

    // Düz ifadeyi bitiren tek başına `/` satırını da yok say.
    if (statement.trim() && statement.trim() !== '/') {
      statements.push(statement.replace(/\n[ \t]*\/[ \t]*$/, '').trim());
    }

    rest = rest.slice(first.length);
  }

  return statements.filter((statement) => !isBlankSql(statement));
}
