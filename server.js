import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
const upload = multer(); // memory storage by default

app.use(cors({ origin: "*" }));

// OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Small helper to reliably extract text from Responses API result.
 * Some SDKs provide response.output_text as a convenience aggregator.
 * This fallback guards against shape changes or multi-item outputs.
 */
function getResponseText(response) {
  if (response?.output_text && typeof response.output_text === "string") {
    return response.output_text.trim();
  }

  // Fallback: attempt to aggregate message output content
  try {
    const text = (response?.output ?? [])
      .filter(item => item.type === "message")
      .flatMap(msg => msg.content ?? [])
      .filter(c => c.type === "output_text")
      .map(c => c.text)
      .join("\n")
      .trim();

    return text || "";
  } catch (e) {
    return "";
  }
}

/**
 * OCR ENDPOINT — UPDATED FOR RESPONSES + PDF FILE INPUT
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  let tempPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname || "upload";

    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(mimeType)) {
      return res.status(400).json({ error: "Only PDF or Word documents allowed" });
    }

    /**
     * IMPORTANT:
     * For this specific Responses API "input_file" approach,
     * we are keeping the next test predictable by requiring PDF.
     * Word support can be added later by converting DOC/DOCX → PDF upstream.
     */
    if (mimeType !== "application/pdf") {
      return res.status(400).json({
        error:
          "For this OCR endpoint, please upload a PDF. Word support requires converting DOC/DOCX to PDF for reliable file-input extraction."
      });
    }

    // Save file temporarily
    const safeName = originalName.replace(/[^\w.\-]+/g, "_");
    tempPath = path.join("/tmp", `${Date.now()}_${safeName}`);
    fs.writeFileSync(tempPath, buffer);

    console.log("Uploading file:", tempPath);

    // STEP 1 — Upload file into OpenAI Files API
    const uploaded = await client.files.create({
      file: fs.createReadStream(tempPath),
      purpose: "user_data"
    });

    console.log("Uploaded file ID:", uploaded.id);

    // STEP 2 — Call the model with correct Responses input shape
    const prompt = `
Extract only the Legal Business Name from this document.
Return a JSON object exactly like this:

{
  "legal_business_name": ""
}

No additional commentary.
`;

    const response = await client.responses.create({
      model: "gpt-4o-mini",

      // ✅ Responses API JSON mode uses text.format (not response_format)
      text: {
        format: { type: "json_object" }
      },

      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_file", file_id: uploaded.id }
          ]
        }
      ]
    });

    const raw = getResponseText(response);

    console.log("RAW MODEL OUTPUT:", raw);

    // STEP 3 — Parse JSON safely
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("JSON parse failed:", raw);
      return res.json({ error: "Invalid JSON returned", raw });
    }

    // Optional hard guard: ensure key exists
    if (!parsed || typeof parsed.legal_business_name !== "string") {
      return res.json({
        error: "JSON returned but missing expected key",
        raw,
        parsed
      });
    }

    // STEP 4 — Respond
    res.json(parsed);

  } catch (err) {
    console.error("OCR ERROR:", err);
    res.status(500).json({
      error: "OCR processing failure",
      details: err?.message || String(err)
    });
  } finally {
    // Cleanup
    try {
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (cleanupErr) {
      console.warn("Temp cleanup failed:", cleanupErr?.message || cleanupErr);
    }
  }
});

app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
