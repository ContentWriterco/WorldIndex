require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

// --- Zmienne środowiskowe ---
const PORT = process.env.PORT || 3000;
const BASE = process.env.AIRTABLE_BASE_ID;
const MAIN = process.env.AIRTABLE_TABLE_NAME; // Nazwa tabeli głównej (np. Poland)
const CATS = process.env.AIRTABLE_CATEGORIES_TABLE_NAME; // Nazwa tabeli z kategoriami
const KEY = process.env.AIRTABLE_API_KEY;
const META = process.env.AIRTABLE_METADATA_TABLE_NAME;
const PRIV = process.env.PRIVATE_API_KEY; // Klucz do prywatnych endpointów
const CONTENT_HUBS_TABLE = "Content hubs"; // Nazwa tabeli Content hubs
const COMMENT_TABLE = "Comment"; // NOWE: Nazwa tabeli z komentarzami

// Lista dwuliterowych kodów języków
const LANGUAGES = [
  "FR", "CZ", "SK", "IT", "CN", "JP", "SI", "LT", "LV", "FI",
  "UA", "PT", "VN", "DE", "NL", "TR", "EE", "RS", "HR", "ES",
  "PL", "HU", "GR", "RO", "BG", "EN"
];

// --- ZARZĄDZANIE CACHEM Z TTL (Time-To-Live) ---
let categoryMapCache = null;
let contentHubsCache = null;
let commentMapCache = null; // NOWE: Cache dla komentarzy
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
    console.log("[CACHE HIT] Categories cache is fresh.");
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
        console.log("[CACHE HIT] Content Hubs cache is fresh.");
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
                if (rec.fields.Title) { // Używamy wartości z pola 'Title' (primary field) jako klucza mapy.
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

/**
 * NOWA FUNKCJA POMOCNICZA: Fetches all comments into a map { id -> fields }.
 * Caches the result and refreshes it if it's stale.
 */
async function loadAllComments() {
    if (commentMapCache && isCacheFresh()) {
        console.log("[CACHE HIT] Comments cache is fresh.");
        return commentMapCache;
    }

    console.log("[INFO] Cache stale or empty. Fetching all comments from Airtable...");
    let map = {};
    let offset = null;
    do {
        try {
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${COMMENT_TABLE}`,
                {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: { offset, pageSize: 100 }
                }
            );
            console.log(`[DEBUG:loadAllComments] Fetched ${r.data.records.length} records from ${COMMENT_TABLE}.`);
            r.data.records.forEach(rec => {
                map[rec.id] = rec.fields;
            });
            offset = r.data.offset;
        } catch (error) {
            console.error(`[ERROR] Failed to fetch comments from Airtable table '${COMMENT_TABLE}':`, error.message);
            throw error;
        }
    } while (offset);

    commentMapCache = map;
    cacheLastLoaded = Date.now();
    console.log(`[INFO] Loaded ${Object.keys(map).length} comments. Cache updated.`);
    return commentMapCache;
}


// --- MIDDLEWARE (dla endpointów, które tego wymagają) ---
// Middleware do sprawdzania prywatnego klucza API
const requireApiKey = (req, res, next) => {
    if (req.headers["x-api-key"] !== PRIV) {
        console.warn(`[WARN] Unauthorized access attempt from IP: ${req.ip}`);
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
        const viewId = process.env.AIRTABLE_EU_VIEW_ID || 'European Union';
        console.log(`[DEBUG:getCountryViewId] Mapping 'eu' to view: '${viewId}'`);
        return viewId;
    } else if (lowerCaseCountry === 'poland') {
        const viewId = process.env.AIRTABLE_POLAND_VIEW_ID || 'Poland';
        console.log(`[DEBUG:getCountryViewId] Mapping 'poland' to view: '${viewId}'`);
        return viewId;
    } else {
        const viewId = countryParam.charAt(0).toUpperCase() + countryParam.slice(1);
        console.log(`[DEBUG:getCountryViewId] Mapping '${countryParam}' to view: '${viewId}'`);
        return viewId;
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
    const allContentHubs = await loadAllContentHubs();
    for (const hubKey in allContentHubs) {
        // Sprawdzamy zarówno TitleEN jak i polski Title (primary field) dla dopasowania
        if (allContentHubs[hubKey].TitleEN && allContentHubs[hubKey].TitleEN.toLowerCase() === hubTitle.toLowerCase()) {
            console.log(`[DEBUG:getContentHubId] Found hub ID for TitleEN '${hubTitle}': ${allContentHubs[hubKey].id}`);
            return allContentHubs[hubKey].id;
        }
        if (allContentHubs[hubKey].Title && allContentHubs[hubKey].Title.toLowerCase() === hubTitle.toLowerCase()) {
            console.log(`[DEBUG:getContentHubId] Found hub ID for Title (PL) '${hubTitle}': ${allContentHubs[hubKey].id}`);
            return allContentHubs[hubKey].id;
        }
    }
    console.warn(`[WARN] getContentHubId failed for "${hubTitle}": Hub not found in cache.`);
    return null;
}


/**
 * Znajduje ID kategorii na podstawie nazwy i kraju.
 * Wykorzystuje buforowane dane.
 */
async function getCategoryIdByName(categoryName, countryName) {
    const categoriesMap = await loadAllCategories();
    const normalizedCategoryName = categoryName.toLowerCase().trim();
    const normalizedCountryName = countryName.toLowerCase().trim();
    
    console.log(`[DEBUG:getCategoryIdByName] Looking for category '${normalizedCategoryName}' in country '${normalizedCountryName}'.`);

    for (const id in categoriesMap) {
        const fields = categoriesMap[id];
        // Używamy SecondaryEN jako nazwy kategorii i TitleEN jako nazwy kraju
        const secondaryEN = (Array.isArray(fields.SecondaryEN) ? fields.SecondaryEN[0] : fields.SecondaryEN) || '';
        const titleEN = (Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN) || '';

        if (secondaryEN.toLowerCase().trim() === normalizedCategoryName && titleEN.toLowerCase().trim() === normalizedCountryName) {
            console.log(`[DEBUG:getCategoryIdByName] Found category ID: ${id} for '${categoryName}' in '${countryName}'.`);
            return id;
        }
    }
    console.warn(`[WARN] getCategoryIdByName failed for category: "${categoryName}" and country: "${countryName}". No matching category found.`);
    return null;
}

// --- PUBLIC ENDPOINTS ---

app.get("/countries", async (req, res) => {
    console.log(`[ENDPOINT] /countries requested.`);
    try {
        const allCategories = await loadAllCategories();
        const countriesSet = new Set();

        for (const id in allCategories) {
            const fields = allCategories[id];
            const countryName = Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN;
            if (countryName) {
                countriesSet.add(countryName);
            }
        }
        
        const countries = Array.from(countriesSet).sort();
        console.log(`[ENDPOINT] /countries returning ${countries.length} countries.`);
        res.json({ count: countries.length, countries });

    } catch (e) {
        console.error(`[ERROR] General error in /countries:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


app.get("/datasets", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const titleKey = `Title${lang}`;
    const descKey = `Description${lang}`;
    const country = req.query.country;
    const category = req.query.category;
    const contentHub = req.query.contentHub;

    console.log(`[ENDPOINT] /datasets requested. Lang: ${lang}, Country: ${country}, Category: ${category}, ContentHub: ${contentHub}`);

    try {
        let filterParts = [];
        let viewId = MAIN;

        if (country) {
            viewId = getCountryViewId(country);
            console.log(`[DEBUG:/datasets] Using view: ${viewId}`);
        }

        if (category) {
            const countryForCatLookup = country ? getCountryNameForFiltering(country) : 'Poland';
            const categoryId = await getCategoryIdByName(category, countryForCatLookup);
            if (categoryId) {
                filterParts.push(`{CategorySelect} = "${categoryId}"`);
                console.log(`[DEBUG:/datasets] Added category filter: CategorySelect = "${categoryId}"`);
            } else {
                console.warn(`[WARN] Category "${category}" not found for country "${countryForCatLookup}". Returning 404.`);
                return res.status(404).json({ error: `Category "${category}" not found for country "${countryForCatLookup}".` });
            }
        }

        if (contentHub) {
            const hubId = await getContentHubId(contentHub);
            if (hubId) {
                filterParts.push(`FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`);
                console.log(`[DEBUG:/datasets] Added content hub filter: FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`);
            } else {
                console.warn(`[WARN] Content hub "${contentHub}" not found. Returning 404.`);
                return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
            }
        }
        
        const filterFormula = filterParts.length > 0 ? `AND(${filterParts.join(',')})` : '';
        console.log(`[DEBUG:/datasets] Final filter formula: ${filterFormula}`);

        let allRecords = [], offset = null;
        do {
            const params = { pageSize: 100, offset };
            if (viewId !== MAIN) {
                params.view = viewId;
            }
            if (filterFormula) {
                params.filterByFormula = filterFormula;
            }
            console.log(`[DEBUG:/datasets] Fetching records from Airtable with params: ${JSON.stringify(params)}`);
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
            console.log(`[DEBUG:/datasets] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
        } while (offset);

        if (allRecords.length === 0) {
            console.warn(`[WARN] No records found for the given criteria in /datasets.`);
        }

        const catMap = await loadAllCategories();
        const items = allRecords
            .filter(r => {
                const isValidTitle = r.fields.Title && r.fields.Title.trim();
                if (!isValidTitle) {
                    console.log(`[DEBUG:/datasets] Filtering out record ${r.id} due to empty title.`);
                }
                return isValidTitle;
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
        
        console.log(`[ENDPOINT] /datasets returning ${items.length} items.`);
        res.json({ count: items.length, items });

    } catch (e) {
        console.error(`[ERROR] General error in /datasets:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


app.get("/data/:numericId/meta", async (req, res) => {
    const numericId = parseInt(req.params.numericId);
    console.log(`[ENDPOINT] /data/${numericId}/meta requested.`);
    
    if (isNaN(numericId)) {
        console.warn(`[WARN] Invalid numeric ID provided: ${req.params.numericId}`);
        return res.status(400).json({ error: "Invalid ID. Please provide a numeric ID." });
    }

    const lang = (req.query.lang || "EN").toUpperCase();
    const langSuffix = lang;
    const titleKey = `Title${langSuffix}`;
    const descriptionKey = `Description${langSuffix}`;
    const aiCommentKey = `AIComment${langSuffix}`;

    try {
        const filterFormula = `{DataID} = ${numericId}`;
        console.log(`[DEBUG:/data/:id/meta] Fetching main record with filter: ${filterFormula}`);
        
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
        console.log(`[DEBUG:/data/:id/meta] Found main record: ${record.id}`);

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
            console.log(`[DEBUG:/data/:id/meta] Fetching metadata for ID: ${metadataId}`);
            try {
                const metaResp = await axios.get(
                    `https://api.airtable.com/v0/${BASE}/${META}/${metadataId}`, {
                        headers: { Authorization: `Bearer ${KEY}` }
                    }
                );
                metadataFields = metaResp.data.fields;
                console.log(`[DEBUG:/data/:id/meta] Metadata fetched successfully.`);
            } catch (e) {
                console.error(`[ERROR] Failed to fetch metadata for ID ${metadataId}:`, e.message);
            }
        }

        const catMap = await loadAllCategories();
        const allComments = await loadAllComments(); // Wczytaj wszystkie komentarze
        const categorySelectIds = f.CategorySelect || [];
        const contentHubValue = f['Content hub'];
        
        // --- KLUCZOWE MIEJSCE DO DEBUGOWANIA KOMENTARZY ---
        let aiCommentValue = null;
        // Odczytujemy pole "Comment", które zawiera linked record IDs
        const linkedCommentRecordIds = f.Comment; 
        console.log(`[DEBUG:/data/:id/meta] Raw value of 'Comment' field from main record:`, linkedCommentRecordIds);

        if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
            const commentRecordId = linkedCommentRecordIds[0]; // Bierzemy pierwszy ID
            const commentFields = allComments[commentRecordId]; // Pobierz z cache'u
            if (commentFields) {
                aiCommentValue = commentFields[aiCommentKey] || commentFields.AICommentEN;
                console.log(`[DEBUG:/data/:id/meta] Found comment in cache for ID ${commentRecordId}. Content preview: "${String(aiCommentValue).substring(0, 50)}..."`);
            } else {
                console.warn(`[WARN] Comment with ID ${commentRecordId} not found in commentMapCache.`);
            }
        } else {
            console.log(`[DEBUG:/data/:id/meta] No linked Comment record IDs found in main record's 'Comment' field.`);
        }
        // --- KONIEC KLUCZOWEGO MIEJSCA ---

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
        console.log(`[ENDPOINT] /data/${numericId}/meta response sent.`);
    } catch (e) {
        console.error(`[ERROR] General error in /data/:numericId/meta for ID ${numericId}:`, e);
        res.status(500).json({ error: e.toString() });
    }
});

app.post("/cache/refresh", requireApiKey, (req, res) => {
    console.log("[ENDPOINT] /cache/refresh requested.");
    categoryMapCache = null;
    contentHubsCache = null;
    commentMapCache = null; // Resetuj cache komentarzy
    cacheLastLoaded = 0; // Resetujemy timestamp
    console.log("[INFO] All caches manually cleared.");
    res.json({ message: "Cache has been cleared and will be reloaded on the next data request." });
});


app.get("/dataset/by-hub/:hubTitle", async (req, res) => {
    const hubTitle = req.params.hubTitle;
    const lang = (req.query.lang || "EN").toUpperCase();
    const titleKey = `Title${lang}`;
    const descKey = `Description${lang}`;
    console.log(`[ENDPOINT] /dataset/by-hub/${hubTitle} requested. Lang: ${lang}`);

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
            console.warn(`[WARN] Content hub "${hubTitle}" not found or has no linked charts. Returning 404.`);
            return res.status(404).json({ error: `Content hub "${hubTitle}" not found or has no linked charts.` });
        }

        const chartRecordIds = hubRecord.fields.Charts;
        const filterFormula = `OR(${chartRecordIds.map(id => `RECORD_ID() = '${id}'`).join(',')})`;
        console.log(`[DEBUG:/dataset/by-hub] Filter formula for charts: ${filterFormula}`);

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
            console.log(`[DEBUG:/dataset/by-hub] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
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
        
        console.log(`[ENDPOINT] /dataset/by-hub/${hubTitle} returning ${items.length} items.`);
        res.json({ count: items.length, items });

    } catch (e) {
        console.error(`[ERROR] General error in /dataset/by-hub/:hubTitle:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});

// ZAKTUALIZOWANY ENDPOINT: /dataset/:country/:category/news
// Zwraca komentarze AI z rekordów dla danego kraju i kategorii,
// pobierając komentarze z tabeli "Comment" poprzez cache.
app.get("/dataset/:country/:category/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const catParam = req.params.category.toLowerCase();
    const country = req.params.country;
    const contentHub = req.query.contentHub;
    const aiCommentKey = `AIComment${lang}`;
    const viewIdentifier = getCountryViewId(country);
    
    console.log(`[ENDPOINT] /dataset/${country}/${catParam}/news requested. Lang: ${lang}, ContentHub: ${contentHub}`);

    try {
        let allRecords = [], offset = null;
        do {
            console.log(`[DEBUG:/news:cat] Fetching records from Airtable view '${viewIdentifier}' with offset: ${offset}`);
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: { offset, pageSize: 100, view: viewIdentifier }
                }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
            console.log(`[DEBUG:/news:cat] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
        } while (offset);

        if (allRecords.length === 0) {
            console.warn(`[WARN] No main records found for country '${country}' in view '${viewIdentifier}'.`);
            return res.json({ count: 0, comments: [] }); // Zwróć pustą tablicę, jeśli nie ma rekordów głównych
        }

        const allComments = await loadAllComments(); // Wczytaj wszystkie komentarze

        const comments = allRecords
            .filter(r => {
                const titleExists = r.fields.Title && r.fields.Title.trim();
                const categoryViewValue = Array.isArray(r.fields.CategoryView) ? r.fields.CategoryView[0] : r.fields.CategoryView;
                const matchesCategory = titleExists && (categoryViewValue && categoryViewValue.toLowerCase().trim() === catParam.trim());
                
                console.log(`[DEBUG:/news:cat] Filtering record ${r.id}. Title exists: ${!!titleExists}, CategoryView: '${categoryViewValue}', Matches category '${catParam}': ${matchesCategory}`);

                let matchesHub = true;
                if (contentHub) {
                    const hubValues = r.fields['Content hub'];
                    matchesHub = Array.isArray(hubValues) && hubValues.some(h => h.toLowerCase().trim() === contentHub.toLowerCase().trim());
                    console.log(`[DEBUG:/news:cat] Content Hub filtering for record ${r.id}. Hub values: ${hubValues}, Matches content hub '${contentHub}': ${matchesHub}`);
                }

                return matchesCategory && matchesHub;
            })
            .map(r => {
                // --- KLUCZOWE MIEJSCE DO DEBUGOWANIA KOMENTARZY ---
                // Odczytujemy pole "Comment", które zawiera linked record IDs
                const linkedCommentRecordIds = r.fields.Comment;
                console.log(`[DEBUG:/news:cat] Processing record ${r.id}. Raw value of 'Comment' field:`, linkedCommentRecordIds);

                if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
                    const commentRecordId = linkedCommentRecordIds[0]; // Bierzemy pierwszy ID
                    const commentFields = allComments[commentRecordId]; // Pobierz z cache'u
                    if (commentFields) {
                        const commentText = commentFields[aiCommentKey] || commentFields.AICommentEN;
                        console.log(`[DEBUG:/news:cat] Found comment for ID ${commentRecordId}. Text: "${String(commentText).substring(0, 50)}..."`);
                        return commentText;
                    } else {
                        console.warn(`[WARN] Comment with ID ${commentRecordId} not found in commentMapCache for record ${r.id}.`);
                    }
                } else {
                    console.log(`[DEBUG:/news:cat] No linked Comment record IDs found in record ${r.id}.`);
                }
                return null;
            })
            .filter(comment => {
                const isValid = comment && comment.trim();
                if (!isValid) {
                    console.log(`[DEBUG:/news:cat] Filtering out empty or null comment.`);
                }
                return isValid;
            });

        console.log(`[ENDPOINT] /dataset/${country}/${catParam}/news returning ${comments.length} comments.`);
        res.json({ count: comments.length, comments });

    } catch (e) {
        console.error(`[ERROR] General error in /dataset/:country/:category/news:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


// ZAKTUALIZOWANY ENDPOINT: /dataset/:country/:contenthub/news
// Zwraca komentarze AI, filtrując po kraju i Content hub
app.get("/dataset/:country/:contenthub/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const country = req.params.country;
    const contentHub = req.params.contenthub;
    const aiCommentKey = `AIComment${lang}`;
    const viewIdentifier = getCountryViewId(country);

    console.log(`[ENDPOINT] /dataset/${country}/${contentHub}/news requested. Lang: ${lang}`);

    try {
        const hubId = await getContentHubId(contentHub);
        if (!hubId) {
            console.warn(`[WARN] Content hub "${contentHub}" not found. Returning 404.`);
            return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
        }

        const filterFormula = `FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`;
        console.log(`[DEBUG:/news:hub] Filter formula: ${filterFormula}`);
        
        let allRecords = [], offset = null;
        do {
            const params = { pageSize: 100, view: viewIdentifier, offset };
            if (filterFormula) {
                params.filterByFormula = filterFormula;
            }
            console.log(`[DEBUG:/news:hub] Fetching records from Airtable view '${viewIdentifier}' with params: ${JSON.stringify(params)}`);
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params: params }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
            console.log(`[DEBUG:/news:hub] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
        } while (offset);
        
        if (allRecords.length === 0) {
            console.warn(`[WARN] No main records found for country '${country}' and content hub '${contentHub}'.`);
            return res.json({ count: 0, comments: [] });
        }

        const allComments = await loadAllComments();

        const comments = allRecords
            .map(r => {
                // --- KLUCZOWE MIEJSCE DO DEBUGOWANIA KOMENTARZY ---
                // Odczytujemy pole "Comment", które zawiera linked record IDs
                const linkedCommentRecordIds = r.fields.Comment;
                console.log(`[DEBUG:/news:hub] Processing record ${r.id}. Raw value of 'Comment' field:`, linkedCommentRecordIds);

                if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
                    const commentRecordId = linkedCommentRecordIds[0]; // Bierzemy pierwszy ID
                    const commentFields = allComments[commentRecordId]; // Pobierz z cache'u
                    if (commentFields) {
                        const commentText = commentFields[aiCommentKey] || commentFields.AICommentEN;
                        console.log(`[DEBUG:/news:hub] Found comment for ID ${commentRecordId}. Text: "${String(commentText).substring(0, 50)}..."`);
                        return commentText;
                    } else {
                        console.warn(`[WARN] Comment with ID ${commentRecordId} not found in commentMapCache for record ${r.id}.`);
                    }
                } else {
                    console.log(`[DEBUG:/news:hub] No linked Comment record IDs found in record ${r.id}.`);
                }
                return null;
            })
            .filter(comment => {
                const isValid = comment && comment.trim();
                if (!isValid) {
                    console.log(`[DEBUG:/news:hub] Filtering out empty or null comment.`);
                }
                return isValid;
            });
            
        console.log(`[ENDPOINT] /dataset/${country}/${contentHub}/news returning ${comments.length} comments.`);
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

    console.log(`[ENDPOINT] /dataset/${country}/news requested. Lang: ${lang}, ContentHub: ${contentHub}`);

    try {
        let filterFormula = '';
        if (contentHub) {
            const hubId = await getContentHubId(contentHub);
            if (hubId) {
                filterFormula = `FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`;
                console.log(`[DEBUG:/news:country] Filter formula: ${filterFormula}`);
            } else {
                console.warn(`[WARN] Content hub "${contentHub}" not found. Returning 404.`);
                return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
            }
        }

        let allRecords = [], offset = null;
        do {
            const params = { pageSize: 100, view: viewIdentifier, offset };
            if (filterFormula) {
                params.filterByFormula = filterFormula;
            }
            console.log(`[DEBUG:/news:country] Fetching records from Airtable view '${viewIdentifier}' with params: ${JSON.stringify(params)}`);
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
            console.log(`[DEBUG:/news:country] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
        } while (offset);

        if (allRecords.length === 0) {
            console.warn(`[WARN] No main records found for country '${country}'.`);
            return res.json({ count: 0, comments: [] });
        }

        const allComments = await loadAllComments();

        const comments = allRecords
            .map(r => {
                // --- KLUCZOWE MIEJSCE DO DEBUGOWANIA KOMENTARZY ---
                // Odczytujemy pole "Comment", które zawiera linked record IDs
                const linkedCommentRecordIds = r.fields.Comment;
                console.log(`[DEBUG:/news:country] Processing record ${r.id}. Raw value of 'Comment' field:`, linkedCommentRecordIds);

                if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
                    const commentRecordId = linkedCommentRecordIds[0]; // Bierzemy pierwszy ID
                    const commentFields = allComments[commentRecordId]; // Pobierz z cache'u
                    if (commentFields) {
                        const commentText = commentFields[aiCommentKey] || commentFields.AICommentEN;
                        console.log(`[DEBUG:/news:country] Found comment for ID ${commentRecordId}. Text: "${String(commentText).substring(0, 50)}..."`);
                        return commentText;
                    } else {
                        console.warn(`[WARN] Comment with ID ${commentRecordId} not found in commentMapCache for record ${r.id}.`);
                    }
                } else {
                    console.log(`[DEBUG:/news:country] No linked Comment record IDs found in record ${r.id}.`);
                }
                return null;
            })
            .filter(comment => {
                const isValid = comment && comment.trim();
                if (!isValid) {
                    console.log(`[DEBUG:/news:country] Filtering out empty or null comment.`);
                }
                return isValid;
            });

        console.log(`[ENDPOINT] /dataset/${country}/news returning ${comments.length} comments.`);
        res.json({ count: comments.length, comments });

    } catch (e) {
        console.error(`[ERROR] General error in /dataset/:country/news:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


app.get("/dataset/:country/:category", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey = `Description${lang}`;
  const catParam = req.params.category.toLowerCase();
  const country = req.params.country;
  const contentHub = req.query.contentHub;
  
  const viewIdentifier = getCountryViewId(country);
  console.log(`[ENDPOINT] /dataset/${country}/${catParam} requested. Lang: ${lang}, ContentHub: ${contentHub}`);

  try {
    let allRecords = [], offset = null;
    do {
      console.log(`[DEBUG:/dataset:cat] Fetching records from Airtable view '${viewIdentifier}' with offset: ${offset}`);
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        { headers: { Authorization: `Bearer ${KEY}` }, params: { offset, pageSize: 100, view: viewIdentifier } }
      );
      allRecords.push(...r.data.records);
      offset = r.data.offset;
      console.log(`[DEBUG:/dataset:cat] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
    } while (offset);

    if (allRecords.length === 0) {
      console.warn(`[WARN] No data found for the view "${viewIdentifier}". Returning 404.`);
      return res.status(404).json({ error: `No data found for the view "${viewIdentifier}". Please check the view name/ID in your Airtable base.` });
    }

    const catMap = await loadAllCategories();

    // LOKALNE FILTROWANIE po kolumnie CategoryView (Lookup field)
    const items = allRecords
      .filter(r => {
        const titleExists = r.fields.Title && r.fields.Title.trim();
        const categoryViewValue = Array.isArray(r.fields.CategoryView) ? r.fields.CategoryView[0] : r.fields.CategoryView;
        const matchesCategory = titleExists && (categoryViewValue && categoryViewValue.toLowerCase().trim() === catParam.trim());
        
        console.log(`[DEBUG:/dataset:cat] Filtering record ${r.id}. Title exists: ${!!titleExists}, CategoryView: '${categoryViewValue}', Matches category '${catParam}': ${matchesCategory}`);

        let matchesHub = true;
        if (contentHub) {
            const hubValues = r.fields['Content hub'];
            matchesHub = Array.isArray(hubValues) && hubValues.some(h => h.toLowerCase().trim() === contentHub.toLowerCase().trim());
            console.log(`[DEBUG:/dataset:cat] Content Hub filtering for record ${r.id}. Hub values: ${hubValues}, Matches content hub '${contentHub}': ${matchesHub}`);
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

    console.log(`[ENDPOINT] /dataset/${country}/${catParam} returning ${items.length} items.`);
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
  console.log(`[ENDPOINT] /dataset/${countryParam} requested. Lang: ${lang}, ContentHub: ${contentHub}`);

  try {
    let filterFormula = '';
    if (contentHub) {
        const hubId = await getContentHubId(contentHub);
        if (hubId) {
            filterFormula = `FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`;
            console.log(`[DEBUG:/dataset:country] Filter formula: ${filterFormula}`);
        } else {
            console.warn(`[WARN] Content hub "${contentHub}" not found. Returning 404.`);
            return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
        }
    }
      
    let allRecords = [], offset = null;
    do {
      const params = { pageSize: 100, view: viewIdentifier, offset };
      if (filterFormula) {
          params.filterByFormula = filterFormula;
      }
      console.log(`[DEBUG:/dataset:country] Fetching records from Airtable view '${viewIdentifier}' with params: ${JSON.stringify(params)}`);
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        { headers: { Authorization: `Bearer ${KEY}` }, params }
      );
      allRecords.push(...r.data.records);
      offset = r.data.offset;
      console.log(`[DEBUG:/dataset:country] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
    } while (offset);

    if (allRecords.length === 0) {
      console.warn(`[WARN] No data found for the view "${viewIdentifier}". Returning 404.`);
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

    console.log(`[ENDPOINT] /dataset/${countryParam} returning ${items.length} items.`);
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
  console.log(`[ENDPOINT] /categories/${country} requested. Lang: ${lang}, Country name for filtering: ${countryNameForFiltering}`);

  try {
    const allCategories = await loadAllCategories();

    const categories = Object.values(allCategories)
      .filter(recFields => {
        const titleEN = Array.isArray(recFields.TitleEN) ? recFields.TitleEN[0] : recFields.TitleEN;
        const matchesCountry = titleEN && titleEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim();
        console.log(`[DEBUG:/categories] Category record TitleEN: '${titleEN}', Matches country '${countryNameForFiltering}': ${matchesCountry}`);
        return matchesCountry;
      })
      .map(recFields => recFields[fieldKey] || recFields["Secondary"])
      .filter(name => name);

    const uniqueCategories = Array.from(new Set(categories)).sort();

    console.log(`[ENDPOINT] /categories/${country} returning ${uniqueCategories.length} categories.`);
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
    console.log(`[ENDPOINT] /contenthubs/${countryParam} requested. Lang: ${lang}`);

    try {
        const hubTranslationsMap = await loadAllContentHubs();

        let allRecords = [], offset = null;
        do {
            console.log(`[DEBUG:/contenthubs] Fetching records from Airtable view '${viewIdentifier}' with offset: ${offset}`);
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params: { offset, pageSize: 100, view: viewIdentifier } }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
            console.log(`[DEBUG:/contenthubs] Fetched ${r.data.records.length} records. Current total: ${allRecords.length}. Offset: ${offset}`);
        } while (offset);

        const contentHubs = new Set();

        allRecords.forEach(record => {
            const linkedHubTitles = record.fields['Content hub']; 
            if (Array.isArray(linkedHubTitles)) {
                console.log(`[DEBUG:/contenthubs] Processing record ${record.id}. Linked Hub Titles:`, linkedHubTitles);
                linkedHubTitles.forEach(primaryTitle => {
                    const translatedHubFields = hubTranslationsMap[primaryTitle];
                    if (translatedHubFields) {
                        const translatedTitle = translatedHubFields[titleKey] || translatedHubFields.TitleEN;
                        if (translatedTitle) {
                            contentHubs.add(translatedTitle);
                            console.log(`[DEBUG:/contenthubs] Added hub: ${translatedTitle}`);
                        } else {
                            console.warn(`[WARN] No translated title for primary hub: ${primaryTitle} in lang ${lang}.`);
                        }
                    } else {
                        console.warn(`[WARN] No translated hub fields found in cache for primary title: ${primaryTitle}.`);
                    }
                });
            } else {
                console.log(`[DEBUG:/contenthubs] Record ${record.id} has no 'Content hub' links.`);
            }
        });

        const sortedContentHubs = Array.from(contentHubs).sort();

        console.log(`[ENDPOINT] /contenthubs/${countryParam} returning ${sortedContentHubs.length} content hubs.`);
        res.json({ count: sortedContentHubs.length, contentHubs: sortedContentHubs });

    } catch (e) {
        console.error(`[ERROR] General error in /contenthubs/:country:`, e.toString());
        res.status(500).json({ error: e.toString() });
    }
});


app.get("/data/:numericId", async (req, res) => {
  const numericId = parseInt(req.params.numericId);
  console.log(`[ENDPOINT] /data/${numericId} requested.`);
  
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
    console.log(`[DEBUG:/data/:id] Fetching main record with filter: ${filterFormula}`);
    
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
    console.log(`[DEBUG:/data/:id] Found main record: ${record.id}`);

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
      console.log(`[DEBUG:/data/:id] Fetching metadata for ID: ${metadataId}`);
      try {
        const metaResp = await axios.get(
          `https://api.airtable.com/v0/${BASE}/${META}/${metadataId}`, {
            headers: { Authorization: `Bearer ${KEY}` }
          }
        );
        metadataFields = metaResp.data.fields;
        console.log(`[DEBUG:/data/:id] Metadata fetched successfully.`);
      } catch (e) {
        console.error(`[ERROR] Failed to fetch metadata for ID ${metadataId}:`, e.message);
      }
    }

    const catMap = await loadAllCategories();
    const allComments = await loadAllComments(); // Wczytaj wszystkie komentarze
    const categorySelectIds = f.CategorySelect || [];
    const contentHubValue = f['Content hub'];
    
    // --- KLUCZOWE MIEJSCE DO DEBUGOWANIA KOMENTARZY ---
    let aiCommentValue = null;
    // Odczytujemy pole "Comment", które zawiera linked record IDs
    const linkedCommentRecordIds = f.Comment; 
    console.log(`[DEBUG:/data/:id] Raw value of 'Comment' field from main record:`, linkedCommentRecordIds);

    if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
        const commentRecordId = linkedCommentRecordIds[0]; // Bierzemy pierwszy ID
        const commentFields = allComments[commentRecordId]; // Pobierz z cache'u
        if (commentFields) {
            aiCommentValue = commentFields[aiCommentKey] || commentFields.AICommentEN;
            console.log(`[DEBUG:/data/:id] Found comment in cache for ID ${commentRecordId}. Content preview: "${String(aiCommentValue).substring(0, 50)}..."`);
        } else {
            console.warn(`[WARN] Comment with ID ${commentRecordId} not found in commentMapCache.`);
        }
    } else {
        console.log(`[DEBUG:/data/:id] No linked Comment record IDs found in main record's 'Comment' field.`);
    }
    // --- KONIEC KLUCZOWEGO MIEJSCA ---

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
      let headNames = headers.split(";").map(s => s.trim());
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

    console.log(`[ENDPOINT] /data/${numericId} response sent.`);
    res.json({ meta, data, translations });
  } catch (e) {
    console.error(`[ERROR] General error in /data/:numericId for ID ${numericId}:`, e);
    res.status(500).json({ error: e.toString() });
  }
});

app.listen(PORT, () => console.log(`API is running on port ${PORT}`));