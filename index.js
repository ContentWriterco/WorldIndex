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

// Endpoint: /poland/:titleEN
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

    const meta = {
      title: fields["TitleEN"] || "",
      description: fields["DescriptionEN"] || "",
      updateFrequency: fields["UpdateFrequency"] || "",
      format: fields["DataEN"] || "",
      lastUpdate: fields["UpdatedThere"] || "",
      nextUpdateTime: fields["NextUpdateTime"] || "",
      sourceName: fields["Source Name"] || ""
    };

    if (fields["CategoryView"] && Array.isArray(fields["CategoryView"]) && fields["CategoryView"].length > 0) {
      meta.category = fields["CategoryView"][0];
    }

    if (fields["Definitions"]) meta.definitions = fields["Definitions"];
    if (fields["ResearchName"]) meta.researchName = fields["ResearchName"];
    if (fields["ResearchPurpose"]) meta.researchPurpose = fields["ResearchPurpose"];
    if (fields["Unit"]) meta.unit = fields["Unit"];

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

// Endpoint: /titlelist with full pagination
app.get("/titlelist", async (req, res) => {
  let allRecords = [];
  let offset = null;

  try {
    do {
      const response = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
        {
          headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          },
          params: offset ? { offset } : {},
        }
      );

      const records = response.data.records;
      allRecords.push(...records);
      offset = response.data.offset;
    } while (offset);

    const filteredRecords = allRecords
      .filter((r) => {
        const f = r.fields;
        return f["TitleEN"] && f["TitleEN"].trim() !== "";
      })
      .map((r) => {
        const f = r.fields;
        return {
          id: r.id,
          meta: {
            title: f["TitleEN"] || "",
            description: f["DescriptionEN"] || "",
            category: Array.isArray(f["CategoryView"]) && f["CategoryView"].length > 0
              ? f["CategoryView"][0]
              : ""
          }
        };
      });

    res.json(filteredRecords);
  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

app.listen(PORT, () => {
  console.log(`API is running on port ${PORT}`);
});
