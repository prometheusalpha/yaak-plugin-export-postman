#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import {
  yaakEnvironmentToPostman,
  yaakToPostman,
  type YaakCollection,
  type YaakEnvironment,
  type YaakFolder,
  type YaakItem,
  type YaakRequest,
} from './postman';

interface ExportRequest extends YaakRequest {
  workspaceId: string;
  folderId: string | null;
}

interface ExportFolder {
  id: string;
  name: string;
  workspaceId: string;
  folderId: string | null;
  description?: string;
  authentication?: Record<string, unknown>;
}

interface ExportEnvironment extends YaakEnvironment {
  base?: boolean;
}

interface ExportWorkspace {
  id: string;
  name: string;
  description?: string;
  authentication?: Record<string, unknown>;
}

interface YaakExportFile {
  resources?: {
    workspaces?: ExportWorkspace[];
    folders?: ExportFolder[];
    httpRequests?: ExportRequest[];
    environments?: ExportEnvironment[];
  };
}

const sanitizeFileName = (name: string): string => name.trim().replace(/[^a-zA-Z0-9._-]+/g, '_');

/**
 * A raw Yaak export stores every resource as a flat row keyed by `workspaceId`
 * and `folderId`; the converter wants a nested `{ name, items[] }` collection.
 */
function exportToCollection(exportFile: YaakExportFile, workspace: ExportWorkspace): YaakCollection {
  const folders = (exportFile.resources?.folders ?? []).filter(f => f.workspaceId === workspace.id);
  const requests = (exportFile.resources?.httpRequests ?? []).filter(r => r.workspaceId === workspace.id);
  const environments = (exportFile.resources?.environments ?? []).filter(e => e.workspaceId === workspace.id);

  const variables: Record<string, string> = {};
  const baseEnvironment = environments.find(e => e.base) ?? environments[0];
  for (const variable of baseEnvironment?.variables ?? []) {
    if (variable.name) variables[variable.name.trim()] = variable.value ?? '';
  }

  const build = (parentId: string | null): YaakItem[] => {
    const items: YaakItem[] = [];
    for (const folder of folders) {
      if ((folder.folderId ?? null) !== parentId) continue;
      items.push({
        id: folder.id,
        name: folder.name,
        description: folder.description,
        authentication: folder.authentication,
        items: build(folder.id),
      } satisfies YaakFolder);
    }
    for (const request of requests) {
      if ((request.folderId ?? null) === parentId) items.push(request);
    }
    return items;
  };

  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    authentication: workspace.authentication,
    variables,
    items: build(null),
  };
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`- ${filePath}`);
}

async function main(argv: string[]) {
  const [inPath, outPathArg] = argv;
  if (!inPath) {
    console.error('Usage: ts-node src/cli.ts <yaak.json> [out.postman.json]');
    process.exit(2);
  }

  const input = JSON.parse(await fs.readFile(inPath, 'utf8')) as YaakExportFile & Partial<YaakCollection>;
  const outDir = path.dirname(path.resolve(outPathArg ?? path.join(process.cwd(), 'postman-export.json')));

  if (!input.resources) {
    if (!Array.isArray(input.items)) {
      throw new Error('Unrecognized input: expected a Yaak export (resources.*) or a collection ({ items: [] })');
    }
    console.log('Generated files:');
    await writeJson(outPathArg ?? path.join(outDir, 'postman-export.json'), yaakToPostman(input as YaakCollection));
    return;
  }

  const workspaces = input.resources.workspaces ?? [];
  if (workspaces.length === 0) throw new Error('No workspaces found in Yaak export');

  console.log('Generated files:');
  for (const workspace of workspaces) {
    const collectionPath =
      workspaces.length > 1
        ? path.join(outDir, `${sanitizeFileName(workspace.name)}.postman_collection.json`)
        : outPathArg ?? path.join(outDir, 'postman-export.json');
    await writeJson(collectionPath, yaakToPostman(exportToCollection(input, workspace)));

    for (const environment of (input.resources.environments ?? []).filter(e => e.workspaceId === workspace.id)) {
      const environmentPath = path.join(outDir, `${sanitizeFileName(environment.name)}.postman_environment.json`);
      await writeJson(environmentPath, yaakEnvironmentToPostman(environment));
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export default main;
