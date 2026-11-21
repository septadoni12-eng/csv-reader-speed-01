// A fast CSV reader that answers exactly what csv-reader 1.0.0 answers.
//
// run(input) takes {text, header} and returns {columns, rows, errors} under
// the same broken-row policy as the reference reader:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record at all;
//   - outside quotes, a CR that is not part of a CRLF is dropped and reported
//     as stray_cr;
//   - a field that opens with a quote runs to the next quote that is not
//     doubled ("" inside it is one quote, and each CRLF or lone CR inside it
//     is read as LF); whatever follows the closing quote, up to the next
//     comma or line break, is appended as it stands (quote_junk, when any of
//     it is kept); a quote that never closes is a literal character and the
//     text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field counted),
//     row its record's index in rows (null for the header), in the order
//     met.
//
// The reference builds every field one character at a time. This reader
// instead remembers where each run of plain characters starts and slices it
// out whole when the run ends, so ordinary text is copied once per field,
// never once per character. Only the characters that change meaning along
// the way (a dropped stray CR, a doubled quote, a CR inside quotes) break a
// run, and only then is a field assembled from parts.

// How a field ended: 0 at a comma, 1 at a line break, 2 at the end of text.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Every error the record meets reports these.
  let recordLine = 1;
  let recordRow = null;

  // Scratch results of the two field readers below, so the hot path never
  // allocates a result object per field.
  let fValue = '';
  let fEnded = 2;
  let fAdded = 0;

  // Reads unquoted characters, starting with the prefix `value` already in
  // hand, up to the next comma or line break. A CR not followed by LF is
  // dropped (stray_cr). Sets fValue, fEnded and fAdded (how many characters
  // were kept past the prefix).
  function readUnquoted(value) {
    let parts = null; // kept runs of plain text, once a stray CR breaks one
    let kept = 0; // characters kept so far, not counting the prefix
    let segStart = pos;
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        // ','
        fEnded = 0;
        fAdded = kept + (i - segStart);
        fValue = parts === null ? value + text.slice(segStart, i) : value + (parts.push(text.slice(segStart, i)), parts.join(''));
        pos = i + 1;
        return;
      }
      if (c === 10) {
        // LF
        fEnded = 1;
        fAdded = kept + (i - segStart);
        fValue = parts === null ? value + text.slice(segStart, i) : value + (parts.push(text.slice(segStart, i)), parts.join(''));
        pos = i + 1;
        line += 1;
        return;
      }
      if (c === 13) {
        // CR: part of a CRLF it ends the field, on its own it is dropped.
        if (text.charCodeAt(i + 1) === 10) {
          fEnded = 1;
          fAdded = kept + (i - segStart);
          fValue = parts === null ? value + text.slice(segStart, i) : value + (parts.push(text.slice(segStart, i)), parts.join(''));
          pos = i + 2;
          line += 1;
          return;
        }
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i));
        kept += i - segStart;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        i += 1;
        segStart = i;
        continue;
      }
      i += 1;
    }
    fEnded = 2;
    fAdded = kept + (n - segStart);
    fValue = parts === null ? value + text.slice(segStart, n) : value + (parts.push(text.slice(segStart, n)), parts.join(''));
    pos = n;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue/fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null; // value pieces, once an escape or an inside CR breaks a run
    let segStart = open + 1;
    let i = segStart;
    let closed = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        // '"': a doubled one is data, a lone one closes the field.
        if (text.charCodeAt(i + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(segStart, i), '"');
          i += 2;
          segStart = i;
          continue;
        }
        fValue = parts === null ? text.slice(segStart, i) : (parts.push(text.slice(segStart, i)), parts.join(''));
        i += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each read as one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, i), '\n');
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        segStart = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as an unquoted field.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      fValue = fValue; // readUnquoted already set fValue/fEnded
      return;
    }
    pos = i;
    if (pos >= n) {
      fEnded = 2;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = 1;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = 1;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const quotedValue = fValue;
    readUnquoted(quotedValue);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      if (lastQuoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
