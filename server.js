import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins — we can restrict to NetSuite later
app.use(cors({ origin: "*" }));

// Load OpenAI API Key (Render env var)
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * OCR ENDPOINT (TEST MODE: ONE FIELD ONLY)
 * Extracts ONLY the Legal Business Name for validation.
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Accept only PDF or Word docs for now
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(mimeType)) {
      return res.status(400).json({ error: "Only PDF or Word documents are allowed" });
    }

    // Safety: Max 3MB
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large (max 3MB)" });
    }

    // Convert to Base64 for Vision API
    const base64 = buffer.toString("base64");

    // TEST PROMPT — extract ONLY the legal business name
    const prompt = `
You are an OCR extraction engine.
Extract ONLY the Legal Business Name from this credit application.

Return EXACTLY this JSON object:

{
  "legal_business_name": ""
}

Rules:
- Do NOT add any text outside the JSON.
- Do NOT include comments or explanation.
- If the legal business name cannot be located, return an empty string.
`;

    // Call OpenAI Vision
    const aiResponse = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "input_image", image_url: `data:${mimeType};base64,${base64}` }
          ]
        }
      ]
    });

    const raw = aiResponse.choices[0].message.content;

    // Ensure valid JSON
    let parsedJSON;
    try {
      parsedJSON = JSON.parse(raw);
    } catch (err) {
      console.error("OCR returned non-JSON:", raw);
      return res.json({ error: "OCR returned non-JSON output", raw });
    }

    // Return clean JSON to Suitelet
    res.json(parsedJSON);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OCR processing failed", details: err.message });
  }
});

/** BASIC HEALTH CHECK */
app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
