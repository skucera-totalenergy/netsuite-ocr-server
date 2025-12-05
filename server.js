import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins. We'll tighten this later.
app.use(cors({ origin: "*" }));

// Load your OpenAI key from Render environment
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Safety check: only PDF or Word
    if (!["application/pdf", 
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
        .includes(mimeType)) {
      return res.status(400).json({ error: "Only PDF or Word documents are allowed" });
    }

    // Safety check: max 3MB
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large (max 3MB)" });
    }

    // Send to OpenAI Vision OCR
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",   // Cheap + excellent for form extraction
      messages: [
        {
          role: "system",
          content: "Extract structured fields from this credit application and return ONLY JSON."
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Parse this credit application:" },
            { type: "input_file", file: buffer }
          ]
        }
      ]
    });

    let json;
    try {
      json = JSON.parse(response.choices[0].message.content);
    } catch (e) {
      json = { error: "Failed to parse JSON from OCR output" };
    }

    res.json(json);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OCR processing failed" });
  }
});

app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
