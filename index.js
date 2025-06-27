require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

// --- Zmienne środowiskowe ---
const PORT = process.env.PORT || 3000;
const BASE = process.env.AIRTABLE_BASE_ID;
const MAIN = process.env.AIRTABLE_TABLE_NAME; // Nazwa tabeli głównej
const CATS = process.env.AIRTABLE_CATEGORIES_TABLE_NAME; // Nazwa tabeli z kategoriami
const KEY = process.env.AIRTABLE_API_KEY;
const META = process.env.AIRTABLE_METADATA_TABLE_NAME;
const PRIV = process.env.PRIVATE_API_KEY; // Klucz do prywatnych endpointów
const CONTENT_HUBS_TABLE = "Content hubs"; // Nazwa tabeli Content hubs

// Lista dwuliterowych kodów języków
const LANGUAGES = [
  "FR", "CZ", "SK", "IT", "CN", "JP", "SI", "LT", "LV", "FI",
  "UA", "PT", "VN", "DE", "NL", "TR", "EE", "RS", "HR", "ES",
  "PL", "HU", "GR", "RO", "BG", "EN"
];

// --- ZARZĄDZANIE CACHEM Z TTL (Time-To-Live) ---
let categoryMapCache = null;
let contentHubsCache = null;
let cacheLastLoaded = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 godzina (w milisekundach)

/**
 * Helper: Sprawdza, czy cache jest aktualny.
 */
function isCacheFresh() {
    return (Date.now() - cacheLastLoaded) < CACHE_TTL_MS;
}

/**
 * Helper: Fetches all categories into a map { id -> fields }.
 * Caches the result and refreshes it if it's stale.
 */
async function loadAllCategories() {
  if (categoryMapCache && isCacheFresh()) {
    return categoryMapCache;
  }

  console.log("[INFO] Cache stale or empty. Fetching all categories from Airtable...");
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
  cacheLastLoaded = Date.now();
  console.log(`[INFO] Loaded ${Object.keys(map).length} categories. Cache updated.`);
  return map;
}

/**
 * Helper: Fetches all content hubs and caches them in a map.
 * The map uses the primary field value (e.g., Polish title) as the key
 * to allow for fast lookups. Refreshes if cache is stale.
 */
