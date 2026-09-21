# Yaak Postman Export Plugin

This plugin exports Yaak requests and collections to Postman Collection v2.1 JSON format.

## Features

- **Collection/Folder Export**: Right-click a workspace or folder and export the entire collection with:
  - Nested folder hierarchy preserved
  - All requests with headers, body, and descriptions
  - Authentication (basic, bearer, API key) with variable conversion
  - Template variable syntax converted from Yaak format (`${[varName]}`) to Postman format (`{{varName}}`)
  - Proper Postman v2.1.0 collection format

## Usage

From Yaak UI (when plugin is installed):

Right-click a workspace or folder and choose "Export Collection to Postman", then:

- Specify the output file path where the Postman collection JSON should be saved
- The collection is exported with all descendants (folders and requests)

## CLI (Development)

Install dev dependencies and run the converter:

```bash
npm install
npx ts-node src/cli.ts path/to/yaak-export.json out.postman.json
```

`bun src/cli.ts …` runs it with no install step.

Input is either a raw Yaak export file (`resources.*` — workspaces, folders, httpRequests,
environments) or the normalized collection shape (`{ name, items[] }`) the plugin builds
inside Yaak. `out.postman.json` is optional and defaults to `./postman-export.json`.

A raw export also writes one Postman environment file per Yaak environment, next to the
collection: `<environment name>.postman_environment.json`. Workspace-level (base) environment
variables are additionally copied into the collection's `variable` array.

## Tests

```bash
npm test
```

## How It Works

The plugin uses the Yaak plugin context APIs to:

- List all requests and folders in a workspace
- Automatically detect folder hierarchy
- Detect authentication type from available fields (username → basic, token → bearer, key/value → apikey)
- Convert Yaak template variables to Postman format throughout URLs, bodies, headers, and auth values
- Generate valid Postman v2.1.0 JSON

## Notes

- Auth is automatically detected: if username+password present → basic auth, if token present → bearer auth, if key+value → API key auth
- Variables in all contexts (URLs, bodies, headers, auth) are converted from `${[name]}` to `{{name}}`
- Folder hierarchy is preserved using nested `item` arrays in the Postman format
- Yaak `urlParameters` become Postman `url.query` entries and are appended to `url.raw` (disabled entries stay in `query` but not in `raw`); `:name` placeholders become `url.variable` entries
- An empty body (empty text, or a form without named fields) is omitted rather than exported as an empty raw body
- Request/folder-level auth overrides collection-level auth (standard Postman behavior)
