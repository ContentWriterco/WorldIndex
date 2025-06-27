# WorldIndex API – Public Datasets

**WorldIndex** is a project designed to present reliable, up-to-date information in a structured, multilingual, and developer-friendly format. This repository provides access to **aggregated public datasets** from various official sources, exposed through a consistent and open API.

## 🌍 What is WorldIndex?

WorldIndex is an interactive platform developed by Content Writer LLC that aggregates official government data (e.g., from GUS, Eurostat, and more) and transforms it into clean, unified datasets. The goal is to make long-term trends easier to understand, analyze, and apply — both for people and AI systems.

Every dataset is available through a consistent API structure and designed to be:
- Machine-readable
- Human-readable
- Automatically updated via official sources
- Easy to visualize, compare, and embed

---

## ✅ Features

- **Public datasets** from multiple countries and regions (e.g., Poland, European Union)
- **Structured API** with comprehensive metadata, multi-column yearly data, and multilingual descriptions
- **Auto-refreshing**: API stays up to date as official sources update
- **Multilingual**: Supports up to 25 language versions per dataset
- **AI-generated news comments**: Provides summarized insights for each dataset, available in multiple languages.
- **Dynamic Categorization**: Datasets are dynamically organized by country and relevant categories.
- **Content Hubs**: Curated collections of related datasets for specific topics (e.g., "Artificial Intelligence", "Economic Situation").

---

## 📊 Example Datasets

- Inflation and unemployment over time (Poland)
- Number of women in the Polish army (Poland)
- Energy production and consumption (European Union)

---

## 📡 API Endpoints

### Data Discovery & Listing

-   `GET /countries`
    Returns a dynamic list of all available countries in the dataset, derived from the database content.
    Example: `https://api.worldindex.co/countries`

-   `GET /categories/{country}`
    Returns a list of all available category slugs (in English by default) for a specific country.
    Example: `https://api.worldindex.co/categories/poland`

-   `GET /categories/{country}?lang={lang}`
    Returns the list of categories translated into the requested language (falls back to English if translation is unavailable).
    Example: `https://api.worldindex.co/categories/poland?lang=pl`

-   `GET /contenthubs/{country}`
    Returns a list of all Content Hubs associated with datasets in a specific country.
    Example: `https://api.worldindex.co/contenthubs/poland`

-   `GET /datasets`
    Returns a comprehensive list of all available datasets across all countries with basic metadata.
    Example: `https://api.worldindex.co/datasets`

-   `GET /dataset/{country}`
    Returns a list of datasets specific to a given country.
    Example: `https://api.worldindex.co/dataset/poland`

-   `GET /dataset/{country}?contentHub={hubTitleEN}`
    Returns datasets for a country, filtered by a specific Content Hub's English title.
    Example: `https://api.worldindex.co/dataset/poland?contentHub=Artificial Intelligence`

-   `GET /dataset/{country}/{categorySlug}`
    Returns a list of datasets for a specific country and category slug (e.g., `economy`, `education`).
    Example: `https://api.worldindex.co/dataset/poland/economy`

-   `GET /dataset/by-hub/{hubTitleEN}`
    Returns a list of all datasets linked to a specific Content Hub (using its English title), regardless of country.
    Example: `https://api.worldindex.co/dataset/by-hub/Artificial Intelligence`

### AI-Generated News Comments

-   `GET /dataset/{country}/news`
    Returns a list of AI-generated news comments for all datasets within a specified country.
    Example: `https://api.worldindex.co/dataset/poland/news`

-   `GET /dataset/{country}/{categorySlug}/news`
    Returns AI-generated news comments for datasets within a specific country and category.
    Example: `https://api.worldindex.co/dataset/poland/economy/news`

-   `GET /dataset/{country}/{contenthubTitleEN}/news`
    Returns AI-generated news comments for datasets within a specific country and Content Hub.
    Example: `https://api.worldindex.co/dataset/poland/Artificial Intelligence/news`

-   **Language Parameter (`?lang={lang}`)**: Most listing and news endpoints support this query parameter to retrieve translated metadata or comments.
    Example: `.../poland/economy/news?lang=pl`

