# strapi-plugin-data-importer

Strapi v5 plugin to import content records from CSV, JSON, and other file formats via the admin panel.

## Features

- Select any content type and upload a data file (CSV, JSON, ...)
- Auto-mapping of columns/keys to Strapi fields
- Download a CSV template for each content type
- Step-by-step import UI in the admin panel

## Requirements

- Strapi v5

## Installation

```bash
npm install strapi-plugin-data-importer
```

## Configuration

Enable the plugin in `config/plugins.ts` (or `config/plugins.js`):

```ts
export default {
  'data-importer': {
    enabled: true,
  },
};
```

### Column mapping (optional)

You can define fixed column → Strapi field mappings per content type.
Create `config/data-importer-mappings.json`:

```json
{
  "api::article.article": {
    "Title": "title",
    "Body": "content",
    "Published": "publishedAt"
  }
}
```

## Usage

1. Open the Strapi admin panel
2. Click **Data Importer** in the sidebar
3. Select a content type
4. Upload a CSV file
5. Adjust field mappings if needed
6. Click **Import**

## License

MIT
