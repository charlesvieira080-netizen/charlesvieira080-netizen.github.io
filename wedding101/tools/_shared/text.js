/* Wedding 101: the copy-as-text formatters, one per tool (TOOLS-SPEC 2.5, 5.1).
 * Plain text with tabs and line breaks, written to be pasted into a text message or
 * an email body. Imported by w101.js and re-exported as `text`. No DOM, no side effects. */

const DOT = ' · ';

function line(parts) { return parts.filter(Boolean).join(DOT); }

/* Run of Show. model: { names, dateLabel, rows: [{timeLabel, what, minutes, cue, note, indent, marker}], floor, sunsetLine } */
export function runOfShow(m) {
  const out = [line(['RUN OF SHOW', m.names, m.dateLabel])];
  for (const r of m.rows) {
    if (r.marker) { out.push((r.indent ? '   ' : '') + r.timeLabel + '\t' + r.what); continue; }
    let l = (r.indent ? '   ' : '') + r.timeLabel + '\t' + r.what + ' (' + r.minutes + ' min)';
    if (r.cue) l += '  cue: ' + r.cue;
    if (r.note) l += '  ' + r.note;
    out.push(l);
  }
  out.push('Dance floor: ' + m.floor + ' min');
  if (m.sunsetLine) out.push(m.sunsetLine);
  return out.join('\n');
}

/* Sunset card. card: { dateLabel, sunset, golden, lastLight, label, endBy, endByRule, portraits, outdoorLine, note } (times already formatted) */
export function sunsetCard(c) {
  const out = [line(['SUNSET', c.dateLabel])];
  out.push('Sunset ' + c.sunset + ' ' + c.label);
  out.push('Golden hour from ' + c.golden);
  out.push('Last usable light ' + c.lastLight);
  if (c.endBy) out.push('Ceremony should end by ' + c.endBy + (c.endByRule ? ' (' + c.endByRule + ')' : ''));
  if (c.outdoorLine) out.push(c.outdoorLine);
  if (c.portraits) out.push('Sunset portraits at ' + c.portraits + ', fifteen minutes');
  if (c.note) out.push(c.note);
  return out.join('\n');
}

/* Events picker. model: { names, keep: [{label, minutes, detail}], maybe: [...], keptMinutes, maybeMinutes } */
export function events(m) {
  const out = [line(['EVENTS', m.names])];
  const block = (title, list) => {
    if (!list.length) return;
    out.push(title);
    for (const e of list) out.push('\t' + e.label + ' (' + e.minutes + ' min)' + (e.detail ? '  ' + e.detail : ''));
  };
  block('Keep', m.keep);
  block('Maybe', m.maybe);
  out.push('Kept: ' + m.keptMinutes + ' min of moments' + (m.maybeMinutes ? DOT + 'Maybes would add ' + m.maybeMinutes + ' min' : ''));
  return out.join('\n');
}

/* A generic sectioned list for any tool that has none of its own: [{title, lines: []}] */
export function sections(title, secs) {
  const out = [title];
  for (const s of secs) {
    if (!s.lines || !s.lines.length) continue;
    out.push(s.title);
    for (const l of s.lines) out.push('\t' + l);
  }
  return out.join('\n');
}
