// Generation-only guard: repository environment files must never be read.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
function checkFile(file) {
  if (typeof file === 'number') return;
  const filename = file instanceof URL ? fileURLToPath(file) : String(file);
  if (/^\.env(?:\.|$)/i.test(path.basename(filename))) {
    throw new Error(
      'Isolated client generation refused an environment file read',
    );
  }
}
for (const name of ['readFileSync', 'readFile']) {
  const original = fs[name];
  fs[name] = function (file, ...args) {
    checkFile(file);
    return original.call(this, file, ...args);
  };
}
const originalPromiseRead = fs.promises.readFile;
fs.promises.readFile = function (file, ...args) {
  checkFile(file);
  return originalPromiseRead.call(this, file, ...args);
};
