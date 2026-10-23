// Generate types only: no app bootstrap, migration, seed, environment file or DB.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, '.venv');
fs.mkdirSync(scratch, { recursive: true });
const isolated = fs.mkdtempSync(path.join(scratch, 'prisma-generate-'));
const output = path
  .join(root, 'node_modules', '.prisma', 'client')
  .replaceAll('\\', '/');
const source = fs.readFileSync(
  path.join(root, 'prisma', 'schema.prisma'),
  'utf8',
);
if (!/generator client\s*\{/.test(source))
  throw new Error('Expected existing Prisma client generator');
const schema = source.replace(
  /generator client\s*\{/,
  (match) => `${match}\n  output = ${JSON.stringify(output)}`,
);
fs.writeFileSync(path.join(isolated, 'schema.prisma'), schema);
fs.writeFileSync(
  path.join(isolated, 'package.json'),
  JSON.stringify({
    name: 'isolated-client-generation',
    private: true,
    dependencies: { '@prisma/client': '4.16.2' },
  }),
);
const result = spawnSync(
  process.execPath,
  [
    '--require',
    path.join(__dirname, 'deny-env-file-reads.cjs'),
    path.join(root, 'node_modules', 'prisma', 'build', 'index.js'),
    'generate',
    '--schema',
    path.join(isolated, 'schema.prisma'),
  ],
  {
    cwd: isolated,
    env: {
      ...process.env,
      DATABASE_URL: 'file:synthetic-unused.db',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
      CHECKPOINT_DISABLE: '1',
    },
    encoding: 'utf8',
  },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
