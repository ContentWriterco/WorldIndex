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

// Main API endpoint: /poland/:titleEN
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

    // Parse multi-column data using DataEN as headers
    const data = [];
    if (fields["Data"] && fields["DataEN"]) {
      const headers = fields["DataEN"].split(";").map((h) => h.trim());
      const lines = fields["Data"].split("\n");

      for (let i = 0; i < lines.length; i++) {
        const values = lines[i].split(";").map((v) => v.trim());
        const row = {};
        headers.forEach((key, index) => {
          const val = values[index];
          row[key === "Year" ? "year" : key] = isNaN(val) ? val : parseFloat(val);
        });
        data.push(row);
      }
    }

    // Main metadata (EN)
    const meta = {
      titleEN: fields["TitleEN"] || "",
      descriptionEN: fields["DescriptionEN"] || "",
      updateFrequency: fields["UpdateFrequency"] || "",
      dataEN: fields["DataEN"] || "",
      updatedThere: fields["UpdatedThere"] || "",
      nextUpdateTime: fields["NextUpdateTime"] || "",
      sourceName: fields["Source Name"] || ""
    };

    if (fields["CategoryView"] && Array.isArray(fields["CategoryView"]) && fields["CategoryView"].length > 0) {
      meta.categoryView = fields["CategoryView"][0];
    }

    // Collect translations for other languages (excluding EN)
    const translations = {};
    LANGUAGES.forEach((lang) => {
      if (lang === "EN") return;

      const titleKey = `Title${lang}`;
      const descriptionKey = `Description${lang}`;
      const dataKey = `Data${lang}`;
      const commentKey = `AIComment${lang}`;

      if (fields[titleKey]) translations[titleKey] = fields[titleKey];
      if (fields[descriptionKey]) translations[descriptionKey] = fields[descriptionKey];
      if (fields[dataKey]) translations[dataKey] = fields[dataKey];
      if (fields[commentKey]) translations[commentKey] = fields[commentKey];
    });

    res.json({
      meta,
      data,
      translations
    });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

// Endpoint: /titlelist – returns list of datasets
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
        id: r.id,
        meta: {
          titleEN: f["TitleEN"] || "",
          descriptionEN: f["DescriptionEN"] || "",
          categoryView: Array.isArray(f["CategoryView"]) && f["CategoryView"].length > 0
            ? f["CategoryView"][0]
            : ""
        }
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
