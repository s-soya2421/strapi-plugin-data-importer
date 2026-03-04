# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-04

### Added

- JSON file import support with nested object/array flattening
- Import history panel showing the last 50 import runs (content type, date, created/updated/failed counts)
- Upsert mode: update existing records by a key field instead of always creating new ones
- Import result now shows separate "Created / Updated / Failed" counts

## [0.1.0] - 2026-03-03

### Added

- Step-by-step CSV import UI in the Strapi admin panel
- Content type auto-detection from Strapi's schema
- Auto-mapping of CSV columns to Strapi fields by name
- Configurable column mapping via `config/data-importer-mappings.json`
- CSV template download per content type
- Import result summary with per-record error details
- i18n support (English / Japanese) via Strapi's `registerTrads`
