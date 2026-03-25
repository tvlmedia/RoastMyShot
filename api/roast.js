const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VALID_ROAST_LEVELS = new Set(["mother", "honest", "hard", "merciless", "timo"]);
const VALID_STYLE_GOALS = new Set(["cinematic", "commercial", "raw", "arthouse", "intimate"]);

const MAX_ONE_LINER_HISTORY = 100;
const oneLinerHistory = { nl: [], en: [] };

const ONE_LINER_OPENING_PATTERNS = {
  nl: [
    "Dit ziet eruit alsof",
    "Deze still voelt als",
    "Alsof iemand",
    "Nog net niet",
    "Je zou denken dat",
    "Dit is het soort beeld waar",
    "Zelfs een",
    "Het oogt alsof"
  ],
  en: [
    "This looks like",
    "This still feels like",
    "As if someone",
    "You would think",
    "This is the kind of frame where",
    "Even a",
    "It reads like",
    "Almost like"
  ]
};

const VISUAL_DETAIL_POOL = {
  nl: [
    "de onscherpe voorgrond",
    "de rommelige achtergrond",
    "de vlakke keylight",
    "de veilige kadrering",
    "de dode blik",
    "de verloren focus",
    "de rare props",
    "de kleur die nergens heen gaat",
    "de halfbakken diepte",
    "de misplaatste lichtbron"
  ],
  en: [
    "the blurry foreground",
    "the noisy background",
    "the flat key light",
    "the safe framing",
    "the dead expression",
    "the drifting focus",
    "the awkward props",
    "the aimless color palette",
    "the half-baked depth",
    "the misplaced light source"
  ]
};

const TIMO_BLOCKLIST = {
  nl: {
    exact: [
      "Dit lijkt op een studentenfilm die blur ontdekte en de rest vergat.",
      "Dit is niet filmisch, dit is gewoon kut met zelfvertrouwen.",
      "Dit doet alsof het arthouse is...",
      "Je hebt niet voor stijl gekozen, je hebt gewoon controle verloren.",
      "Dit ziet eruit alsof iemand per ongeluk op record drukte en daarna heel hard 'sfeer' riep.",
      "Dit frame doet alsof het spannend is, maar oogt als visuele chaos met bravoure.",
      "Dit voelt als nep-arthouse met IKEA-zelfvertrouwen en nul controle."
    ],
    patterns: [
      /studentenfilm.*blur.*vergat/i,
      /kut\s+met\s+zelfvertrouwen/i,
      /doet\s+alsof\s+het\s+arthouse\s+is/i,
      /niet\s+filmisch/i,
      /controle\s+verloren/i,
      /per\s+ongeluk\s+op\s+record/i,
      /heel\s+hard\s+['"]?sfeer['"]?\s+riep/i
    ]
  },
  en: {
    exact: [
      "This is not cinematic, this is just trash with confidence.",
      "You did not choose a style, you just lost control.",
      "This pretends to be arthouse...",
      "This looks like a student short that discovered blur and forgot everything else.",
      "This looks like somebody hit record by accident and then sold panic as atmosphere."
    ],
    patterns: [
      /not\s+cinematic.*trash\s+with\s+confidence/i,
      /did\s+not\s+choose\s+(a\s+)?style.*lost\s+control/i,
      /pretends\s+to\s+be\s+arthouse/i,
      /student\s+(short|film).*blur/i,
      /hit\s+record\s+by\s+accident/i
    ]
  }
};

function normalizeRoastLevel(value) {
  const level = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_ROAST_LEVELS.has(level) ? level : "hard";
}

function normalizeStyleGoal(value) {
  const styleGoal = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_STYLE_GOALS.has(styleGoal) ? styleGoal : "cinematic";
}

function clampScore(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(10, Math.round(numeric)));
}

