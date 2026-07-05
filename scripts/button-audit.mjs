import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const roots = ['src/components', 'src/App.jsx'];
const files = [];

const walk = async (targetPath) => {
  const details = await stat(targetPath);

  if (details.isDirectory()) {
    const entries = await readdir(targetPath);
    await Promise.all(entries.map((entry) => walk(path.join(targetPath, entry))));
    return;
  }

  if (/\.(jsx|js)$/.test(targetPath)) {
    files.push(targetPath);
  }
};

await Promise.all(roots.map((root) => walk(root)));

const issues = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const buttonPattern = /<button\b[\s\S]*?<\/button>/g;
  let match;

  while ((match = buttonPattern.exec(source))) {
    const block = match[0];
    const isPlainButton = /type=["']button["']/.test(block);
    const hasClickHandler = /\bonClick=/.test(block);

    if (isPlainButton && !hasClickHandler) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      const label = block
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      issues.push({ file, line, label });
    }
  }
}

assert.deepEqual(issues, [], `Buttons without onClick:\n${JSON.stringify(issues, null, 2)}`);
console.log('button audit passed');
