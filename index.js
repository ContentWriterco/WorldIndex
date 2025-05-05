require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();

const PORT = process.env.PORT || 3000;

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

// 🔍 Testowy endpoint
app.get("/test", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        }
      }
    );

    res.json(response.data.records.map(r => r.fields.Title));
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

// 📊 Główny endpoint z danymi
app.get("/poland/:title", async (req, res) => {
  const { title } = req.params;

  try {
    const response = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`,
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        },
        params: {
          filterByFormula: `LOWER({Title}) = "${title.toLowerCase()}"`
        }
      }
    );

    const record = response.data.records[0];

    if (!record) {
      return res.status(404).json({ error: `Brak danych dla "${title}"` });
    }

    const fields = record.fields;

    const parsedData = {};
    if (fields["Data"]) {
      const lines = fields["Data"].split("\n");
      for (const line of lines) {
        const [year, value] = line.split(";");
        if (year && value) {
          parsedData[year.trim()] = parseFloat(value);
        }
      }
    }

    const result = {
      title: fields["Title"] || "",
      description: fields["Description"] || "",
      updateFrequency: fields["UpdateFrequency"] || "",
      format: fields["Format"] || "",
      updatedThere: fields["UpdatedThere"] || "",
      nextUpdateTime: fields["NextUpdateTime"] || "",
      sourceName: fields["Source Name"] || "",
      titleEN: fields["TitleEN"] || "",
      descriptionEN: fields["DescriptionEN"] || "",
      formatEN: fields["DataEN"] || "",
      ...parsedData
    };

    res.json(result);

  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

app.listen(PORT, () => {
  console.log(`API działa na porcie ${PORT}`);
});
