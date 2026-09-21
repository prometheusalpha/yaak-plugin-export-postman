/**
 * Yaak -> Postman Collection v2.1 converter.
 *
 * Input is the normalized "collection" shape the plugin builds inside Yaak
 * (`{ name, items[], variables, authentication }`); the CLI adapts a raw Yaak
 * export file into that shape before calling here.
 */

export interface YaakUrlParameter {
  name: string;
  value?: string;
  enabled?: boolean;
  id?: string;
}

export interface YaakHeader {
  name: string;
  value?: string;
  enabled?: boolean;
  id?: string;
}

export interface YaakFormField {
  name?: string;
  value?: string;
  enabled?: boolean;
}

export interface YaakBody {
  text?: string;
  form?: YaakFormField[];
}

export interface YaakRequest {
  id?: string;
  name?: string;
  method?: string;
  url: string;
  headers?: YaakHeader[] | Record<string, string>;
  body?: string | YaakBody | null;
  bodyType?: string | null;
  /** Path placeholders (`:id`) and query string entries, per the Yaak model. */
  urlParameters?: YaakUrlParameter[];
  description?: string;
  authentication?: Record<string, unknown>;
}

export interface YaakFolder {
  id?: string;
  name: string;
  description?: string;
  authentication?: Record<string, unknown>;
  items: YaakItem[];
}

export type YaakItem = YaakRequest | YaakFolder;

export interface YaakCollection {
  id?: string;
  name?: string;
  items: YaakItem[];
  variables?: Record<string, string>;
  description?: string;
  authentication?: Record<string, unknown>;
}

export interface YaakEnvironment {
  id?: string;
  name: string;
  workspaceId?: string;
  variables?: YaakFormField[];
}

export interface PostmanQueryParam {
  key: string;
  value: string;
  disabled?: boolean;
}

export interface PostmanUrlVariable {
  key: string;
  value: string;
  type: 'string';
}

export interface PostmanUrl {
  raw: string;
  protocol?: string;
  host?: string[];
  port?: string;
  path?: string[];
  query?: PostmanQueryParam[];
  variable?: PostmanUrlVariable[];
}

export interface PostmanHeader {
  key: string;
  value: string;
}

export interface PostmanFormParam {
  key: string;
  value: string;
  disabled?: boolean;
}

export interface PostmanBody {
  mode: 'raw' | 'urlencoded' | 'formdata';
  raw?: string;
  options?: { raw: { language: 'json' | 'text' } };
  urlencoded?: PostmanFormParam[];
  formdata?: PostmanFormParam[];
}

export interface PostmanAuthAttribute {
  key: string;
  value: string;
  type: 'string';
}

export interface PostmanAuth {
  type: string;
  bearer?: PostmanAuthAttribute[];
  basic?: PostmanAuthAttribute[];
  apikey?: PostmanAuthAttribute[];
}

export interface PostmanRequestItem {
  name: string;
  request: {
    method: string;
    header: PostmanHeader[];
    url: PostmanUrl;
    description?: string;
    body?: PostmanBody;
    auth?: PostmanAuth;
  };
}

export interface PostmanFolderItem {
  name: string;
  item: PostmanItem[];
  description?: string;
  auth?: PostmanAuth;
}

export type PostmanItem = PostmanRequestItem | PostmanFolderItem;

export interface PostmanCollection {
  info: {
    name: string;
    _postman_id?: string;
    schema: string;
    description?: string;
  };
  item: PostmanItem[];
  variable?: Array<{ key: string; value: string }>;
  auth?: PostmanAuth;
}

export interface PostmanEnvironment {
  name: string;
  values: Array<{ key: string; value: string; type: 'default'; enabled: boolean }>;
  _postman_variable_scope: 'environment';
}

/** `${[ varName ]}` -> `{{varName}}`, whitespace inside the brackets included. */
export function convertYaakVariables(str: string): string {
  return str.replace(/\$\{\[([^\]]+)\]\}/g, (_, varName: string) => `{{${varName.trim()}}}`);
}

