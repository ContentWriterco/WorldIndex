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

app.use("/poland/:titleEN", (req, res, next) => {
  const clientKey = req.headers["x-api-key"];
  if (clientKey !== PRIVATE_API_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid or missing API key" });
  }
  next();
});

async function fetchCategoryNames(categoryIds, lang) {
  const titleField = `Title${lang}`;
  const categories = {};

  try {
    for (let i = 0; i < categoryIds.length; i += 10) {
      const chunk = categoryIds.slice(i, i + 10);
      const response = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CATEGORIES_TABLE_NAME}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          params: {
            filterByFormula: `OR(${chunk.map(id => `RECORD_ID()='${id}'`).join(",")})`
          }
        }
      );
      response.data.records.forEach(record => {
        categories[record.id] = record.fields[titleField] || record.fields["TitleEN"] || "(no title)";
      });
    }
  } catch (error) {
    console.error("Error fetching categories:", error.toString());
  }

  return categories;
}

app.get("/poland/:titleEN", async (req, res) => {
  const { titleEN } = req.params;

  try {
    const response = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        params: {
          filterByFormula: `LOWER({TitleEN}) = \"${titleEN.toLowerCase()}\"`
        }
      }
    );

    const record = response.data.records[0];
    if (!record) return res.status(404).json({ error: `No data found for \"${titleEN}\"` });

    const fields = record.fields;
    const lang = (req.query.lang || "EN").toUpperCase();
    const titleKey = `Title${lang}`;
    const descKey = `Description${lang}`;

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

    let category = "";
    const catId = Array.isArray(fields["CategoryView"]) && fields["CategoryView"].length > 0 ? fields["CategoryView"][0] : null;
    if (catId) {
      const categoryMap = await fetchCategoryNames([catId], lang);
      category = categoryMap[catId] || "";
    }

    const meta = {
      title: fields[titleKey] || fields["TitleEN"] || "",
      description: fields[descKey] || fields["DescriptionEN"] || "",
      updateFrequency: fields["UpdateFrequency"] || "",
      format: fields["DataEN"] || "",
      lastUpdate: fields["UpdatedThere"] || "",
      nextUpdateTime: fields["NextUpdateTime"] || "",
      sourceName: fields["Source Name"] || "",
      category
    };

    if (fields["Definitions"]) meta.definitions = fields["Definitions"];
    if (fields["ResearchName"]) meta.researchName = fields["ResearchName"];
    if (fields["ResearchPurpose"]) meta.researchPurpose = fields["ResearchPurpose"];
    if (fields["Unit"]) meta.unit = fields["Unit"];

    const translations = {};
    LANGUAGES.forEach((langCode) => {
      if (langCode === "EN") return;
      const title = fields[`Title${langCode}`];
      const desc = fields[`Description${langCode}`];
      const dataField = fields[`Data${langCode}`];
      const comment = fields[`AIComment${langCode}`];
      if (title) translations[`Title${langCode}`] = title;
      if (desc) translations[`Description${langCode}`] = desc;
      if (dataField) translations[`Data${langCode}`] = dataField;
      if (comment) translations[`AIComment${langCode}`] = comment;
    });

    res.json({ meta, data, translations });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

app.get("/titlelist/poland", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey = `Description${lang}`;

  let allRecords = [];
  let offset = null;
  const categoryIds = new Set();

  try {
    do {
      const response = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          params: { offset, pageSize: 100 }
        }
      );

      response.data.records.forEach(record => {
        const f = record.fields;
        if (Array.isArray(f["CategoryView"])) {
          categoryIds.add(f["CategoryView"][0]);
        }
        allRecords.push(record);
      });

      offset = response.data.offset;
    } while (offset);

    const categoryMap = await fetchCategoryNames(Array.from(categoryIds), lang);

    const items = allRecords
      .filter(r => r.fields["TitleEN"] && r.fields["TitleEN"].trim() !== "")
      .map(r => {
        const f = r.fields;
        const catId = Array.isArray(f["CategoryView"]) ? f["CategoryView"][0] : null;
        return {
          id: r.id,
          meta: {
            title: f[titleKey] || f["TitleEN"],
            description: f[descKey] || f["DescriptionEN"] || "",
            category: catId ? categoryMap[catId] || "" : "",
            lastUpdate: f["UpdatedThere"] || "",
            nextUpdateTime: f["NextUpdateTime"] || ""
          }
        };
      });

    res.json({ count: items.length, items });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

app.get("/categories/poland", async (req, res) => {
  let allRecords = [];
  let offset = null;
  const categorySet = new Set();

  try {
    do {
      const response = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          params: { offset, pageSize: 100 }
        }
      );

      allRecords.push(...response.data.records);
      offset = response.data.offset;
    } while (offset);

    allRecords.forEach(r => {
      const f = r.fields;
      if (Array.isArray(f["CategoryView"])) {
        f["CategoryView"].forEach(c => categorySet.add(c));
      }
    });

    res.json({ count: categorySet.size, categories: Array.from(categorySet).sort() });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

app.listen(PORT, () => {
  console.log(`API is running on port ${PORT}`);
});