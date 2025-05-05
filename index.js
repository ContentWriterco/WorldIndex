require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const PORT = process.env.PORT || 3000;

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

const LANGUAGES = [
  "FR", "CZ", "SK", "IT", "CN", "JP", "SI", "LT", "LV", "FI",
  "UA", "PT", "VN", "DE", "NL", "TR", "EE", "RS", "HR", "ES",
  "PL", "HU", "GR", "RO", "BG", "EN"
];

// Endpoint główny
app.get("/poland/:titleEN", async (req, res) => {
  const { titleEN } = req.params;

  try {
    const response = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
        params: {
          filterByFormula: `LOWER({TitleEN}) = "${titleEN.toLowerCase()}"`
        }
      }
    );

    const record = response.data.records[0];
    if (!record) {
      return res.status(404).json({ error: `No data found for "${titleEN}"` });
    }

    const fields = record.fields;

    // 📊 Dane: array of { year, value }
    const data = [];
    if (fields["Data"]) {
      const lines = fields["Data"].split("\n");
      for (const line of lines) {
        const [year, value] = line.split(";");
        if (year && value) {
          data.push({ year: parseInt(year.trim()), value: parseFloat(value) });
        }
      }
    }

    // 🧾 Metadane główne (po angielsku)
    const meta = {
      titleEN: fields["TitleEN"] || "",
      descriptionEN: fields["DescriptionEN"] || "",
      updateFrequency: fields["UpdateFrequency"] || "",
      formatEN: fields["DataEN"] || "",
      updatedThere: fields["UpdatedThere"] || "",
      nextUpdateTime: fields["NextUpdateTime"] || "",
      sourceName: fields["Source Name"] || "",
      categoryView: fields["CategoryView"] || "",
      contentHub: fields["ContentHub"] || ""
    };

    // 🌐 Tłumaczenia
    const translations = {};
    LANGUAGES.forEach((lang) => {
      const titleKey = `Title${lang}`;
      const descriptionKey = `Description${lang}`;
      const dataKey = `Data${lang}`;
      const commentKey = `AIComment${lang}`;

      if (fields[titleKey]) translations[titleKey] = fields[titleKey];
      if (fields[descriptionKey]) translations[descriptionKey] = fields[descriptionKey];
      if (fields[dataKey]) translations[dataKey] = fields[dataKey];
      if (fields[commentKey]) translations[commentKey] = fields[commentKey];
    });

    // ✅ Finalna odpowiedź
    res.json({
      ...meta,
      data,
      translations
    });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

// Endpoint z listą dostępnych tytułów
app.get("/titlelist", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        }
      }
    );

    const records = response.data.records.map((r) => {
      const f = r.fields;
      return {
        titleEN: f["TitleEN"] || "",
        descriptionEN: f["DescriptionEN"] || "",
        categoryView: f["CategoryView"] || "",
        contentHub: f["ContentHub"] || ""
      };
    });

    res.json(records);
  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

app.listen(PORT, () => {
  console.log(`API is running on port ${PORT}`);
});