export function yaakToPostman(collection: YaakCollection): PostmanCollection {
  const postman: PostmanCollection = {
    info: {
      name: collection.name || 'Yaak Export',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: convertItems(collection.items),
  };

  if (collection.id) {
    postman.info._postman_id = collection.id;
  }

  if (collection.description) {
    postman.info.description = collection.description;
  }

  // Always add auth if provided (even if empty object, convertAuth will handle it)
  if (collection.authentication) {
    postman.auth = convertAuth(collection.authentication);
  }

  if (collection.variables && Object.keys(collection.variables).length > 0) {
    postman.variable = Object.entries(collection.variables).map(([k, v]) => ({ key: k, value: v }));
  }

  return postman;
}

export function yaakEnvironmentToPostman(environment: YaakEnvironment): PostmanEnvironment {
  return {
    name: environment.name,
    values: (environment.variables ?? [])
      .filter((v): v is YaakFormField & { name: string } => Boolean(v.name))
      .map(v => ({
        key: v.name,
        value: convertYaakVariables(v.value ?? ''),
        type: 'default' as const,
        enabled: v.enabled !== false,
      })),
    _postman_variable_scope: 'environment',
  };
}

function convertItems(items: YaakItem[]): PostmanItem[] {
  return items.map(item => ('items' in item ? convertFolder(item) : convertRequest(item)));
}

function convertRequest(request: YaakRequest): PostmanRequestItem {
  const postmanRequest: PostmanRequestItem = {
    name: request.name || request.id || '',
    request: {
      method: (request.method || 'GET').toUpperCase(),
      header: convertHeaders(request.headers),
      url: convertUrl(request.url, request.urlParameters),
    },
  };

  if (request.description) {
    postmanRequest.request.description = request.description;
  }

  const body = convertBody(request);
  if (body) {
    postmanRequest.request.body = body;
  }

  if (request.authentication && Object.keys(request.authentication).length > 0) {
    postmanRequest.request.auth = convertAuth(request.authentication);
  }

  return postmanRequest;
}

function convertFolder(folder: YaakFolder): PostmanFolderItem {
  const postmanFolder: PostmanFolderItem = {
    name: folder.name,
    item: convertItems(folder.items ?? []),
  };

  if (folder.description) {
    postmanFolder.description = folder.description;
  }

  if (folder.authentication && Object.keys(folder.authentication).length > 0) {
    postmanFolder.auth = convertAuth(folder.authentication);
  }

  return postmanFolder;
}

function convertHeaders(headers: YaakRequest['headers']): PostmanHeader[] {
  // Handle both array and object header formats
  if (Array.isArray(headers)) {
    return headers
      .filter(h => h.enabled !== false && h.name)
      .map(h => ({
        key: convertYaakVariables(h.name),
        value: convertYaakVariables(h.value ?? ''),
      }));
  }
  if (headers) {
    return Object.entries(headers).map(([key, value]) => ({
      key: convertYaakVariables(key),
      value: convertYaakVariables(String(value)),
    }));
  }
  return [];
}

/**
 * Yaak keeps query entries in `urlParameters` (the URL itself carries no `?`),
 * while path placeholders live in the URL as `:name` and are also listed in
 * `urlParameters`. Postman wants the query both in `raw` and as structured
 * entries, and path placeholders defined in `url.variable`.
 */
function convertUrl(url: string, urlParameters: YaakUrlParameter[] = []): PostmanUrl {
  const converted = convertYaakVariables(url);
  const pathParams = urlParameters.filter(p => p.name?.startsWith(':'));
  const queryParams = urlParameters.filter(p => p.name && !p.name.startsWith(':'));

  // Split off any query string already present in the URL so parameter entries
  // are merged by name instead of appended twice.
  const queryStart = converted.indexOf('?');
  const base = queryStart === -1 ? converted : converted.slice(0, queryStart);
  const existingQuery = queryStart === -1 ? '' : converted.slice(queryStart + 1);
  const merged = new Map<string, PostmanQueryParam>();

  for (const pair of existingQuery.split('&').filter(Boolean)) {
    const [key, ...rest] = pair.split('=');
    if (!key || key.startsWith(':')) continue;
    merged.set(key, { key, value: rest.join('=') });
  }
  for (const param of queryParams) {
    const key = convertYaakVariables(param.name);
    merged.set(key, {
      key,
      value: convertYaakVariables(param.value ?? ''),
      ...(param.enabled === false ? { disabled: true } : {}),
    });
  }

  const query = [...merged.values()];
  const enabledQuery = query.filter(q => !q.disabled);
  const raw = enabledQuery.length
    ? `${base}?${enabledQuery.map(q => `${q.key}=${q.value}`).join('&')}`
    : base;

  const urlObj: PostmanUrl = {
    raw,
    ...parseUrlParts(base),
  };

  if (query.length > 0) {
    urlObj.query = query;
  }

  if (pathParams.length > 0) {
    urlObj.variable = pathParams.map(p => ({
      key: p.name.replace(/^:/, ''),
      value: convertYaakVariables(p.value ?? ''),
      type: 'string' as const,
    }));
  }

  return urlObj;
}

function parseUrlParts(base: string): Omit<PostmanUrl, 'raw' | 'query' | 'variable'> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    try {
      const url = new URL(base);
      return {
        protocol: url.protocol.replace(':', ''),
        host: url.hostname.split('.'),
        ...(url.port ? { port: url.port } : {}),
        path: url.pathname.split('/').filter(Boolean),
      };
    } catch {
      // Fall through: the URL has a protocol but is not parseable (e.g. it
      // contains template variables in the host position).
    }
  }

  const withoutProtocol = base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const [hostPart, ...pathParts] = withoutProtocol.split('/').filter(Boolean);
  return {
    ...(hostPart ? { host: [hostPart] } : {}),
    path: pathParts,
  };
}

