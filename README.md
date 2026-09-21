# Yaak → Postman Exporter

Converts a Yaak export file into a Postman Collection v2.1 JSON plus one Postman environment
file per Yaak environment. Also installable as a Yaak plugin (see [Yaak plugin](#yaak-plugin-ui)).

Verified on macOS with bun 1.4.2. No build step, no dependencies required for the CLI.

## Quick start

```bash
git clone https://github.com/prometheusalpha/yaak-plugin-export-postman.git
cd yaak-plugin-export-postman

bun src/cli.ts /absolute/path/to/yaak-export.json /absolute/path/to/out.postman_collection.json
```

`bun` is the only prerequisite (`bun --version`); install it with
`curl -fsSL https://bun.sh/install | bash`. There is no `npm install` step for the CLI — `src/cli.ts`
only imports `node:fs/promises`, `node:path` and the sibling `src/postman.ts`.

Do **not** run it with `ts-node` or `node`: the sources use extensionless relative imports and
`node src/cli.ts` fails with `Cannot find module '.../src/postman'`.

## CLI parameters

```
bun src/cli.ts <input.json> [output.json]
```

| # | Parameter | Required | Default | Meaning |
|---|---|---|---|---|
| 1 | `input.json` | yes | — | Yaak export file. Absolute path recommended. Relative paths resolve against the current working directory. |
| 2 | `output.json` | no | `./postman-export.json` (in the cwd) | Where the Postman collection is written. Missing directories are created. Environment files are written next to it. |

Exit code `0` on success, `1` on any error. All written paths are printed to stdout as `- <path>`.

Accepted input shapes (auto-detected):

1. **Raw Yaak export** — `{ "resources": { "workspaces": [], "folders": [], "httpRequests": [], "environments": [] } }`
   (this is what Yaak's "Export data" produces, and the file this tool was built for).
2. **Normalized collection** — `{ "name": "…", "items": [ … ], "variables": {}, "authentication": {} }`
   (the shape the plugin builds inside Yaak). Only the collection is written; no environments exist in that shape.

## Output files

For input `/tmp/yaak.tendoo.json` with output `/tmp/out.postman_collection.json`:

```
- /tmp/out.postman_collection.json                              Postman Collection v2.1
- /tmp/Global_Variables.postman_environment.json                one per Yaak environment
- /tmp/Gitlab_Environment.postman_environment.json
```

* Environment file name = Yaak environment name with every character outside `[A-Za-z0-9._-]`
  replaced by `_`, suffixed `.postman_environment.json`. They always land beside the collection.
* If the export contains more than one workspace, one collection is written per workspace as
  `<workspace name>.postman_collection.json` (same name sanitization as environments) and the
  `output.json` argument is ignored — verified: `Alpha Workspace` → `Alpha_Workspace.postman_collection.json`.
* The workspace's base environment (`"base": true`, otherwise the first environment) is copied into
  the collection's `variable` array, so `{{name}}` references resolve without importing an environment.

Import into Postman via **Import → Files** (select the collection and both environment files).

## Verify the result

```bash
jq -r '
  [.. | objects | select(has("request"))] as $r
  | "requests:              \($r|length)",
    "top-level items:       \(.item|length)",
    "collection variables:  \(.variable|length)",
    "query parameters:      \([.. | objects | select(has("request")) | (.request.url.query // []) | .[]]|length)",
    "unconverted ${[ ]}:     \([.. | strings | select(contains("${["))]|length)"
' out.postman_collection.json
```

For the reference export used during development (`yaak.tendoo.json`: 1 workspace, 57 folders,
203 requests, 2 environments) the expected output is:

```
requests:              203
top-level items:       8
collection variables:  25
query parameters:      153
unconverted ${[ ]}:     0
```

`unconverted ${[ ]}` must be `0`. `requests` must equal `resources.httpRequests` filtered by the
workspace, which you can cross-check with:

```bash
jq -r '.resources.httpRequests | length' yaak-export.json
```

## Conversion rules

| Yaak | Postman |
|---|---|
| `${[ varName ]}` (whitespace allowed) in URLs, bodies, header names, header values, auth fields | `{{varName}}` |
| `urlParameters[]` with a plain `name` | `url.query[]` entry, appended to `url.raw` as `?k=v&…`. Entries with `enabled: false` stay in `query` but are **not** appended to `raw`. Existing `?…` in `url` is merged by key first |
| `urlParameters[]` named `:id` | `url.variable[]` entry; the `:id` segment is left in `url.path` |
| `folders[].folderId` | nested `item[]` arrays; folders come before requests at each level |
| `httpRequests[].headers[]` | `request.header[]`, dropping entries with `enabled: false` |
| `body.text` + `bodyType: application/json` | `request.body = { mode: "raw", raw, options: { raw: { language: "json" } } }` |
| `body.form[]` + `bodyType: application/x-www-form-urlencoded` | `mode: "urlencoded"`; other form types → `mode: "formdata"` |
| empty body (`{}`, empty `text`, or a form with no named field) | omitted entirely (no empty `raw` body) |
| `authenticationType: bearer` + non-empty `authentication.token` | `request.auth = { type: "bearer", … }` |
| `authenticationType: basic` + non-empty `username`/`password` | `{ type: "basic", … }` |
| auth present but all credential values empty | `{ type: "noauth" }` |
| `environments[]` | one Postman environment file; workspace base env also → collection `variable[]` |

Not converted: saved responses, gRPC/WebSocket requests, cookies, request/folder-level settings
(timeout, redirects), and files in multipart bodies (only text form fields are kept).

## Tests and typecheck

These need dependencies, unlike the CLI:

```bash
npm install --no-save --no-package-lock
npx vitest run src/postman.test.ts          # 11 tests, converter behaviour
npx tsc --noEmit --strict --target es2021 --module esnext --moduleResolution bundler \
  --skipLibCheck src/postman.ts src/cli.ts src/postman.test.ts
```

Known issue: `npx vitest run` (all files) fails — `src/index.test.ts` still asserts the old plugin
shape (`plugin.httpRequestActions`, label `Export to Postman`) that `src/index.ts` no longer exposes,
and `src/index.ts` is the Yaak-UI entry point, unrelated to the CLI. Run `src/postman.test.ts`
as shown above until that test is updated.

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `Unrecognized input: expected a Yaak export (resources.*) or a collection ({ items: [] })` | Valid JSON, wrong shape | Confirm the file has `resources.httpRequests`, or pass the normalized `{ items: [] }` shape |
| `No workspaces found in Yaak export` | `resources.workspaces` missing or empty | Re-export from Yaak; the file must contain a workspace |
| `ENOENT` with the input path | File not found — relative paths resolve from the cwd | Pass an absolute input path |
| `Cannot find module '…/src/postman'` | Ran with `node`/`ts-node` | Run with `bun src/cli.ts …` |
| Collection exists but `requests: 0` | `httpRequests[].workspaceId` does not match any `workspaces[].id` | Inspect both fields in the input |

## Yaak plugin (UI)

The same converter is exposed as a Yaak plugin: right-click a workspace or folder in Yaak →
**Export Collection to Postman** → enter the output path. Build/install with `npm run build`
(`yaakcli build`) and `npm run dev`.

Differences from the CLI:

* Runs against the live workspace through the Yaak plugin API, so it needs no export file.
* Writes only the collection — the plugin API exposes no environment accessor, so no environment
  files and no collection `variable` entries.
* Auth, variable and body conversion are identical (both paths share `src/postman.ts`).
