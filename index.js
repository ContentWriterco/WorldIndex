require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

// --- Zmienne środowiskowe ---
const PORT = process.env.PORT || 3000;
const BASE = process.env.AIRTABLE_BASE_ID;
const MAIN = process.env.AIRTABLE_TABLE_NAME; // Wartość "Poland"
const CATS = process.env.AIRTABLE_CATEGORIES_TABLE_NAME;
const KEY = process.env.AIRTABLE_API_KEY;
const META = process.env.AIRTABLE_METADATA_TABLE_NAME;

// Lista dwuliterowych kodów języków
const LANGUAGES = [
  "FR", "CZ", "SK", "IT", "CN", "JP", "SI", "LT", "LV", "FI",
  "UA", "PT", "VN", "DE", "NL", "TR", "EE", "RS", "HR", "ES",
  "PL", "HU", "GR", "RO", "BG", "EN"
];

// Cache dla kategorii, żeby nie pobierać ich za każdym razem
let categoryMapCache = null;

/**
 * Helper: Fetches all categories into a map { id -> fields }
 * Caches the result to avoid redundant API calls.
 */
async function loadAllCategories() {
  if (categoryMapCache) {
    return categoryMapCache;
  }

  console.log("[INFO] Fetching all categories from Airtable...");
  let map = {};
  let offset = null;
  do {
    try {
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${CATS}`, {
          headers: {
            Authorization: `Bearer ${KEY}`
          },
          params: {
            offset,
            pageSize: 100
          }
        }
      );
      r.data.records.forEach(rec => {
        map[rec.id] = rec.fields;
      });
      offset = r.data.offset;
    } catch (error) {
      console.error("[ERROR] Failed to fetch categories from Airtable:", error.message);
      throw error;
    }
  } while (offset);

  categoryMapCache = map;
  console.log(`[INFO] Loaded ${Object.keys(map).length} categories.`);
  return map;
}

// --- PUBLIC ENDPOINTS (bardziej szczegółowe trasy na górze) ---

// --- NOWY ENDPOINT: /titlelist/:country/:category/news ---
// Zwraca listę wszystkich AICommentEN/PL/etc. dla danej kategorii i kraju.
app.get("/titlelist/:country/:category/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const catParam = req.params.category.toLowerCase();
    const country = req.params.country;

    // Ustawienie dynamicznego klucza dla pola AIComment
    const aiCommentKey = `AIComment${lang}`;

    // Mapowanie parametru URL na wartość w Airtable
    let countryNameForAirtable;
    const lowerCaseCountry = country.toLowerCase();

    if (lowerCaseCountry === 'eu') {
      countryNameForAirtable = 'European Union';
    } else {
      countryNameForAirtable = lowerCaseCountry.charAt(0).toUpperCase() + lowerCaseCountry.slice(1);
    }

    // Użyj ID widoku dla "EU" i "Poland" do pobrania danych country-specific
    let viewIdentifier;
    if (lowerCaseCountry === 'eu') {
      viewIdentifier = process.env.AIRTABLE_EU_VIEW_ID;
      if (!viewIdentifier) {
        console.error("[ERROR] AIRTABLE_EU_VIEW_ID not set in .env file for /titlelist/:country/:category/news.");
        return res.status(500).json({ error: "Configuration for 'EU' view is missing. Please check your .env file." });
      }
    } else if (lowerCaseCountry === 'poland') {
      viewIdentifier = process.env.AIRTABLE_POLAND_VIEW_ID;
      if (!viewIdentifier) {
        console.error("[ERROR] AIRTABLE_POLAND_VIEW_ID not set in .env file for /titlelist/:country/:category/news.");
        return res.status(500).json({ error: "Configuration for 'Poland' view is missing. Please check your .env file." });
      }
    } else {
      // Fallback do używania nazwy widoku dla innych, nie-zdefiniowanych widoków
      viewIdentifier = countryNameForAirtable;
    }

    try {
        // 1. Validate category and country combination exists in Categories table
        const categoriesResp = await axios.get(
            `https://api.airtable.com/v0/${BASE}/${CATS}`,
            {
                headers: { Authorization: `Bearer ${KEY}` },
                params: {
                    filterByFormula: `AND(LOWER({SecondaryEN}) = "${catParam}", LOWER({TitleEN}) = "${countryNameForAirtable.toLowerCase()}")`
                }
            }
        );
        const categoryRecord = categoriesResp.data.records[0];
        if (!categoryRecord) {
            console.warn(`[WARN] Category filter not found: SecondaryEN: "${catParam}", TitleEN: "${countryNameForAirtable}".`);
            return res.status(404).json({ error: `Category "${catParam}" not found for "${country}".` });
        }

        // 2. Fetch all records from the MAIN table for the country view
        let allRecords = [], offset = null;
        do {
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: {
                        offset,
                        pageSize: 100,
                        view: viewIdentifier // Pobieramy rekordy z widoku kraju (np. "EU" lub "Poland")
                    }
                }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);

        if (allRecords.length === 0) {
            console.warn(`[WARN] No records found for view: "${viewIdentifier}" when filtering by category.`);
            return res.status(404).json({ error: `No data found for the view "${viewIdentifier}" when filtering by category.` });
        }

        // 3. Lokalnie filtruj rekordy po kolumnie CategoryView i mapuj na AICommentEN/PL/etc.
        const comments = allRecords
            .filter(r => {
                // Filter for valid Title records
                const titleExists = r.fields.Title && r.fields.Title.trim();
                // Filter for the correct category
                const categoryViewValue = Array.isArray(r.fields.CategoryView) ? r.fields.CategoryView[0] : r.fields.CategoryView;
                return titleExists && (categoryViewValue && categoryViewValue.toLowerCase() === catParam);
            })
            .map(r => r.fields[aiCommentKey] || r.fields['AICommentEN']) // Pobierz komentarz w danym języku lub domyślnie po angielsku
            .filter(comment => comment && comment.trim()); // Odrzuć puste lub niezdefiniowane komentarze

        // Zwróć tylko listę komentarzy i ich liczbę
        res.json({ count: comments.length, comments });

    } catch (e) {
        console.error(`[ERROR] General error in /titlelist/:country/:category/news:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


// --- Endpoint: /titlelist/:country/:category
// Zaktualizowany, aby poprawnie filtrować kategorię i kraj na podstawie podanych danych
app.get("/titlelist/:country/:category", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey = `Description${lang}`;
  const catParam = req.params.category.toLowerCase();
  const country = req.params.country;

  // --- Zmieniony blok: mapowanie parametru URL na wartość w Airtable ---
  let countryNameForAirtable;
  const lowerCaseCountry = country.toLowerCase();

  if (lowerCaseCountry === 'eu') {
    countryNameForAirtable = 'European Union';
  } else {
    countryNameForAirtable = lowerCaseCountry.charAt(0).toUpperCase() + lowerCaseCountry.slice(1);
  }
  // ----------------------------------------------------------------------

  // Użyj ID widoku dla "EU" i "Poland" do pobrania danych country-specific
  let viewIdentifier;
  if (lowerCaseCountry === 'eu') {
    viewIdentifier = process.env.AIRTABLE_EU_VIEW_ID;
    if (!viewIdentifier) {
      console.error("[ERROR] AIRTABLE_EU_VIEW_ID not set in .env file for /titlelist/:country/:category.");
      return res.status(500).json({ error: "Configuration for 'EU' view is missing. Please check your .env file." });
    }
  } else if (lowerCaseCountry === 'poland') {
    viewIdentifier = process.env.AIRTABLE_POLAND_VIEW_ID;
    if (!viewIdentifier) {
      console.error("[ERROR] AIRTABLE_POLAND_VIEW_ID not set in .env file for /titlelist/:country/:category.");
      return res.status(500).json({ error: "Configuration for 'Poland' view is missing. Please check your .env file." });
    }
  } else {
    // Fallback do używania nazwy widoku dla innych, nie-zdefiniowanych widoków
    viewIdentifier = countryNameForAirtable; // Użyj skapitalizowanej nazwy kraju jako nazwy widoku
  }

  try {
    // 1. Find the category record ID based on its Secondary and the correct country name
    const categoriesResp = await axios.get(
      `https://api.airtable.com/v0/${BASE}/${CATS}`,
      {
        headers: { Authorization: `Bearer ${KEY}` },
        params: {
          // --- Zaktualizowana formuła z poprawnymi nazwami kolumn: SecondaryEN i TitleEN ---
          filterByFormula: `AND(LOWER({SecondaryEN}) = "${catParam}", LOWER({TitleEN}) = "${countryNameForAirtable.toLowerCase()}")`
          // --------------------------------------------------------
        }
      }
    );
    
    // --- NOWE LINIE DO DEBUGOWANIA ---
    console.log("[DEBUG] Categories API raw response records:", categoriesResp.data.records);
    // --------------------------------

    const categoryRecord = categoriesResp.data.records[0];

    if (!categoryRecord) {
      console.warn(`[WARN] No category record found for name: "${catParam}" in country: "${countryNameForAirtable}".`);
      return res.status(404).json({ error: `Category "${catParam}" not found in "${country}".` });
    }
    const categoryId = categoryRecord.id;
    
    // --- NOWA LINIA DO DEBUGOWANIA ---
    console.log("[DEBUG] Found category ID:", categoryId);
    // ---------------------------------

    // 2. Fetch all records from the MAIN table using the country-specific view
    let allRecords = [], offset = null;
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        {
          headers: { Authorization: `Bearer ${KEY}` },
          params: {
            offset,
            pageSize: 100,
            view: viewIdentifier
          }
        }
      );
      // --- LINIA DO DEBUGOWANIA: Wypisuje klucze i wartości pól ---
      if (r.data.records.length > 0) {
          console.log("[DEBUG] Fields of the first fetched record:", Object.keys(r.data.records[0].fields));
          console.log("[DEBUG] First record's raw fields data:", r.data.records[0].fields);
      } else {
          console.log("[DEBUG] No records were fetched from the main table using the linked record ID.");
      }
      // -----------------------------------------------------------
      allRecords.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    // If no records are found in the view, return 404
    if (allRecords.length === 0) {
      console.warn(`[WARN] No records found for view: "${viewIdentifier}" in main table.`);
      return res.status(404).json({ error: `No data found for the view "${viewIdentifier}". Please check the view name/ID in your Airtable base.` });
    }


    const catMap = await loadAllCategories();

    // 3. Lokalnie filtruj rekordy po kolumnie CategoryView
    const items = allRecords
      // --- Zaktualizowany filtr, aby sprawdzić "Title" i "CategoryView" ---
      .filter(r => {
        const titleExists = r.fields.Title && r.fields.Title.trim();
        const categoryViewValue = Array.isArray(r.fields.CategoryView) ? r.fields.CategoryView[0] : r.fields.CategoryView;
        return titleExists && (categoryViewValue && categoryViewValue.toLowerCase() === catParam);
      })
      .map(r => {
        const f = r.fields;
        let catName = null;
        const categorySelectIds = f.CategorySelect || [];
        if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
          const cf = catMap[categorySelectIds[0]];
          if (cf) {
            const key = lang === "EN" ? "Secondary" : `Secondary${lang}`;
            catName = cf[key] || cf["Secondary"] || null;
          }
        }
        return {
          id: r.id,
          meta: {
            // --- Zaktualizowane mapowanie, aby użyć "Title" jako głównego tytułu ---
            title: f.Title || f[`Title${lang}`] || f.TitleEN,
            description: f[`Description${lang}`] || f.DescriptionEN || "",
            category: catName,
            lastUpdate: f.UpdatedThere || "",
            nextUpdateTime: f.NextUpdateTime || ""
          }
        };
      });

    items.sort((a, b) => new Date(b.meta.lastUpdate) - new Date(a.meta.lastUpdate));

    res.json({ count: items.length, items });
  } catch (e) {
    console.error(`[ERROR] General error in /titlelist/:country/:category:`, e.toString());
    res.status(500).json({ error: e.toString() });
  }
});