function convertBody(request: YaakRequest): PostmanBody | undefined {
  const body = request.body;
  if (body == null) return undefined;

  const useUrlEncoded = (request.bodyType ?? '').includes('x-www-form-urlencoded');

  if (typeof body !== 'string') {
    const form = Array.isArray(body.form) ? body.form.filter(f => f.name) : [];
    if (form.length > 0) {
      const fields: PostmanFormParam[] = form.map(f => ({
        key: convertYaakVariables(f.name ?? ''),
        value: convertYaakVariables(f.value ?? ''),
        ...(f.enabled === false ? { disabled: true } : {}),
      }));
      return useUrlEncoded ? { mode: 'urlencoded', urlencoded: fields } : { mode: 'formdata', formdata: fields };
    }
  }

  const text = typeof body === 'string' ? body : body.text;
  if (!text) return undefined;

  return {
    mode: 'raw',
    raw: convertYaakVariables(text),
    options: { raw: { language: request.bodyType === 'application/json' ? 'json' : 'text' } },
  };
}

function convertAuth(auth: Record<string, unknown>): PostmanAuth {
  const str = (value: unknown): string => convertYaakVariables(typeof value === 'string' ? value : '');

  // Handle empty or missing auth
  if (Object.keys(auth).length === 0) {
    return { type: 'noauth' };
  }

  // Detect auth type from fields if not explicitly set
  let type = typeof auth.type === 'string' ? auth.type : typeof auth.authenticationType === 'string' ? auth.authenticationType : 'noauth';

  // Auto-detect auth type from available fields. Empty values mean the request
  // carries no usable credential, so it stays `noauth`.
  if (type === 'noauth') {
    if (auth.username && auth.password) {
      type = 'basic';
    } else if (auth.token) {
      type = 'bearer';
    } else if (auth.key && auth.value) {
      type = 'apikey';
    }
  }

  const lower = type.toLowerCase();

  if (lower === 'bearer') {
    return { type: 'bearer', bearer: [{ key: 'token', value: str(auth.token), type: 'string' }] };
  }
  if (lower === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: str(auth.username), type: 'string' },
        { key: 'password', value: str(auth.password), type: 'string' },
      ],
    };
  }
  if (lower === 'apikey') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: str(auth.key), type: 'string' },
        { key: 'value', value: str(auth.value), type: 'string' },
        { key: 'in', value: str(auth.in) || 'header', type: 'string' },
      ],
    };
  }

  return { type: 'noauth' };
}

export default yaakToPostman;
