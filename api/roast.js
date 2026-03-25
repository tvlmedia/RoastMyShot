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
    " dit is gewoon ",
    " ziet eruit alsof ",
    " alsof ",
    " als een ",
    " lijkt op ",
    " lijkt meer op ",
    " doet alsof ",
    " nog net niet ",
    " zelfs een ",
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
      ? ["student", "arthouse", "bokeh", "middle of the road", "half-baked", "timid", "creative brief", "fake deep", "this is just", "looks like"]
      : ["student", "arthouse", "bokeh", "middle of the road", "halfbakken", "laf", "slap", "nep-arthouse", "pseudo-diep", "dit is gewoon", "ziet eruit alsof"];

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

function hasHarshTone(text, language) {
  const source = toCleanString(text).toLowerCase();
  if (!source) return false;

  const harshMarkers =
    language === "en"
      ? ["trash", "awful", "stupid", "weak", "destroy", "burn", "terrible", "bad", "fake arthouse", "student film"]
      : ["kut", "verkankerd", "mogool", "laf", "slap", "halfbakken", "afmaken", "slecht", "waardeloos"];

  return harshMarkers.some((marker) => source.includes(marker));
}

function isSoftPoliteLine(text, language) {
  const source = toCleanString(text).toLowerCase();
  if (!source) return true;

  const markers =
    language === "en"
      ? ["maybe", "perhaps", "could", "might", "consider", "it would help"]
      : ["misschien", "zou kunnen", "wellicht", "het kan helpen", "probeer eens"];

  return markers.some((marker) => source.includes(marker));
}

function countComparisonLines(list) {
  if (!Array.isArray(list)) return 0;
  return list.filter((item) => hasComparisonTone(item)).length;
}