// --- Endpoint: /titlelist/:country --- Zmienione na filtrowanie po View ID dla spójności!
app.get("/titlelist/:country", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey = `Description${lang}`;
  const countryParam = req.params.country.toLowerCase();

  // Użyj ID widoku dla "EU" i "Poland" dla niezawodności
  let viewIdentifier;
  if (countryParam === 'eu') {
    viewIdentifier = process.env.AIRTABLE_EU_VIEW_ID;
    if (!viewIdentifier) {
      console.error("[ERROR] AIRTABLE_EU_VIEW_ID not set in .env file.");
      return res.status(500).json({ error: "Configuration for 'EU' view is missing. Please check your .env file." });
    }
  } else if (countryParam === 'poland') {
    viewIdentifier = process.env.AIRTABLE_POLAND_VIEW_ID;
    if (!viewIdentifier) {
      console.error("[ERROR] AIRTABLE_POLAND_VIEW_ID not set in .env file.");
      return res.status(500).json({ error: "Configuration for 'Poland' view is missing. Please check your .env file." });
    }
  } else {
    // Fallback do używania nazwy widoku dla innych, nie-zdefiniowanych widoków
    viewIdentifier = countryParam.charAt(0).toUpperCase() + countryParam.slice(1);
  }

  try {
    const apiUrl = `https://api.airtable.com/v0/${BASE}/${MAIN}`;
    console.log(`[DEBUG] Making API call to: ${apiUrl}`);
    console.log(`[DEBUG] Using view identifier: "${viewIdentifier}"`);
    
    // 1. Fetch records from the specified Grid View
    let allRecords = [], offset = null;
    do {
      const r = await axios.get(
        apiUrl,
        {
          headers: { Authorization: `Bearer ${KEY}` },
          params: {
            offset,
            pageSize: 100,
            view: viewIdentifier
          }
        }
      );
      allRecords.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    // If no records are found in the view, return 404
    if (allRecords.length === 0) {
      console.warn(`[WARN] No records found for view: "${viewIdentifier}"`);
      return res.status(404).json({ error: `No data found for the view "${viewIdentifier}". Please check the view name/ID in your Airtable base.` });
    }

    const catMap = await loadAllCategories();

    const items = allRecords
      // --- Zaktualizowany filtr, aby sprawdzić "Title" ---
      .filter(r => r.fields.Title && r.fields.Title.trim())
      .map(r => {
        const f = r.fields;
        let catName = null;
        const categorySelectIds = f.CategorySelect || [];
        if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
          const cf = catMap[categorySelectIds[0]];
          if (cf) {
            const key = lang === "EN" ? "Secondary" : `Secondary${lang}`;
            catName = cf[key] || cf["Secondary"] || null;
          }
        }
        return {
          id: r.id,
          meta: {
            // --- Zaktualizowane mapowanie, aby użyć "Title" jako głównego tytułu ---
            title: f.Title || f[titleKey] || f.TitleEN,
            description: f[descKey] || f.DescriptionEN || "",
            category: catName,
            lastUpdate: f.UpdatedThere || "",
            nextUpdateTime: f.NextUpdateTime || ""
          }
        };
      });

    items.sort((a, b) => new Date(b.meta.lastUpdate) - new Date(a.meta.lastUpdate));

    res.json({ count: items.length, items });
  } catch (e) {
    console.error(`[ERROR] General error in /titlelist/:country:`, e.toString());
    res.status(500).json({ error: e.toString() });
  }
});

