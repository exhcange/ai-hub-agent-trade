// Run with: node --import tsx scripts/generate-futures-reference.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { createToolRegistry } from '../packages/core/src/index.ts';
const tools = createToolRegistry().list({product:'futures'});
let out = '# Futures operation reference\n\nGenerated from the Core registry. Writes expose prepare tools and require a separate confirm_action. All CLI commands use --profile futures.\n\n| MCP tool | CLI command | Required input | HTTP |\n| --- | --- | --- | --- |\n';
for (const t of tools) {
  const name = t.operation === 'write' ? t.name.replace('futures_', 'futures_prepare_') : t.name;
  out += `| ${name} | ai-hub ${t.cliPath.join(' ')} | ${(t.inputSchema.required??[]).join(', ')||'None'} | ${t.openApiContract.method} ${t.openApiContract.path} |\n`;
}
await mkdir(new URL('../docs/', import.meta.url), {recursive:true});
await writeFile(new URL('../docs/FUTURES_OPERATIONS.md', import.meta.url), out);
