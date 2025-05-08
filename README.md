# WorldIndex API – Poland Dataset

**WorldIndex** is a project designed to present reliable, up-to-date information in a structured, multilingual, and developer-friendly format. This repository provides access to the **Polish datasets** exposed through an open API.

## 🌍 What is WorldIndex?

WorldIndex is an interactive platform developed by Content Writer LLC that aggregates official government data (e.g. from dane.gov.pl, GUS, API DBW and more) and transforms it into clean, unified datasets. The goal is to make long-term trends easier to understand, analyze, and apply — both for people and AI systems.

Every dataset is available through a consistent API structure and designed to be:
- Machine-readable
- Human-readable
- Automatically updated via official sources
- Easy to visualize, compare, and embed

---

## ✅ Features

- **Public Polish datasets** powered by official government sites
- **Structured API** with metadata, multi-column yearly data, and multilingual descriptions
- **Auto-refreshing**: API stays up to date as official sources update
- **Multilingual**: 25 language versions per dataset

---

## 📊 Example Datasets

- Number of women in the Polish army
- Inflation and unemployment over time
- Name popularity and demographic changes
- Crime rates and education statistics

---

## 📡 API Endpoints

- `GET /poland/{title}` – returns full dataset with metadata, data table, and translations  
  Example: `https://api.worldindex.co/poland/inflation`

- `GET /titlelist/poland` – returns a list of all available Polish datasets with metadata  
  Example: `https://api.worldindex.co/titlelist/poland`

---

## 🔧 API Response Structure

### 📚 Example: GET /titlelist/poland

Returns a list of available datasets with basic metadata.

```json
  {
      "id": "rec7umbf8ZbjH31Xs",
      "meta": {
        "title": "Inflation",
        "description": "Inflation rate in Poland (%)",
        "category": "Economy",
        "lastUpdate": "2025-02-20",
        "nextUpdateTime": "2025-10-08"
      }
    }
```
---

### 📘 Example: GET /poland/{title}

Returns full dataset with metadata, data records, and translations.

```json

{
  "meta": {
    "title": "Inflation",
    "description": "Annual inflation rate (%)",
    "format": "Year;Value",
    "lastUpdate": "2025-02-20",
    "nextUpdateTime": "2025-10-08",
    "sourceName": "GUS – Department of National Accounts",
    "category": "Economy"
  },
  "data": [
    { "Data": 2021, "Value": 5.6 },
    { "Data": 2022, "Value": 13.9 },
    { "Data": 2023, "Value": 9.6 }
    // more records...
  ],
  "translations": {
    "TitleFR": "Inflation",
    "DescriptionFR": "Taux dʼinflation en Pologne (%)"
    // more translations...
  }
}

```
---


## 📄 View Available Datasets

You can explore all available datasets for Poland here:  
👉 [https://api.worldindex.co/titlelist/poland](https://api.worldindex.co/titlelist/poland)

---

## 📩 Want API Access?

To integrate this API with your project, get access through RapidAPI:  
👉 [https://rapidapi.com/worldindex/api/poland-data](https://rapidapi.com/worldindex/api/poland-data)

✉️ You can also obtain a private API key by writing us at **contact@contentwriter.co**

Free and commercial plans are available.