// --- Endpoint: /categories/:country
// Zaktualizowany, aby poprawnie mapować parametr URL na wartość w Airtable
app.get("/categories/:country", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const fieldKey = lang === "EN" ? "Secondary" : `Secondary${lang}`;
  const country = req.params.country;
  
  // --- Zmieniony blok: mapowanie parametru URL na wartość w Airtable ---
  let countryNameForAirtable;
  const lowerCaseCountry = country.toLowerCase();
  if (lowerCaseCountry === 'eu') {
      countryNameForAirtable = 'European Union';
  } else {
      countryNameForAirtable = lowerCaseCountry.charAt(0).toUpperCase() + lowerCaseCountry.slice(1);
  }
  // ----------------------------------------------------------------------

  try {
    let categories = [];
    let offset = null;
    
    // Fetch categories filtered by 'TitleEN'
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${CATS}`, {
          headers: {
            Authorization: `Bearer ${KEY}`
          },
          params: {
            offset,
            pageSize: 100,
            filterByFormula: `LOWER({TitleEN})="${countryNameForAirtable.toLowerCase()}"`
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

    res.json({
      count: categories.length,
      categories
    });
  } catch (e) {
    console.error(`[ERROR] General error in /categories/:country:`, e.toString());
    res.status(500).json({
      error: e.toString()
    });
  }
});

// --- Endpoint: /:country/:titleEN (najmniej szczegółowa trasa na samym końcu)
// Zaktualizowany, aby poprawnie mapować parametr URL na wartość w Airtable
app.get("/:country/:titleEN", async (req, res) => {
  const country = req.params.country;
  const titleEN = req.params.titleEN.toLowerCase();
  const lang = (req.query.lang || "EN").toUpperCase();
  const langSuffix = lang === "EN" ? "" : lang;

  const titleKey = `Title${langSuffix}`;
  const descriptionKey = `Description${langSuffix}`;
  const dataKey = `Data${langSuffix}`;

  // --- Zmieniony blok: mapowanie parametru URL na wartość w Airtable ---
  let countryNameForAirtable;
  const lowerCaseCountry = country.toLowerCase();
  if (lowerCaseCountry === 'eu') {
      countryNameForAirtable = 'European Union';
  } else {
      countryNameForAirtable = lowerCaseCountry.charAt(0).toUpperCase() + lowerCaseCountry.slice(1);
  }
  // ----------------------------------------------------------------------

  try {
    // 1. Find the category record ID for the country
    const categoriesResp = await axios.get(
      `https://api.airtable.com/v0/${BASE}/${CATS}`,
      {
        headers: { Authorization: `Bearer ${KEY}` },
        params: {
          filterByFormula: `LOWER({TitleEN}) = "${countryNameForAirtable.toLowerCase()}"`
        }
      }
    );
    const categoryRecord = categoriesResp.data.records[0];

    if (!categoryRecord) {
      console.warn(`[WARN] No category record found for country: "${countryNameForAirtable}"`);
      return res.status(404).json({ error: `Country "${country}" not found.` });
    }
    const categoryId = categoryRecord.id;

    // 2. Fetch the main record, filtering by both Title and the linked category ID
    const mainResp = await axios.get(
      `https://api.airtable.com/v0/${BASE}/${MAIN}`, {
        headers: {
          Authorization: `Bearer ${KEY}`
        },
        params: {
          // --- Zaktualizowana formuła z kolumną "Title" ---
          filterByFormula: `AND(LOWER({Title})="${titleEN}", FIND("${categoryId}", ARRAYJOIN({CategorySelect})))`
        }
      }
    );

    const record = mainResp.data.records[0];
    if (!record) {
      console.warn(`[WARN] No record found for title: "${titleEN}" in country: "${country}"`);
      return res.status(404).json({
        error: `No data for "${titleEN}" in "${country}"`
      });
    }

    const f = record.fields;

    const data = [];
    const headers = f[dataKey] || f.DataEN;
    if (f.Data && headers) {
      headNames = headers.split(";").map(s => s.trim());
      f.Data.split("\n").forEach(line => {
        const vals = line.split(";").map(s => s.trim());
        if (vals.length === headNames.length) {
          const row = {};
          headNames.forEach((h, i) => {
            const v = vals[i];
            row[h === "Year" ? "year" : h] = isNaN(v) ? v : parseFloat(v);
          });
          data.push(row);
        }
      });
    }
    
    const meta = {
      // --- Zaktualizowane mapowanie, aby użyć "Title" jako głównego tytułu ---
      title: f.Title || f[titleKey] || f.TitleEN || "",
      description: f[descriptionKey] || f.DescriptionEN || "",
      updateFrequency: f.UpdateFrequency || "",
      format: f[dataKey] || f.DataEN || "", 
      lastUpdate: f.UpdatedThere || "",
      nextUpdateTime: f.NextUpdateTime || "",
      researchName: "",
      researchPurpose: "",
      definitions: "",
      methodology: "",
      sourceName: "",
      unit: "",
      category: null
    };

    let metadataFields = {};
    const metadataIds = f.Metadata || [];
    if (Array.isArray(metadataIds) && metadataIds.length > 0) {
      const metadataId = metadataIds[0];
      try {
        const metaResp = await axios.get(
          `https://api.airtable.com/v0/${BASE}/${META}/${metadataId}`, {
            headers: {
              Authorization: `Bearer ${KEY}`
            }
          }
        );
        metadataFields = metaResp.data.fields;

        meta.researchName = metadataFields[`ResearchName${langSuffix}`] || metadataFields.ResearchNameEN || "";
        meta.researchPurpose = metadataFields[`ResearchPurpose${langSuffix}`] || metadataFields.ResearchPurposeEN || "";
        meta.definitions = metadataFields[`Definitions${langSuffix}`] || metadataFields.DefinitionsEN || "";
        meta.methodology = metadataFields[`Methodology${langSuffix}`] || metadataFields.MethodologyEN || "";
        meta.sourceName = metadataFields[`Source Name${langSuffix}`] || metadataFields["Source NameEN"] || "";
        meta.unit = metadataFields[`Unit${langSuffix}`] || metadataFields.UnitEN || "";

      } catch (e) {
        console.error(`[ERROR] Failed to fetch metadata for ID ${metadataId}:`, e.message);
      }
    }
    
    const catMap = await loadAllCategories();
    const categorySelectIds = f.CategorySelect || [];
    if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
      const catFields = catMap[categorySelectIds[0]];
      if (catFields) {
        const categoryKey = lang === "EN" ? "Secondary" : `Secondary${lang}`;
        meta.category = catFields[categoryKey] || catFields["Secondary"] || null;
      }
    }

    const translations = {};
    LANGUAGES.forEach(l => {
      ["Title", "Description", "Data", "AIComment"].forEach(prefix => {
        const key = `${prefix}${l}`;
        if (f[key]) translations[key] = f[key];
      });
      ["Definitions", "Source Name", "ResearchName", "ResearchPurpose"].forEach(prefix => {
          const key = `${prefix}${l}`;
          if (metadataFields[key]) translations[key] = metadataFields[key];
      });
    });

    res.json({
      meta,
      data,
      translations
    });
  } catch (e) {
    console.error("❌ General error:", e);
    res.status(500).json({
      error: e.toString()
    });
  }
});

app.listen(PORT, () => console.log(`API is running on port ${PORT}`));