const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function toStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
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

  const parts = [];
  const outputItems = Array.isArray(response?.output) ? response.output : [];

  outputItems.forEach((item) => {
    const contentItems = Array.isArray(item?.content) ? item.content : [];
    contentItems.forEach((content) => {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    });
  });

  return parts.join("\n");
}

function gatherTextForLanguageCheck(payload) {
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

function seemsEnglish(text) {
  if (!text) return false;
  const englishSignals = [
    " the ",
    " and ",
    " with ",
    " this ",
    " that ",
    " looks ",
    " lighting ",
    " background ",
    " subject ",
    " shot "
  ];
  const normalized = ` ${text.replace(/\s+/g, " ")} `;
  const hits = englishSignals.filter((signal) => normalized.includes(signal)).length;
  return hits >= 2;
}

async function translatePayloadToDutch(payload) {
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
              "Translate all textual fields to natural Dutch. Keep scores unchanged. Return ONLY valid JSON with the exact same keys."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(payload)
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "roast_feedback_translated",
        strict: true,
        schema: {
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
            one_liner_roast: { type: "string" },
            cinema_score: { type: "number", minimum: 0, maximum: 10 },
            brutality_score: { type: "number", minimum: 0, maximum: 10 },
            strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
            problems: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
            fixes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
            final_verdict: { type: "string" }
          }
        }
      }
    }
  });

  const parsed = parseFirstJsonObject(getResponseText(response));
  if (!parsed || typeof parsed !== "object") return null;

  return {
    one_liner_roast: toCleanString(parsed.one_liner_roast, payload.one_liner_roast),
    cinema_score: clampScore(parsed.cinema_score, payload.cinema_score),
    brutality_score: clampScore(parsed.brutality_score, payload.brutality_score),
    strengths: toStringList(parsed.strengths),
    problems: toStringList(parsed.problems),
    fixes: toStringList(parsed.fixes),
    final_verdict: toCleanString(parsed.final_verdict, payload.final_verdict)
  };
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
    const roastLevel = toCleanString(body.roastLevel, "hard");
    const styleGoal = toCleanString(body.styleGoal, "cinematic");
    const language = body.language === "en" ? "en" : "nl";

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Upload een geldige base64 afbeelding." });
    }

    const userInstruction =
      language === "en"
        ? `Analyze this still and return practical cinematography feedback. Roast level: ${roastLevel}. Style goal: ${styleGoal}.`
        : `Analyseer deze still en geef praktische cinematografie-feedback. Roast level: ${roastLevel}. Style goal: ${styleGoal}.`;

    const targetLanguageName = language === "en" ? "English" : "Dutch";

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      max_output_tokens: 800,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                `Return ONLY valid JSON with keys: one_liner_roast, cinema_score, brutality_score, strengths, problems, fixes, final_verdict. Keep scores between 0 and 10. strengths/problems/fixes must be arrays of short strings. All textual fields MUST be written in ${targetLanguageName}.`
            }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: userInstruction },
            { type: "input_image", image_url: image }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "roast_feedback",
          strict: true,
          schema: {
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
              one_liner_roast: { type: "string" },
              cinema_score: { type: "number", minimum: 0, maximum: 10 },
              brutality_score: { type: "number", minimum: 0, maximum: 10 },
              strengths: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 6
              },
              problems: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 6
              },
              fixes: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 6
              },
              final_verdict: { type: "string" }
            }
          }
        }
      }
    });

    const parsed = parseFirstJsonObject(getResponseText(response));

    if (!parsed || typeof parsed !== "object") {
      return res.status(502).json({
        error: "AI gaf geen geldige JSON terug. Probeer opnieuw."
      });
    }

    let payload = {
      one_liner_roast: toCleanString(parsed.one_liner_roast, language === "en" ? "No roast generated." : "Geen roast gegenereerd."),
      cinema_score: clampScore(parsed.cinema_score, 5),
      brutality_score: clampScore(parsed.brutality_score, 5),
      strengths: toStringList(parsed.strengths),
      problems: toStringList(parsed.problems),
      fixes: toStringList(parsed.fixes),
      final_verdict: toCleanString(parsed.final_verdict, language === "en" ? "No final verdict generated." : "Geen eindoordeel gegenereerd.")
    };

    if (!payload.strengths.length || !payload.problems.length || !payload.fixes.length) {
      return res.status(502).json({
        error: "AI gaf onvolledige JSON terug. Probeer opnieuw."
      });
    }

    if (language === "nl" && seemsEnglish(gatherTextForLanguageCheck(payload))) {
      try {
        const translated = await translatePayloadToDutch(payload);
        if (translated && translated.strengths.length && translated.problems.length && translated.fixes.length) {
          payload = translated;
        }
      } catch (translationError) {
        console.error("Dutch translation fallback failed", translationError);
      }
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error("/api/roast error", error);
    return res.status(500).json({
      error: "Roast request mislukt op de server."
    });
  }
};
