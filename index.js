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
const COMMENT_TABLE = "Comment"; // Nazwa tabeli z komentarzami
const DIVISIONS_TABLE = "Divisions"; // NOWE: Nazwa tabeli Divisions

// Lista dwuliterowych kodów języków
const LANGUAGES = [
  "FR", "CZ", "SK", "IT", "CN", "JP", "SI", "LT", "LV", "FI",
  "UA", "PT", "VN", "DE", "NL", "TR", "EE", "RS", "HR", "ES",
  "PL", "HU", "GR", "RO", "BG", "EN"
];

// --- ZARZĄDZANIE CACHEM Z TTL (Time-To-Live) ---
let categoryMapCache = null;
let contentHubsCache = null;
let commentMapCache = null; // Cache dla komentarzy
let divisionsCache = null; // NOWE: Cache dla Divisions
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
                if (rec.fields.Title) { // Używamy wartości z pola 'Title' (primary field) jako klucza mapy.
                    map[rec.fields.Title] = { ...rec.fields, id: rec.id };
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

/**
 * NOWA FUNKCJA POMOCNICZA: Fetches all divisions into a map { id -> fields }.
 * Caches the result and refreshes it if it's stale.
 */
async function loadAllDivisions() {
    if (divisionsCache && isCacheFresh()) {
        return divisionsCache;
    }

    console.log("[INFO] Cache stale or empty. Fetching all divisions from Airtable...");
    let map = {};
    let offset = null;
    
    try {
        do {
            console.log(`[DEBUG:loadAllDivisions] Attempting to fetch from table: ${DIVISIONS_TABLE}`);
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(DIVISIONS_TABLE)}`,
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

        divisionsCache = map;
        cacheLastLoaded = Date.now();
        console.log(`[INFO] Loaded ${Object.keys(map).length} divisions. Cache updated.`);
        return divisionsCache;
    } catch (error) {
        console.error(`[ERROR] Failed to fetch divisions from Airtable table '${DIVISIONS_TABLE}':`, error.message);
        console.error(`[ERROR] Full error details:`, error.response?.data || error);
        console.error(`[ERROR] Status code:`, error.response?.status);
        console.error(`[ERROR] Base ID: ${BASE}, Table: ${DIVISIONS_TABLE}`);
        
        // Return empty map instead of throwing error to prevent API crashes
        console.warn(`[WARN] Returning empty divisions cache due to error. API will continue without divisions data.`);
        divisionsCache = {};
        cacheLastLoaded = Date.now();
        return divisionsCache;
    }
}

/**
 * NOWA FUNKCJA POMOCNICZA: Gets divisions linked to a main record.
 * Returns an array of division records that are linked to the given main record.
 */
async function getLinkedDivisions(mainRecordId) {
    const allDivisions = await loadAllDivisions();
    const linkedDivisions = [];
    
    for (const divisionId in allDivisions) {
        const divisionFields = allDivisions[divisionId];
        
        // Try multiple possible field names for linking to main table
        const possibleLinkingFields = [
            'linkedto', 'LinkedTo', 'MainRecord', 'Main', 'Poland', 'ParentRecord',
            'linkedto', 'Linked To', 'Main Record', 'Parent Record', 'Poland Record'
        ];
        
        let linkedToMain = null;
        for (const fieldName of possibleLinkingFields) {
            if (divisionFields[fieldName]) {
                linkedToMain = divisionFields[fieldName];
                break;
            }
        }
        
        if (Array.isArray(linkedToMain) && linkedToMain.includes(mainRecordId)) {
            linkedDivisions.push({
                id: divisionId,
                fields: divisionFields
            });
        }
    }
    
    return linkedDivisions;
}

/**
 * NOWA FUNKCJA POMOCNICZA: Unifies AI comments from main record and its linked divisions.
 * Returns an array of all AI comments for a given language.
 */
async function getUnifiedAIComments(mainRecord, lang) {
    const aiCommentKey = `AIComment${lang}`;
    const comments = [];
    
    // Get comments from main record
    const allComments = await loadAllComments();
    const linkedCommentRecordIds = mainRecord.fields.Comment;
    
    if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
        const commentRecordId = linkedCommentRecordIds[0];
        const commentFields = allComments[commentRecordId];
        if (commentFields) {
            const commentText = commentFields[aiCommentKey] || commentFields.AICommentEN;
            if (commentText && commentText.trim()) {
                comments.push({
                    source: 'main',
                    comment: commentText
                });
            }
        }
    }
    
    // Get comments from linked divisions
    const linkedDivisions = await getLinkedDivisions(mainRecord.id);
    for (const division of linkedDivisions) {
        const divisionCommentIds = division.fields.Comment;
        if (Array.isArray(divisionCommentIds) && divisionCommentIds.length > 0) {
            const commentRecordId = divisionCommentIds[0];
            const commentFields = allComments[commentRecordId];
            if (commentFields) {
                const commentText = commentFields[aiCommentKey] || commentFields.AICommentEN;
                if (commentText && commentText.trim()) {
                    comments.push({
                        source: 'division',
                        divisionId: division.id,
                        comment: commentText
                    });
                }
            }
        }
    }
    
    return comments;
}

/**
 * NOWA FUNKCJA POMOCNICZA: Gets unified data from main record and its divisions.
 * Returns an object with main data and additional division data.
 */
async function getUnifiedData(mainRecord, lang) {
    const titleKey = `Title${lang}`;
    const descKey = `Description${lang}`;
    const dataKey = `Data${lang}`;
    
    const unifiedData = {
        main: {
            id: mainRecord.fields.DataID || mainRecord.id,
            title: mainRecord.fields[titleKey] || mainRecord.fields.Title || mainRecord.fields.TitleEN || "",
            description: mainRecord.fields[descKey] || mainRecord.fields.DescriptionEN || "",
            data: mainRecord.fields[dataKey] || mainRecord.fields.DataEN || "",
            lastUpdate: mainRecord.fields.UpdatedThere || "",
            nextUpdateTime: mainRecord.fields.NextUpdateTime || "",
            updateFrequency: mainRecord.fields.UpdateFrequency || ""
        },
        divisions: []
    };
    
    // Get linked divisions
    const linkedDivisions = await getLinkedDivisions(mainRecord.id);
    for (const division of linkedDivisions) {
        const divisionData = {
            id: division.id,
            title: division.fields[titleKey] || division.fields.Title || division.fields.TitleEN || "",
            description: division.fields[descKey] || division.fields.DescriptionEN || "",
            data: division.fields[dataKey] || division.fields.DataEN || "",
            category: division.fields.Category || null,
            country: division.fields.Country || null,
            contentHub: division.fields['Content hub'] || null
        };
        unifiedData.divisions.push(divisionData);
    }
    
    return unifiedData;
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
        const viewId = process.env.AIRTABLE_EU_VIEW_ID || 'European Union';
        return viewId;
    } else if (lowerCaseCountry === 'poland') {
        const viewId = process.env.AIRTABLE_POLAND_VIEW_ID || 'Poland';
        return viewId;
    } else {
        const viewId = countryParam.charAt(0).toUpperCase() + countryParam.slice(1);
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
            return allContentHubs[hubKey].id;
        }
        if (allContentHubs[hubKey].Title && allContentHubs[hubKey].Title.toLowerCase() === hubTitle.toLowerCase()) {
            return allContentHubs[hubKey].id;
        }
    }
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
    
    for (const id in categoriesMap) {
        const fields = categoriesMap[id];
        // Używamy SecondaryEN jako nazwy kategorii i TitleEN jako nazwy kraju
        const secondaryEN = (Array.isArray(fields.SecondaryEN) ? fields.SecondaryEN[0] : fields.SecondaryEN) || '';
        const titleEN = (Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN) || '';

        if (secondaryEN.toLowerCase().trim() === normalizedCategoryName && titleEN.toLowerCase().trim() === normalizedCountryName) {
            return id;
        }
    }
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
        res.json({ count: countries.length, countries });

    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// ZAKTUALIZOWANY ENDPOINT: /datasets - teraz zawiera dane z obu tabel
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
        }

        if (category) {
            const countryForCatLookup = country ? getCountryNameForFiltering(country) : 'Poland';
            const categoryId = await getCategoryIdByName(category, countryForCatLookup);
            if (categoryId) {
                filterParts.push(`{CategorySelect} = "${categoryId}"`);
            } else {
                return res.status(404).json({ error: `Category "${category}" not found for country "${countryForCatLookup}".` });
            }
        }

        if (contentHub) {
            const hubId = await getContentHubId(contentHub);
            if (hubId) {
                filterParts.push(`FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`);
            } else {
                return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
            }
        }
        
        const filterFormula = filterParts.length > 0 ? `AND(${filterParts.join(',')})` : '';

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

        if (allRecords.length === 0) {
            return res.status(404).json({ error: `No records found for the given criteria in /datasets.` });
        }

        const catMap = await loadAllCategories();
        const items = allRecords
            .filter(r => {
                const isValidTitle = r.fields.Title && r.fields.Title.trim();
                return isValidTitle;
            })
            .map(r => {
                const f = r.fields;
                
                // Get category and country from CategorySelect
                let catName = null;
                let countryName = null;
                const categorySelectIds = f.CategorySelect || [];
                if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
                    const cf = catMap[categorySelectIds[0]];
                    if (cf) {
                        const key = lang === "EN" ? "Secondary" : `Secondary${lang}`;
                        catName = cf[key] || cf["Secondary"] || null;
                        // Get country from TitleEN field
                        countryName = cf.TitleEN || null;
                    }
                }
                
                return {
                    id: f.DataID || r.id,
                    meta: {
                        title: f[titleKey] || f.Title,
                        description: f[descKey] || f.DescriptionEN || "",
                        category: catName,
                        country: countryName,
                        lastUpdate: f.UpdatedThere || "",
                        nextUpdateTime: f.NextUpdateTime || ""
                    }
                };
            });
        
        items.sort((a, b) => new Date(b.meta.lastUpdate) - new Date(a.meta.lastUpdate));
        
        res.json({ count: items.length, items });

    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// ZAKTUALIZOWANY ENDPOINT: /data/:numericId/meta - teraz zawiera dane z obu tabel
app.get("/data/:numericId/meta", async (req, res) => {
    const idParam = req.params.numericId;
    const isDivision = idParam.startsWith('d');
    const numericId = isDivision ? parseInt(idParam.substring(1)) : parseInt(idParam);
    if (isNaN(numericId)) {
        return res.status(400).json({ error: "Invalid ID. Please provide a valid numeric ID or 'd' + numeric ID for division records." });
    }
    const lang = (req.query.lang || "EN").toUpperCase();
    const langSuffix = lang;
    const titleKey = `Title${langSuffix}`;
    const descriptionKey = `Description${langSuffix}`;
    const aiCommentKey = `AIComment${langSuffix}`;
    try {
        let record = null;
        let f = null;
        if (isDivision) {
            // Fetch from Divisions table
            const allDivisions = await loadAllDivisions();
            for (const divisionId in allDivisions) {
                const divisionFields = allDivisions[divisionId];
                if (divisionFields.DataID === numericId) {
                    record = { id: divisionId, fields: divisionFields };
                    f = divisionFields;
                    break;
                }
            }
            if (!record) {
                return res.status(404).json({ error: `No division data for ID "d${numericId}"` });
            }
            // For division records, try to get metadata from linked Poland record
            const mainDataIds = f.Main_Data;
            if (mainDataIds && Array.isArray(mainDataIds) && mainDataIds.length > 0) {
                const mainDataId = mainDataIds[0];
                let allPoland = [];
                let offset = null;
                do {
                    const params = { pageSize: 100, offset };
                    const r = await axios.get(
                        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                        { headers: { Authorization: `Bearer ${KEY}` }, params }
                    );
                    allPoland.push(...r.data.records);
                    offset = r.data.offset;
                } while (offset);
                const linkedPolandRecord = allPoland.find(r => r.id === mainDataId);
                if (linkedPolandRecord) {
                    const polandFields = linkedPolandRecord.fields;
                    let polandMetadataFields = {};
                    const polandMetadataIds = polandFields.Metadata || [];
                    if (Array.isArray(polandMetadataIds) && polandMetadataIds.length > 0) {
                        const polandMetadataId = polandMetadataIds[0];
                        try {
                            const metaResp = await axios.get(
                                `https://api.airtable.com/v0/${BASE}/${META}/${polandMetadataId}`,
                                { headers: { Authorization: `Bearer ${KEY}` } }
                            );
                            polandMetadataFields = metaResp.data.fields;
                        } catch (e) {}
                    }
                    f._polandMetadataFields = polandMetadataFields;
                }
            }
        } else {
            // Fetch from Poland table
            const filterFormula = `{DataID} = ${numericId}`;
            const mainResp = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`, {
                    headers: { Authorization: `Bearer ${KEY}` },
                    params: { filterByFormula: filterFormula }
                }
            );
            record = mainResp.data.records[0];
            if (!record) {
                return res.status(404).json({ error: `No data for ID "${numericId}"` });
            }
            f = record.fields;
        }
        const meta = {
            title: Array.isArray(f[titleKey]) ? f[titleKey][0] : (f[titleKey] || (Array.isArray(f.Title) ? f.Title[0] : f.Title) || f.TitleEN || ""),
            description: f[descriptionKey] || f.DescriptionEN || "",
            updateFrequency: f.UpdateFrequency || "",
            lastUpdate: f.UpdatedThere || "",
            nextUpdateTime: f.NextUpdateTime || "",
            category: undefined,
            contentHub: undefined,
            summary: undefined,
            sourceName: undefined,
            unit: undefined
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
            } catch (e) {}
        }
        const catMap = await loadAllCategories();
        const categorySelectIds = f.CategorySelect || [];
        const contentHubValue = f['Content hub'];
        let aiCommentValue = null;
        if (isDivision) {
            aiCommentValue = f[aiCommentKey] || f.AICommentEN;
        } else {
            const allComments = await loadAllComments();
            const linkedCommentRecordIds = f.Comment;
            if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
                const commentRecordId = linkedCommentRecordIds[0];
                const commentFields = allComments[commentRecordId];
                if (commentFields) {
                    aiCommentValue = commentFields[aiCommentKey] || commentFields.AICommentEN;
                }
            }
        }
        // Set meta.category for both Poland and Division records using CategorySelect, but use SecondaryEN (or language-specific Secondary) from Categories table
        let categorySet = false;
        if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
            const catFields = catMap[categorySelectIds[0]];
            console.log('[DEBUG:/data/:numericId/meta] categorySelectIds:', categorySelectIds, 'catFields:', catFields);
            if (catFields) {
                const categorySecondaryKey = lang === "EN" ? "SecondaryEN" : `Secondary${lang}`;
                meta.category = catFields[categorySecondaryKey] || catFields["SecondaryEN"] || null;
                categorySet = true;
            }
        }
        // For Division records, if category is still not set, try to get it from linked Poland record
        if (isDivision && !categorySet && f.Main_Data && Array.isArray(f.Main_Data) && f.Main_Data.length > 0) {
            const mainDataId = f.Main_Data[0];
            let allPoland = [];
            let offset = null;
            do {
                const params = { pageSize: 100, offset };
                const r = await axios.get(
                    `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                    { headers: { Authorization: `Bearer ${KEY}` }, params }
                );
                allPoland.push(...r.data.records);
                offset = r.data.offset;
            } while (offset);
            const linkedPolandRecord = allPoland.find(r => r.id === mainDataId);
            if (linkedPolandRecord) {
                const polandCategorySelectIds = linkedPolandRecord.fields.CategorySelect || [];
                if (Array.isArray(polandCategorySelectIds) && polandCategorySelectIds.length) {
                    const catFields = catMap[polandCategorySelectIds[0]];
                    if (catFields) {
                        const categorySecondaryKey = lang === "EN" ? "SecondaryEN" : `Secondary${lang}`;
                        meta.category = catFields[categorySecondaryKey] || catFields["SecondaryEN"] || null;
                    }
                }
            }
        }
        if (contentHubValue && Array.isArray(contentHubValue) && contentHubValue.length > 0) {
            meta.contentHub = contentHubValue.join(', ');
        }
        if (aiCommentValue) {
            meta.summary = aiCommentValue;
        }
        if (isDivision && f._polandMetadataFields) {
            meta.sourceName = f._polandMetadataFields[`Source Name${langSuffix}`]
                || f._polandMetadataFields["Source NameEN"]
                || f._polandMetadataFields["Source Name"]
                || "";
            meta.unit = f._polandMetadataFields[`Unit${langSuffix}`]
                || f._polandMetadataFields.UnitEN
                || f._polandMetadataFields.Unit
                || "";
        } else {
            meta.sourceName = metadataFields[`Source Name${langSuffix}`]
                || metadataFields["Source NameEN"]
                || metadataFields["Source Name"]
                || f.sourceName
                || "";
            meta.unit = metadataFields[`Unit${langSuffix}`]
                || metadataFields.UnitEN
                || metadataFields.Unit
                || f[`Unit${langSuffix}`]
                || f.UnitEN
                || f.unit
                || "";
        }
        res.json({ meta });
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

