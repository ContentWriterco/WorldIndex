require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const PORT = process.env.PORT || 3000;
const AIRTABLE_BASE_ID               = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME            = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_CATEGORIES_TABLE_NAME = process.env.AIRTABLE_CATEGORIES_TABLE_NAME;
const AIRTABLE_API_KEY               = process.env.AIRTABLE_API_KEY;
const PRIVATE_API_KEY                = process.env.PRIVATE_API_KEY;

// Lista obsługiwanych języków (dwuliterowe kody ISO)
const LANGUAGES = [
  "FR","CZ","SK","IT","CN","JP","SI","LT","LV","FI",
  "UA","PT","VN","DE","NL","TR","EE","RS","HR","ES",
  "PL","HU","GR","RO","BG","EN"
];

/**
 * Pobiera z tabeli Categories rekord o podanym ID
 * i zwraca obiekt tłumaczeń { id, en, pl, fr, ... }
 */
async function fetchCategoryTranslations(categoryId) {
  const resp = await axios.get(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CATEGORIES_TABLE_NAME}/${categoryId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
  const f = resp.data.fields;
  const translations = { id: categoryId };
  LANGUAGES.forEach(lang => {
    const key = `Title${lang}`;
    if (f[key]) translations[lang.toLowerCase()] = f[key];
  });
  return translations;
}

/**
 * Pobiera z tabeli Categories rekord o podanym ID
 * i zwraca jedną nazwę w żądanym języku (fallback: EN)
 */
async function fetchCategoryName(categoryId, lang) {
  const resp = await axios.get(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CATEGORIES_TABLE_NAME}/${categoryId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
  const f = resp.data.fields;
  const key = `Title${lang.toUpperCase()}`;
  return f[key] || f["TitleEN"] || null;
}

// Middleware zabezpieczające endpoint /poland/:titleEN
app.use("/poland/:titleEN", (req, res, next) => {
  const clientKey = req.headers["x-api-key"];
  if (clientKey !== PRIVATE_API_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid or missing API key" });
  }
  next();
});

// === Protected endpoint: /poland/:titleEN ===
app.get("/poland/:titleEN", async (req, res) => {
  const { titleEN } = req.params;
  try {
    // 1) Pobierz główny rekord
    const r = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
      {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        params: {
          filterByFormula: `LOWER({TitleEN}) = "${titleEN.toLowerCase()}"`
        }
      }
    );

    const record = r.data.records[0];
    if (!record) {
      return res.status(404).json({ error: `No data found for "${titleEN}"` });
    }

    const fields = record.fields;
    // Parsowanie danych „Data” / „DataEN”
    const data = [];
    if (fields.Data && fields.DataEN) {
      const headers = fields.DataEN.split(";").map(h => h.trim());
      fields.Data.split("\n").forEach(line => {
        const values = line.split(";").map(v => v.trim());
        const row = {};
        headers.forEach((key, i) => {
          const val = values[i];
          row[key === "Year" ? "year" : key] = isNaN(val) ? val : parseFloat(val);
        });
        data.push(row);
      });
    }

    // Meta podstawowe
    const meta = {
      title:            fields.TitleEN       || "",
      description:      fields.DescriptionEN || "",
      updateFrequency:  fields.UpdateFrequency||"",
      format:           fields.DataEN        || "",
      lastUpdate:       fields.UpdatedThere  || "",
      nextUpdateTime:   fields.NextUpdateTime||"",
      sourceName:       fields["Source Name"]||""
    };

    // Tłumaczenia i inne pola opcjonalne
    if (fields.Definitions)     meta.definitions     = fields.Definitions;
    if (fields.ResearchName)    meta.researchName    = fields.ResearchName;
    if (fields.ResearchPurpose) meta.researchPurpose = fields.ResearchPurpose;
    if (fields.Unit)            meta.unit            = fields.Unit;

    // Pobranie obiektu kategorii z pełnymi tłumaczeniami
    if (Array.isArray(fields.CategorySelect) && fields.CategorySelect.length) {
      const categoryId = fields.CategorySelect[0];
      meta.category = await fetchCategoryTranslations(categoryId);
    }

    // Tłumaczenia dla innych języków
    const translations = {};
    LANGUAGES.forEach(lang => {
      if (lang === "EN") return;
      ["Title", "Description", "Data", "AIComment"].forEach(prefix => {
        const key = `${prefix}${lang}`;
        if (fields[key]) translations[key] = fields[key];
      });
    });

    res.json({ meta, data, translations });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

// === Public endpoint: /titlelist/poland ===
app.get("/titlelist/poland", async (req, res) => {
  const lang      = (req.query.lang || "EN").toUpperCase();
  const titleKey  = `Title${lang}`;
  const descKey   = `Description${lang}`;

  try {
    // 1) Paginacja po wszystkich rekordach
    let all = [], offset = null;
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          params: { offset, pageSize: 100 }
        }
      );
      all.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    // 2) Filtracja i równoległe mapowanie z dynamicznym tłumaczeniem kategorii
    const items = await Promise.all(
      all
        .filter(r => r.fields.TitleEN && r.fields.TitleEN.trim())
        .map(async r => {
          const f = r.fields;
          let catName = null;
          if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
            catName = await fetchCategoryName(f.CategorySelect[0], lang);
          }
          return {
            id: r.id,
            meta: {
              title:          f[titleKey]       || f.TitleEN,
              description:    f[descKey]        || f.DescriptionEN || "",
              category:       catName,
              lastUpdate:     f.UpdatedThere    || "",
              nextUpdateTime: f.NextUpdateTime  || ""
            }
          };
        })
    );

    res.json({ count: items.length, items });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

// === Public endpoint: /titlelist/poland/:category ===
app.get("/titlelist/poland/:category", async (req, res) => {
  const lang            = (req.query.lang || "EN").toUpperCase();
  const titleKey        = `Title${lang}`;
  const descKey         = `Description${lang}`;
  const categoryParamLC = req.params.category.toLowerCase();

  try {
    // 1) Pobranie wszystkich rekordów
    let all = [], offset = null;
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          params: { offset, pageSize: 100 }
        }
      );
      all.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    // 2) Filtracja po surowej CategoryView i mapowanie
    const items = await Promise.all(
      all
        .filter(r => {
          const cv = r.fields.CategoryView;
          return (
            r.fields.TitleEN &&
            Array.isArray(cv) &&
            cv[0].toLowerCase() === categoryParamLC
          );
        })
        .map(async r => {
          const f = r.fields;
          let catName = null;
          if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
            catName = await fetchCategoryName(f.CategorySelect[0], lang);
          }
          return {
            id: r.id,
            meta: {
              title:          f[titleKey]       || f.TitleEN,
              description:    f[descKey]        || f.DescriptionEN || "",
              category:       catName,
              lastUpdate:     f.UpdatedThere    || "",
              nextUpdateTime: f.NextUpdateTime  || ""
            }
          };
        })
    );

    res.json({ count: items.length, items });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

// === Public endpoint: /categories/poland ===
app.get("/categories/poland", async (req, res) => {
  try {
    let all = [], offset = null;
    const categorySet = new Set();
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          params: { offset, pageSize: 100 }
        }
      );
      all.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    all.forEach(r => {
      const cv = r.fields.CategoryView;
      if (Array.isArray(cv)) cv.forEach(c => categorySet.add(c));
    });

    res.json({ count: categorySet.size, categories: Array.from(categorySet).sort() });

  } catch (error) {
    res.status(500).json({ error: `Server error: ${error.toString()}` });
  }
});

app.listen(PORT, () => {
  console.log(`API is running on port ${PORT}`);
});
