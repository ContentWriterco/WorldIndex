# WorldIndex API – Poland Dataset

**WorldIndex** is an open data platform designed to present reliable, up-to-date information in a structured, multilingual, and developer-friendly format. This repository provides access to the **Polish datasets** exposed through an open API.

### 🌍 What is WorldIndex?

WorldIndex is an interactive platform that aggregates official government data (e.g. from dane.gov.pl, GUS, API DBW and more) and transforms it into clean, unified datasets. The goal is to make long-term trends easier to understand, analyze, and apply — both for people and AI systems.

Every dataset is available through a consistent API structure and designed to be:
- Machine-readable
- Human-readable
- Automatically updated via official sources
- Easy to visualize, compare, and embed

> **“WorldIndex – 21st century data, restructured.”**

---

### ✅ Features

- **Public Polish datasets** powered by dane.gov.pl
- **Structured API** with metadata, multi-column yearly data, and multilingual descriptions
- **Auto-refreshing**: API stays up to date as official sources update
- **Multilingual**: up to 30 language versions per dataset
- **Free and open** to use for non-commercial projects

---

### 📊 Example Datasets

- Number of women in the Polish army
- Inflation and unemployment over time
- Name popularity and demographic changes
- Crime rates and education statistics *(coming soon)*

---

### 🔧 API Structure

Every dataset endpoint returns:

```json
{
  "meta": {
    "title": "Dataset title",
    "description": "Dataset description",
    "format": "Column headers",
    "lastUpdate": "YYYY-MM-DD",
    ...
  },
  "data": [
    { "year": 2020, "Land Forces": 7708, ... },
    ...
  ],
  "translations": {
    "TitleFR": "...",
    "DescriptionPL": "...",
    ...
  }
}
