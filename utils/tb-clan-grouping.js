/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                  CLAN TAG GROUPING UTILITY                    ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Extracts clan tag groups from raw player data and (optionally) merges
 * groups whose tags are within a configurable Levenshtein edit distance.
 *
 * Pure logic — no external dependencies. Importable from both the plugin
 * and the standalone test harness.
 *
 * EXPORTS
 * -------
 *   levenshteinDistance(a, b) -> number
 *     Standard Levenshtein distance with O(min(m,n)) memory.
 *
 *   extractClanGroups(rawPlayers, options) -> { tag: [eosID, ...] }
 *     Extracts a clan-tag prefix from each player's name using a
 *     five-strategy detector (ported from the squadjs-elo-tracker
 *     project), groups by tag, optionally normalizes case + diacritics
 *     + "gamer-character" lookalikes for case-insensitive merging,
 *     optionally merges groups within a Levenshtein edit distance, and
 *     filters by min/max group size.
 *
 *     Detection strategies, applied in priority order:
 *       1. Tag wrapped in a matched or mismatched bracket pair, including
 *          a wide variety of Unicode bracket-like glyphs (captures the
 *          inside of the pair):
 *          `[TAG]`, `(TAG)`, `<TAG>`, `{TAG}`, `【TAG】`, `╔TAG╗`, `{TAG)`
 *       2. Tag followed by an explicit separator + space:
 *          `TAG | Name`, `TAG // Name`, `TAG - Name`, `TAG : Name`,
 *          `TAG † Name`, `TAG ™ Name`, `TAG ✯ Name`, `TAG ~ Name`,
 *          `TAG * Name`
 *       3. Tag separated from name by 2+ spaces:
 *          `TAG  PlayerName`
 *       4. Short ASCII ALL-CAPS tag with a single-space terminator and
 *          an uppercase continuation: `KM Lookout`, `7TH Captain`
 *       5. Bare-prefix fallback — 2–7 non-bracket non-whitespace chars
 *          followed by whitespace + a non-empty token. Catches Unicode
 *          and mixed-case bare prefixes that strategies 1–4 don't pick
 *          up: `KΛZ Korven`, `♣ΛCE Wurstwasser`, `RmdV Habicht`,
 *          `[OPN Player` (open-only bracket).
 *
 *     Only names with no visible tag/name boundary at all yield no group
 *     (e.g. `ABCJohnSmith` — no whitespace, no brackets, no separator).
 *     Strategy 5 requires a `\s+\S` boundary, which prevents the previous
 *     extractor's 7-char-prefix false positives while still recovering
 *     the bare-prefix names real Squad servers use.
 *
 *     options = {
 *       minSize: number          // default 2
 *       maxSize: number          // default 18
 *       maxEditDistance: number  // default 1; 0 = exact match only
 *       caseSensitive: boolean   // default true; when false, the raw
 *                                // captured prefix is normalized via
 *                                // NFD + a gamer-character map
 *                                // (λ→a, я→r, etc.) + non-alphanumeric
 *                                // strip + uppercase, so [Café] /
 *                                // [CAFE] / [CΛFE] collapse together.
 *     }
 */

const NON_ASCII_MAP = {
  'ƒ': 'f', 'И': 'n', '丹': 'a', '匚': 'c', 'н': 'h', '尺': 'r', 'λ': 'a', 'ν': 'v', 'є': 'e',
  '†': 't', 'Ð': 'd', 'ø': 'o', 'ß': 'ss', 'ค': 'a', 'г': 'r', 'ς': 'c', 'ɦ': 'h', 'м': 'm',
  'я': 'r', 'ċ': 'c', '€': 'e', '₥': 'm', '₠': 'e', '₮': 't', '₯': 'd', '₨': 'rs', '₩': 'w',
  '₫': 'd', '₭': 'k', '₰': 'p', 'ℜ': 'r', 'ℭ': 'c', 'ℑ': 'i', 'ℒ': 'l', 'ℓ': 'l', '℔': 'lb',
  'ℕ': 'n', '℗': 'p', '℘': 'p', 'ℙ': 'p', 'ℚ': 'q', 'ℛ': 'r', 'ℝ': 'r', '℞': 'rx', '℟': 'r',
  '℠': 'sm', '℡': 'tel', '™': 'tm', '℣': 'v', 'ℤ': 'z', 'Ω': 'ohm', '∂': 'd', '₦': 'n', '₧': 'pts',
  '₹': 'r', '₸': 't', '₿': 'b',
  // Add more mappings as needed
};

