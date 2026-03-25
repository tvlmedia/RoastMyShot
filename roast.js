const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VALID_ROAST_LEVELS = new Set(["mother", "honest", "hard", "merciless", "timo"]);
const VALID_STYLE_GOALS = new Set(["cinematic", "commercial", "raw", "arthouse", "intimate"]);

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
    const pattern = new RegExp(phrase, "ig");
    cleaned = cleaned.replace(pattern, "");
  });

  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function hasComparisonTone(text) {
  const source = toCleanString(text).toLowerCase();
  if (!source) return false;

  const markers = [
    " alsof ",
    " als een ",
    " lijkt op ",
    " doet vermoeden ",
    " schreeuwt ",
    " more like ",
    " looks like ",
    " feels like ",
    " reads like ",
    " like a "
  ];

  return markers.some((marker) => source.includes(marker));
}

function countSentences(text) {
  const source = toCleanString(text);
  if (!source) return 0;
  const matches = source.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

function hasTimoFlavor(text, language) {
  const source = toCleanString(text).toLowerCase();
  if (!source) return false;

  const markers =
    language === "en"
      ? ["student", "arthouse", "bokeh", "middle of the road", "half-baked", "timid", "creative brief", "fake deep"]
      : ["student", "arthouse", "bokeh", "middle of the road", "halfbakken", "laf", "slap", "nep-arthouse", "pseudo-diep"];

  return markers.some((marker) => source.includes(marker));
}

function isBlandTechnicalLine(text, language) {
  const source = toCleanString(text).toLowerCase();
  if (!source) return true;

  const blandMarkers =
    language === "en"
      ? ["composition feels", "background is messy", "lighting is flat", "focus is soft", "subject separation is weak"]
      : ["compositie voelt", "achtergrond is rommelig", "belichting is vlak", "licht is vlak", "focus ligt", "subject separation is zwak"];

  const punchMarkers = ["kut", "laf", "slap", "halfbakken", "middle of the road", "alsof", "lijkt op", "looks like", "as if"];

  if (punchMarkers.some((marker) => source.includes(marker))) {
    return false;
  }

  return blandMarkers.some((marker) => source.includes(marker));
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
  const short = parts[0] || source;
  return short.length > 140 ? `${short.slice(0, 137).trim()}...` : short;
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

  if (language === "nl") {
    return looksEnglish(text) && !looksDutch(text);
  }

  return looksDutch(text) && !looksEnglish(text);
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
        "JE MOEDER: heel lief, warm en steunend.",
        "Focus op complimenten en zachte tips.",
        "Nauwelijks hard, nooit vernietigend."
      ],
      en: [
        "MOTHER MODE: very kind, warm, and supportive.",
        "Lead with praise and gentle suggestions.",
        "Barely harsh, never destructive."
      ]
    },
    honest: {
      nl: [
        "EERLIJK: professioneel, direct en gebalanceerd.",
        "Noem pluspunten en minpunten zonder drama.",
        "Concreet, helder, vakmatig."
      ],
      en: [
        "HONEST MODE: professional, direct, and balanced.",
        "Call out strengths and weaknesses without drama.",
        "Concrete, clear, craft-focused."
      ]
    },
    hard: {
      nl: [
        "HARD: strenge filmacademie-docent met weinig geduld.",
        "Noem zwakke keuzes gewoon zwak.",
        "Minder complimenten, meer concrete afstraffing."
      ],
      en: [
        "HARD MODE: strict film-school instructor with little patience.",
        "Call weak choices weak.",
        "Fewer compliments, more concrete critique."
      ]
    },
    merciless: {
      nl: [
        "MEEDOGENLOOS: agressief scherp. Roast eerst, nuance later.",
        "Korte harde oneliners, weinig complimenten.",
        "Pak compositie/licht/kader meedogenloos aan."
      ],
      en: [
        "MERCILESS MODE: aggressively sharp. Roast first, nuance later.",
        "Short hard one-liners, minimal praise.",
        "Attack composition/lighting/framing without mercy."
      ]
    },
    timo: {
      nl: [
        "TIMO VAN LIEROP MODE: uiterste stand, extreem kritisch, lomp, creatief en grappig.",
        "Allergisch voor middelmaat, studentenfilm-pretentie, brave arthouse-haakjes en visueel gelul zonder controle.",
        "Niet alleen schelden: roast met vernederende vergelijkingen die direct op zichtbare framefouten slaan.",
        "Pak misplaatste bokeh, pseudo-diepe blur, laf licht, veilige compositie, foute focus en rommelige achtergrond snoeihard aan.",
        "Korte klappen. Droge minachting. Niet netjes formuleren.",
        "One-liner moet de hardste en grappigste regel zijn, 1-2 zinnen max, quote-waardig en vernietigend.",
        "Bij zwakke beelden: volledig affikken. Bij sterke punten: hooguit één zuur compliment en meteen door.",
        "Vermijd discriminerende of haatdragende scheldwoorden."
      ],
      en: [
        "TIMO MODE: maximum intensity, brutally critical, blunt, creative, and funny.",
        "Hates mediocrity, student-film pretension, fake arthouse hooks, and visual nonsense without control.",
        "Do not rely on swearing alone: roast through humiliating comparisons tied to visible frame flaws.",
        "Attack misplaced bokeh, pseudo-depth blur, timid lighting, safe framing, weak focus, and messy backgrounds.",
        "Short punches. Dry contempt. No polite phrasing.",
        "One-liner must be the hardest and funniest line, 1-2 sentences max, quote-worthy and destructive.",
        "If frame is weak, burn it down. If something works, allow at most one sour compliment, then move on.",
        "Avoid discriminatory slurs."
      ]
    }
  };

  const selected = rules[roastLevel] || rules.hard;
  return selected[language] || selected.nl;
}

