const META_LINE_RE = /^(Neighborhood|Date|Type|Vehicle)\s*:\s*(.*)$/i;
const SUSPECT_HEADER_RE = /^Suspect description:\s*(.*)$/i;
const FOOTER_RE = /^This is a neighborhood-to-city briefing/i;
const EDITOR_NOTE_RE = /\s*Edit before publishing\.?\s*$/i;

function flushAuthor(blocks, buffer) {
  const text = buffer.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  buffer.length = 0;
  if (text) blocks.push({ kind: "author", text });
}

function flushMeta(blocks, fields) {
  if (fields.length === 0) return;
  blocks.push({ kind: "meta", fields: fields.slice() });
  fields.length = 0;
}

function flushSuspect(blocks, buffer) {
  if (!buffer) return null;
  const text = buffer.join("\n").trim();
  if (text) blocks.push({ kind: "author", label: "Suspect description", text });
  return null;
}

/**
 * Split mixed City Hub body text into system metadata vs author narrative.
 * Works for incident-share drafts and freeform posts.
 */
export function parseCityHubContent(raw) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const blocks = [];
  const authorBuf = [];
  const metaFields = [];
  let suspectBuf = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const metaMatch = trimmed.match(META_LINE_RE);
    const suspectMatch = trimmed.match(SUSPECT_HEADER_RE);

    if (FOOTER_RE.test(trimmed)) {
      flushAuthor(blocks, authorBuf);
      flushMeta(blocks, metaFields);
      suspectBuf = flushSuspect(blocks, suspectBuf);
      blocks.push({
        kind: "system",
        text: trimmed.replace(EDITOR_NOTE_RE, "").trim(),
      });
      continue;
    }

    if (metaMatch) {
      flushAuthor(blocks, authorBuf);
      suspectBuf = flushSuspect(blocks, suspectBuf);
      metaFields.push({
        label: metaMatch[1].replace(/^\w/, (ch) => ch.toUpperCase()),
        value: String(metaMatch[2] || "").trim(),
      });
      continue;
    }

    if (suspectMatch) {
      flushAuthor(blocks, authorBuf);
      flushMeta(blocks, metaFields);
      suspectBuf = [];
      const rest = String(suspectMatch[1] || "").trim();
      if (rest) suspectBuf.push(rest);
      continue;
    }

    if (suspectBuf) {
      if (trimmed === "" && suspectBuf.length > 0) {
        suspectBuf = flushSuspect(blocks, suspectBuf);
        continue;
      }
      if (trimmed) suspectBuf.push(trimmed);
      continue;
    }

    if (metaFields.length > 0) {
      if (trimmed === "") continue;
      flushMeta(blocks, metaFields);
    }

    authorBuf.push(line);
  }

  flushMeta(blocks, metaFields);
  flushSuspect(blocks, suspectBuf);
  flushAuthor(blocks, authorBuf);
  return blocks;
}