function shortPunchLine(text, maxLength) {
  const source = toCleanString(text);
  if (!source) return source;
  const first = source.split(/(?<=[.!?])\s+/)[0] || source;
  return first.length > maxLength ? `${first.slice(0, maxLength - 3).trim()}...` : first;
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
        "JE MOEDER: extreem lief, beschermend en een beetje wereldvreemd positief.",
        "Geef vooral complimenten, maak dingen mooier dan ze zijn, en verpak kritiek als iets piepkleins.",
        "One-liner is geen roast maar een lieve opmerking met een mini-kritiekpunt.",
        "Nooit hard, nooit vernietigend, nooit sarcastisch."
      ],
      en: [
        "MOTHER MODE: extremely kind, protective, and a little naively positive.",
        "Lead with praise, overstate positives, and wrap criticism as tiny gentle notes.",
        "One-liner is not a roast; it is a loving comment with a tiny soft critique.",
        "Never harsh, never destructive, never sarcastic."
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
        "TIMO VAN LIEROP MODE: lomp, hard, dommig-grappig en meedogenloos raak.",
        "Niet als filmdocent praten; klink als die vriend op de bank die direct ziet waarom het shot kut werkt.",
        "Gebruik vernederende vergelijkingen: 'alsof', 'lijkt meer op', 'dit doet alsof', 'ziet eruit alsof', 'dit is gewoon ... met zelfvertrouwen'.",
        "One-liner moet de grappigste klap zijn: 1-2 zinnen, eerst grap, daarna pas inhoud.",
        "Stijlreferentie: iemand die een still direct belachelijk maakt met domme maar rake vergelijkingen, niet netjes, wel precies raak.",
        "Pak studentenfilm-vibes, nep-arthouse, misplaatste bokeh, pseudo-diepte, laf licht, veilige compositie en visueel geklooi extra hard.",
        "Problems moeten kort, bot en grappig-afbrandend zijn, niet netjes technisch geformuleerd.",
        "Fixes mogen direct en lomp zijn.",
        "Geen brave complimenten; hooguit één zuur compliment.",
        "Vermijd discriminerende of haatdragende scheldwoorden."
      ],
      en: [
        "TIMO MODE: blunt, rough, stupid-funny, and brutally accurate.",
        "Do not sound like a film professor; sound like the savage friend on the couch calling out exactly why the still fails.",
        "Use humiliating comparison language: 'as if', 'looks more like', 'this pretends to be', 'looks like', 'this is just ... with confidence'.",
        "One-liner must be the funniest hit: 1-2 sentences, joke first, content second.",
        "Style reference: immediate ridicule with dumb-but-accurate comparisons, not polished, still precise.",
        "Hit student-film vibes, fake arthouse, misplaced bokeh, pseudo-depth, timid light, safe framing, and visual chaos hard.",
        "Problems must be short, blunt, roasty, and funny instead of polite technical notes.",
        "Fixes can be direct and rough.",
        "No soft compliments; at most one sour compliment.",
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
            ? "One-liner must be the funniest line in the output. Joke first, then content."
            : "One-liner moet de grappigste zin van de output zijn. Eerst grap, daarna inhoud.",
          language === "en"
            ? "Problems must sound like roast lines with visible evidence, not classroom notes."
            : "Problems moeten klinken als roast-zinnen met zichtbare onderbouwing, niet als klaslokaal-notities.",
          language === "en"
            ? "Fixes must be short blunt commands, not polite suggestions."
            : "Fixes moeten korte botte opdrachten zijn, geen nette suggesties.",
          language === "en"
            ? "Do not be polite. Do not soften impact. Keep sentences short and hard."
            : "Niet netjes formuleren. Niets verzachten. Houd zinnen kort en hard."
        ]
      : [];
  const motherSoftRules =
    roastLevel === "mother"
      ? [
          language === "en"
            ? "Mother output must feel loving, protective, and awkwardly positive, not professional critique."
            : "Moeder-output moet liefdevol, beschermend en onhandig positief voelen, niet als professionele feedback.",
          language === "en"
            ? "Praise more than critique. Keep all critique very soft and small."
            : "Geef meer complimenten dan kritiek. Maak alle kritiek heel zacht en klein.",
          language === "en"
            ? "Do not use destructive comparisons, sarcasm, or hard phrasing."
            : "Gebruik geen vernietigende vergelijkingen, sarcasme of harde formulering."
        ]
      : [];

  return [
    ...universalRules,
    languageRule,
    ...outputRules,
    ...levelRules,
    ...motherSoftRules,
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
            "Do not sound like normal technical notes.",
            "Use couch-friend energy: short dumb-funny hits that are painfully true."
          ]
        : [
            "Maak Timo duidelijk grappiger en gemener dan alle andere modi.",
            "Gebruik onverwachte vernederende vergelijkingen (studentenfilm-vibes, nep-arthouse, misplaatste bokeh, pseudo-diepte, laf licht).",
            "One-liner: 1-2 zinnen, hardste en grappigste punchline van de hele output.",
            "Klink niet als normale technische feedback.",
            "Gebruik bankvriend-energie: korte dom-grappige klappen die pijnlijk waar zijn."
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
          "This looks like someone hit record by accident and then shouted 'mood' to save face.",
          "The bokeh is misplaced, like a first-year discovered blur and tried to skip directing.",
          "This light is so limp even a construction lamp would be embarrassed.",
          "The framing hangs there like nobody bothered to look at it for two extra seconds.",
          "The background joins in on wrecking the shot like visual noise with confidence."
        ]
      : [
          "Dit ziet eruit alsof iemand per ongeluk op record drukte en daarna heel hard 'sfeer' riep.",
          "Die bokeh is misplaatst, alsof een eerstejaars blur ontdekte en regie oversloeg.",
          "Dat licht is zo slap dat zelfs een bouwlamp zich ervoor zou schamen.",
          "Dat kader hangt erbij alsof niemand nog even twee seconden heeft gekeken.",
          "Die achtergrond doet gezellig mee met het verkankeren van je shot."
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
      ? "This pretends to be cinematic, but it looks like chaos with confidence."
      : "Dit is niet filmisch, dit is gewoon kut met zelfvertrouwen.";

  const timoVerdictFallback =
    language === "en"
      ? "Technically maybe usable, creatively it sinks like a student short pretending blur is depth and panic is style."
      : "Technisch misschien bruikbaar, creatief zinkt dit als een studentenfilm die blur voor diepte en paniek voor stijl verkoopt.";

  const timoFixesFallback =
    language === "en"
      ? [
          "Pick one framing decision and commit; this safe middle is killing the image.",
          "Stop hiding behind blur and give the subject actual visual priority.",
          "Control your light like you mean it, not like you are negotiating with fear.",
          "Clean the background so it stops sabotaging your shot."
        ]
      : [
          "Kies één kaderkeuze en commit; dit veilige midden maakt je beeld kapot.",
          "Stop met verstoppen achter blur en geef je onderwerp echte prioriteit.",
          "Zet je licht neer alsof je iets durft, niet alsof je bang bent voor contrast.",
          "Ruim die achtergrond op zodat hij je shot niet langer saboteert."
        ];

  const motherFallback =
    language === "en"
      ? {
          oneLiner: "Aww, this is honestly really lovely, maybe the face could be just a little brighter.",
          strengths: [
            "You can feel that you put care into this shot.",
            "There is a nice atmosphere, even if I do not fully understand everything.",
            "It already feels cinematic in a sweet way."
          ],
          problems: [
            "Maybe there is just a tiny bit much happening in the background.",
            "The face could maybe be a little easier to see.",
            "I had to look carefully in a few places."
          ],
          fixes: [
            "Maybe add a tiny bit more light on the face.",
            "Maybe make the background slightly calmer.",
            "Maybe let the subject stand out just a little more."
          ],
          verdict: "I think this is really lovely and you should be proud; with a few tiny tweaks it will be even prettier."
        }
      : {
          oneLiner: "Ahhh, ik vind dit eigenlijk best wel mooi hoor, alleen misschien is het gezichtje een beetje donker.",
          strengths: [
            "Je ziet echt dat je hier gevoel in hebt gestopt.",
            "Ik vind de sfeer heel mooi en spannend overkomen.",
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
            "Misschien het onderwerp nog iets meer laten opvallen."
          ],
          verdict: "Ik vind dit echt heel knap gedaan hoor, en met een paar kleine dingetjes wordt het alleen nog mooier."
        };

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
    fallback: roastLevel === "timo" ? timoFixesFallback : baseFallback.fixes
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

    const comparisonCount = countComparisonLines(payload.problems);
    if (comparisonCount < 3) {
      payload.problems = normalizeList([...payload.problems, ...timoExtraProblems], {
        language,
        max: 7,
        min: 4,
        fallback: timoExtraProblems
      });
    }

    payload.fixes = normalizeList(payload.fixes, {
      language,
      max: 5,
      min: 3,
      fallback: timoFixesFallback
    }).map((line, index) => {
      if (isSoftPoliteLine(line, language) || isBlandTechnicalLine(line, language)) {
        return timoFixesFallback[index % timoFixesFallback.length];
      }
      return shortPunchLine(line, 95);
    });

    if (!payload.final_verdict || !hasComparisonTone(payload.final_verdict)) {
      payload.final_verdict = timoVerdictFallback;
    }

    if (!hasTimoFlavor(payload.final_verdict, language)) {
      payload.final_verdict = timoVerdictFallback;
    }

    payload.final_verdict = shortPunchLine(payload.final_verdict, 145);
  }

  if (roastLevel === "mother") {
    payload.brutality_score = Math.min(2, clampScore(payload.brutality_score, 1));
    payload.strengths = normalizeList(payload.strengths, {
      language,
      max: 3,
      min: 3,
      fallback: motherFallback.strengths
    });
    payload.problems = normalizeList(payload.problems, {
      language,
      max: 3,
      min: 2,
      fallback: motherFallback.problems
    }).map((line, idx) => (hasHarshTone(line, language) ? motherFallback.problems[idx % motherFallback.problems.length] : line));
    payload.fixes = normalizeList(payload.fixes, {
      language,
      max: 3,
      min: 2,
      fallback: motherFallback.fixes
    });

    if (!payload.one_liner_roast || hasHarshTone(payload.one_liner_roast, language) || hasComparisonTone(payload.one_liner_roast)) {
      payload.one_liner_roast = motherFallback.oneLiner;
    }

    if (!payload.final_verdict || hasHarshTone(payload.final_verdict, language) || hasComparisonTone(payload.final_verdict)) {
      payload.final_verdict = motherFallback.verdict;
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
    if (!Array.isArray(payload.fixes) || payload.fixes.length < 3) return true;
    if (!hasComparisonTone(payload.one_liner_roast)) return true;
    if (!hasComparisonTone(payload.final_verdict)) return true;
    if (!hasTimoFlavor(payload.one_liner_roast, language)) return true;
    if (!hasTimoFlavor(payload.final_verdict, language)) return true;
    if (countComparisonLines(payload.problems) < 3) return true;
    if (payload.fixes.some((line) => isSoftPoliteLine(line, language))) return true;
    if (countSentences(payload.one_liner_roast) > 2) return true;
  }

  if (roastLevel === "mother") {
    if (payload.brutality_score > 2) return true;
    if (!Array.isArray(payload.strengths) || payload.strengths.length < 2) return true;
    if (!Array.isArray(payload.problems) || payload.problems.length < 1) return true;
    if (hasHarshTone(payload.one_liner_roast, language)) return true;
    if (hasHarshTone(payload.final_verdict, language)) return true;
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
