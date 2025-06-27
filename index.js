require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const PORT  = process.env.PORT || 3000;
const BASE  = process.env.AIRTABLE_BASE_ID;
const MAIN  = process.env.AIRTABLE_TABLE_NAME;
const CATS  = process.env.AIRTABLE_CATEGORIES_TABLE_NAME;
const KEY   = process.env.AIRTABLE_API_KEY;
const PRIV  = process.env.PRIVATE_API_KEY;
const META  = process.env.AIRTABLE_METADATA_TABLE_NAME;


// Lista dwuliterowych kodów języków
const LANGUAGES = [
  "FR","CZ","SK","IT","CN","JP","SI","LT","LV","FI",
  "UA","PT","VN","DE","NL","TR","EE","RS","HR","ES",
  "PL","HU","GR","RO","BG","EN"
];

// Helper: fetch all categories into map { id → fields }
async function loadAllCategories() {
  let map = {};
  let offset = null;
  do {
    const r = await axios.get(
      `https://api.airtable.com/v0/${BASE}/${CATS}`,
      {
        headers: { Authorization: `Bearer ${KEY}` },
        params: { offset, pageSize: 100 }
      }
    );
    r.data.records.forEach(rec => {
      map[rec.id] = rec.fields;
    });
    offset = r.data.offset;
  } while (offset);
  return map;
}


// === /poland/:titleEN ===
app.get("/poland/:titleEN", async (req, res) => {
  const titleEN = req.params.titleEN.toLowerCase();
  const lang = (req.query.lang || "EN").toUpperCase();
  const langSuffix = lang === "EN" ? "" : lang;

  try {
    const mainResp = await axios.get(
      `https://api.airtable.com/v0/${BASE}/${MAIN}`,
      {
        headers: { Authorization: `Bearer ${KEY}` },
        params: {
          filterByFormula: `LOWER({TitleEN})="${titleEN}"`
        }
      }
    );

    const record = mainResp.data.records[0];
    if (!record) {
      return res.status(404).json({ error: `No data for "${titleEN}"` });
    }

    const f = record.fields;

    // Parsowanie danych
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

    // Podstawowe meta z głównej tabeli
    const meta = {
      title:           f.TitleEN || "",
      description:     f.DescriptionEN || "",
      updateFrequency: f.UpdateFrequency || "",
      format:          f.DataEN || "",
      lastUpdate:      f.UpdatedThere || "",
      nextUpdateTime:  f.NextUpdateTime || ""
    };

    // Pobieranie metadanych z powiązanej tabeli Metadata
    if (Array.isArray(f.Metadata) && f.Metadata.length > 0) {
      const metadataId = f.Metadata[0];
      try {
        const metaResp = await axios.get(
          `https://api.airtable.com/v0/${BASE}/${META}/${metadataId}`,
          {
            headers: { Authorization: `Bearer ${KEY}` }
          }
        );
        const m = metaResp.data.fields;
    
        meta.researchName    = m[`ResearchName${langSuffix}`]    || "";
        meta.researchPurpose = m[`ResearchPurpose${langSuffix}`] || "";
        meta.definitions     = m[`Definitions${langSuffix}`]     || "";
        meta.methodology     = m[`Methodology${langSuffix}`]     || "";
        meta.sourceName      = m[`Source Name${langSuffix}`]     || "";
        meta.unit            = m[`Unit${langSuffix}`]            || "";
      } catch (e) {
        console.error("Błąd przy pobieraniu Metadata:", e.toString());
      }
    }

    // Kategorie
    const catMap = await loadAllCategories();
    if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
      const catFields = catMap[f.CategorySelect[0]];
      const catTrans = { id: f.CategorySelect[0] };
      LANGUAGES.forEach(l => {
        const key = l === "EN" ? "Secondary" : `Secondary${l}`;
        if (catFields[key]) catTrans[l.toLowerCase()] = catFields[key];
      });
      meta.category = catTrans;
    }

    // Tłumaczenia (TitlePL, DescriptionPL, itd.)
    const translations = {};
    LANGUAGES.forEach(l => {
      if (l === "EN") return;
      ["Title", "Description", "Data", "AIComment"].forEach(prefix => {
        const key = `${prefix}${l}`;
        if (f[key]) translations[key] = f[key];
      });
    });

    res.json({ meta, data, translations });
  } catch (e) {
    console.error("❌ General error:", e.toString());
    res.status(500).json({ error: e.toString() });
  }
});



