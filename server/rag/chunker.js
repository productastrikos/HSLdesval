'use strict';

// Target chunk size and overlap in words
const CHUNK_SIZE    = 450;
const CHUNK_OVERLAP = 80;

/**
 * Split text into overlapping chunks, preserving section structure.
 * Returns [{ text, section, wordCount }]
 */
function chunkText(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sections   = extractSections(normalized);
  const chunks     = [];

  for (const sec of sections) {
    const words = sec.content.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const prefix = sec.title ? `[${sec.title}] ` : '';

    if (words.length <= CHUNK_SIZE) {
      chunks.push({ text: (prefix + sec.content).trim(), section: sec.title, wordCount: words.length });
      continue;
    }

    let i = 0;
    while (i < words.length) {
      const end   = Math.min(i + CHUNK_SIZE, words.length);
      const slice = words.slice(i, end);
      chunks.push({ text: prefix + slice.join(' '), section: sec.title, wordCount: slice.length });

      i += CHUNK_SIZE - CHUNK_OVERLAP;

      // If remaining words are fewer than overlap, add final tail and stop
      if (i < words.length && words.length - i < CHUNK_OVERLAP) {
        const tail = words.slice(i);
        chunks.push({ text: prefix + tail.join(' '), section: sec.title, wordCount: tail.length });
        break;
      }
    }
  }

  return chunks.filter(c => c.wordCount >= 15);
}

/**
 * Parse text into named sections based on heading patterns.
 */
function extractSections(text) {
  const lines    = text.split('\n');
  const sections = [];
  let title      = '';
  let buf        = [];

  const isSep    = l => /^[=\-]{3,}/.test(l.trim());
  const isHeader = l => {
    const t = l.trim();
    if (!t || t.length < 4) return false;
    // Explicit section keywords
    if (/^(CHAPTER|SECTION|PART|ANNEX|REGULATION|APPENDIX)\s+/i.test(t)) return true;
    // IEC/IRS numbered section like "IEC 60092-101" or "Section 1 —"
    if (/^(IEC|IRS|IMO|IACS|DNV|ABS|ISO)\s+\d/i.test(t)) return true;
    // ALL-CAPS line (likely a heading) longer than 8 chars
    if (t.length > 8 && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) return true;
    return false;
  };

  const flush = () => {
    const content = buf.join('\n').trim();
    if (content.length > 0) sections.push({ title, content });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';

    if (isSep(line)) {
      flush();
      title = '';
      continue;
    }

    if (isHeader(line) || (line.trim() && isSep(next))) {
      flush();
      title = line.trim();
      if (isSep(next)) i++; // skip underline separator
      continue;
    }

    buf.push(line);
  }
  flush();

  return sections.filter(s => s.content.trim().length > 10);
}

module.exports = { chunkText };
