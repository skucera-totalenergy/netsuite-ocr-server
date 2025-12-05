import express from "express";
import multer from "multer";
import OpenAI from "openai";
import cors from "cors";

const app = express();
const upload = multer();

// TEMP: allow all origins — we can restrict to NetSuite later
app.use(cors({ origin: "*" }));

// Load your OpenAI key from Render environment
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * OCR ENDPOINT
 * Receives a PDF/Word file, sends it to OpenAI Vision, returns structured JSON.
 */
app.post("/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Allow PDF or Word files. (Can expand later)
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(mimeType)) {
      return res.status(400).json({ error: "Only PDF or Word documents are allowed" });
    }

    // Max 3MB safety limit
    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large (max 3MB)" });
    }

    // Convert file to Base64 for Vision API
    const base64 = buffer.toString("base64");

    // UNIVERSAL, FORM-AGNOSTIC EXTRACTION PROMPT
    const prompt = `
You are an AI that extracts structured business information from ANY credit application,
credit reference sheet, bank reference, or commercial credit form.

Extract data based on MEANING — not position, formatting, or layout.

Return ONLY valid JSON using this schema:

{
  "legal_name": "",
  "dba_name": "",
  "address1": "",
  "address2": "",
  "city": "",
  "state": "",
  "zip": "",
  "country": "",
  "phone": "",
  "fax": "",
  "email": "",
  "website": "",

  "tax_id": "",
  "fein": "",
  "tin": "",
  "duns": "",
  "years_in_business": "",
  "employees": "",
  "state_of_incorporation": "",
  "entity_type": "",

  "bank_name": "",
  "bank_account_number": "",
  "bank_contact_name": "",
  "bank_contact_phone": "",
  "bank_contact_email": "",
  "bank_contact_address": "",

  "trade_refs": [
    {
      "name": "",
      "contact": "",
      "phone": "",
      "email": "",
      "address": ""
    }
  ]
}

RULES:
- If a field is missing or unreadable, return it as an empty string.
- Normalize phone numbers when possible.
- Return ONLY raw JSON. No comments, no explanation.
`;

    // Send to OpenAI Vision OCR
    const aiResponse = await client.chat.completions.create({
      model: "gpt-4o-mini",   // Fast + excellent OCR + lowest cost
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${base64}`
            }
          ]
        }
      ]
    });

    const raw = aiResponse.choices[0].message.content;

    // Try to parse JSON returned by the model
    let parsedJSON;
    try {
      parsedJSON = JSON.parse(raw);
    } catch (err) {
      console.error("OCR returned non-JSON:", raw);
      return res.json({ error: "OCR returned non-JSON output", raw });
    }

    res.json(parsedJSON);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OCR processing failed", details: err.message });
  }
});


/**
 * BASIC HEALTH CHECK
 */
app.get("/", (req, res) => {
  res.send("OCR server is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("OCR server running");
});
