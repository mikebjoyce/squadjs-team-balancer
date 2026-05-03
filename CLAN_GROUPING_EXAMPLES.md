# Clan Tag Grouping — Worked Examples

Concrete before/after scenarios for the `enableClanTagGrouping` feature in TeamBalancer. See the main [README](README.md#clan-tag-grouping-optional) for the option reference.

> **Note:** The diagrams below show the **internal representation** the scrambler builds before Phase 1 runs — they do **not** describe in-game squad merges. The scrambler only outputs team-assignment moves; the game's actual squad structure is unchanged.

**Quick legend**

| Symbol            | Meaning                                                  |
| ----------------- | -------------------------------------------------------- |
| `[XYZ]Name`       | Player whose name starts with the clan tag `[XYZ]`       |
| `T1-S4`           | Squad 4 on Team 1                                        |
| `★ virtual squad` | A scrambler-internal grouping anchored on a real squad   |

**Tag detection:** five strategies applied in priority order (ported from [squadjs-elo-tracker](https://github.com/mikebjoyce/squadjs-elo-tracker)):

1. **Bracket pair** — matched or mismatched, plus exotic Unicode brackets (`[TAG]`, `(TAG)`, `<TAG>`, `{TAG}`, `【TAG】`, `╔TAG╗`, `{TAG)`). Captures the inside of the pair.
2. **Explicit separator** — `|`, `//`, `-`, `:`, `†`, `™`, `✯`, `~`, `*` followed by a space (`KqXz | Korvath`).
3. **2+ space gap** — `TAG  PlayerName` (two or more spaces).
4. **Short ASCII ALL-CAPS tag** — 2–4 uppercase chars + single space + uppercase continuation (`KM Lookout`).
5. **Bare-prefix fallback** — any 2–7 non-bracket non-whitespace chars + whitespace + non-empty token (`KΛZ Korven`, `♣ΛCE Wurstwasser`, `[OPN Player`).

The captured tag accepts ASCII letters/digits, special chars (`_ . - & | + = * # @ ™`), and Unicode (Greek `Λ`, math `℘`, card-suit `♣`, currency `€`, Cyrillic, etc.).

Real-world examples that all extract correctly:

| Name | Strategy | Extracted tag |
|---|---|---|
| `[QRZ] Steel Hawks` | bracket pair | `QRZ` |
| `KqXz \| Korvath` | separator (`\|`) | `KqXz` |
| `JX \| Drazark` | separator (`\|`) | `JX` |
| `[QZ℘] Voidstomper` | bracket pair | `QZ℘` |
| `[XQR]™ Drazo` | bracket pair | `XQR` |
| `[KΛZ] iTxBlueFlame` | bracket pair | `KΛZ` |
| `KΛZ Korven` | bare-prefix fallback | `KΛZ` |
| `[♣ΛCE] Hans_Wurst` | bracket pair | `♣ΛCE` |
| `♣ΛCE Wurstwasser` | bare-prefix fallback | `♣ΛCE` |
| `[7th-CAV]Player` | bracket pair | `7th-CAV` |
| `KM Lookout` | short ALL-CAPS | `KM` |

> **Heads-up:** only names with no visible tag/name boundary at all — like `ABCJohnSmith` (no whitespace, no bracket, no separator) — yield no group. Strategy 5 requires whitespace + a non-empty following token, which keeps unrelated 7-char-prefix collisions out while still recovering bare-prefix names that real Squad servers use.

---

## Example 1 — Same-team clan spread across squads (default pull mode)

**Settings:** `enableClanTagGrouping: true`, `clanGroupingPullEntireSquads: false` (default).

Five `[AAA]` clan members on Team 1, scattered across three squads.

**Before**

```
T1-S4: [AAA]Tom, [AAA]Bob, Alice, Joe       (4 players, 2 clan)
T1-S5: [AAA]Eve, [AAA]Sue, Mark             (3 players, 2 clan)
T1-S6: [AAA]Mia, Liz, Dan                   (3 players, 1 clan)
```

**After Pre-Phase**

```
T1-S4 ★ virtual squad (anchor):
       [AAA]Tom, [AAA]Bob, [AAA]Eve, [AAA]Sue, [AAA]Mia, Alice, Joe   (7 players)
T1-S5: Mark                                 (lost [AAA]Eve, [AAA]Sue)
T1-S6: Liz, Dan                             (lost [AAA]Mia)
```

**Why T1-S4 is the anchor:**
- Most clan members → tied with T1-S5 (both have 2)
- Larger total squad size → T1-S4 wins (4 > 3)

**What Phase 1 does:** treats the 7-player virtual squad as one indivisible unit. Either all 5 `[AAA]` players move together to Team 2, or none of them move. Alice and Joe (non-clan in the anchor) travel with them; Mark, Liz, and Dan stay put in their (now smaller) original squads.

---

## Example 2 — Same scenario with `clanGroupingPullEntireSquads: true`

**Settings:** As above, but with `clanGroupingPullEntireSquads: true`.

**Before** (identical to Example 1)

```
T1-S4: [AAA]Tom, [AAA]Bob, Alice, Joe
T1-S5: [AAA]Eve, [AAA]Sue, Mark
T1-S6: [AAA]Mia, Liz, Dan
```

**After Pre-Phase**

```
T1-S4 ★ virtual squad (anchor):
       [AAA]Tom, [AAA]Bob, [AAA]Eve, [AAA]Sue, [AAA]Mia,
       Alice, Joe, Mark, Liz, Dan          (10 players — full absorption)
T1-S5: (gone — fully absorbed)
T1-S6: (gone — fully absorbed)
```

**Trade-off:** heavier swap moves (10 players move together), but no original squadmate is left behind when the clan migrates.

**Pick this mode when:** non-clan teammates routinely play *with* the clan and shouldn't get stranded on the opposite team.

---

## Example 3 — Cross-team clan: each side independent

`[BBB]` has 5 members total — 3 on Team 1, 2 on Team 2.

**Before**

```
T1-S4: [BBB]Ana, Tim
T1-S5: [BBB]Leo, [BBB]Ivy, Pat
T2-S2: [BBB]Sam, Ron
T2-S3: [BBB]Kai
```

**After Pre-Phase**

```
T1-S4 ★ virtual squad (anchor): [BBB]Ana, [BBB]Leo, [BBB]Ivy, Tim
T1-S5: Pat                                  (lost [BBB]Leo, [BBB]Ivy)
T2-S2 ★ virtual squad (anchor): [BBB]Sam, [BBB]Kai, Ron
T2-S3: (empty — removed after losing [BBB]Kai)
```

**Two independent virtual squads form.** The scrambler does **not** try to bring all 5 `[BBB]` members onto one team — that's the documented "cross-team not consolidated" behavior. Team 1's three `[BBB]` members stay together; Team 2's two `[BBB]` members stay together; the cross-team split is preserved.

---

## Example 4 — Similarity merging with `clanTagMaxEditDistance: 1`

Tags within Levenshtein distance 1 of each other are merged at extraction time. Larger groups absorb smaller ones.

**Raw tags scanned from player names**

| Tag      | Members |
| -------- | ------- |
| `[CLAN]` | 3       |
| `[CLAM]` | 2       |
| `[TBG]`  | 2       |
| `[TBx]`  | 2       |
| `[XYZ]`  | 3       |
| `[ABC]`  | 2       |
| `[Abc]`  | 2       |

**After similarity merge (`clanTagMaxEditDistance: 1`)**

| Tag      | Members | Notes                                                 |
| -------- | ------- | ----------------------------------------------------- |
| `[CLAN]` | 5       | absorbed `[CLAM]` — distance 1 (`N` ↔ `M`)            |
| `[TBG]`  | 4       | absorbed `[TBx]` — distance 1 (`G` ↔ `x`)             |
| `[XYZ]`  | 3       | no near-neighbors                                     |
| `[ABC]`  | 2       | distance 2 from `[Abc]` (`B`↔`b` *and* `C`↔`c`)       |
| `[Abc]`  | 2       | not merged with `[ABC]` at threshold 1                 |

**Key points**
- The display name of a merged group is the *larger* tag's name.
- Case differences count as edits when `clanTagCaseSensitive` is `true` (the default), which is why `[ABC]+[Abc]` need 2 edits to align.
- Set `clanTagMaxEditDistance: 0` to disable similarity merging — only exact tag matches will group.

---

## Example 5 — Case-insensitive matching with `clanTagCaseSensitive: false`

Same raw input as Example 4. With `clanTagCaseSensitive: false`, the extracted prefix is run through a normalization pipeline before grouping:

1. **NFD-decompose + strip combining marks** — `Café` → `Cafe`, `Naïve` → `Naive`.
2. **Map gamer-character lookalikes** — `λ`→`a`, `я`→`r`, `丹`→`a`, `ø`→`o`, `ß`→`ss`, `†`→`t`, `匚`→`c`, `н`→`h`, `尺`→`r`, … (21-entry table).
3. **Strip non-alphanumerics** — `[*TOP*]` → `TOP`, `7-CAV` → `7CAV`.
4. **Uppercase** — `Abc` → `ABC`, `KqXz` → `KQXZ`.

The normalized form becomes the grouping key. Levenshtein merging then runs on those canonical keys.

**With `clanTagCaseSensitive: false` and `clanTagMaxEditDistance: 0`** (normalize only)

| Tag      | Members | Notes                                |
| -------- | ------- | ------------------------------------ |
| `CLAN`   | 3       |                                       |
| `CLAM`   | 2       |                                       |
| `TBG`    | 2       |                                       |
| `TBX`    | 2       | normalized from `[TBx]`              |
| `XYZ`    | 3       |                                       |
| `ABC`    | 4       | absorbed `[Abc]` — same key after fold |

**With `clanTagCaseSensitive: false` *and* `clanTagMaxEditDistance: 1`** (normalize + similarity)

| Tag      | Members | Notes                                                 |
| -------- | ------- | ----------------------------------------------------- |
| `CLAN`   | 5       | absorbed `CLAM`                                       |
| `TBG`    | 4       | absorbed `TBX` (distance 1 after fold)                |
| `XYZ`    | 3       |                                                       |
| `ABC`    | 4       | absorbed `Abc` → `ABC` via fold                       |

**Order of operations:** normalization runs **first** (during extraction), then Levenshtein merging runs on the canonical keys.

**Beyond simple case folding:** because non-alphanumerics are stripped, `[QZ℘]  Voidstomper` and `QZ℘ | Cravo` both normalize to `QZ` and group together. Because the gamer-character map is applied, `[CΛFE]` and `[Café]` and `[CAFE]` all collapse to `CAFE`. Because diacritics are stripped, `[Naïve]` and `[Naive]` collapse too.

**Pick this mode when:** your community uses inconsistent casing, decorative Unicode lookalikes, or accents — e.g. some players type `[CLAN]`, others `[clan]`, others `[CLΛN]`, and you want them all treated as the same clan.

---

## Example 6 — Sub-min clan ignored

**Settings:** `minClanGroupSize: 2` (default).

A solo player carrying a clan tag isn't a "group":

```
Players in server:                Extracted clan groups:
[SOLO]Eve  (only [SOLO] online)   {} — empty, [SOLO] dropped
```

**The scrambler treats `[SOLO]Eve` like any other ungrouped player.** No virtual squad is built; no special protection applies.

The same logic applies in reverse via `maxClanGroupSize` (default 18): a clan with too many members is dropped to avoid one mega-group dominating balance decisions.

---

## Example 7 — Anchor selection tiebreaker

Two squads contain the same number of clan members. Which one becomes the anchor?

**Before**

```
T1-S2: [GGG]A, [GGG]B, Joe                  (3 players, 2 clan)
T1-S5: [GGG]C, [GGG]D, Eve, Liz, Pat        (5 players, 2 clan)
```

**Anchor pick: T1-S5**

| Tiebreaker step                  | T1-S2 | T1-S5 | Winner    |
| -------------------------------- | ----- | ----- | --------- |
| 1. Most clan members             | 2     | 2     | tie       |
| 2. Larger total squad size       | 3     | 5     | **T1-S5** |
| 3. Lower squad ID (rare tiebreak)| —     | —     | —         |

**Resulting virtual squad** anchored on T1-S5: `[GGG]A, [GGG]B, [GGG]C, [GGG]D, Eve, Liz, Pat` (with `pullEntireSquads: false`, Joe stays in T1-S2).

**Tiebreaker order summary:** most clan members → larger total squad size → lower squad ID.