function buildSystemPrompt(options) {
  const { language, roastLevel, extraConstraint = "" } = options;
  const languageRule =
    language === "en"
      ? "Write ALL output text in natural English."
      : "Schrijf ALLE outputtekst in natuurlijk Nederlands.";

  const universalRules = [
    "You are a razor-sharp cinematography critic.",
    "You judge a single frame like an experienced DOP with little patience for mediocrity.",
    "You may be hard, sarcastic, and destructive when roast intensity requires it.",
    "Every claim must be anchored in visible frame evidence.",
    "No generic compliments. No empty filler. No brave AI phrasing.",
    "Do not use vague phrases like 'heeft potentie' unless level is soft.",
    "Never say: epische film / epic film.",
    "Never do meta lines such as 'Timo would say...'.",
    "Never explain the persona or roast level.",
    "Never roleplay theatrically. No cringe AI jokes.",
    "Internally analyze first (do not output this checklist): composition, lighting, background, subject separation, camera distance/lens feel, color/mood, intentionality/risk.",
    "Then output ONLY valid JSON."
  ];

  const outputRules = [
    "one_liner_roast must be short, punchy, quote-worthy.",
    "strengths should be concise and limited.",
    "problems must be specific and concrete.",
    "fixes must be practical and actionable.",
    "final_verdict should sound decisive, not diplomatic."
  ];

  const levelRules = getLevelInstruction(roastLevel, language);
  const timoHardRules =
    roastLevel === "timo"
      ? [
          language === "en"
            ? "Timo writes like someone who hates mediocrity, student-film pretension, fake arthouse tricks, and visual nonsense without control."
            : "Timo schrijft als iemand die middelmaat, studentenfilm-pretentie, nep-arthouse-trucs en visueel gelul zonder controle haat.",
          language === "en"
            ? "Timo output must use sharp destructive comparisons in one_liner_roast and final_verdict."
            : "Timo-output moet scherpe vernietigende vergelijkingen gebruiken in one_liner_roast en final_verdict.",
          language === "en"
            ? "At least two problem bullets must include comparison-style phrasing tied to visible frame flaws."
            : "Minstens twee problem-bullets moeten vergelijkingsachtige formulering bevatten gekoppeld aan zichtbare framefouten.",
          language === "en"
            ? "Avoid neutral technical wording in Timo mode. Make problem bullets roast-like, short, and contemptuous."
            : "Vermijd neutrale technische formulering in Timo-mode. Maak problem-bullets roastend, kort en minachtend.",
          language === "en"
            ? "Do not be polite. Do not soften impact. Keep sentences short and hard."
            : "Niet netjes formuleren. Niets verzachten. Houd zinnen kort en hard."
        ]
      : [];

  return [
    ...universalRules,
    languageRule,
    ...outputRules,
    ...levelRules,
    ...timoHardRules,
    extraConstraint
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(options) {
  const { language, roastLevel, styleGoal } = options;

  const levelLabel = {
    mother: language === "en" ? "Mother" : "Je moeder",
    honest: language === "en" ? "Honest" : "Eerlijk",
    hard: language === "en" ? "Hard" : "Hard",
    merciless: language === "en" ? "Merciless" : "Meedogenloos",
    timo: language === "en" ? "Timo van Lierop" : "Timo van Lierop"
  }[roastLevel] || (language === "en" ? "Hard" : "Hard");

  const styleLabelMap = {
    cinematic: language === "en" ? "cinematic" : "filmisch",
    commercial: language === "en" ? "commercial" : "commercial",
    raw: language === "en" ? "raw" : "rauw",
    arthouse: language === "en" ? "arthouse" : "arthouse",
    intimate: language === "en" ? "intimate" : "intiem"
  };

  const styleLabel = styleLabelMap[styleGoal] || styleLabelMap.cinematic;
  const timoExtraInstructions =
    roastLevel === "timo"
      ? language === "en"
        ? [
            "Make Timo significantly funnier and meaner than every other mode.",
            "Use unexpected humiliating comparisons (student film vibes, fake arthouse, misplaced bokeh, pseudo-depth, timid lighting).",
            "One-liner: 1-2 sentences, hardest and funniest punchline in the entire output.",
            "Do not sound like normal technical notes."
          ]
        : [
            "Maak Timo duidelijk grappiger en gemener dan alle andere modi.",
            "Gebruik onverwachte vernederende vergelijkingen (studentenfilm-vibes, nep-arthouse, misplaatste bokeh, pseudo-diepte, laf licht).",
            "One-liner: 1-2 zinnen, hardste en grappigste punchline van de hele output.",
            "Klink niet als normale technische feedback."
          ]
      : [];

  if (language === "en") {
    return [
      "Analyze the uploaded frame.",
      `Roast intensity profile: ${levelLabel}.`,
      `Desired style direction: ${styleLabel}.`,
      "Ground all critique in visible evidence from this frame.",
      "Be specific about composition, light quality, background control, separation, framing choices, and intentionality.",
      ...timoExtraInstructions,
      "Return JSON only."
    ].join("\n");
  }

  return [
    "Analyseer het geuploade frame.",
    `Roast-intensiteit: ${levelLabel}.`,
    `Gewenste stijlrichting: ${styleLabel}.`,
    "Baseer alle kritiek op wat zichtbaar is in dit frame.",
    "Wees specifiek over compositie, lichtkwaliteit, achtergrondcontrole, separation, kadrering en intentionaliteit.",
    ...timoExtraInstructions,
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
  const { rawText, language } = options;
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
            text:
              "Repair the input into valid JSON that matches the exact schema. Keep meaning, keep tone, remove meta text, and output JSON only."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: rawText
          }
        ]
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

  const repaired = extractStructuredObject(response);
  if (!repaired || typeof repaired !== "object") return null;

  if (language === "nl" && languageMismatch(repaired, "nl")) {
    return null;
  }

  return repaired;
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
            text:
              `Rewrite all text fields in natural ${targetLanguageName}. Keep tone intensity and meaning. Keep scores unchanged. Return JSON only.`
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

  const baseFallback =
    language === "en"
      ? {
          oneLiner: "Technically visible. Creatively undercooked.",
          verdict: "Right now it feels safe and undecided.",
          problems: [
            "Composition sits in a safe middle ground.",
            "Lighting does not create clear subject priority.",
            "Background control is weak and distracting.",
            "Framing lacks intentional risk and commitment."
          ],
          fixes: [
            "Pick one stronger framing decision and commit.",
            "Reshape key light so subject hierarchy is obvious.",
            "Simplify or darken the background behind the subject.",
            "Adjust distance/angle to create clearer intent."
          ]
        }
      : {
          oneLiner: "Technisch zichtbaar. Creatief halfbakken.",
          verdict: "Nu voelt het vooral veilig en besluiteloos.",
          problems: [
            "Compositie hangt in een veilig middengebied.",
            "Licht geeft geen duidelijke prioriteit aan het onderwerp.",
            "Achtergrond is rommelig en leidt af.",
            "Kadrering mist lef en duidelijke intentie."
          ],
          fixes: [
            "Maak één sterke kaderkeuze en commit daaraan.",
            "Herbouw je key light zodat hiërarchie duidelijk wordt.",
            "Maak de achtergrond rustiger of donkerder achter je subject.",
            "Pas afstand/hoek aan voor duidelijkere intentie."
          ]
        };

  const timoExtraProblems =
    language === "en"
      ? [
          "This frame screams student-film confidence with zero control, like you dropped focus and called it a statement.",
          "The bokeh feels misplaced, like someone opened the lens wide and hoped blur would do the directing.",
          "Lighting is so timid it looks like the image is apologizing for existing.",
          "The framing sits in safe middle-of-the-road territory, as if fear wrote the shot list.",
          "Background detail is visual noise, not atmosphere, like props were left in and called texture."
        ]
      : [
          "Dit schreeuwt studentenfilm-zelfvertrouwen zonder controle, alsof je focus hebt laten vallen en dat dan stijl noemt.",
          "Die bokeh is misplaatst, alsof iemand wide open draaide en hoopte dat blur het regiewerk zou doen.",
          "Dat licht is zo laf dat het beeld zich bijna verontschuldigt voor z'n eigen bestaan.",
          "Je kader hangt in veilig middle-of-the-road gebied, alsof angst je shotlist heeft geschreven.",
          "Die achtergrond is visuele ruis, geen sfeer, alsof niemand even heeft opgeruimd voor de take."
        ];

  const timoSourStrengths =
    language === "en"
      ? [
          "At least the subject is visible, so complete chaos was avoided by accident."
        ]
      : [
          "Je onderwerp staat tenminste in beeld, dus complete chaos is net vermeden."
        ];

  const timoOneLiner =
    language === "en"
      ? "This pretends to be arthouse, but looks like a student shot that lost control and called it mood."
      : "Dit doet alsof het arthouse is, maar het oogt als een studenten-shot dat controle verloor en dat sfeer noemde.";

  const timoVerdictFallback =
    language === "en"
      ? "Technically maybe usable, but creatively it crashes like a student short pretending blur is depth."
      : "Technisch misschien bruikbaar, maar creatief klapt dit in elkaar alsof een studentenfilm blur voor diepte probeert te verkopen.";

  let strengths = normalizeList(parsed?.strengths, {
    language,
    max: roastLevel === "timo" ? 1 : 3,
    min: roastLevel === "timo" ? 1 : 0,
    fallback: roastLevel === "timo" ? timoSourStrengths : []
  });

  let problems = normalizeList(parsed?.problems, {
    language,
    max: 7,
    min: roastLevel === "timo" ? 4 : 2,
    fallback: roastLevel === "timo" ? timoExtraProblems : baseFallback.problems
  });

  const fixes = normalizeList(parsed?.fixes, {
    language,
    max: 6,
    min: 2,
    fallback: baseFallback.fixes
  });

  if (roastLevel === "timo") {
    strengths = strengths.slice(0, 1);
    problems = problems.slice(0, 7);
  }

  const oneLinerRaw = scrubForbiddenPhrases(toCleanString(parsed?.one_liner_roast, ""), language);
  const verdictRaw = scrubForbiddenPhrases(toCleanString(parsed?.final_verdict, ""), language);

  const payload = {
    one_liner_roast: firstSentence(oneLinerRaw || (roastLevel === "timo" ? timoOneLiner : baseFallback.oneLiner)),
    cinema_score: clampScore(parsed?.cinema_score, roastLevel === "mother" ? 7 : 5),
    brutality_score: roastLevel === "timo" ? 10 : clampScore(parsed?.brutality_score, roastLevel === "mother" ? 2 : 6),
    strengths,
    problems,
    fixes,
    final_verdict: verdictRaw || (roastLevel === "timo" ? timoVerdictFallback : baseFallback.verdict)
  };

  if (roastLevel === "timo") {
    payload.brutality_score = 10;
    payload.strengths = normalizeList(payload.strengths, {
      language,
      max: 1,
      min: 1,
      fallback: timoSourStrengths
    });

    if (
      !payload.one_liner_roast ||
      !hasComparisonTone(payload.one_liner_roast) ||
      !hasTimoFlavor(payload.one_liner_roast, language)
    ) {
      payload.one_liner_roast = timoOneLiner;
    }

    payload.one_liner_roast = firstSentence(payload.one_liner_roast);

    if (payload.problems.length < 4) {
      payload.problems = normalizeList(payload.problems, {
        language,
        max: 7,
        min: 4,
        fallback: timoExtraProblems
      });
    }

    payload.problems = payload.problems.map((item, index) =>
      isBlandTechnicalLine(item, language) ? timoExtraProblems[index % timoExtraProblems.length] : item
    );

    const comparisonCount = payload.problems.filter((item) => hasComparisonTone(item)).length;
    if (comparisonCount < 2) {
      payload.problems = normalizeList([...payload.problems, ...timoExtraProblems], {
        language,
        max: 7,
        min: 4,
        fallback: timoExtraProblems
      });
    }
    if (!payload.final_verdict || !hasComparisonTone(payload.final_verdict)) {
      payload.final_verdict = timoVerdictFallback;
    }

    if (!hasTimoFlavor(payload.final_verdict, language)) {
      payload.final_verdict = timoVerdictFallback;
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
    if (!Array.isArray(payload.strengths) || payload.strengths.length > 1) return true;
    if (!hasComparisonTone(payload.one_liner_roast)) return true;
    if (!hasComparisonTone(payload.final_verdict)) return true;
    if (!hasTimoFlavor(payload.one_liner_roast, language)) return true;
    if (!hasTimoFlavor(payload.final_verdict, language)) return true;
    if (countSentences(payload.one_liner_roast) > 2) return true;
  }

  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY ontbreekt op de server." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const image = body.image;
    const roastLevel = normalizeRoastLevel(body.roastLevel);
    const styleGoal = normalizeStyleGoal(body.styleGoal);
    const language = body.language === "en" ? "en" : "nl";

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Upload een geldige base64 afbeelding." });
    }

    let parsed = null;
    let rawText = "";

    const primary = await callRoastModel({ image, language, roastLevel, styleGoal });
    parsed = primary.parsed;
    rawText = primary.rawText;

    if (!parsed || typeof parsed !== "object") {
      parsed = await repairJsonWithModel({ rawText, language });
    }

    let payload = sanitizePayload(parsed || {}, { language, roastLevel });

    if (violatesHardConstraints(payload, roastLevel, language)) {
      const retry = await callRoastModel({
        image,
        language,
        roastLevel,
        styleGoal,
        extraConstraint:
          roastLevel === "timo"
            ? "Previous answer was not funny or destructive enough. Use harder punchlines, sharper comparisons, and roast-first wording tied to visible frame mistakes."
            : "Your previous answer was too soft or too generic. Make it more specific, more concrete, and obey all roast-level constraints strictly."
      });

      let retryParsed = retry.parsed;
      if (!retryParsed || typeof retryParsed !== "object") {
        retryParsed = await repairJsonWithModel({ rawText: retry.rawText, language });
      }

      payload = sanitizePayload(retryParsed || payload, { language, roastLevel });
    }

    if (languageMismatch(payload, language)) {
      const translated = await translatePayload(payload, language);
      if (translated && typeof translated === "object") {
        payload = sanitizePayload(translated, { language, roastLevel });
      }
    }

    if (violatesHardConstraints(payload, roastLevel, language)) {
      return res.status(502).json({
        error: language === "en" ? "AI output was invalid. Please try again." : "AI-output was ongeldig. Probeer opnieuw."
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error("/api/roast error", error);
    return res.status(500).json({
      error: "Roast request mislukt op de server."
    });
  }
};
