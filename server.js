import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins — we can restrict to NetSuite later
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
      return res.status(400).json({
        error: "Only PDF or Word documents are allowed"
      });
    }

    // Max 3MB file protection
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({
        error: "File too large (max 3MB)"
      });
    }

    // --- TEST PROMPT ---
    const prompt = `
Extract ONLY the Legal Business Name from this credit application.

Return EXACTLY this JSON:

{
  "legal_business_name": ""
}

Rules:
- Return ONLY JSON.
- No markdown.
- If not found, return empty string.
    `;

    // Upload file to OpenAI (correct method for PDFs)
    const uploaded = await client.files.create({
      file: buffer,
      purpose: "vision" // tells OpenAI we want OCR / vision analysis
    });

    // Request OCR from OpenAI using new Responses API
    const aiResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      attachments: [
        {
          file_id: uploaded.id,
          tools: [{ type: "file_viewer" }]
        }
      ]
    });

    const rawOutput = aiResponse.output_text;

    // Validate JSON
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

    // Return JSON back to NetSuite Suitelet
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