function extractRawPrefix(name) {
  // Strategies in priority order. Bracket and explicit-separator come
  // before 2+ space because a name like `[QZ℘]  Voidstomper` or
  // `JX |  Drazark` should be recognised by the strongest signal in the
  // name (the bracket pair / the `|`), not by the unrelated 2+ space gap
  // that would over-capture the bracket and the separator into the key.
  // The elo-tracker source orders 2+ space first; that works for them
  // because their downstream normalizeTag strips brackets and separators
  // anyway. We group by raw tag too, so we have to pick the right
  // boundary up-front.

  // 1. Bracketed prefix; tolerates mismatched and exotic Unicode pairs.
  //    Captures the INSIDE of the bracket pair so `[7-CAV]` groups as
  //    `7-CAV` even when caseSensitive: true skips normalization. Adds
  //    `>` to the closing class — the elo-tracker source omits it (their
  //    downstream normalizeTag strips it anyway, so the bug is invisible).
  const bracketRegex = /^\s*[\[\(【「『《╔├↾╬✦⟦╟|=<\{~\*](.+?)[\]\)】」』》╗┤↿╬✦⟧╢|=<>~\*\}]/;
  let match = name.match(bracketRegex);
  if (match) return match[1].trim();

  // 2. Explicit separator: TAG // Name, TAG | Name, TAG - Name, etc.
  const sepRegex = /^\s*(.{1,10}?)\s*(?:\/\/|\||-|:|\:\(|\:\)|†|™|✯|~|\*)\s+/;
  match = name.match(sepRegex);
  if (match) return match[1].trim();

  // 3. 2+ space separator (catches bare-prefix tags with a wide gap).
  const spaceRegex = /^\s*(.{1,10}?)\s{2,}/;
  match = name.match(spaceRegex);
  if (match) return match[1].trim();

  // 4. Short ALL-CAPS tag + single space + uppercase continuation
  //    (catches `KM Lookout`-style names — ASCII only).
  const shortTagRegex = /^\s*([A-Z0-9]{2,4})\s+[A-Z]/;
  match = name.match(shortTagRegex);
  if (match) return match[1].trim();

  // 5. Bare-prefix fallback: any 2–7 non-bracket non-whitespace chars
  //    followed by whitespace and a non-empty token. Catches Unicode
  //    bare prefixes (`KΛZ Korven`, `♣ΛCE Wurstwasser`), mixed-case
  //    bare prefixes (`RmdV Habicht`), and open-only brackets
  //    (`[OPN Player`) — none of which strategies 1–4 recognize because
  //    they require ASCII uppercase, an explicit separator, or a closing
  //    bracket. Anchored to a following \S so a name with no separator
  //    at all (`ABCJohnSmith`) still doesn't match — we only accept the
  //    looser prefix definition when there's a visible boundary between
  //    tag and player name.
  const bareRegex = /^[\[<({]?([^\s\[\](){}<>]{2,7})\s+\S/u;
  match = name.match(bareRegex);
  if (match) return match[1].trim();

  return null;
}

function normalizeTag(raw) {
  if (!raw) return null;

  // NFD-decompose then strip combining marks (Café → Cafe).
  let norm = raw.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Map "gamer character" lookalikes to their ASCII equivalents.
  for (const [key, val] of Object.entries(NON_ASCII_MAP)) {
    norm = norm.replace(new RegExp(key, 'gi'), val);
  }

  // Strip non-alphanumerics and uppercase.
  norm = norm.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return norm || null;
}

export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Ensure a is the shorter string for memory efficiency
  if (a.length > b.length) [a, b] = [b, a];

  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);

  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

export function extractClanGroups(rawPlayers, options = {}) {
  const minSize = options.minSize ?? 2;
  const maxSize = options.maxSize ?? 18;
  const maxEditDistance = options.maxEditDistance ?? 1;
  const caseSensitive = options.caseSensitive ?? true;

  const groups = {};
  for (const player of rawPlayers || []) {
    if (!player?.name || !player?.eosID) continue;
    const raw = extractRawPrefix(player.name);
    if (!raw) continue;
    const key = caseSensitive ? raw : normalizeTag(raw);
    if (!key) continue;
    if (!groups[key]) groups[key] = new Set();
    groups[key].add(player.eosID);
  }

  // Convert sets to arrays for the rest of processing.
  for (const tag of Object.keys(groups)) {
    groups[tag] = [...groups[tag]];
  }

  if (maxEditDistance > 0) {
    let merged = true;
    while (merged) {
      merged = false;
      const tags = Object.keys(groups);
      for (let i = 0; i < tags.length && !merged; i++) {
        for (let j = i + 1; j < tags.length && !merged; j++) {
          if (levenshteinDistance(tags[i], tags[j]) <= maxEditDistance) {
            const [keep, absorb] = groups[tags[i]].length >= groups[tags[j]].length
              ? [tags[i], tags[j]]
              : [tags[j], tags[i]];
            const seen = new Set(groups[keep]);
            for (const id of groups[absorb]) {
              if (!seen.has(id)) {
                groups[keep].push(id);
                seen.add(id);
              }
            }
            delete groups[absorb];
            merged = true;
          }
        }
      }
    }
  }

  for (const tag of Object.keys(groups)) {
    if (groups[tag].length < minSize || groups[tag].length > maxSize) {
      delete groups[tag];
    }
  }

  return groups;
}