async function loadAllContentHubs() {
    if (contentHubsCache && isCacheFresh()) {
        return contentHubsCache;
    }

    console.log("[INFO] Cache stale or empty. Fetching all content hubs from Airtable...");
    let map = {};
    let offset = null;
    do {
        try {
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(CONTENT_HUBS_TABLE)}`,
                {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: { offset, pageSize: 100 }
                }
            );
            r.data.records.forEach(rec => {
                // Używamy wartości z pola 'Title' (primary field, polski tytuł) jako klucza mapy.
                if (rec.fields.Title) {
                    map[rec.fields.Title] = rec.fields;
                }
            });
            offset = r.data.offset;
        } catch (error) {
            console.error("[ERROR] Failed to fetch content hubs from Airtable:", error.message);
            throw error;
        }
    } while (offset);

    contentHubsCache = map;
    cacheLastLoaded = Date.now(); // Aktualizujemy timestamp załadowania cache
    console.log(`[INFO] Loaded ${Object.keys(map).length} content hubs. Cache updated.`);
    return contentHubsCache;
}

// --- MIDDLEWARE (dla endpointów, które tego wymagają) ---
// Middleware do sprawdzania prywatnego klucza API
const requireApiKey = (req, res, next) => {
    if (req.headers["x-api-key"] !== PRIV) {
        return res.status(403).json({ error: "Forbidden: invalid API key" });
    }
    next();
};

/**
 * Helper: Converts country param to Airtable view name or ID for API requests.
 */
function getCountryViewId(countryParam) {
    const lowerCaseCountry = countryParam.toLowerCase();
    if (lowerCaseCountry === 'eu') {
        return process.env.AIRTABLE_EU_VIEW_ID || 'European Union';
    } else if (lowerCaseCountry === 'poland') {
        return process.env.AIRTABLE_POLAND_VIEW_ID || 'Poland';
    } else {
        return countryParam.charAt(0).toUpperCase() + countryParam.slice(1);
    }
}

/**
 * Helper: Converts country param to the country name for local filtering.
 */
function getCountryNameForFiltering(countryParam) {
    const lowerCaseCountry = countryParam.toLowerCase();
    if (lowerCaseCountry === 'eu') {
        return 'European Union';
    } else if (lowerCaseCountry === 'poland') {
        return 'Poland';
    } else {
        return countryParam.charAt(0).toUpperCase() + countryParam.slice(1);
    }
}

/**
 * Helper: Fetches content hub record ID from its TitleEN.
 */
async function getContentHubId(hubTitle) {
    if (!hubTitle) return null;
    try {
        const hubResp = await axios.get(
            `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(CONTENT_HUBS_TABLE)}`,
            {
                headers: { Authorization: `Bearer ${KEY}` },
                params: {
                    filterByFormula: `LOWER({TitleEN}) = "${hubTitle.toLowerCase()}"`
                }
            }
        );
        return hubResp.data.records[0]?.id || null;
    } catch (error) {
        console.error(`[ERROR] getContentHubId failed for "${hubTitle}":`, error.message);
        return null;
    }
}

/**
 * NOWA FUNKCJA POMOCNICZA: Znajduje ID kategorii na podstawie nazwy i kraju.
 * Wykorzystuje buforowane dane.
 */
async function getCategoryIdByName(categoryName, countryName) {
    const categoriesMap = await loadAllCategories();
    const normalizedCategoryName = categoryName.toLowerCase().trim();
    const normalizedCountryName = countryName.toLowerCase().trim();
    
    for (const id in categoriesMap) {
        const fields = categoriesMap[id];
        const secondaryEN = (Array.isArray(fields.SecondaryEN) ? fields.SecondaryEN[0] : fields.SecondaryEN) || '';
        const titleEN = (Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN) || '';

        if (secondaryEN.toLowerCase().trim() === normalizedCategoryName && titleEN.toLowerCase().trim() === normalizedCountryName) {
            return id;
        }
    }
    console.warn(`[WARN] getCategoryIdByName failed for category: "${categoryName}" and country: "${countryName}"`);
    return null;
}

// --- PUBLIC ENDPOINTS ---

// ZAKTUALIZOWANY ENDPOINT: Zwraca listę krajów na podstawie danych z bazy Airtable
app.get("/countries", async (req, res) => {
    try {
        const allCategories = await loadAllCategories();
        const countriesSet = new Set();

        for (const id in allCategories) {
            const fields = allCategories[id];
            // TitleEN to pole 'primary' w tabeli Categories, które trzyma nazwę kraju
            const countryName = Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN;
            if (countryName) {
                countriesSet.add(countryName);
            }
        }
        
        const countries = Array.from(countriesSet).sort();
        res.json({ count: countries.length, countries });

    } catch (e) {
        console.error(`[ERROR] General error in /countries:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


// NOWY ENDPOINT: Zwraca listę wszystkich rekordów, z opcjonalnym filtrowaniem globalnym.
app.get("/datasets", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const titleKey = `Title${lang}`;
    const descKey = `Description${lang}`;
    const country = req.query.country; // Opcjonalny filtr po kraju
    const category = req.query.category; // Opcjonalny filtr po kategorii
    const contentHub = req.query.contentHub; // Opcjonalny filtr po Content Hub

    try {
        // Budujemy dynamiczną formułę filtrującą na podstawie parametrów query
        let filterParts = [];
        let viewId = MAIN; // Domyślnie używamy nazwy tabeli, nie konkretnego widoku

        // Filtr po kraju
        if (country) {
            viewId = getCountryViewId(country); // Użycie widoku jest bardziej wydajne
        }

        // Filtr po kategorii
        if (category) {
            const countryForCatLookup = country ? getCountryNameForFiltering(country) : 'Poland'; // Domyślamy się, że bez kraju to Polska
            const categoryId = await getCategoryIdByName(category, countryForCatLookup);
            if (categoryId) {
                filterParts.push(`{CategorySelect} = "${categoryId}"`);
            } else {
                return res.status(404).json({ error: `Category "${category}" not found for country "${countryForCatLookup}".` });
            }
        }

        // Filtr po Content Hub
        if (contentHub) {
            const hubId = await getContentHubId(contentHub);
            if (hubId) {
                filterParts.push(`FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`);
            } else {
                return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
            }
        }
        
        const filterFormula = filterParts.length > 0 ? `AND(${filterParts.join(',')})` : '';

        // Pobierz rekordy z Airtable, używając widoku lub całej tabeli i formuły
        let allRecords = [], offset = null;
        do {
            const params = { pageSize: 100, offset };
            if (viewId !== MAIN) {
                params.view = viewId;
            }
            if (filterFormula) {
                params.filterByFormula = filterFormula;
            }
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);

        const catMap = await loadAllCategories();
        const items = allRecords
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
                    id: f.DataID || r.id,
                    meta: {
                        title: f[titleKey] || f.Title,
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
        console.error(`[ERROR] General error in /datasets:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


// NOWY ENDPOINT: Zwraca metadane rekordu po ID, bez danych numerycznych.
app.get("/data/:numericId/meta", async (req, res) => {
    const numericId = parseInt(req.params.numericId);
    
    if (isNaN(numericId)) {
        return res.status(400).json({ error: "Invalid ID. Please provide a numeric ID." });
    }

    const lang = (req.query.lang || "EN").toUpperCase();
    const langSuffix = lang;
    const titleKey = `Title${langSuffix}`;
    const descriptionKey = `Description${langSuffix}`;
    const aiCommentKey = `AIComment${langSuffix}`;

    try {
        const filterFormula = `{DataID} = ${numericId}`;
        
        const mainResp = await axios.get(
            `https://api.airtable.com/v0/${BASE}/${MAIN}`, {
                headers: { Authorization: `Bearer ${KEY}` },
                params: { filterByFormula: filterFormula }
            }
        );

        const record = mainResp.data.records[0];
        if (!record) {
            return res.status(404).json({ error: `No data for ID "${numericId}"` });
        }

        const f = record.fields;
        
        const meta = {
            title: f[titleKey] || f.Title || f.TitleEN || "",
            description: f[descriptionKey] || f.DescriptionEN || "",
            updateFrequency: f.UpdateFrequency || "",
            lastUpdate: f.UpdatedThere || "",
            nextUpdateTime: f.NextUpdateTime || ""
        };

        let metadataFields = {};
        const metadataIds = f.Metadata || [];
        if (Array.isArray(metadataIds) && metadataIds.length > 0) {
            const metadataId = metadataIds[0];
            try {
                const metaResp = await axios.get(
                    `https://api.airtable.com/v0/${BASE}/${META}/${metadataId}`, {
                        headers: { Authorization: `Bearer ${KEY}` }
                    }
                );
                metadataFields = metaResp.data.fields;
            } catch (e) {
                console.error(`[ERROR] Failed to fetch metadata for ID ${metadataId}:`, e.message);
            }
        }

        const catMap = await loadAllCategories();
        const categorySelectIds = f.CategorySelect || [];
        const contentHubValue = f['Content hub'];
        const aiCommentValue = f[aiCommentKey] || f.AICommentEN;

        if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
            const catFields = catMap[categorySelectIds[0]];
            if (catFields) {
                const categoryKey = lang === "EN" ? "Secondary" : `Secondary${lang}`;
                meta.category = catFields[categoryKey] || catFields["Secondary"] || null;
            }
        }
        
        if (contentHubValue && Array.isArray(contentHubValue) && contentHubValue.length > 0) {
            meta.contentHub = contentHubValue.join(', ');
        }
        
        if (aiCommentValue) {
            meta.aiComment = aiCommentValue;
        }

        const researchNameValue = metadataFields[`ResearchName${langSuffix}`] || metadataFields.ResearchNameEN;
        if (researchNameValue) meta.researchName = researchNameValue;
        
        const researchPurposeValue = metadataFields[`ResearchPurpose${langSuffix}`] || metadataFields.ResearchPurposeEN;
        if (researchPurposeValue) meta.researchPurpose = researchPurposeValue;
        
        const definitionsValue = metadataFields[`Definitions${langSuffix}`] || metadataFields.DefinitionsEN;
        if (definitionsValue) meta.definitions = definitionsValue;
        
        const methodologyValue = metadataFields[`Methodology${langSuffix}`] || metadataFields.MethodologyEN;
        if (methodologyValue) meta.methodology = methodologyValue;
        
        const sourceNameValue = metadataFields[`Source Name${langSuffix}`] || metadataFields["Source NameEN"];
        if (sourceNameValue) meta.sourceName = sourceNameValue;
        
        const unitValue = metadataFields[`Unit${langSuffix}`] || metadataFields.UnitEN;
        if (unitValue) meta.unit = unitValue;

        res.json({ meta });
    } catch (e) {
        console.error("❌ General error in /data/:numericId/meta:", e);
        res.status(500).json({ error: e.toString() });
    }
});

