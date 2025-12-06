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
 * OCR ENDPOINT — FINAL WORKING VERSION
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;

    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(mimeType)) {
      return res.status(400).json({ error: "Only PDF or Word documents allowed" });
    }

    // Save file temporarily
    const tempPath = `/tmp/${Date.now()}_${originalName}`;
    fs.writeFileSync(tempPath, buffer);

    console.log("Uploading file:", tempPath);

    // STEP 1 — Upload file into OpenAI Files API
    const uploaded = await client.files.create({
      file: fs.createReadStream(tempPath),
      purpose: "assistants"
    });

    console.log("Uploaded file ID:", uploaded.id);

    // STEP 2 — Call GPT-4o-mini Vision via Responses API
    const prompt = `
Extract only the Legal Business Name from this document.
Return JSON exactly like this:

{
  "legal_business_name": ""
}

No additional commentary.
`;

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        prompt,
        { file_id: uploaded.id }  // CORRECT way to attach the file
      ]
    });

    const raw = response.output_text;
    console.log("RAW MODEL OUTPUT:", raw);

    // STEP 3 — Parse JSON safely
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("JSON parse failed:", raw);
      return res.json({ error: "Invalid JSON returned", raw });
    }

    // STEP 4 — Send to Suitelet
    res.json(parsed);

    // Cleanup
    fs.unlinkSync(tempPath);

  } catch (err) {
    console.error("OCR ERROR:", err);
    res.status(500).json({
      error: "OCR processing failure",
      details: err.message
    });
  }
});

app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
