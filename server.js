import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins — restrict later
app.use(cors({ origin: "*" }));

// Load OpenAI key
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * OCR ENDPOINT — Extract ONLY “Legal Business Name”
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;

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

    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({
        error: "File too large (max 10MB)"
      });
    }

    // 🔥🔥 FIX: Must use purpose:"assistants" for Vision PDF support
    const uploadedFile = await client.files.create({
      file: buffer,
      purpose: "assistants"
    });

    // OCR prompt
    const prompt = `
Extract ONLY the Legal Business Name from this credit application.

Return EXACTLY this JSON:
{
  "legal_business_name": ""
}

Rules:
- Return ONLY JSON.
- No text outside JSON.
- If not found, return empty string.
`;

    // Vision OCR using Responses API with file viewer tool
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

    const raw = aiResponse.output_text;

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

    return res.json(parsed);

  } catch (err) {
    console.error("OCR ERROR:", err);
    return res.status(500).json({
      error: "OCR processing failed",
      details: err.message
    });
  }
});

// Health check
app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
