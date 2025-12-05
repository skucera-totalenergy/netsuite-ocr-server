import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins — later we restrict to NetSuite domain
app.use(cors({ origin: "*" }));

// Load OpenAI key from Render environment
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * OCR ENDPOINT — TEST MODE
 * Extract ONLY the Legal Business Name so we can verify end-to-end autofill.
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Accept only PDF & Word files
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(mimeType)) {
      return res
        .status(400)
        .json({ error: "Only PDF or Word documents are allowed" });
    }

    // Max 3MB file protection
    if (buffer.length > 3 * 1024 * 1024) {
      return res
        .status(400)
        .json({ error: "File too large (max 3MB)" });
    }

    // Base64 encode file for Vision model
    const base64 = buffer.toString("base64");

    // --- TEST PROMPT ---
    // Extract ONLY the legal business name for now (so we can verify Suitelet autofill)
    const prompt = `
Extract ONLY the Legal Business Name from this credit application.

Return EXACTLY this JSON:

{
  "legal_business_name": ""
}

Rules:
- Return ONLY JSON.
- No surrounding text, no markdown.
- If legal name cannot be detected, return an empty string.
    `;

    // Send the Vision request
    const aiResponse = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: `data:${mimeType};base64,${base64}`
            }
          ]
        }
      ]
    });

    const raw = aiResponse.choices[0].message.content;

    // Ensure JSON is valid
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("Non-JSON OCR output:", raw);
      return res.json({
        error: "OCR returned non-JSON output",
        raw
      });
    }

    // Return JSON to Suitelet
    res.json(parsed);

  } catch (err) {
    console.error("OCR ERROR:", err);
    res.status(500).json({
      error: "OCR processing failed",
      details: err.message
    });
  }
});

/** BASIC HEALTH CHECK (GET /) */
app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