app.post("/cache/refresh", requireApiKey, (req, res) => {
    categoryMapCache = null;
    contentHubsCache = null;
    commentMapCache = null; // Resetuj cache komentarzy
    divisionsCache = null; // NOWE: Resetuj cache divisions
    cacheLastLoaded = 0; // Resetujemy timestamp
    res.json({ message: "Cache has been cleared and will be reloaded on the next data request." });
});

// Debug endpoint to clear content hubs cache only
app.post("/cache/refresh-content-hubs", requireApiKey, (req, res) => {
    contentHubsCache = null;
    res.json({ message: "Content hubs cache has been cleared and will be reloaded on the next request." });
});

// NOWY ENDPOINT DO TESTOWANIA DOSTĘPU DO TABELI DIVISIONS
app.get("/debug/divisions", async (req, res) => {
    try {
        const divisions = await loadAllDivisions();
        const divisionCount = Object.keys(divisions).length;
        
        // Get sample division data for debugging
        const sampleDivisions = [];
        let count = 0;
        for (const divisionId in divisions) {
            if (count < 3) { // Only return first 3 divisions
                sampleDivisions.push({
                    id: divisionId,
                    fields: divisions[divisionId]
                });
                count++;
            }
        }
        
        res.json({ 
            message: "Divisions table access test",
            totalDivisions: divisionCount,
            sampleDivisions: sampleDivisions,
            tableName: DIVISIONS_TABLE,
            baseId: BASE
        });
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// NOWY ENDPOINT DO TESTOWANIA DOSTĘPU DO VIEWS
app.get("/debug/views", async (req, res) => {
    try {
        // Try to get table metadata to see available views
        const r = await axios.get(
            `https://api.airtable.com/v0/meta/bases/${BASE}/tables`,
            { headers: { Authorization: `Bearer ${KEY}` } }
        );
        
        const tables = r.data.tables;
        const mainTable = tables.find(t => t.name === MAIN);
        
        if (mainTable) {
            res.json({
                message: "Available views for main table",
                tableName: MAIN,
                views: mainTable.views || [],
                baseId: BASE
            });
        } else {
            res.json({
                message: "Main table not found in metadata",
                tableName: MAIN,
                availableTables: tables.map(t => t.name),
                baseId: BASE
            });
        }
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// NOWY ENDPOINT DO TESTOWANIA STRUKTURY DIVISIONS
app.get("/debug/divisions-structure", async (req, res) => {
    try {
        const divisions = await loadAllDivisions();
        const divisionCount = Object.keys(divisions).length;
        
        // Get sample division data with field analysis
        const sampleDivisions = [];
        let count = 0;
        for (const divisionId in divisions) {
            if (count < 5) { // Return first 5 divisions
                const fields = divisions[divisionId];
                const fieldAnalysis = {};
                
                // Analyze each field
                for (const fieldName in fields) {
                    const fieldValue = fields[fieldName];
                    fieldAnalysis[fieldName] = {
                        type: typeof fieldValue,
                        isArray: Array.isArray(fieldValue),
                        value: fieldValue,
                        length: Array.isArray(fieldValue) ? fieldValue.length : null
                    };
                }
                
                sampleDivisions.push({
                    id: divisionId,
                    fieldAnalysis: fieldAnalysis
                });
                count++;
            }
        }
        
        res.json({ 
            message: "Divisions table structure analysis",
            totalDivisions: divisionCount,
            sampleDivisions: sampleDivisions,
            tableName: DIVISIONS_TABLE,
            baseId: BASE
        });
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// ZAKTUALIZOWANY ENDPOINT: /dataset/:country/:category/news - teraz zawiera komentarze z obu tabel
app.get("/dataset/:country/:category/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const catParam = req.params.category.toLowerCase();
    const country = req.params.country;
    const viewIdentifier = getCountryViewId(country);
    try {
        // 1. Find Category record(s) for the country and category
        const allCategories = await loadAllCategories();
        const countryNameForFiltering = getCountryNameForFiltering(country);
        const matchingCategories = Object.entries(allCategories)
          .filter(([id, fields]) => {
            const titleEN = Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN;
            const secondaryEN = Array.isArray(fields.SecondaryEN) ? fields.SecondaryEN[0] : fields.SecondaryEN;
            const matchesCountry = titleEN && titleEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim();
            const matchesCategory = secondaryEN && secondaryEN.toLowerCase().trim() === catParam.trim();
            return matchesCountry && matchesCategory;
          });
        if (matchingCategories.length === 0) {
            return res.status(404).json({ error: `No category found for country "${country}" and category "${catParam}"` });
        }
        // 2. Collect all linked record IDs from both Divisions and Poland for this category
        let divisionIds = [];
        let polandIds = [];
        for (const [catId, fields] of matchingCategories) {
            if (Array.isArray(fields.Divisions)) divisionIds.push(...fields.Divisions);
            if (Array.isArray(fields.Poland)) polandIds.push(...fields.Poland);
        }
        // 3. Fetch records from Divisions and Poland tables
        const allDivisions = await loadAllDivisions();
        const allPoland = [];
        let offset = null;
        do {
            const params = { pageSize: 100, offset };
            const r = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${MAIN}`,
                { headers: { Authorization: `Bearer ${KEY}` }, params }
            );
            allPoland.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);
        // 4. Filter records by IDs (Divisions and Poland)
        const divisionRecords = divisionIds.map(id => allDivisions[id]).filter(Boolean);
        const polandRecords = allPoland.filter(r => polandIds.includes(r.id));
        // 5. Collect AI comments from both Comment table (linked to Poland) and Divisions table
        const allComments = await loadAllComments();
        const aiCommentKey = `AIComment${lang}`;
        const comments = [];
        // Poland comments
        for (const r of polandRecords) {
            const f = r.fields;
            const linkedCommentRecordIds = f.Comment;
            if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
                const commentRecordId = linkedCommentRecordIds[0];
                const commentFields = allComments[commentRecordId];
                if (commentFields) {
                    const commentText = commentFields[aiCommentKey] || commentFields.AICommentEN;
                    if (commentText && commentText.trim()) {
                        comments.push(commentText);
                    }
                }
            }
        }
        // Division comments
        for (const f of divisionRecords) {
            if (f[aiCommentKey] && f[aiCommentKey].trim()) {
                comments.push(f[aiCommentKey]);
            } else if (f.AICommentEN && f.AICommentEN.trim()) {
                comments.push(f.AICommentEN);
            }
        }
        res.json({ count: comments.length, comments });
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// ZAKTUALIZOWANY ENDPOINT: /dataset/:country/:contenthub/news - teraz zawiera komentarze z obu tabel
app.get("/dataset/:country/:contenthub/news", async (req, res) => {
    const lang = (req.query.lang || "EN").toUpperCase();
    const country = req.params.country;
    const contentHub = req.params.contenthub;
    const viewIdentifier = getCountryViewId(country);

    try {
        const hubId = await getContentHubId(contentHub);
        if (!hubId) {
            return res.status(404).json({ error: `Content hub "${contentHub}" not found.` });
        }

        const filterFormula = `FIND("${hubId}", ARRAYJOIN({Content hubs in build}))`;
        
        let allRecords = [], offset = null;
        do {
            const params = { pageSize: 100, view: viewIdentifier, offset };
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
        
        if (allRecords.length === 0) {
            return res.json({ count: 0, comments: [] });
        }

        const comments = [];
        
        for (const record of allRecords) {
            // NOWE: Pobierz zunifikowane komentarze AI z głównej tabeli i divisions
            const unifiedComments = await getUnifiedAIComments(record, lang);
            unifiedComments.forEach(comment => {
                if (comment.comment && comment.comment.trim()) {
                    comments.push(comment.comment);
                }
            });
        }
            
        res.json({ count: comments.length, comments });

    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// ZAKTUALIZOWANY ENDPOINT: /dataset/:country/news - teraz zawiera komentarze z obu tabel
app.get("/dataset/:country/news", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const countryParam = req.params.country.toLowerCase();
  const aiCommentKey = `AIComment${lang}`;

  try {
    // 1. Find Category record(s) for the country
    const allCategories = await loadAllCategories();
    const countryNameForFiltering = getCountryNameForFiltering(countryParam);
    
    const matchingCategories = Object.entries(allCategories)
      .filter(([id, fields]) => {
        const titleEN = Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN;
        const matches = titleEN && titleEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim();
        return matches;
      });

    if (matchingCategories.length === 0) {
      return res.status(404).json({ error: `No category found for country "${countryNameForFiltering}".` });
    }

    // 2. Collect all linked record IDs from both Divisions and Poland
    let divisionIds = [];
    let polandIds = [];
    for (const [catId, fields] of matchingCategories) {
      if (Array.isArray(fields.Divisions)) divisionIds.push(...fields.Divisions);
      if (Array.isArray(fields.Poland)) polandIds.push(...fields.Poland);
    }

    // 3. Fetch records from Divisions and Poland tables
    const allDivisions = await loadAllDivisions();
    const allPoland = [];
    let offset = null;
    do {
      const params = { pageSize: 100, offset };
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        { headers: { Authorization: `Bearer ${KEY}` }, params }
      );
      allPoland.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    // 4. Filter records by IDs (Divisions) and by country (Poland)
    // --- MODIFIED LOGIC FOR POLAND: Only use Poland records, not Divisions ---
    let polandRecords;
    if (countryParam === 'poland') {
      // For Poland, include all records that match the country (like in /dataset/:country)
      polandRecords = allPoland.filter(r => {
        const f = r.fields;
        return polandIds.includes(r.id) ||
          (
            (typeof f.CountryEN === 'string' && f.CountryEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim()) ||
            (Array.isArray(f.CountryEN) && f.CountryEN.some(
              c => typeof c === 'string' && c.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim()
            ))
          );
      });
    } else {
      // For other countries, keep the old logic (both Divisions and Poland)
      polandRecords = allPoland.filter(r => {
        const f = r.fields;
        return polandIds.includes(r.id) ||
          (
            (typeof f.CountryEN === 'string' && f.CountryEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim()) ||
            (Array.isArray(f.CountryEN) && f.CountryEN.some(
              c => typeof c === 'string' && c.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim()
            ))
          );
      });
    }

    // 5. Collect AI comments from both Comment table (linked to Poland) and Divisions table
    const allComments = await loadAllComments();
    const comments = [];

    if (countryParam === 'poland' || countryParam === 'eu') {
      // Get comments from Comment table linked to Poland records
      for (const r of polandRecords) {
        const f = r.fields;
        const linkedCommentRecordIds = f.Comment;
        if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
          const commentRecordId = linkedCommentRecordIds[0];
          const commentFields = allComments[commentRecordId];
          if (commentFields) {
            const commentText = commentFields[aiCommentKey] || commentFields.AICommentEN;
            if (commentText && commentText.trim()) {
              comments.push(commentText);
            }
          }
        }
      }
      
      // Get comments from Divisions table
      const divisionRecords = divisionIds.map(id => allDivisions[id]).filter(Boolean);
      for (const f of divisionRecords) {
        if (f[aiCommentKey] && f[aiCommentKey].trim()) {
          comments.push(f[aiCommentKey]);
        }
        else if (f.AICommentEN && f.AICommentEN.trim()) {
          comments.push(f.AICommentEN);
        }
      }
    } else {
      // For other countries, keep the old logic (Divisions and Poland)
      const divisionRecords = divisionIds.map(id => allDivisions[id]).filter(Boolean);
      for (const f of divisionRecords) {
        if (f[aiCommentKey] && f[aiCommentKey].trim()) {
          comments.push(f[aiCommentKey]);
        }
        else if (f.AICommentEN && f.AICommentEN.trim()) {
          comments.push(f.AICommentEN);
        }
      }
      for (const r of polandRecords) {
        const f = r.fields;
        if (f[aiCommentKey] && f[aiCommentKey].trim()) {
          comments.push(f[aiCommentKey]);
        }
        else if (f.AICommentEN && f.AICommentEN.trim()) {
          comments.push(f.AICommentEN);
        }
      }
    }

    res.json({ count: comments.length, comments });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// NOWY ENDPOINT: /data/:numericId/unified - zwraca zunifikowane dane z głównej tabeli i divisions
app.get("/data/:numericId/unified", async (req, res) => {
    const numericId = parseInt(req.params.numericId);
    
    if (isNaN(numericId)) {
        return res.status(400).json({ error: "Invalid ID. Please provide a numeric ID." });
    }

    const lang = (req.query.lang || "EN").toUpperCase();

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

        // NOWE: Pobierz zunifikowane dane z głównej tabeli i divisions
        const unifiedData = await getUnifiedData(record, lang);
        
        // Pobierz zunifikowane komentarze AI
        const unifiedComments = await getUnifiedAIComments(record, lang);
        unifiedData.aiComments = unifiedComments;

        res.json(unifiedData);
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// DODANE BRAKUJĄCE ENDPOINTY Z ORYGINALNEGO SKRYPTU

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
  
  try {
    // 1. Find Category record(s) for the country
    const allCategories = await loadAllCategories();
    const countryNameForFiltering = getCountryNameForFiltering(country);

    const matchingCategories = Object.entries(allCategories)
      .filter(([id, fields]) => {
        const titleEN = Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN;
        return titleEN && titleEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim();
      });

    if (matchingCategories.length === 0) {
      return res.status(404).json({ error: `No category found for country "${countryNameForFiltering}"` });
    }

    // 2. Collect all linked record IDs from both Divisions and Poland
    let divisionIds = [];
    let polandIds = [];
    for (const [catId, fields] of matchingCategories) {
      if (Array.isArray(fields.Divisions)) divisionIds.push(...fields.Divisions);
      if (Array.isArray(fields.Poland)) polandIds.push(...fields.Poland);
    }

    // 3. Fetch records from Divisions and Poland tables
    const allDivisions = await loadAllDivisions();
    const allPoland = [];
    let offset = null;
    do {
      const params = { pageSize: 100, offset };
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        { headers: { Authorization: `Bearer ${KEY}` }, params }
      );
      allPoland.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    // 4. Filter records by IDs and category
    const divisionRecords = divisionIds.map(id => allDivisions[id]).filter(Boolean);
    const polandRecords = allPoland.filter(r => polandIds.includes(r.id));

    // 5. Filter by category (using CategoryView field for Poland records)
    const filteredPolandRecords = polandRecords.filter(r => {
      const categoryViewValue = Array.isArray(r.fields.CategoryView) ? r.fields.CategoryView[0] : r.fields.CategoryView;
      return categoryViewValue && categoryViewValue.toLowerCase().trim() === catParam.trim();
    });

    // 6. Filter division records by category (if they have category field)
    const filteredDivisionRecords = divisionRecords.filter(f => {
      // Check if division has category field that matches
      const divisionCategory = f.Category || f.CategoryView;
      if (divisionCategory) {
        const categoryValue = Array.isArray(divisionCategory) ? divisionCategory[0] : divisionCategory;
        return categoryValue && categoryValue.toLowerCase().trim() === catParam.trim();
      }
      return true; // Include if no category field
    });

    // 7. Combine and format results
    const items = [
      ...filteredDivisionRecords.map(f => {
        // For division records, try to get metadata from linked Poland record
        let description = f[descKey] || f.DescriptionEN || "";
        let lastUpdate = f.UpdatedThere || "";
        let nextUpdateTime = f.NextUpdateTime || "";
        
        // Try to find linked Poland record via Main_Data field
        const mainDataIds = f.Main_Data;
        if (mainDataIds && Array.isArray(mainDataIds) && mainDataIds.length > 0) {
          const mainDataId = mainDataIds[0]; // Get the first ID from the array
          const linkedPolandRecord = allPoland.find(r => r.id === mainDataId);
          if (linkedPolandRecord) {
            const polandFields = linkedPolandRecord.fields;
            description = polandFields[descKey] || polandFields.DescriptionEN || description;
            lastUpdate = polandFields.UpdatedThere || lastUpdate;
            nextUpdateTime = polandFields.NextUpdateTime || nextUpdateTime;
          }
        }
        
        return {
          id: `d${f.DataID || f.id}`,
          meta: {
            title: Array.isArray(f[titleKey]) ? f[titleKey][0] : (f[titleKey] || (Array.isArray(f.Title) ? f.Title[0] : f.Title)),
            description: description,
            lastUpdate: lastUpdate,
            nextUpdateTime: nextUpdateTime
          }
        };
      }),
      ...filteredPolandRecords.map(r => {
        const f = r.fields;
        return {
          id: f.DataID || r.id,
          meta: {
            title: f[titleKey] || f.Title,
            description: f[descKey] || f.DescriptionEN || "",
            lastUpdate: f.UpdatedThere || "",
            nextUpdateTime: f.NextUpdateTime || ""
          }
        };
      })
    ];

    items.sort((a, b) => new Date(b.meta.lastUpdate) - new Date(a.meta.lastUpdate));

    res.json({ count: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.get("/dataset/:country", async (req, res) => {
  const lang = (req.query.lang || "EN").toUpperCase();
  const titleKey = `Title${lang}`;
  const descKey = `Description${lang}`;
  const countryParam = req.params.country.toLowerCase();

  try {
    // 1. Find Category record(s) for the country
    const allCategories = await loadAllCategories();
    const countryNameForFiltering = getCountryNameForFiltering(countryParam);

    const matchingCategories = Object.entries(allCategories)
      .filter(([id, fields]) => {
        const titleEN = Array.isArray(fields.TitleEN) ? fields.TitleEN[0] : fields.TitleEN;
        return titleEN && titleEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim();
      });

    if (matchingCategories.length === 0) {
      return res.status(404).json({ error: `No category found for country "${countryNameForFiltering}"` });
    }

    // 2. Collect all linked record IDs from both Divisions and Poland
    let divisionIds = [];
    let polandIds = [];
    for (const [catId, fields] of matchingCategories) {
      if (Array.isArray(fields.Divisions)) divisionIds.push(...fields.Divisions);
      if (Array.isArray(fields.Poland)) polandIds.push(...fields.Poland);
    }

    // 3. Fetch records from Divisions and Poland tables
    const allDivisions = await loadAllDivisions();
    const allPoland = [];
    let offset = null;
    do {
      const params = { pageSize: 100, offset };
      const r = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`,
        { headers: { Authorization: `Bearer ${KEY}` }, params }
      );
      allPoland.push(...r.data.records);
      offset = r.data.offset;
    } while (offset);

    // 4. Filter records by IDs
    const divisionRecords = divisionIds.map(id => allDivisions[id]).filter(Boolean);
    const polandRecords = allPoland.filter(r => polandIds.includes(r.id));

    // 5. Combine and format results
    const items = [
      ...divisionRecords.map(f => {
        // For division records, try to get metadata from linked Poland record
        let description = f[descKey] || f.DescriptionEN || "";
        let lastUpdate = f.UpdatedThere || "";
        let nextUpdateTime = f.NextUpdateTime || "";
        
        // Try to find linked Poland record via Main_Data field
        const mainDataIds = f.Main_Data;
        if (mainDataIds && Array.isArray(mainDataIds) && mainDataIds.length > 0) {
          const mainDataId = mainDataIds[0]; // Get the first ID from the array
          const linkedPolandRecord = allPoland.find(r => r.id === mainDataId);
          if (linkedPolandRecord) {
            const polandFields = linkedPolandRecord.fields;
            description = polandFields[descKey] || polandFields.DescriptionEN || description;
            lastUpdate = polandFields.UpdatedThere || lastUpdate;
            nextUpdateTime = polandFields.NextUpdateTime || nextUpdateTime;
          }
        }
        
        return {
          id: `d${f.DataID || f.id}`,
          meta: {
            title: Array.isArray(f[titleKey]) ? f[titleKey][0] : (f[titleKey] || (Array.isArray(f.Title) ? f.Title[0] : f.Title)),
            description: description,
            lastUpdate: lastUpdate,
            nextUpdateTime: nextUpdateTime
          }
        };
      }),
      ...polandRecords.map(r => {
        const f = r.fields;
        return {
          id: f.DataID || r.id,
          meta: {
            title: f[titleKey] || f.Title,
            description: f[descKey] || f.DescriptionEN || "",
            lastUpdate: f.UpdatedThere || "",
            nextUpdateTime: f.NextUpdateTime || ""
          }
        };
      })
    ];

    items.sort((a, b) => new Date(b.meta.lastUpdate) - new Date(a.meta.lastUpdate));

    res.json({ count: items.length, items });
  } catch (e) {
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
        const matchesCountry = titleEN && titleEN.toLowerCase().trim() === countryNameForFiltering.toLowerCase().trim();
        return matchesCountry;
      })
      .map(recFields => recFields[fieldKey] || recFields["Secondary"])
      .filter(name => name);

    const uniqueCategories = Array.from(new Set(categories)).sort();

    res.json({ count: uniqueCategories.length, categories: uniqueCategories });
  } catch (e) {
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
                { headers: { Authorization: `Bearer ${KEY}` }, params: { offset, pageSize: 100, view: viewIdentifier } }
            );
            allRecords.push(...r.data.records);
            offset = r.data.offset;
        } while (offset);

        const contentHubs = new Set();

        allRecords.forEach(record => {
            const linkedHubTitles = record.fields['Content hub']; 
            if (Array.isArray(linkedHubTitles)) {
                linkedHubTitles.forEach(primaryTitle => {
                    const translatedHubFields = hubTranslationsMap[primaryTitle];
                    if (translatedHubFields) {
                        const translatedTitle = translatedHubFields[titleKey] || translatedHubFields.TitleEN;
                        if (translatedTitle) {
                            contentHubs.add(translatedTitle);
                        } else {
                            console.warn(`[WARN] No translated title for primary hub: ${primaryTitle} in lang ${lang}.`);
                        }
                    } else {
                        console.warn(`[WARN] No translated hub fields found in cache for primary title: ${primaryTitle}.`);
                    }
                });
            }
        });

        const sortedContentHubs = Array.from(contentHubs).sort();

        res.json({ count: sortedContentHubs.length, contentHubs: sortedContentHubs });

    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

app.get("/data/:numericId", async (req, res) => {
  const idParam = req.params.numericId;
  
  // Check if it's a division record (starts with 'd')
  const isDivision = idParam.startsWith('d');
  const numericId = isDivision ? parseInt(idParam.substring(1)) : parseInt(idParam);
  
  if (isNaN(numericId)) {
      return res.status(400).json({ error: "Invalid ID. Please provide a valid numeric ID or 'd' + numeric ID for division records." });
  }

  const lang = (req.query.lang || "EN").toUpperCase();
  const langSuffix = lang;

  const titleKey = `Title${langSuffix}`;
  const descriptionKey = `Description${langSuffix}`;
  const dataKey = `Data${langSuffix}`;
  const aiCommentKey = `AIComment${langSuffix}`;

  try {
    let record = null;
    let f = null;
    
    if (isDivision) {
      // Fetch from Divisions table
      const allDivisions = await loadAllDivisions();
      
      // Find division record by DataID
      for (const divisionId in allDivisions) {
        const divisionFields = allDivisions[divisionId];
        if (divisionFields.DataID === numericId) {
          record = { id: divisionId, fields: divisionFields };
          f = divisionFields;
          break;
        }
      }
      
      if (!record) {
        return res.status(404).json({ error: `No division data for ID "d${numericId}"` });
      }
      
      // For division records, try to get metadata from linked Poland record
      const mainDataIds = f.Main_Data;
      if (mainDataIds && Array.isArray(mainDataIds) && mainDataIds.length > 0) {
        const mainDataId = mainDataIds[0]; // Get the first ID from the array
        
        // Fetch Poland records to find the linked one
        let allPoland = [];
        let offset = null;
        do {
          const params = { pageSize: 100, offset };
          const r = await axios.get(
            `https://api.airtable.com/v0/${BASE}/${MAIN}`,
            { headers: { Authorization: `Bearer ${KEY}` }, params }
          );
          allPoland.push(...r.data.records);
          offset = r.data.offset;
        } while (offset);
        const linkedPolandRecord = allPoland.find(r => r.id === mainDataId);
        if (linkedPolandRecord) {
          const polandFields = linkedPolandRecord.fields;
          f[descriptionKey] = polandFields[descriptionKey] || polandFields.DescriptionEN || f[descriptionKey];
          f.UpdateFrequency = polandFields.UpdateFrequency || f.UpdateFrequency;
          f.UpdatedThere = polandFields.UpdatedThere || f.UpdatedThere;
          f.NextUpdateTime = polandFields.NextUpdateTime || f.NextUpdateTime;
          // Get SourceName and Unit from Poland record - try multiple possible field names
          const possibleSourceNameFields = [
            polandFields[`Source Name${langSuffix}`],
            polandFields["Source NameEN"],
            polandFields.SourceName,
            polandFields.Source,
            polandFields["Source Name"],
            polandFields["SourceName"],
            polandFields["Source name"],
            polandFields["sourceName"],
            polandFields["source_name"]
          ];
          f.sourceName = possibleSourceNameFields.find(field => field) || f.sourceName;
          const possibleUnitFields = [
            polandFields[`Unit${langSuffix}`],
            polandFields.UnitEN,
            polandFields.Unit,
            polandFields["Unit"],
            polandFields["unit"]
          ];
          f.unit = possibleUnitFields.find(field => field) || f.unit;

          // NEW: Fetch Metadata from linked Poland record and use its Source NameXX and UnitXX
          let polandMetadataFields = {};
          const polandMetadataIds = polandFields.Metadata || [];
          if (Array.isArray(polandMetadataIds) && polandMetadataIds.length > 0) {
            const polandMetadataId = polandMetadataIds[0];
            try {
              const metaResp = await axios.get(
                `https://api.airtable.com/v0/${BASE}/${META}/${polandMetadataId}`,
                { headers: { Authorization: `Bearer ${KEY}` } }
              );
              polandMetadataFields = metaResp.data.fields;
            } catch (e) {
              console.error(`[ERROR] Failed to fetch metadata for Poland record's Metadata ID ${polandMetadataId}:`, e.message);
            }
          }
          // Store for later use in meta assignment
          f._polandMetadataFields = polandMetadataFields;
          const langFields = {};
          for (const lang of LANGUAGES) {
            langFields[`Source Name${lang}`] = f._polandMetadataFields[`Source Name${lang}`];
            langFields[`Unit${lang}`] = f._polandMetadataFields[`Unit${lang}`];
          }
        } else {
          console.log(`[DEBUG:/data/:id] No Poland record found for Main_Data ID: ${mainDataId}`);
        }
      } else {
        console.log(`[DEBUG:/data/:id] Division record ${f.DataID || record.id} has no Main_Data field or it's empty`);
      }
    } else {
      // Fetch from Poland table
      const filterFormula = `{DataID} = ${numericId}`;
      
      const mainResp = await axios.get(
        `https://api.airtable.com/v0/${BASE}/${MAIN}`, {
          headers: { Authorization: `Bearer ${KEY}` },
          params: { filterByFormula: filterFormula }
        }
      );

      record = mainResp.data.records[0];
      if (!record) {
        return res.status(404).json({ error: `No data for ID "${numericId}"` });
      }
      f = record.fields;
    }
    
    const meta = {
      title: Array.isArray(f[titleKey]) ? f[titleKey][0] : (f[titleKey] || (Array.isArray(f.Title) ? f.Title[0] : f.Title) || f.TitleEN || ""),
      description: f[descriptionKey] || f.DescriptionEN || "",
      updateFrequency: f.UpdateFrequency || "",
      lastUpdate: f.UpdatedThere || "",
      nextUpdateTime: f.NextUpdateTime || "",
      category: undefined,
      contentHub: undefined,
      summary: undefined,
      sourceName: undefined,
      unit: undefined
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
    const allComments = await loadAllComments(); // Wczytaj wszystkie komentarze
    const categorySelectIds = f.CategorySelect || [];
    const contentHubValue = f['Content hub'];
    
    // --- KLUCZOWE MIEJSCE DO DEBUGOWANIA KOMENTARZY ---
    let aiCommentValue = null;
    
    if (isDivision) {
      // For Division records, get AIComment directly from the record
      aiCommentValue = f[aiCommentKey] || f.AICommentEN;
    } else {
      // For Poland records, get AIComment from linked Comment record
      const linkedCommentRecordIds = f.Comment; 

      if (Array.isArray(linkedCommentRecordIds) && linkedCommentRecordIds.length > 0) {
          const commentRecordId = linkedCommentRecordIds[0]; // Bierzemy pierwszy ID
          const commentFields = allComments[commentRecordId]; // Pobierz z cache'u
          if (commentFields) {
              aiCommentValue = commentFields[aiCommentKey] || commentFields.AICommentEN;
          }
      }
    }
    // --- KONIEC KLUCZOWEGO MIEJSCA ---

    if (Array.isArray(categorySelectIds) && categorySelectIds.length) {
      const catFields = catMap[categorySelectIds[0]];
      console.log('[DEBUG:/data/:numericId/meta] categorySelectIds:', categorySelectIds, 'catFields:', catFields);
      if (catFields) {
        const categorySecondaryKey = lang === "EN" ? "SecondaryEN" : `Secondary${lang}`;
        meta.category = catFields[categorySecondaryKey] || catFields["SecondaryEN"] || null;
        categorySet = true;
      }
    }
    
    if (contentHubValue && Array.isArray(contentHubValue) && contentHubValue.length > 0) {
        meta.contentHub = contentHubValue.join(', ');
    }
    
    if (aiCommentValue) {
        meta.summary = aiCommentValue;
    }
    // Always set sourceName at the end to guarantee order
    meta.sourceName = metadataFields[`Source Name${langSuffix}`] || metadataFields["Source NameEN"] || f.sourceName || "";
    // Always set unit at the end, using language-specific logic
    meta.unit = metadataFields[`Unit${langSuffix}`] || metadataFields.UnitEN || f[`Unit${langSuffix}`] || f.UnitEN || f.unit || "";

    const researchNameValue = metadataFields[`ResearchName${langSuffix}`] || metadataFields.ResearchNameEN;
    if (researchNameValue) meta.researchName = researchNameValue;
    
    const researchPurposeValue = metadataFields[`ResearchPurpose${langSuffix}`] || metadataFields.ResearchPurposeEN;
    if (researchPurposeValue) meta.researchPurpose = researchPurposeValue;
    
    const definitionsValue = metadataFields[`Definitions${langSuffix}`] || metadataFields.DefinitionsEN;
    if (definitionsValue) meta.definitions = definitionsValue;
    
    const methodologyValue = metadataFields[`Methodology${langSuffix}`] || metadataFields.MethodolologyEN;
    if (methodologyValue) meta.methodology = methodologyValue;
    
    // Get sourceName from metadata (for Poland records) or from linked Poland record (for Division records)
    let sourceNameValue = metadataFields[`Source Name${langSuffix}`] || metadataFields["Source NameEN"];
    if (isDivision) {
        // For Division records, use the sourceName we got from linked Poland record
        sourceNameValue = f.sourceName || sourceNameValue;
    }
    if (sourceNameValue) meta.sourceName = sourceNameValue;
    
    // Get unit from metadata (for Poland records) or from linked Poland record (for Division records)
    let unitValue = metadataFields[`Unit${langSuffix}`] || metadataFields.UnitEN;
    if (isDivision) {
        // For Division records, use the unit we got from linked Poland record
        unitValue = f.unit || unitValue;
    }
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

    if (isDivision && f._polandMetadataFields) {
      meta.sourceName = f._polandMetadataFields[`Source Name${langSuffix}`]
        || f._polandMetadataFields["Source NameEN"]
        || f._polandMetadataFields["Source Name"]
        || "";
      meta.unit = f._polandMetadataFields[`Unit${langSuffix}`]
        || f._polandMetadataFields.UnitEN
        || f._polandMetadataFields.Unit
        || "";
    }

    res.json({ meta, data, translations });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.listen(PORT, () => console.log(`Unified API is running on port ${PORT}`)); 