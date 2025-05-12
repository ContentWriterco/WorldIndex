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
 * i zwraca obiekt tłumaczeń Secondary / SecondaryXX
 */
async function fetchCategoryTranslations(categoryId) {
  const resp = await axios.get(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CATEGORIES_TABLE_NAME}/${categoryId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
  const f = resp.data.fields;
  const translations = { id: categoryId };
  LANGUAGES.forEach(lang => {
    // dla angielskiego mamy po prostu pole "Secondary"
    const key = lang === "EN"
      ? "Secondary"
      : `Secondary${lang.toUpperCase()}`;
    if (f[key]) {
      translations[lang.toLowerCase()] = f[key];
    }
  });
  return translations;
}

/**
 * Pobiera z tabeli Categories rekord o podanym ID
 * i zwraca pojedynczą nazwę kategorii w żądanym języku
 * (fallback do angielskiego Secondary)
 */
async function fetchCategoryName(categoryId, lang) {
  const resp = await axios.get(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CATEGORIES_TABLE_NAME}/${categoryId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
  );
  const f = resp.data.fields;
  const key = lang === "EN"
    ? "Secondary"
    : `Secondary${lang.toUpperCase()}`;
  return f[key] || f["Secondary"] || null;
}

// Middleware do ochrony /poland/:titleEN
app.use("/poland/:titleEN", (req, res, next) => {
  if (req.headers["x-api-key"] !== PRIVATE_API_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid or missing API key" });
  }
  next();
});

// === Protected endpoint: /poland/:titleEN ===
app.get("/poland/:titleEN", async (req, res) => {
  const { titleEN } = req.params;
  try {
    // 1) główny rekord
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
    if (!record) return res.status(404).json({ error: `No data for "${titleEN}"` });

    const f = record.fields;
    // parsowanie Data/DataEN
    const data = [];
    if (f.Data && f.DataEN) {
      const heads = f.DataEN.split(";").map(s => s.trim());
      f.Data.split("\n").forEach(line => {
        const vals = line.split(";").map(s => s.trim());
        const row = {};
        heads.forEach((h, i) => {
          const v = vals[i];
          row[h === "Year" ? "year" : h] = isNaN(v) ? v : parseFloat(v);
        });
        data.push(row);
      });
    }

    // meta podstawowe
    const meta = {
      title:           f.TitleEN       || "",
      description:     f.DescriptionEN || "",
      updateFrequency: f.UpdateFrequency||"",
      format:          f.DataEN        || "",
      lastUpdate:      f.UpdatedThere  || "",
      nextUpdateTime:  f.NextUpdateTime||"",
      sourceName:      f["Source Name"]||""
    };

    // dodatkowe:
    if (f.Definitions)     meta.definitions     = f.Definitions;
    if (f.ResearchName)    meta.researchName    = f.ResearchName;
    if (f.ResearchPurpose) meta.researchPurpose = f.ResearchPurpose;
    if (f.Unit)            meta.unit            = f.Unit;

    // kategoria – pełne tłumaczenia
    if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
      meta.category = await fetchCategoryTranslations(f.CategorySelect[0]);
    }

    // inne tłumaczenia z głównej tabeli
    const translations = {};
    LANGUAGES.forEach(lang => {
      if (lang === "EN") return;
      ["Title","Description","Data","AIComment"].forEach(pref => {
        const key = `${pref}${lang}`;
        if (f[key]) translations[key] = f[key];
      });
    });

    res.json({ meta, data, translations });

  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// === Public endpoint: /titlelist/poland ===
app.get("/titlelist/poland", async (req, res) => {
  const lang      = (req.query.lang||"EN").toUpperCase();
  const titleKey  = `Title${lang}`;
  const descKey   = `Description${lang}`;

  try {
    // pobieramy wszystkie rekordy
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

    // filtr i mapowanie z dynamiczną kategorią
    const items = await Promise.all(
      all
        .filter(r => r.fields.TitleEN && r.fields.TitleEN.trim())
        .map(async r => {
          const f = r.fields;
          let cat = null;
          if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
            cat = await fetchCategoryName(f.CategorySelect[0], lang);
          }
          return {
            id: r.id,
            meta: {
              title:         f[titleKey]       || f.TitleEN,
              description:   f[descKey]        || f.DescriptionEN || "",
              category:      cat,
              lastUpdate:    f.UpdatedThere    || "",
              nextUpdateTime:f.NextUpdateTime  || ""
            }
          };
        })
    );

    res.json({ count: items.length, items });

  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// === Public endpoint: /titlelist/poland/:category ===
app.get("/titlelist/poland/:category", async (req, res) => {
  const lang            = (req.query.lang||"EN").toUpperCase();
  const titleKey        = `Title${lang}`;
  const descKey         = `Description${lang}`;
  const categoryParamLC = req.params.category.toLowerCase();

  try {
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
          let cat = null;
          if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
            cat = await fetchCategoryName(f.CategorySelect[0], lang);
          }
          return {
            id: r.id,
            meta: {
              title:         f[titleKey]       || f.TitleEN,
              description:   f[descKey]        || f.DescriptionEN || "",
              category:      cat,
              lastUpdate:    f.UpdatedThere    || "",
              nextUpdateTime:f.NextUpdateTime  || ""
            }
          };
        })
    );

    res.json({ count: items.length, items });

  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// === Public endpoint: /categories/poland ===
app.get("/categories/poland", async (req, res) => {
  try {
    let all = [], offset = null;
    const set = new Set();
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
      if (Array.isArray(cv)) cv.forEach(c => set.add(c));
    });

    res.json({ count: set.size, categories: Array.from(set).sort() });

  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.listen(PORT, () => {
  console.log(`API is running on port ${PORT}`);
});