// === /titlelist/poland (public) ===
app.get("/titlelist/poland", async (req, res) => {
  const lang     = (req.query.lang||"EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey  = `Description${lang}`;

  try {
    // pobierz wszystkie rekordy główne
    let all = [], offset = null;
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        {
          headers: { Authorization: `Bearer ${KEY}` },
          params: { offset, pageSize: 100 }
        }
      );
      all.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    const catMap = await loadAllCategories();

    // buduj items
    const items = all
      .filter(r => r.fields.TitleEN && r.fields.TitleEN.trim())
      .map(r => {
        const f = r.fields;
        let catName = null;
        if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
          const cf = catMap[f.CategorySelect[0]];
          const key = lang==="EN"?"Secondary":`Secondary${lang}`;
          catName = cf[key] || cf["Secondary"] || null;
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
      });

    // sortujemy malejąco po lastUpdate
    items.sort((a, b) => {
      const da = new Date(a.meta.lastUpdate);
      const db = new Date(b.meta.lastUpdate);
      return db - da;
    });

    res.json({ count: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// === /titlelist/poland/:category (public) ===
app.get("/titlelist/poland/:category", async (req, res) => {
  const lang     = (req.query.lang||"EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey  = `Description${lang}`;
  const catParam = req.params.category.toLowerCase();

  try {
    // pobierz wszystkie rekordy główne
    let all = [], offset = null;
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        {
          headers: { Authorization: `Bearer ${KEY}` },
          params: { offset, pageSize: 100 }
        }
      );
      all.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    const catMap = await loadAllCategories();

    // filtr i mapowanie
    const items = all
      .filter(r => {
        const cv = r.fields.CategoryView;
        return r.fields.TitleEN &&
               Array.isArray(cv) &&
               cv[0].toLowerCase() === catParam;
      })
      .map(r => {
        const f = r.fields;
        let catName = null;
        if (Array.isArray(f.CategorySelect) && f.CategorySelect.length) {
          const cf = catMap[f.CategorySelect[0]];
          const key = lang==="EN"?"Secondary":`Secondary${lang}`;
          catName = cf[key] || cf["Secondary"] || null;
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
      });

    // sortujemy malejąco po lastUpdate
    items.sort((a, b) => {
      const da = new Date(a.meta.lastUpdate);
      const db = new Date(b.meta.lastUpdate);
      return db - da;
    });

    res.json({ count: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// === Public endpoint: /categories/poland ===
app.get("/categories/poland", async (req, res) => {
  const lang     = (req.query.lang || "EN").toUpperCase();
  const fieldKey = lang === "EN"
    ? "Secondary"
    : `Secondary${lang}`;

  try {
    let categories = [];
    let offset = null;

    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${CATS}`,
        {
          headers: { Authorization: `Bearer ${KEY}` },
          params: {
            offset,
            pageSize: 100,
            filterByFormula: `{Primary Category}="Poland"`
          }
        }
      );
      r.data.records.forEach(rec => {
        const f = rec.fields;
        const name = f[fieldKey] || f["Secondary"];
        if (name) categories.push(name);
      });
      offset = r.data.offset;
    } while (offset);

    categories = Array.from(new Set(categories)).sort();

    res.json({ count: categories.length, categories });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.listen(PORT, () => console.log(`API on port ${PORT}`));
