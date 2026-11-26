'use strict';
const assert = require('node:assert/strict');
const { normalizeSignupDisplayName, validateSignupDisplayName, getPasswordStrength } = require('../modules/auth-validation.js');
assert.equal(normalizeSignupDisplayName('  محمد   النبهاني  '), 'محمد النبهاني');
assert.equal(validateSignupDisplayName('محمد النبهاني').valid, true);
assert.equal(validateSignupDisplayName('محمد').valid, false);
assert.equal(validateSignupDisplayName('محمد النبهاني الثالث').valid, true);
assert.equal(validateSignupDisplayName('محمد النبهاني الثالث الرابع').valid, false);
assert.equal(getPasswordStrength('').level, 0);
assert.equal(getPasswordStrength('abc').level, 1);
assert.equal(getPasswordStrength('abcdefgh').level, 1);
assert.equal(getPasswordStrength('Abcdef12').level, 3);
assert.equal(getPasswordStrength('Abcdefgh1234!').level, 4);
console.log('auth-validation tests passed');

// Script-order contract: module is loaded before the main inline consumer.
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const moduleIndex = html.indexOf('<script src="./modules/auth-validation.js"></script>');
const mainIndex = html.indexOf("<script>\n'use strict';");
assert.ok(moduleIndex >= 0 && mainIndex > moduleIndex, 'module must load before main script');
for (const name of ['normalizeSignupDisplayName','validateSignupDisplayName','getPasswordStrength']) {
  assert.ok(html.includes('function '+name+'('), 'compatibility wrapper retained: '+name);
  assert.ok(html.includes('BizmindAuthValidation.'+name), 'wrapper delegates: '+name);
}