function toCleanString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizePhrase(text) {
  return toCleanString(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(a, b) {
  const na = normalizePhrase(a);
  const nb = normalizePhrase(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.93;

  const aWords = new Set(na.split(" "));
  const bWords = new Set(nb.split(" "));
  const intersection = [...aWords].filter((x) => bWords.has(x)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return union ? intersection / union : 0;
}

function parseFirstJsonObject(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function getResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const chunks = [];
  const outputItems = Array.isArray(response?.output) ? response.output : [];
  outputItems.forEach((item) => {
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    contentItems.forEach((content) => {
      if (typeof content?.text === "string") {
        chunks.push(content.text);
      }
    });
  });

  return chunks.join("\n");
}

function extractStructuredObject(response) {
  if (response?.output_parsed && typeof response.output_parsed === "object") {
    return response.output_parsed;
  }

  const outputItems = Array.isArray(response?.output) ? response.output : [];
  for (const item of outputItems) {
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    for (const content of contentItems) {
      if (content?.parsed && typeof content.parsed === "object") {
        return content.parsed;
      }
    }
  }

  return parseFirstJsonObject(getResponseText(response));
}

function scrubForbiddenPhrases(text, language) {
  const source = toCleanString(text);
  if (!source) return source;

  const forbidden =
    language === "en"
      ? ["epic film", "timo would say", "roast level", "as an ai"]
      : ["epische film", "timo zou zeggen", "roast level", "als ai"];

  let cleaned = source;
  forbidden.forEach((phrase) => {
    cleaned = cleaned.replace(new RegExp(phrase, "ig"), "");
  });

  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function normalizeList(value, options) {
  const { max = 6, min = 0, fallback = [], language = "nl" } = options;

  const list = Array.isArray(value)
    ? value
        .map((item) => scrubForbiddenPhrases(toCleanString(item), language))
        .filter(Boolean)
    : [];

  const output = list.slice(0, max);
  for (const fallbackItem of fallback) {
    if (output.length >= min) break;
    output.push(fallbackItem);
  }

  return output.slice(0, max);
}

function firstSentence(text) {
  const source = toCleanString(text);
  if (!source) return source;
  const parts = source.split(/(?<=[.!?])\s+/);
  return parts[0] || source;
}

function countSentences(text) {
  const source = toCleanString(text);
  if (!source) return 0;
  const matches = source.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

function countWords(text) {
  const source = normalizePhrase(text);
  return source ? source.split(" ").length : 0;
}

function gatherPayloadText(payload) {
  return [
    payload.one_liner_roast,
    payload.final_verdict,
    ...(Array.isArray(payload.strengths) ? payload.strengths : []),
    ...(Array.isArray(payload.problems) ? payload.problems : []),
    ...(Array.isArray(payload.fixes) ? payload.fixes : [])
  ]
    .filter((x) => typeof x === "string")
    .join(" ")
    .toLowerCase();
}

function looksEnglish(text) {
  if (!text) return false;
  const tokens = [" the ", " and ", " with ", " this ", "shot", "lighting", "background"];
  const sample = ` ${text.replace(/\s+/g, " ")} `;
  return tokens.filter((token) => sample.includes(token)).length >= 2;
}

function looksDutch(text) {
  if (!text) return false;
  const tokens = [" de ", " het ", " en ", " met ", " dit ", "licht", "compositie", "achtergrond"];
  const sample = ` ${text.replace(/\s+/g, " ")} `;
  return tokens.filter((token) => sample.includes(token)).length >= 2;
}

function languageMismatch(payload, language) {
  const text = gatherPayloadText(payload);
  if (!text) return false;

  if (language === "nl") return looksEnglish(text) && !looksDutch(text);
  return looksDutch(text) && !looksEnglish(text);
}

function hasComparisonTone(text) {
  const source = toCleanString(text).toLowerCase();
  if (!source) return false;

  const markers = [
    "ziet eruit alsof",
    "dit ziet eruit alsof",
    "deze still voelt als",
    "alsof iemand",
    "nog net niet",
    "je zou denken dat",
    "dit is het soort beeld",
    "zelfs een",
    "het oogt alsof",
    "lijkt meer op",
    "looks like",
    "this still feels like",
    "as if someone",
    "you would think",
    "even a",
    "it reads like"
  ];

  return markers.some((marker) => source.includes(marker));
}

function hasTimoFlavor(text, language) {
  const source = toCleanString(text).toLowerCase();
  if (!source) return false;

  const markers =
    language === "en"
      ? [
          "student",
          "arthouse",
          "bokeh",
          "half-baked",
          "timid",
          "trash",
          "looks like",
          "as if",
          "pseudo",
          "middle of the road"
        ]
      : [
          "student",
          "arthouse",
          "bokeh",
          "halfbakken",
          "laf",
          "slap",
          "kut",
          "ziet eruit alsof",
          "alsof",
          "middle of the road"
        ];

  return markers.some((marker) => source.includes(marker));
}

function hasVisualAnchor(text, language) {
  const source = normalizePhrase(text);
  if (!source) return false;

  const visualMarkers =
    language === "en"
      ? [
          "focus",
          "background",
          "light",
          "lighting",
          "frame",
          "framing",
          "face",
          "pose",
          "mask",
          "prop",
          "depth",
          "sharp",
          "blur",
          "expression",
          "styling",
          "wardrobe",
          "color",
          "neon"
        ]
      : [
          "focus",
          "achtergrond",
          "licht",
          "kader",
          "kadrering",
          "gezicht",
          "pose",
          "masker",
          "prop",
          "diepte",
          "scherpte",
          "onscherp",
          "blur",
          "expressie",
          "styling",
          "kleding",
          "kleur",
          "neon"
        ];

  return visualMarkers.some((marker) => source.includes(marker));
}

function openingSignature(text) {
  const n = normalizePhrase(text);
  if (!n) return "";
  return n.split(" ").slice(0, 3).join(" ");
}

function endingSignature(text) {
  const n = normalizePhrase(text);
  if (!n) return "";
  const words = n.split(" ");
  return words.slice(Math.max(0, words.length - 5)).join(" ");
}

function toNgramSet(text, size) {
  const source = normalizePhrase(text).replace(/\s+/g, " ");
  const set = new Set();
  if (!source) return set;
  if (source.length <= size) {
    set.add(source);
    return set;
  }
  for (let i = 0; i <= source.length - size; i += 1) {
    set.add(source.slice(i, i + size));
  }
  return set;
}

function jaccardSetSimilarity(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let intersection = 0;
  aSet.forEach((value) => {
    if (bSet.has(value)) intersection += 1;
  });
  const union = aSet.size + bSet.size - intersection;
  return union ? intersection / union : 0;
}

function extractTropeTokens(text, language) {
  const source = normalizePhrase(text);
  if (!source) return new Set();
  const tokens =
    language === "en"
      ? ["student", "arthouse", "blur", "bokeh", "safe", "flat", "middle", "pretend", "confidence", "fake"]
      : ["studentenfilm", "student", "arthouse", "blur", "bokeh", "veilig", "vlak", "middengebied", "zelfvertrouwen", "nep"];
  return new Set(tokens.filter((token) => source.includes(token)));
}

function detectStructureType(text, language) {
  const source = toCleanString(text).toLowerCase();
  const patterns = ONE_LINER_OPENING_PATTERNS[language] || ONE_LINER_OPENING_PATTERNS.nl;
  const match = patterns.find((pattern) => source.startsWith(pattern.toLowerCase()));
  if (match) return match.toLowerCase();
  if (source.includes("alsof") || source.includes("as if")) return "as_if";
  if (source.includes("ziet eruit") || source.includes("looks like")) return "looks_like";
  return "other";
}

function oneLinerSimilarityDetails(a, b, language) {
  const tokenSim = similarityScore(a, b);
  const charTriSim = jaccardSetSimilarity(toNgramSet(a, 3), toNgramSet(b, 3));
  const charFourSim = jaccardSetSimilarity(toNgramSet(a, 4), toNgramSet(b, 4));
  const openingSame = openingSignature(a) && openingSignature(a) === openingSignature(b);
  const endingSim = similarityScore(endingSignature(a), endingSignature(b));
  const structureSame = detectStructureType(a, language) === detectStructureType(b, language);
  const tropeA = extractTropeTokens(a, language);
  const tropeB = extractTropeTokens(b, language);
  const tropeOverlap = jaccardSetSimilarity(tropeA, tropeB);

  return {
    tokenSim,
    charTriSim,
    charFourSim,
    openingSame,
    endingSim,
    structureSame,
    tropeOverlap
  };
}

function pushOneLinerHistory(text, language) {
  const line = toCleanString(text);
  if (!line) return;
  const bucket = oneLinerHistory[language] || oneLinerHistory.nl;
  bucket.push(line);
  if (bucket.length > MAX_ONE_LINER_HISTORY) {
    bucket.splice(0, bucket.length - MAX_ONE_LINER_HISTORY);
  }
}

function isBlockedOrNearBlockedOneLiner(text, language) {
  const line = toCleanString(text);
  if (!line) return true;

  const block = TIMO_BLOCKLIST[language] || TIMO_BLOCKLIST.nl;
  const normalized = normalizePhrase(line);

  if (block.exact.some((item) => normalizePhrase(item) === normalized)) return true;
  if (block.patterns.some((pattern) => pattern.test(line))) return true;
  if (block.exact.some((item) => similarityScore(line, item) >= 0.74)) return true;

  return false;
}

function isTooSimilarToHistory(text, language) {
  const line = toCleanString(text);
  if (!line) return true;

  const bucket = oneLinerHistory[language] || [];
  if (!bucket.length) return false;

  const opening = openingSignature(line);
  const sameOpeningCount = bucket.filter((oldLine) => openingSignature(oldLine) === opening).length;
  if (opening && sameOpeningCount >= 2) return true;

  return bucket.some((oldLine) => {
    const details = oneLinerSimilarityDetails(line, oldLine, language);
    if (details.tokenSim >= 0.72) return true;
    if (details.charTriSim >= 0.84 || details.charFourSim >= 0.8) return true;
    if (details.openingSame && details.endingSim >= 0.66) return true;
    if (details.structureSame && details.tropeOverlap >= 0.7 && details.tokenSim >= 0.56) return true;
    if (details.openingSame && details.tropeOverlap >= 0.75) return true;
    return false;
  });
}

function failsOriginalityCheck(line, language, roastLevel) {
  const source = toCleanString(line);
  if (!source) return "missing_one_liner";

  if (countSentences(source) > 2) return "too_long";
  if (countWords(source) < 6) return "too_short";

  if (roastLevel === "timo") {
    if (!hasComparisonTone(source)) return "no_comparison_structure";
    if (!hasVisualAnchor(source, language)) return "not_visual_specific";
  }

  const normalized = normalizePhrase(source);
  const overusedTerms = language === "en" ? ["student film", "arthouse", "blur", "trash with confidence"] : ["studentenfilm", "arthouse", "blur", "kut met zelfvertrouwen"];
  const termHits = overusedTerms.filter((term) => normalized.includes(normalizePhrase(term))).length;
  if (termHits >= 2 && roastLevel === "timo" && !hasVisualAnchor(source, language)) return "overused_generic_terms";

  if (isBlockedOrNearBlockedOneLiner(source, language)) return "blocked_or_near_blocked";
  if (isTooSimilarToHistory(source, language)) return "too_similar_to_recent_history";

  return "";
}

function buildForcedUniqueOneLiner(language, roastLevel, seed = 0) {
  const openings = ONE_LINER_OPENING_PATTERNS[language] || ONE_LINER_OPENING_PATTERNS.nl;
  const details = VISUAL_DETAIL_POOL[language] || VISUAL_DETAIL_POOL.nl;
  const tonePool =
    language === "en"
      ? [
          "this frame trips over its own ambition.",
          "this shot confuses noise with intention.",
          "the joke is that the image takes itself seriously.",
          "the style talks loud while the frame says nothing."
        ]
      : [
          "dit frame struikelt over z'n eigen ambitie.",
          "dit shot verwart ruis met intentie.",
          "de grap is dat het beeld zichzelf veel te serieus neemt.",
          "de stijl roept hard terwijl het frame niks zegt."
        ];

  const base = (seed + Date.now()) % 997;
  for (let i = 0; i < 80; i += 1) {
    const opening = openings[(base + i) % openings.length];
    const detail = details[(base + i * 3) % details.length];
    const tone = tonePool[(base + i * 5) % tonePool.length];
    const candidate =
      roastLevel === "mother"
        ? language === "en"
          ? `Aww, I still like this, maybe ${detail} could be a little softer.`
          : `Ahhh, ik vind dit nog steeds mooi hoor, misschien mag ${detail} net iets zachter.`
        : language === "en"
          ? `${opening} ${detail} wrecks the whole frame; ${tone}`
          : `${opening} ${detail} de boel sloopt; ${tone}`;

    if (!isTooSimilarToHistory(candidate, language) && !isBlockedOrNearBlockedOneLiner(candidate, language)) {
      return candidate;
    }
  }

  return roastLevel === "mother"
    ? language === "en"
      ? "Aww, this is still sweet, maybe the frame needs one clearer focus point."
      : "Ahhh, dit is nog steeds lief, misschien wil het frame één duidelijker focuspunt."
    : language === "en"
      ? `This frame is unique for the wrong reasons: ${Date.now().toString(36)}.`
      : `Dit frame is uniek om de verkeerde reden: ${Date.now().toString(36)}.`;
}

function buildRetryConstraint({ language, reason, attempt, historyCount = 0 }) {
  const reasons = {
    missing_one_liner: language === "en" ? "You returned no usable one-liner." : "Je gaf geen bruikbare one-liner terug.",
    too_short: language === "en" ? "One-liner is too short and generic." : "De one-liner is te kort en te generiek.",
    too_long: language === "en" ? "One-liner is too long; keep max 2 short sentences." : "De one-liner is te lang; max 2 korte zinnen.",
    no_comparison_structure: language === "en" ? "One-liner misses a sharp comparison structure." : "De one-liner mist een scherpe vergelijkingsstructuur.",
    not_visual_specific: language === "en" ? "One-liner is not tied to visible frame details." : "De one-liner is niet gekoppeld aan zichtbare details.",
    overused_generic_terms: language === "en" ? "Do not lean on generic arthouse/student/blur templates." : "Leun niet op generieke arthouse/student/blur templates.",
    blocked_or_near_blocked: language === "en" ? "One-liner matches forbidden phrase patterns." : "De one-liner matcht verboden zins-patronen.",
    too_similar_to_recent_history:
      language === "en"
        ? "One-liner is too similar to recent outputs. Use a different opening and punchline."
        : "De one-liner lijkt te veel op recente output. Gebruik een andere opening en punchline."
  };

  const openings = ONE_LINER_OPENING_PATTERNS[language] || ONE_LINER_OPENING_PATTERNS.nl;
  const details = VISUAL_DETAIL_POOL[language] || VISUAL_DETAIL_POOL.nl;
  const forcedOpening = openings[(historyCount + attempt) % openings.length];
  const forcedDetail = details[(historyCount + attempt * 2) % details.length];

  const header = language === "en" ? `Retry attempt ${attempt}/5.` : `Retry poging ${attempt}/5.`;
  const body = reasons[reason] || (language === "en" ? "Previous one-liner failed originality constraints." : "Vorige one-liner faalde op originaliteitseisen.");
  const forceDifferentAngle =
    attempt >= 4
      ? language === "en"
        ? `Force a totally different angle now. Start with "${forcedOpening}" and include this visible detail: "${forcedDetail}".`
        : `Forceer nu een totaal andere invalshoek. Start met "${forcedOpening}" en gebruik dit zichtbare detail: "${forcedDetail}".`
      : "";

  return [
    header,
    body,
    language === "en"
      ? "Generate a fully different one-liner: new imagery, new wording, new opening, tied to this exact frame."
      : "Genereer een totaal andere one-liner: nieuwe beeldspraak, nieuwe formulering, nieuwe opening, gekoppeld aan dit exacte frame.",
    language === "en"
      ? "Never copy or paraphrase known examples."
      : "Kopieer of parafraseer nooit bekende voorbeeldzinnen.",
    language === "en"
      ? "Draft 8 internal candidates first, output only the best one."
      : "Bedenk intern eerst 8 kandidaten en geef alleen de beste terug.",
    forceDifferentAngle
  ].join(" ");
}

function getJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "one_liner_roast",
      "cinema_score",
      "brutality_score",
      "strengths",
      "problems",
      "fixes",
      "final_verdict"
    ],
    properties: {
      one_liner_roast: { type: "string", minLength: 4, maxLength: 240 },
      cinema_score: { type: "number", minimum: 0, maximum: 10 },
      brutality_score: { type: "number", minimum: 0, maximum: 10 },
      strengths: {
        type: "array",
        items: { type: "string", minLength: 2, maxLength: 180 },
        minItems: 0,
        maxItems: 3
      },
      problems: {
        type: "array",
        items: { type: "string", minLength: 2, maxLength: 220 },
        minItems: 2,
        maxItems: 7
      },
      fixes: {
        type: "array",
        items: { type: "string", minLength: 2, maxLength: 220 },
        minItems: 2,
        maxItems: 6
      },
      final_verdict: { type: "string", minLength: 4, maxLength: 260 }
    }
  };
}

function getLevelInstruction(roastLevel, language) {
  const rules = {
    mother: {
      nl: [
        "JE MOEDER: extreem lief, beschermend en een beetje wereldvreemd positief.",
        "Geef vooral complimenten en verpak kritiek als heel klein en schattig.",
        "One-liner is geen roast, maar een lieve opmerking met mini-kritiek.",
        "Nooit hard, nooit vernietigend."
      ],
      en: [
        "MOTHER MODE: very kind, protective, and naively positive.",
        "Praise a lot and wrap critique as tiny gentle notes.",
        "One-liner is loving, not roasty.",
        "Never harsh or destructive."
      ]
    },
    honest: {
      nl: ["EERLIJK: professioneel, direct en gebalanceerd."],
      en: ["HONEST MODE: professional, direct, balanced."]
    },
    hard: {
      nl: ["HARD: strenge filmdocent, weinig geduld."],
      en: ["HARD MODE: strict film-school instructor, little patience."]
    },
    merciless: {
      nl: ["MEEDOGENLOOS: scherp en agressief. Roast eerst, nuance later."],
      en: ["MERCILESS MODE: sharp and aggressive. Roast first, nuance later."]
    },
    timo: {
      nl: [
        "TIMO VAN LIEROP MODE: lomp, hard, grappig-afbrandend en meedogenloos raak.",
        "Niet klinken als filmacademie-feedback, wel als harde bank-roast met korte klappen.",
        "One-liner: max 1-2 zinnen, hardste en grappigste punchline van de output.",
        "Use voorbeeldzinnen alleen als energie; nooit copy, nooit parafrase.",
        "Bedenk intern eerst 8 verschillende one-liners en kies dan de meest originele.",
        "One-liner moet frame-specifiek zijn op zichtbare details: scherpte, achtergrond, pose, expressie, props, lichtbron, kadering, kleur.",
        "Varieer openingsvormen; herhaal niet steeds dezelfde startfrase.",
        "Verboden herhaalzinnen nooit gebruiken, ook niet licht herschreven."
      ],
      en: [
        "TIMO MODE: blunt, funny-destructive, savage and specific.",
        "Do not sound like film school notes; sound like a couch roast with short hits.",
        "One-liner: 1-2 sentences max, funniest and hardest punchline in output.",
        "Use example lines as style energy only; never copy, never paraphrase.",
        "Internally draft 8 different one-liners first, then pick the most original.",
        "One-liner must be frame-specific using visible details: focus, background, pose, expression, props, light source, framing, color.",
        "Vary opening structures; avoid repeating the same opening formula.",
        "Never output forbidden repeat lines or close variants."
      ]
    }
  };

  const selected = rules[roastLevel] || rules.hard;
  return selected[language] || selected.nl;
}

function buildSystemPrompt(options) {
  const { language, roastLevel, extraConstraint = "" } = options;

  const baseRules = [
    "You are a razor-sharp cinematography critic.",
    "Judge the frame like an experienced DOP with little patience for mediocrity.",
    "All feedback MUST be grounded in visible frame evidence.",
    "No generic filler. No vague praise.",
    "Never explain the mode/persona. Never use meta commentary.",
    "Internally analyze first (not in output): composition, lighting, subject separation, background, camera distance/lens feel, color, intentionality.",
    "Then output ONLY valid JSON matching the schema.",
    language === "en" ? "Write all text in English." : "Schrijf alle tekst in Nederlands.",
    "Never say: 'epic film' or 'epische film'."
  ];

  const outputRules = [
    "one_liner_roast must be short and quote-worthy.",
    "strengths max 3 items.",
    "problems concrete and image-specific.",
    "fixes practical and direct.",
    "final_verdict decisive."
  ];

  const timoRules =
    roastLevel === "timo"
      ? [
          "Timo must be the funniest and sharpest mode by far.",
          "Use humiliating comparisons and short, blunt phrasing.",
          "Internally draft 8 one-liner options; output only the best one.",
          "Do NOT copy/paraphrase style examples or known fallback lines.",
          "If one-liner sounds generic, regenerate a new one internally.",
          "Use varied opening patterns across outputs: 'Dit ziet eruit alsof', 'Deze still voelt als', 'Alsof iemand', 'Nog net niet', 'Je zou denken dat', 'Dit is het soort beeld waar', 'Zelfs een', 'Het oogt alsof'.",
          "Tie jokes to concrete visible details, not generic templates.",
          "Forbidden phrases include variants of: 'Dit is niet filmisch, dit is gewoon kut met zelfvertrouwen.' and 'Je hebt niet voor stijl gekozen, je hebt gewoon controle verloren.'"
        ]
      : [];

  return [...baseRules, ...outputRules, ...getLevelInstruction(roastLevel, language), ...timoRules, extraConstraint]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(options) {
  const { language, roastLevel, styleGoal } = options;

  const styleLabelMap = {
    cinematic: language === "en" ? "cinematic" : "filmisch",
    commercial: language === "en" ? "commercial" : "commercial",
    raw: language === "en" ? "raw" : "rauw",
    arthouse: language === "en" ? "arthouse" : "arthouse",
    intimate: language === "en" ? "intimate" : "intiem"
  };

  const levelLabel = {
    mother: language === "en" ? "Mother" : "Je moeder",
    honest: language === "en" ? "Honest" : "Eerlijk",
    hard: language === "en" ? "Hard" : "Hard",
    merciless: language === "en" ? "Merciless" : "Meedogenloos",
    timo: "Timo van Lierop"
  }[roastLevel] || "Hard";

  if (language === "en") {
    return [
      "Analyze the uploaded still.",
      `Roast level: ${levelLabel}.`,
      `Style goal: ${styleLabelMap[styleGoal] || "cinematic"}.`,
      "Anchor feedback in visible details.",
      "Output JSON only."
    ].join("\n");
  }

  return [
    "Analyseer de geuploade still.",
    `Roast level: ${levelLabel}.`,
    `Stijldoel: ${styleLabelMap[styleGoal] || "filmisch"}.`,
    "Baseer feedback op zichtbare details.",
    "Geef alleen JSON terug."
  ].join("\n");
}

async function callRoastModel(options) {
  const { image, language, roastLevel, styleGoal, extraConstraint = "" } = options;

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    max_output_tokens: 900,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: buildSystemPrompt({ language, roastLevel, extraConstraint })
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildUserPrompt({ language, roastLevel, styleGoal })
          },
          {
            type: "input_image",
            image_url: image
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "roast_feedback",
        strict: true,
        schema: getJsonSchema()
      }
    }
  });

  return {
    parsed: extractStructuredObject(response),
    rawText: getResponseText(response)
  };
}

