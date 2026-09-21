import { describe, expect, test } from 'vitest';
import {
  yaakEnvironmentToPostman,
  yaakToPostman,
  type PostmanFolderItem,
  type PostmanItem,
  type PostmanRequestItem,
  type YaakCollection,
} from './postman';

function asRequest(item: PostmanItem | undefined): PostmanRequestItem {
  if (!item || !('request' in item)) throw new Error('expected a request item');
  return item;
}

function asFolder(item: PostmanItem | undefined): PostmanFolderItem {
  if (!item || !('item' in item)) throw new Error('expected a folder item');
  return item;
}

describe('Postman Exporter', () => {
  test('converts a simple request', () => {
    const yaak: YaakCollection = {
      name: 'My Col',
      items: [
        {
          id: '1',
          name: 'Get Thing',
          method: 'get',
          url: 'https://example.com/api/v1/things/1',
          headers: { Accept: 'application/json' },
          body: null,
          description: 'A test request',
        },
      ],
    };

    const postman = yaakToPostman(yaak);
    const request = asRequest(postman.item[0]);
    expect(postman.info.name).toBe('My Col');
    expect(postman.item).toHaveLength(1);
    expect(request.name).toBe('Get Thing');
    expect(request.request.method).toBe('GET');
    expect(request.request.header[0]).toEqual({ key: 'Accept', value: 'application/json' });
    expect(request.request.url.raw).toBe('https://example.com/api/v1/things/1');
  });

  test('includes variables at collection root', () => {
    const yaak: YaakCollection = {
      name: 'With Vars',
      variables: { baseUrl: 'https://example.com' },
      items: [],
    };

    const postman = yaakToPostman(yaak);
    expect(postman.variable).toEqual([{ key: 'baseUrl', value: 'https://example.com' }]);
  });

  test('preserves folder hierarchy', () => {
    const yaak: YaakCollection = {
      name: 'With Folders',
      items: [
        {
          id: 'folder1',
          name: 'API v1',
          items: [
            {
              id: '1',
              name: 'Get User',
              method: 'GET',
              url: 'https://api.example.com/users/1',
            },
          ],
        },
      ],
    };

    const postman = yaakToPostman(yaak);
    const folder = asFolder(postman.item[0]);
    expect(postman.item).toHaveLength(1);
    expect(folder.name).toBe('API v1');
    expect(folder.item).toHaveLength(1);
    expect(asRequest(folder.item[0]).name).toBe('Get User');
  });

  test('moves url parameters into the query string', () => {
    const yaak: YaakCollection = {
      name: 'With Query',
      items: [
        {
          id: '1',
          name: 'Search',
          method: 'GET',
          url: '${[ baseURL ]}/v2/products',
          urlParameters: [
            { name: 'search', value: 'lua', enabled: true },
            { name: 'exclude', value: 'true', enabled: false },
          ],
        },
      ],
    };

    const url = asRequest(yaakToPostman(yaak).item[0]).request.url;
    expect(url.raw).toBe('{{baseURL}}/v2/products?search=lua');
    expect(url.query).toEqual([
      { key: 'search', value: 'lua' },
      { key: 'exclude', value: 'true', disabled: true },
    ]);
  });

  test('keeps a query string already present in the url', () => {
    const yaak: YaakCollection = {
      name: 'Merged',
      items: [
        {
          id: '1',
          name: 'Search',
          method: 'GET',
          url: 'https://example.com/v2/products?page=2',
          urlParameters: [{ name: 'search', value: 'lua', enabled: true }],
        },
      ],
    };

    const url = asRequest(yaakToPostman(yaak).item[0]).request.url;
    expect(url.raw).toBe('https://example.com/v2/products?page=2&search=lua');
    expect(url.host).toEqual(['example', 'com']);
    expect(url.path).toEqual(['v2', 'products']);
  });

  test('turns path placeholders into url variables', () => {
    const yaak: YaakCollection = {
      name: 'Path Var',
      items: [
        {
          id: '1',
          name: 'Merge MR',
          method: 'POST',
          url: '${[ GITLAB_URL ]}/projects/:id/merge_requests/:iid/merge',
          urlParameters: [{ name: ':id', value: '42', enabled: true }],
        },
      ],
    };

    const url = asRequest(yaakToPostman(yaak).item[0]).request.url;
    expect(url.variable).toEqual([{ key: 'id', value: '42', type: 'string' }]);
    expect(url.query).toBeUndefined();
    expect(url.raw).toBe('{{GITLAB_URL}}/projects/:id/merge_requests/:iid/merge');
  });

  test('converts variables in header keys and values', () => {
    const yaak: YaakCollection = {
      name: 'Headers',
      items: [
        {
          id: '1',
          name: 'Headers',
          method: 'GET',
          url: 'https://example.com',
          headers: [{ name: '${[ BUSINESS_ID_HEADER ]}', value: '${[ businessId ]}', enabled: true }],
        },
      ],
    };

    const request = asRequest(yaakToPostman(yaak).item[0]).request;
    expect(request.header).toEqual([{ key: '{{BUSINESS_ID_HEADER}}', value: '{{businessId}}' }]);
  });

  test('omits an empty body but keeps a json one', () => {
    const yaak: YaakCollection = {
      name: 'Bodies',
      items: [
        { id: '1', name: 'Empty', method: 'GET', url: 'https://example.com/a', body: {}, bodyType: null },
        {
          id: '2',
          name: 'Json',
          method: 'POST',
          url: 'https://example.com/b',
          body: { text: '{"id":"${[ businessId ]}"}' },
          bodyType: 'application/json',
        },
      ],
    };

    const postman = yaakToPostman(yaak);
    expect(asRequest(postman.item[0]).request.body).toBeUndefined();
    expect(asRequest(postman.item[1]).request.body).toEqual({
      mode: 'raw',
      raw: '{"id":"{{businessId}}"}',
      options: { raw: { language: 'json' } },
    });
  });

  test('maps a form body by content type', () => {
    const form = [{ name: 'grant_type', value: 'password', enabled: true }];
    const build = (bodyType: string): YaakCollection => ({
      name: 'Form',
      items: [{ id: '1', name: 'Token', method: 'POST', url: 'https://example.com/token', body: { form }, bodyType }],
    });

    expect(asRequest(yaakToPostman(build('application/x-www-form-urlencoded')).item[0]).request.body).toEqual({
      mode: 'urlencoded',
      urlencoded: [{ key: 'grant_type', value: 'password' }],
    });
    expect(asRequest(yaakToPostman(build('multipart/form-data')).item[0]).request.body).toEqual({
      mode: 'formdata',
      formdata: [{ key: 'grant_type', value: 'password' }],
    });
  });

  test('reports auth only when a credential is present', () => {
    const build = (authentication: Record<string, unknown>): YaakCollection => ({
      name: 'Auth',
      items: [{ id: '1', name: 'Auth', method: 'GET', url: 'https://example.com', authentication }],
    });

    const bearer = asRequest(yaakToPostman(build({ token: 'abc' })).item[0]).request.auth;
    expect(bearer).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: 'abc', type: 'string' }] });

    const blank = asRequest(yaakToPostman(build({ token: '' })).item[0]).request.auth;
    expect(blank).toEqual({ type: 'noauth' });
  });

  test('converts an environment', () => {
    const postman = yaakEnvironmentToPostman({
      name: 'Global Variables',
      variables: [
        { name: 'baseURL', value: 'https://api.example.com', enabled: true },
        { name: 'stale', value: 'https://old.example.com', enabled: false },
      ],
    });

    expect(postman).toEqual({
      name: 'Global Variables',
      values: [
        { key: 'baseURL', value: 'https://api.example.com', type: 'default', enabled: true },
        { key: 'stale', value: 'https://old.example.com', type: 'default', enabled: false },
      ],
      _postman_variable_scope: 'environment',
    });
  });
});
