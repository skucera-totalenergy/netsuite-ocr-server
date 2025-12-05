import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins — later restrict to NetSuite domain
app.use(cors({ origin: "*" }));

// Load OpenAI key from Render environment
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * OCR ENDPOINT — TEST MODE
 * Extract ONLY the Legal Business Name so we can verify autofill.
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

    // Max 3MB file size
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({
        error: "File too large (max 3MB)"
      });
    }

    // Convert file to Base64
    const base64 = buffer.toString("base64");

    // ------------------------------------------
    // OCR PROMPT — extract ONLY legal business name
    // ------------------------------------------
    const prompt = `
Extract ONLY the Legal Business Name from this credit application.

Return EXACTLY this JSON:

{
  "legal_business_name": ""
}

Rules:
- Return ONLY the JSON object.
- No markdown, no text, no explanation.
- If legal name cannot be detected, return an empty string.
    `;

    // ------------------------------------------
    // SEND REQUEST TO OPENAI VISION
    // MUST USE OBJECT VERSION OF image_url
    // ------------------------------------------
    const aiResponse = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`
              }
            }
          ]
        }
      ]
    });

    const rawOutput = aiResponse.choices[0].message.content;

    // Try to parse JSON
    let parsed;
    try {
      parsed = JSON.parse(rawOutput);
    } catch (err) {
      console.error("Non-JSON OCR output:", rawOutput);
      return res.json({
        error: "OCR returned non-JSON output",
        raw: rawOutput
      });
    }

    // Return clean JSON to the Suitelet
    res.json(parsed);

  } catch (err) {
    console.error("OCR ERROR:", err);
    res.status(500).json({
      error: "OCR processing failed",
      details: err.message
    });
  }
});

/** BASIC HEALTH CHECK */
app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
