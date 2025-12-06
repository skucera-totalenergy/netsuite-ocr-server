import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";
import fs from "fs";

const app = express();
const upload = multer();

app.use(cors({ origin: "*" }));

// OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * OCR – USING FILES API (THE CORRECT WAY)
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;

    // Allowed file types
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(mimeType)) {
      return res.status(400).json({
        error: "Only PDF or Word documents allowed"
      });
    }

    // Write buffer to a temp file
    const tempPath = `/tmp/${Date.now()}_${originalName}`;
    fs.writeFileSync(tempPath, buffer);

    console.log("Uploading file to OpenAI:", tempPath);

    // STEP 1 — Upload file to OpenAI Files API
    const fileUpload = await client.files.create({
      file: fs.createReadStream(tempPath),
      purpose: "assistants"  // required purpose
    });

    console.log("File uploaded to OpenAI:", fileUpload.id);

    // STEP 2 — Call GPT-4o-mini Vision referencing the uploaded file
    const prompt = `
Extract ONLY the Legal Business Name from this credit application.

Return JSON:

{
  "legal_business_name": ""
}

Rules:
- Return ONLY JSON.
- No markdown, no commentary.
`;

    const visionResponse = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "user", content: prompt },
        { role: "user", content: { input_file: fileUpload.id } }
      ]
    });

    const raw = visionResponse.output_text;

    console.log("Model raw output:", raw);

    // STEP 3 — Parse JSON cleanly
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("FAILED TO PARSE JSON:", raw);
      return res.json({
        error: "OCR returned invalid JSON",
        raw
      });
    }

    // STEP 4 — return to Suitelet
    res.json(parsed);

    // Clean temp file
    fs.unlinkSync(tempPath);

  } catch (err) {
    console.error("OCR ERROR:", err);
    res.status(500).json({
      error: "OCR processing failed",
      details: err.message
    });
  }
});

/** Health check */
app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