async function repairJsonWithModel(options) {
  const { rawText } = options;
  if (!toCleanString(rawText)) return null;

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    max_output_tokens: 700,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Repair this into valid JSON matching the schema exactly. Keep meaning and tone. Output JSON only."
          }
        ]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: rawText }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "roast_feedback_repair",
        strict: true,
        schema: getJsonSchema()
      }
    }
  });

  return extractStructuredObject(response);
}

async function translatePayload(payload, targetLanguage) {
  const targetLanguageName = targetLanguage === "en" ? "English" : "Dutch";

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    max_output_tokens: 700,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `Rewrite all text fields in natural ${targetLanguageName}. Keep tone and meaning. Keep scores unchanged. Output JSON only.`
          }
        ]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(payload) }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "roast_feedback_translate",
        strict: true,
        schema: getJsonSchema()
      }
    }
  });

  return extractStructuredObject(response);
}

function sanitizePayload(parsed, options) {
  const { language, roastLevel } = options;

  const fallback =
    language === "en"
      ? {
          oneLiner: "Technically visible. Creatively undercooked.",
          verdict: "Usable foundation, but still too safe and undecided.",
          problems: [
            "Composition sits in a safe middle and lacks commitment.",
            "Lighting hierarchy is weak for subject priority.",
            "Background adds noise instead of support.",
            "Framing choices feel timid."
          ],
          fixes: [
            "Commit to one clear framing choice.",
            "Shape key light for obvious subject priority.",
            "Clean or darken distracting background zones.",
            "Adjust camera distance for stronger intent."
          ]
        }
      : {
          oneLiner: "Technisch zichtbaar. Creatief halfbakken.",
          verdict: "Bruikbare basis, maar nog te veilig en besluiteloos.",
          problems: [
            "Compositie hangt in veilig middengebied zonder keuze.",
            "Lichthiërarchie is te zwak voor duidelijke subject-prioriteit.",
            "Achtergrond voegt ruis toe in plaats van steun.",
            "Kaderkeuzes voelen laf."
          ],
          fixes: [
            "Kies één duidelijke kadrering en commit.",
            "Shape je key light voor duidelijke prioriteit.",
            "Ruim afleidende achtergrondzones op of maak ze donkerder.",
            "Pas camera-afstand aan voor sterkere intentie."
          ]
        };

  const motherFallback =
    language === "en"
      ? {
          oneLiner: "Aww, this is honestly really pretty, maybe the face could be just a little brighter.",
          strengths: [
            "You can really feel your care in this frame.",
            "There is a lovely atmosphere here.",
            "It already feels cinematic in a sweet way."
          ],
          problems: [
            "Maybe there is just a tiny bit much happening in the background.",
            "The face could maybe be a little easier to see.",
            "I had to look closely in a few areas."
          ],
          fixes: [
            "Maybe add a tiny bit more light on the face.",
            "Maybe calm the background slightly.",
            "Maybe let the subject stand out a little more."
          ],
          verdict: "This is really lovely and you should be proud; a few tiny tweaks will make it even prettier."
        }
      : {
          oneLiner: "Ahhh, ik vind dit eigenlijk best mooi hoor, alleen misschien is het gezichtje iets donker.",
          strengths: [
            "Je ziet echt dat je hier gevoel in hebt gestopt.",
            "Ik vind de sfeer heel mooi overkomen.",
            "Wat knap dat je dit allemaal zelf maakt."
          ],
          problems: [
            "Op de achtergrond gebeurt misschien net iets veel.",
            "Het gezicht had misschien nog iets beter zichtbaar gemogen.",
            "Ik moest soms even goed kijken."
          ],
          fixes: [
            "Misschien een klein beetje meer licht op het gezicht.",
            "Misschien de achtergrond iets rustiger maken.",
            "Misschien het onderwerp iets meer laten opvallen."
          ],
          verdict: "Ik vind dit echt heel knap gedaan hoor, en met een paar kleine dingetjes wordt het alleen nog mooier."
        };

  const timoFallback =
    language === "en"
      ? {
          oneLiner: "This frame looks like panic pretending to be a visual style.",
          verdict: "Technically maybe usable, creatively still face-planting into mediocrity.",
          strengths: ["At least the subject is visible, so it is not total chaos."],
          problems: [
            "The framing hangs there like nobody committed to a decision.",
            "Your key light avoids the subject like it is allergic to storytelling.",
            "Background clutter screams louder than the characters.",
            "Depth/focus choices feel like accidents sold as taste."
          ],
          fixes: [
            "Choose one framing idea and commit.",
            "Put the main light on the subject, not random junk.",
            "Kill noisy background distractions.",
            "Lock focus where the story actually is."
          ]
        }
      : {
          oneLiner: "Dit frame ziet eruit als paniek die zich voordoet als stijl.",
          verdict: "Technisch misschien bruikbaar, creatief glijdt dit hard de middelmaat in.",
          strengths: ["Je onderwerp staat tenminste in beeld, dus het is niet volledig chaos."],
          problems: [
            "Je kader hangt erbij alsof niemand een echte keuze durfde te maken.",
            "Je keylight ontwijkt je onderwerp alsof verhaal vertellen optioneel was.",
            "Je achtergrond schreeuwt harder dan je scene.",
            "Je focus/diepte lijkt op ongelukjes die als smaak worden verkocht."
          ],
          fixes: [
            "Kies één kaderidee en commit.",
            "Zet je hoofdlicht op je onderwerp, niet op random troep.",
            "Sloop afleidende achtergrondruis.",
            "Leg je focus waar het verhaal zit."
          ]
        };

  let oneLiner = scrubForbiddenPhrases(toCleanString(parsed?.one_liner_roast), language);
  let finalVerdict = scrubForbiddenPhrases(toCleanString(parsed?.final_verdict), language);
  let strengths = normalizeList(parsed?.strengths, { language, max: roastLevel === "timo" ? 2 : 3, min: roastLevel === "timo" ? 1 : 0, fallback: roastLevel === "timo" ? timoFallback.strengths : [] });
  let problems = normalizeList(parsed?.problems, { language, max: 7, min: roastLevel === "timo" ? 4 : 2, fallback: roastLevel === "timo" ? timoFallback.problems : fallback.problems });
  let fixes = normalizeList(parsed?.fixes, { language, max: roastLevel === "timo" ? 5 : 6, min: roastLevel === "timo" ? 3 : 2, fallback: roastLevel === "timo" ? timoFallback.fixes : fallback.fixes });

  if (!oneLiner) oneLiner = roastLevel === "timo" ? timoFallback.oneLiner : fallback.oneLiner;
  if (!finalVerdict) finalVerdict = roastLevel === "timo" ? timoFallback.verdict : fallback.verdict;

  const payload = {
    one_liner_roast: firstSentence(oneLiner),
    cinema_score: clampScore(parsed?.cinema_score, roastLevel === "mother" ? 7 : 5),
    brutality_score: roastLevel === "timo" ? 10 : clampScore(parsed?.brutality_score, roastLevel === "mother" ? 1 : 6),
    strengths,
    problems,
    fixes,
    final_verdict: finalVerdict
  };

  if (roastLevel === "mother") {
    payload.brutality_score = Math.min(payload.brutality_score, 2);
    payload.strengths = normalizeList(payload.strengths, { language, max: 3, min: 3, fallback: motherFallback.strengths });
    payload.problems = normalizeList(payload.problems, { language, max: 3, min: 2, fallback: motherFallback.problems });
    payload.fixes = normalizeList(payload.fixes, { language, max: 3, min: 2, fallback: motherFallback.fixes });
    payload.one_liner_roast = payload.one_liner_roast || motherFallback.oneLiner;
    payload.final_verdict = payload.final_verdict || motherFallback.verdict;
  }

  if (roastLevel === "timo") {
    payload.brutality_score = 10;
    payload.strengths = normalizeList(payload.strengths, { language, max: 2, min: 1, fallback: timoFallback.strengths });
    payload.problems = normalizeList(payload.problems, { language, max: 7, min: 4, fallback: timoFallback.problems });
    payload.fixes = normalizeList(payload.fixes, { language, max: 5, min: 3, fallback: timoFallback.fixes });

    if (failsOriginalityCheck(payload.one_liner_roast, language, roastLevel)) {
      payload.one_liner_roast = timoFallback.oneLiner;
    }
  }

  return payload;
}

