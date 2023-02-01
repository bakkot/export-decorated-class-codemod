'use strict';

let parser = require('@typescript-eslint/parser');
let fs = require('node:fs/promises');
let path = require('path');

if (process.argv.length !== 3) {
  console.log(`Usage: node transform.js path-to-transform`);
  process.exit(0);
}
walk(process.argv[2]);

// you could parallelize this if you wanted to
async function walk(p) {
  if ((await fs.lstat(p)).isDirectory()) {
    for (let file of await fs.readdir(p)) {
      if (file === 'node_modules') {
        continue;
      }
      await walk(path.join(p, file));
    }
  } else {
    if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      let src = await fs.readFile(p, { encoding: 'utf8' });
      let rewritten = transform(p, src);
      if (rewritten != null) {
        await fs.writeFile(p, rewritten, { encoding: 'utf8' });
        console.log('rewrote', p);
      }
    }
  }
}

function transform(path, src) {
  let jsx = path.endsWith('.tsx');
  let body, tokens;
  try {
    ({ body, tokens } = parser.parse(src, { range: true, tokens: true, ecmaFeatures: { jsx } }));
  } catch (e) {
    console.log(`parse failed for ${JSON.stringify(path)}`);
    return null;
  }

  let nextTokenIdx = 0;
  // NB scanner is stateful
  function scanTokensUpTo(bound, predicate = null) {
    let results = [];
    while (true) {
      let tok = tokens[nextTokenIdx];
      if (tok == null || tok.range[0] > bound) {
        break;
      }
      if (predicate != null && predicate(tok)) {
        results.push(tok);
      }
      ++nextTokenIdx;
    }
    return results;
  }

  function applyTransforms(src, transforms) {
    transforms.sort((a, b) => a.start - b.start);
    let index = 0;
    let out = '';
    for (let item of transforms) {
      out += src.slice(index, item.start);
      switch (item.type) {
        case 'add': {
          out += item.text;
          index = item.start;
          break;
        }
        case 'remove': {
          index = item.end;
          break;
        }
        default: {
          throw new Error(`unknown type ${item.type}`);
        }
      }
    }
    out += src.slice(index);
    return out;
  }

  let mods = [];
  for (let item of body) {
    if (
      (item.type === 'ExportDefaultDeclaration' || item.type === 'ExportNamedDeclaration') &&
      item.declaration?.type === 'ClassDeclaration' &&
      item.declaration.decorators?.length > 0
    ) {
      let klass = item.declaration;
      let firstDecoratorStart = Math.min(...klass.decorators.map(d => d.range[0]));
      let firstDecoratorEnd = Math.min(...klass.decorators.map(d => d.range[1]));
      let klassStart = klass.range[0];
      scanTokensUpTo(firstDecoratorEnd);
      let exportTokens = scanTokensUpTo(
        klassStart,
        t => t.type === 'Keyword' && (t.value === 'export' || t.value === 'default')
      );
      if (exportTokens.length > 0) {
        mods.push({
          type: 'add',
          start: firstDecoratorStart,
          text: src.slice(exportTokens[0].range[0], exportTokens.at(-1).range[1] + 1),
        });
        mods.push({
          type: 'remove',
          start: exportTokens[0].range[0],
          end: exportTokens.at(-1).range[1] + 1,
        });
      }
    }
  }
  if (mods.length === 0) {
    return null;
  }
  return applyTransforms(src, mods);
}
