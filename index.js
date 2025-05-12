require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const PORT = process.env.PORT || 3000;

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_CATEGORIES_TABLE_NAME = process.env.AIRTABLE_CATEGORIES_TABLE_NAME;
const PRIVATE_API_KEY = process.env.PRIVATE_API_KEY;

const LANGUAGES = [
  "FR", "CZ", "SK", "IT", "CN", "JP", "SI", "LT", "LV", "FI",
  "UA", "PT", "VN", "DE", "NL", "TR", "EE", "RS", "HR", "ES",
  "PL", "HU", "GR", "RO", "BG", "EN"
];

// Middleware to protect /poland/:titleEN
app.use("/poland/:titleEN", (req, res, next) => {
  const clientKey = req.headers["x-api-key"];
  if (clientKey !== PRIVATE_API_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid or missing API key" });
  }
  next();
});

// Protected endpoint: /poland/:titleEN
app.get("/poland/:titleEN", async (req, res) => {
  const { titleEN } = req.params;

  try {
    const response = await axios.get(
      https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME},
      {
        headers: {
          Authorization: Bearer ${AIRTABLE_API_KEY},
        },
        params: {
          filterByFormula: LOWER({TitleEN}) = \"${titleEN.toLowerCase()}\"
        }
      }
    );

    const record = response.data.records[0];
    if (!record) {
      return res.status(404).json({ error: No data found for \"${titleEN}\" });
    }

    const fields = record.fields;
    const data = [];

    if (fields["Data"] && fields["DataEN"]) {
      const headers = fields["DataEN"].split(";").map(h => h.trim());
      const lines = fields["Data"].split("\n");

      for (const line of lines) {
        const values = line.split(";").map(v => v.trim());
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

    if (Array.isArray(fields["CategoryView"]) && fields["CategoryView"].length > 0) {
      meta.category = fields["CategoryView"][0];
    }

    if (fields["Definitions"]) meta.definitions = fields["Definitions"];
    if (fields["ResearchName"]) meta.researchName = fields["ResearchName"];
    if (fields["ResearchPurpose"]) meta.researchPurpose = fields["ResearchPurpose"];
    if (fields["Unit"]) meta.unit = fields["Unit"];

    const translations = {};
    LANGUAGES.forEach((lang) => {
      if (lang === "EN") return;
      const titleKey = Title${lang};
      const descriptionKey = Description${lang};
      const dataKey = Data${lang};
      const commentKey = AIComment${lang};
      if (fields[titleKey]) translations[titleKey] = fields[titleKey];
      if (fields[descriptionKey]) translations[descriptionKey] = fields[descriptionKey];
      if (fields[dataKey]) translations[dataKey] = fields[dataKey];
      if (fields[commentKey]) translations[commentKey] = fields[commentKey];
    });

    res.json({ meta, data, translations });

  } catch (error) {
    res.status(500).json({ error: Server error: ${error.toString()} });
  }
});

// Public endpoint: /titlelist/poland
app.get("/titlelist/poland", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = Title${lang};
  const descKey = Description${lang};

  let allRecords = [];
  let offset = null;

  try {
    do {
      const response = await axios.get(
        https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME},
        {
          headers: {
            Authorization: Bearer ${AIRTABLE_API_KEY},
          },
          params: {
            offset: offset,
            pageSize: 100
          }
        }
      );

      allRecords.push(...response.data.records);
      offset = response.data.offset;
    } while (offset);

    const filteredRecords = allRecords
      .filter((r) => r.fields["TitleEN"] && r.fields["TitleEN"].trim() !== "")
      .map((r) => {
        const f = r.fields;
        return {
          id: r.id,
          meta: {
            title: f[titleKey] || f["TitleEN"],
            description: f[descKey] || f["DescriptionEN"] || "",
            category: Array.isArray(f["CategoryView"]) && f["CategoryView"].length > 0 ? f["CategoryView"][0] : "",
            lastUpdate: f["UpdatedThere"] || "",
            nextUpdateTime: f["NextUpdateTime"] || ""
          }
        };
      });

    res.json({ count: filteredRecords.length, items: filteredRecords });

  } catch (error) {
    res.status(500).json({ error: Server error: ${error.toString()} });
  }
});

// Public endpoint: /titlelist/poland/:category
app.get("/titlelist/poland/:category", async (req, res) => {
  const categoryParam = req.params.category.toLowerCase();
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = Title${lang};
  const descKey = Description${lang};

  let allRecords = [];
  let offset = null;

  try {
    do {
      const response = await axios.get(
        https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME},
        {
          headers: {
            Authorization: Bearer ${AIRTABLE_API_KEY},
          },
          params: {
            offset: offset,
            pageSize: 100
          }
        }
      );

      allRecords.push(...response.data.records);
      offset = response.data.offset;
    } while (offset);

    const filteredRecords = allRecords
      .filter((r) => {
        const f = r.fields;
        const category = Array.isArray(f["CategoryView"]) && f["CategoryView"].length > 0 ? f["CategoryView"][0].toLowerCase() : "";
        return f["TitleEN"] && f["TitleEN"].trim() !== "" && category === categoryParam;
      })
      .map((r) => {
        const f = r.fields;
        return {
          id: r.id,
          meta: {
            title: f[titleKey] || f["TitleEN"],
            description: f[descKey] || f["DescriptionEN"] || "",
            category: Array.isArray(f["CategoryView"]) && f["CategoryView"].length > 0 ? f["CategoryView"][0] : "",
            lastUpdate: f["UpdatedThere"] || "",
            nextUpdateTime: f["NextUpdateTime"] || ""
          }
        };
      });

    res.json({ count: filteredRecords.length, items: filteredRecords });

  } catch (error) {
    res.status(500).json({ error: Server error: ${error.toString()} });
  }
});

// Restored version of /categories/poland: returns unique raw categories
app.get("/categories/poland", async (req, res) => {
  let allRecords = [];
  let offset = null;
  const categorySet = new Set();

  try {
    do {
      const response = await axios.get(
        https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME},
        {
          headers: {
            Authorization: Bearer ${AIRTABLE_API_KEY},
          },
          params: {
            offset: offset,
            pageSize: 100
          }
        }
      );

      allRecords.push(...response.data.records);
      offset = response.data.offset;
    } while (offset);

    allRecords.forEach((r) => {
      const f = r.fields;
      if (Array.isArray(f["CategoryView"])) {
        f["CategoryView"].forEach(c => categorySet.add(c));
      }
    });

    res.json({ count: categorySet.size, categories: Array.from(categorySet).sort() });

  } catch (error) {
    res.status(500).json({ error: Server error: ${error.toString()} });
  }
});

app.listen(PORT, () => {
  console.log(API is running on port ${PORT});
});