function violatesHardConstraints(payload, roastLevel, language) {
  if (!payload || typeof payload !== "object") return true;
  if (!payload.one_liner_roast || !payload.final_verdict) return true;
  if (!Array.isArray(payload.problems) || payload.problems.length < 2) return true;
  if (!Array.isArray(payload.fixes) || payload.fixes.length < 2) return true;

  if (roastLevel === "timo") {
    if (payload.brutality_score !== 10) return true;
    if (!Array.isArray(payload.problems) || payload.problems.length < 4) return true;
    if (!Array.isArray(payload.fixes) || payload.fixes.length < 3) return true;
    if (!hasComparisonTone(payload.one_liner_roast)) return true;
    if (!hasTimoFlavor(payload.one_liner_roast, language)) return true;
    if (!hasVisualAnchor(payload.one_liner_roast, language)) return true;
    if (failsOriginalityCheck(payload.one_liner_roast, language, roastLevel)) return true;
  }

  if (roastLevel === "mother") {
    if (payload.brutality_score > 2) return true;
    if (!Array.isArray(payload.strengths) || payload.strengths.length < 2) return true;
  }

  return false;
}

function buildEmergencyPayload(language, roastLevel) {
  const isEnglish = language === "en";

  if (roastLevel === "timo") {
    return isEnglish
      ? {
          one_liner_roast: "This still looks like panic wearing a fake cinematic jacket.",
          cinema_score: 3,
          brutality_score: 10,
          strengths: ["At least the subject is visible."],
          problems: [
            "Framing is safe and indecisive.",
            "Light hierarchy misses the subject.",
            "Background noise competes with the scene.",
            "Focus/depth feels accidental."
          ],
          fixes: [
            "Commit to one framing choice.",
            "Shape key light for the subject first.",
            "Simplify background distractions.",
            "Lock focus on story-critical areas."
          ],
          final_verdict: "Technically usable, creatively still undercooked."
        }
      : {
          one_liner_roast: "Deze still ziet eruit als paniek met een nep-filmisch jasje.",
          cinema_score: 3,
          brutality_score: 10,
          strengths: ["Je onderwerp is tenminste zichtbaar."],
          problems: [
            "Kadrering is veilig en besluiteloos.",
            "Lichthiërarchie mist het onderwerp.",
            "Achtergrondruis concurreert met de scene.",
            "Focus/diepte voelt als toeval."
          ],
          fixes: [
            "Commit op één duidelijke kaderkeuze.",
            "Shape je keylight eerst voor je onderwerp.",
            "Verminder achtergrondafleiding.",
            "Zet focus strak op story-kritische zones."
          ],
          final_verdict: "Technisch bruikbaar, creatief nog halfbakken."
        };
  }

  return isEnglish
    ? {
        one_liner_roast: "There is a base here, but the shot needs clearer decisions.",
        cinema_score: 5,
        brutality_score: 4,
        strengths: ["The frame has atmosphere.", "There is a workable direction."],
        problems: ["Subject priority is unclear.", "Background and light control can be tighter."],
        fixes: ["Refine framing around the subject.", "Create clearer light hierarchy."],
        final_verdict: "Solid start, but visual decisions need to be stronger."
      }
    : {
        one_liner_roast: "Er zit een basis in, maar het shot mist duidelijke keuzes.",
        cinema_score: 5,
        brutality_score: 4,
        strengths: ["Er zit sfeer in het frame.", "Er is een bruikbare richting."],
        problems: ["Onderwerp-prioriteit is onduidelijk.", "Achtergrond- en lichtcontrole kan strakker."],
        fixes: ["Kadrering rond het onderwerp verfijnen.", "Lichthiërarchie duidelijker maken."],
        final_verdict: "Goede start, maar visuele keuzes moeten sterker."
      };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY ontbreekt op de server." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const image = body.image;
    const roastLevel = normalizeRoastLevel(body.roastLevel);
    const styleGoal = normalizeStyleGoal(body.styleGoal);
    const language = body.language === "en" ? "en" : "nl";

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Upload een geldige base64 afbeelding." });
    }

    let payload = null;
    let failReason = "";

    const maxAttempts = 5;
    const historyCount = (oneLinerHistory[language] || []).length;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const extraConstraint =
        attempt > 1
          ? buildRetryConstraint({ language, reason: failReason, attempt, historyCount })
          : "";

      const generation = await callRoastModel({ image, language, roastLevel, styleGoal, extraConstraint });
      let parsed = generation.parsed;
      if (!parsed || typeof parsed !== "object") {
        parsed = await repairJsonWithModel({ rawText: generation.rawText, language });
      }

      let candidate = sanitizePayload(parsed || {}, { language, roastLevel });

      if (languageMismatch(candidate, language)) {
        const translated = await translatePayload(candidate, language);
        if (translated && typeof translated === "object") {
          candidate = sanitizePayload(translated, { language, roastLevel });
        }
      }

      failReason = failsOriginalityCheck(candidate.one_liner_roast, language, roastLevel);
      if (!failReason && !violatesHardConstraints(candidate, roastLevel, language)) {
        payload = candidate;
        break;
      }

      if (!failReason) failReason = "generic_timo_output";
    }

    if (!payload) {
      payload = buildEmergencyPayload(language, roastLevel);
      payload.one_liner_roast = buildForcedUniqueOneLiner(language, roastLevel, historyCount);
    } else if (failsOriginalityCheck(payload.one_liner_roast, language, roastLevel)) {
      payload.one_liner_roast = buildForcedUniqueOneLiner(language, roastLevel, historyCount);
    }

    pushOneLinerHistory(payload.one_liner_roast, language);

    return res.status(200).json(payload);
  } catch (error) {
    console.error("/api/roast error", error);
    return res.status(500).json({ error: "Roast request mislukt op de server." });
  }
};
