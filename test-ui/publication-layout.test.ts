import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('public upload styles retain bounded shared metadata and rights review layout',()=>{
  const css=readFileSync(new URL('../console/ui/src/publication.css',import.meta.url),'utf8');
  const shared=css.match(/(?:^|\n)\.public-json\s*\{([^}]+)\}/)?.[1];
  assert.ok(shared,'The shared JSON rule must remain outside the new workbench-specific selector.');
  assert.match(shared,/white-space:\s*pre-wrap/);
  assert.match(shared,/overflow-wrap:\s*anywhere/);
  assert.match(shared,/max-height:\s*360px/);
  assert.match(shared,/overflow-y:\s*auto/);
  assert.match(css,/\.review-checkbox\s*\{[^}]*display:\s*flex/);
  assert.match(css,/\.rights-workbench\s+select\s*\{/);
});