### Detailed Data Access

-   `GET /data/{numericId}`
    Returns the full dataset, including its metadata, raw data table, and all available translations, identified by a unique numeric ID.
    Example: `https://api.worldindex.co/data/2042`

-   `GET /data/{numericId}/meta`
    Returns only the metadata for a specific dataset ID, without the potentially large raw data table.
    Example: `https://api.worldindex.co/data/2042/meta`

-   **Language Parameter (`?lang={lang}`)**: For `/data/{numericId}` and `/data/{numericId}/meta`, this parameter determines which language version of the `title`, `description`, `data` (if applicable), and `AIComment` fields will be included directly in the main response body. All other available translations are provided in the `translations` field.
    Example: `.../data/2042?lang=fr`

---

## 🔧 API Response Structure

### 📚 Example: `GET /dataset/poland/economy`

Returns a list of available datasets with basic metadata:

```json
{
  "count": 123,
  "items": [
    {
      "id": "2042",
      "meta": {
        "title": "Inflation",
        "description": "Inflation rate in Poland (%)",
        "category": "Economy",
        "lastUpdate": "2025-02-20",
        "nextUpdateTime": "2025-10-08"
      }
    },
    {
      "id": "2043",
      "meta": {
        "title": "Unemployment Rate",
        "description": "Unemployment rate in Poland (%).",
        "category": "Economy",
        "lastUpdate": "2025-02-15",
        "nextUpdateTime": "2025-09-30"
      }
    }
    // ... more datasets
  ]
}

```

### 📚 Example: `GET /data/2042`

Returns full dataset with metadata, data records, and translations.

```json
{
  "meta": {
    "title": "Inflation",
    "description": "Annual inflation rate (%)",
    "updateFrequency": "Monthly",
    "lastUpdate": "2025-02-20",
    "nextUpdateTime": "2025-10-08",
    "sourceName": "GUS – Department of National Accounts",
    "category": "Economy",
    "researchName": "Economic Indicators",
    "researchPurpose": "To monitor macroeconomic stability.",
    "definitions": "Inflation measured by CPI.",
    "methodology": "Survey of prices in selected retail outlets.",
    "unit": "Percentage"
  },
  "data": [
    {
      "year": 2021,
      "Value": 5.6
    },
    {
      "year": 2022,
      "Value": 13.9
    },
    {
      "year": 2023,
      "Value": 9.6
    }
    // more records...
  ],
  "translations": {
    "TitleFR": "Inflation",
    "DescriptionFR": "Taux d'inflation en Pologne (%)",
    "DataFR": "Année;Valeur\n2021;5.6\n2022;13.9\n2023;9.6",
    "AICommentFR": "Selon les dernières données, l'inflation en Pologne a augmenté...",
    "DefinitionsFR": "L'inflation mesurée par l'IPC.",
    "SourceNameFR": "GUS – Département des comptes nationaux"
    // more translations...
  }
}

```

### 📚 Example: `GET /dataset/eu/economy/news`

Returns a list of AI-generated comments related to economy datasets in the European Union.

```json
{
  "comments": [
    "In June 2025, the confidence indicator in construction was -4.6 (+0.7 points m/m).",
    "In May 2025, the annual inflation in the EU countries in the transport sector was -1.1% (-0.8 pp m/m).",
    "In April 2025, the net retail trade turnover was 0.6% (+0.3 p.p. m/m)."
  ]
}
```

## 📄 View Available Datasets

You can explore all available datasets and their classifications using the endpoints above.

To see all datasets globally:
👉 `https://api.worldindex.co/datasets`

To filter datasets by a specific country:
👉 `https://api.worldindex.co/dataset/poland`

To filter by a specific category within a country:
👉 `https://api.worldindex.co/dataset/poland/economy`

---

## 🎉 Enjoy

The WorldIndex API is completely **free** for all users. Use it and make Internet a smarter place.

In case of any questions – reach us via [contact@contentwriter.co](mailto:contact@contentwriter.co)
