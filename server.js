import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins — restrict later
app.use(cors({ origin: "*" }));

// Load OpenAI key from Render env variables
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * OCR ENDPOINT — TEST MODE
 * Extract ONLY the Legal Business Name from the PDF.
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Only PDFs & Word docs
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

    // Safety limit
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({
        error: "File too large (max 5MB)"
      });
    }

    // Step 1 — Upload file to OpenAI
    const uploadedFile = await client.files.create({
      file: buffer,
      purpose: "vision"
    });

    // Step 2 — OCR prompt (test mode)
    const prompt = `
Extract ONLY the Legal Business Name from this credit application.

Return EXACTLY this JSON:
{
  "legal_business_name": ""
}

Rules:
- Return ONLY JSON.
- No text outside the JSON.
- If legal name cannot be detected, return an empty string.
    `;

    // Step 3 — Call Responses API with attachment
    const aiResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "user", content: prompt }
      ],
      attachments: [
        {
          file_id: uploadedFile.id,
          tools: [{ type: "file_viewer" }]
        }
      ]
    });

    // Extract text output from the model
    const raw = aiResponse.output_text;

    // Validate JSON
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("OCR returned non-JSON:", raw);
      return res.json({
        error: "OCR returned non-JSON output",
        raw
      });
    }

    // Good to go
    return res.json(parsed);

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

// Start server
app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