// NOWY ENDPOINT: Umożliwia ręczne odświeżenie cache'a (wymaga klucza API)
app.post("/cache/refresh", requireApiKey, (req, res) => {
    categoryMapCache = null;
    contentHubsCache = null;
    cacheLastLoaded = 0; // Resetujemy timestamp
    console.log("[INFO] Cache manually cleared.");
    res.json({ message: "Cache has been cleared and will be reloaded on the next data request." });
});


// --- ZAKTUALIZOWANE ENDPOINTY (poprawiona kolejność) ---

app.get("/dataset/by-hub/:hubTitle", async (req, res) => {
    const hubTitle = req.params.hubTitle;
    const lang = (req.query.lang || "EN").toUpperCase();
    const titleKey = `Title${lang}`;
    const descKey = `Description${lang}`;

    try {
        const hubResp = await axios.get(
            `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(CONTENT_HUBS_TABLE)}`,
            {
                headers: { Authorization: `Bearer ${KEY}` },
                params: {
                    filterByFormula: `LOWER({TitleEN}) = "${hubTitle.toLowerCase()}"`
                }
            }
        );

        const hubRecord = hubResp.data.records[0];

        if (!hubRecord || !hubRecord.fields.Charts || hubRecord.fields.Charts.length === 0) {
            return res.status(404).json({ error: `Content hub "${hubTitle}" not found or has no linked charts.` });
        }

        const chartRecordIds = hubRecord.fields.Charts;
        const filterFormula = `OR(${chartRecordIds.map(id => `RECORD_ID() = '${id}'`).join(',')})`;

        let allRecords = [], offset = null;
        do {
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: { offset, pageSize: 100, filterByFormula: filterFormula }
                }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);

        const catMap = await loadAllCategories();
        const items = allRecords
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
                    id: f.DataID || r.id,
                    meta: {
                        title: f[titleKey] || f.Title,
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
        console.error(`[ERROR] General error in /dataset/by-hub/:hubTitle:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});

// ZAKTUALIZOWANY ENDPOINT: /dataset/:country/:category/news (PRZESUNIĘTY W GÓRĘ)
// Zwraca komentarze AI z rekordów dla danego kraju i kategorii.
// POWRÓT DO LOKALNEGO FILTROWANIA PO "CategoryView", ABY ZACHOWAĆ POPRZEDNIE DZIAŁANIE
app.get("/dataset/:country/:category/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const catParam = req.params.category.toLowerCase();
    const country = req.params.country;
    const contentHub = req.query.contentHub;
    const aiCommentKey = `AIComment${lang}`;
    const viewIdentifier = getCountryViewId(country);
    
    try {
        let allRecords = [], offset = null;
        do {
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: { offset, pageSize: 100, view: viewIdentifier }
                }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);

        // LOKALNIE filtruj rekordy po kolumnie CategoryView i Content hub (jeśli podany)
        const comments = allRecords
            .filter(r => {
                const titleExists = r.fields.Title && r.fields.Title.trim();
                const categoryViewValue = Array.isArray(r.fields.CategoryView) ? r.fields.CategoryView[0] : r.fields.CategoryView;
                const matchesCategory = titleExists && (categoryViewValue && categoryViewValue.toLowerCase().trim() === catParam.trim());

                let matchesHub = true;
                if (contentHub) {
                    const hubValues = r.fields['Content hub'];
                    matchesHub = Array.isArray(hubValues) && hubValues.some(h => h.toLowerCase().trim() === contentHub.toLowerCase().trim());
                }

                return matchesCategory && matchesHub;
            })
            .map(r => r.fields[aiCommentKey] || r.fields['AICommentEN'])
            .filter(comment => comment && comment.trim());

        res.json({ count: comments.length, comments });

    } catch (e) {
        console.error(`[ERROR] General error in /dataset/:country/:category/news:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


// ZAKTUALIZOWANY ENDPOINT: /dataset/:country/:contenthub/news (PRZESUNIĘTY W DÓŁ)
// Zwraca komentarze AI, filtrując po kraju i Content hub
app.get("/dataset/:country/:contenthub/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const country = req.params.country;
    const contentHub = req.params.contenthub;
    const aiCommentKey = `AIComment${lang}`;
    const viewIdentifier = getCountryViewId(country);

    try {
        const hubId = await getContentHubId(contentHub);
        if (!hubId) {
            return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
        }

        const filterFormula = `FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`; // Poprawna deklaracja
        
        let allRecords = [], offset = null;
        do {
            const params = { pageSize: 100, view: viewIdentifier, offset };
            // Poprawka: Dodajemy filterByFormula do params tylko jeśli jest niepuste
            if (filterFormula) {
                params.filterByFormula = filterFormula;
            }
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params: params }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);
        
        const comments = allRecords
            .map(r => r.fields[aiCommentKey] || r.fields['AICommentEN'])
            .filter(comment => comment && comment.trim());
            
        res.json({ count: comments.length, comments });

    } catch (e) {
        console.error(`[ERROR] General error in /dataset/:country/:contenthub/news:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});

app.get("/dataset/:country/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const country = req.params.country;
    const contentHub = req.query.contentHub;
    const aiCommentKey = `AIComment${lang}`;
    const viewIdentifier = getCountryViewId(country);

    try {
        let filterFormula = '';
        if (contentHub) {
            const hubId = await getContentHubId(contentHub);
            if (hubId) {
                filterFormula = `FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`;
            } else {
                return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
            }
        }

        let allRecords = [], offset = null;
        do {
            const params = { pageSize: 100, view: viewIdentifier, offset };
            if (filterFormula) {
                params.filterByFormula = filterFormula;
            }
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);

        const comments = allRecords
            .map(r => r.fields[aiCommentKey] || r.fields['AICommentEN'])
            .filter(comment => comment && comment.trim());

        res.json({ count: comments.length, comments });

    } catch (e) {
        console.error(`[ERROR] General error in /dataset/:country/news:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


// ZAKTUALIZOWANY: POWRÓT DO LOKALNEGO FILTROWANIA PO "CategoryView"!
app.get("/dataset/:country/:category", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey = `Description${lang}`;
  const catParam = req.params.category.toLowerCase();
  const country = req.params.country;
  const contentHub = req.query.contentHub;
  
  const viewIdentifier = getCountryViewId(country);

  try {
    let allRecords = [], offset = null;
    do {
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        { headers: { Authorization: `Bearer ${KEY}` }, params: { offset, pageSize: 100, view: viewIdentifier } }
      );
      allRecords.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    if (allRecords.length === 0) {
      return res.status(404).json({ error: `No data found for the view "${viewIdentifier}". Please check the view name/ID in your Airtable base.` });
    }

    const catMap = await loadAllCategories();

    // LOKALNE FILTROWANIE po kolumnie CategoryView (Lookup field)
    const items = allRecords
      .filter(r => {
        const titleExists = r.fields.Title && r.fields.Title.trim();
        const categoryViewValue = Array.isArray(r.fields.CategoryView) ? r.fields.CategoryView[0] : r.fields.CategoryView;
        const matchesCategory = titleExists && (categoryViewValue && categoryViewValue.toLowerCase().trim() === catParam.trim());

        let matchesHub = true;
        if (contentHub) {
            const hubValues = r.fields['Content hub'];
            matchesHub = Array.isArray(hubValues) && hubValues.some(h => h.toLowerCase().trim() === contentHub.toLowerCase().trim());
        }

        return matchesCategory && matchesHub;
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
          id: f.DataID || r.id,
          meta: {
            title: f[titleKey] || f.Title,
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
    console.error(`[ERROR] General error in /dataset/:country/:category:`, e.toString());
    res.status(500).json({ error: e.toString() });
  }
});


app.get("/dataset/:country", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey = `Description${lang}`;
  const countryParam = req.params.country.toLowerCase();
  const contentHub = req.query.contentHub;

  const viewIdentifier = getCountryViewId(countryParam);

  try {
    let filterFormula = '';
    if (contentHub) {
        const hubId = await getContentHubId(contentHub);
        if (hubId) {
            filterFormula = `FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`;
        } else {
            return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
        }
    }
      
    let allRecords = [], offset = null;
    do {
      const params = { pageSize: 100, view: viewIdentifier, offset };
      if (filterFormula) {
          params.filterByFormula = filterFormula;
      }
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        { headers: { Authorization: `Bearer ${KEY}` }, params }
      );
      allRecords.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    if (allRecords.length === 0) {
      return res.status(404).json({ error: `No data found for the view "${viewIdentifier}". Please check the view name/ID in your Airtable base.` });
    }

    const catMap = await loadAllCategories();

    const items = allRecords
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
          id: f.DataID || r.id,
          meta: {
            title: f[titleKey] || f.Title,
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
    console.error(`[ERROR] General error in /dataset/:country:`, e.toString());
    res.status(500).json({ error: e.toString() });
  }
});


app.get("/categories/:country", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const fieldKey = lang === "EN" ? "Secondary" : `Secondary${lang}`;
  const country = req.params.country;
  
  const countryNameForFiltering = getCountryNameForFiltering(country);

  try {
    const allCategories = await loadAllCategories();

    const categories = Object.values(allCategories)
      .filter(recFields => {
        const titleEN = Array.isArray(recFields.TitleEN) ? recFields.TitleEN[0] : recFields.TitleEN;
        return titleEN && titleEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim();
      })
      .map(recFields => recFields[fieldKey] || recFields["Secondary"])
      .filter(name => name);

    const uniqueCategories = Array.from(new Set(categories)).sort();

    res.json({ count: uniqueCategories.length, categories: uniqueCategories });
  } catch (e) {
    console.error(`[ERROR] General error in /categories/:country:`, e.toString());
    res.status(500).json({ error: e.toString() });
  }
});


app.get("/contenthubs/:country", async (req, res) => {
    const countryParam = req.params.country;
    const lang = (req.query.lang || "EN").toUpperCase();
    const viewIdentifier = getCountryViewId(countryParam);
    const titleKey = `Title${lang}`;

    try {
        const hubTranslationsMap = await loadAllContentHubs();

        let allRecords = [], offset = null;
        do {
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: { offset, pageSize: 100, view: viewIdentifier }
                }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);

        const hubs = new Set();
        allRecords.forEach(record => {
            const linkedHubTitles = record.fields['Content hub']; 
            if (Array.isArray(linkedHubTitles)) {
                linkedHubTitles.forEach(primaryTitle => {
                    const translatedHubFields = hubTranslationsMap[primaryTitle];
                    if (translatedHubFields) {
                        const translatedTitle = translatedHubFields[titleKey] || translatedHubFields.TitleEN;
                        if (translatedTitle) {
                            hubs.add(translatedTitle);
                        }
                    }
                });
            }
        });

        const sortedHubs = Array.from(hubs).sort();

        res.json({ count: sortedHubs.length, hubs: sortedHubs });
    } catch (e) {
        console.error(`[ERROR] General error in /contenthubs/:country:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


app.get("/data/:numericId", async (req, res) => {
  const numericId = parseInt(req.params.numericId);
  
  if (isNaN(numericId)) {
      console.warn(`[WARN] Invalid numeric ID provided: ${req.params.numericId}`);
      return res.status(400).json({ error: "Invalid ID. Please provide a numeric ID." });
  }

  const lang = (req.query.lang || "EN").toUpperCase();
  const langSuffix = lang;

  const titleKey = `Title${langSuffix}`;
  const descriptionKey = `Description${langSuffix}`;
  const dataKey = `Data${langSuffix}`;
  const aiCommentKey = `AIComment${langSuffix}`;

  try {
    const filterFormula = `{DataID} = ${numericId}`;
    
    const mainResp = await axios.get(
      `https://api.airtable.com/v0/${BASE}/${MAIN}`, {
        headers: { Authorization: `Bearer ${KEY}` },
        params: { filterByFormula: filterFormula }
      }
    );

    const record = mainResp.data.records[0];
    if (!record) {
      console.warn(`[WARN] No record found for DataID: ${numericId}`);
      return res.status(404).json({ error: `No data for ID "${numericId}"` });
    }

    const f = record.fields;
    
    const meta = {
      title: f[titleKey] || f.Title || f.TitleEN || "",
      description: f[descriptionKey] || f.DescriptionEN || "",
      updateFrequency: f.UpdateFrequency || "",
      lastUpdate: f.UpdatedThere || "",
      nextUpdateTime: f.NextUpdateTime || ""
    };

    let metadataFields = {};
    const metadataIds = f.Metadata || [];
    if (Array.isArray(metadataIds) && metadataIds.length > 0) {
      const metadataId = metadataIds[0];
      try {
        const metaResp = await axios.get(
          `https://api.airtable.com/v0/${BASE}/${META}/${metadataId}`, {
            headers: { Authorization: `Bearer ${KEY}` }
          }
        );
        metadataFields = metaResp.data.fields;
      } catch (e) {
        console.error(`[ERROR] Failed to fetch metadata for ID ${metadataId}:`, e.message);
      }
    }

    const catMap = await loadAllCategories();
    const categorySelectIds = f.CategorySelect || [];
    const contentHubValue = f['Content hub'];
    const aiCommentValue = f[aiCommentKey] || f.AICommentEN;

    if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
      const catFields = catMap[categorySelectIds[0]];
      if (catFields) {
        const categoryKey = lang === "EN" ? "Secondary" : `Secondary${lang}`;
        meta.category = catFields[categoryKey] || catFields["Secondary"] || null;
      }
    }
    
    if (contentHubValue && Array.isArray(contentHubValue) && contentHubValue.length > 0) {
        meta.contentHub = contentHubValue.join(', ');
    }
    
    if (aiCommentValue) {
        meta.aiComment = aiCommentValue;
    }

    const researchNameValue = metadataFields[`ResearchName${langSuffix}`] || metadataFields.ResearchNameEN;
    if (researchNameValue) meta.researchName = researchNameValue;
    
    const researchPurposeValue = metadataFields[`ResearchPurpose${langSuffix}`] || metadataFields.ResearchPurposeEN;
    if (researchPurposeValue) meta.researchPurpose = researchPurposeValue;
    
    const definitionsValue = metadataFields[`Definitions${langSuffix}`] || metadataFields.DefinitionsEN;
    if (definitionsValue) meta.definitions = definitionsValue;
    
    const methodologyValue = metadataFields[`Methodology${langSuffix}`] || metadataFields.MethodologyEN;
    if (methodologyValue) meta.methodology = methodologyValue;
    
    const sourceNameValue = metadataFields[`Source Name${langSuffix}`] || metadataFields["Source NameEN"];
    if (sourceNameValue) meta.sourceName = sourceNameValue;
    
    const unitValue = metadataFields[`Unit${langSuffix}`] || metadataFields.UnitEN;
    if (unitValue) meta.unit = unitValue;
    
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

    const translations = {};
    LANGUAGES.forEach(l => {
      ["Title", "Description", "Data", "AIComment"].forEach(prefix => {
        const key = `${prefix}${l}`;
        if (f[key]) translations[key] = f[key];
      });
      ["Definitions", "Source Name", "ResearchName", "ResearchPurpose", "Unit"].forEach(prefix => {
          const key = `${prefix}${l}`;
          if (metadataFields[key]) translations[key] = metadataFields[key];
      });
    });

    res.json({ meta, data, translations });
  } catch (e) {
    console.error("❌ General error:", e);
    res.status(500).json({ error: e.toString() });
  }
});

app.listen(PORT, () => console.log(`API is running on port ${PORT}`));