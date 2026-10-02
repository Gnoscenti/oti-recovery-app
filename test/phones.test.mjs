import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNumber, formatDisplay, isValidNumber, telHref, smsHref, searchPhones, groupByCategory } from '../www/js/phones.js';

test('normalizeNumber strips formatting, keeps leading +', () => {
  assert.equal(normalizeNumber(' (619) 555-0100 '), '6195550100');
  assert.equal(normalizeNumber('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizeNumber(''), '');
});

test('formatDisplay formats US numbers and leaves others alone', () => {
  assert.equal(formatDisplay('6195550100'), '(619) 555-0100');
  assert.equal(formatDisplay('18006624357'), '1-800-662-4357');
  assert.equal(formatDisplay('988'), '988');
});

test('isValidNumber accepts short codes, US numbers, international; rejects junk', () => {
  for (const ok of ['988', '211', '741741', '619 555 0100', '1-800-662-4357', '+442079460958']) assert.ok(isValidNumber(ok), ok);
  for (const bad of ['', '12', '555-0100', '61955501000', 'call me', '+1']) assert.ok(!isValidNumber(bad), bad);
});

test('telHref produces dialable links', () => {
  assert.equal(telHref('988'), 'tel:988');
  assert.equal(telHref('6195550100'), 'tel:+16195550100');
  assert.equal(telHref('18006624357'), 'tel:+18006624357');
  assert.equal(telHref('+442079460958'), 'tel:+442079460958');
  assert.equal(telHref(''), '');
});

test('smsHref prefills a body when given', () => {
  assert.equal(smsHref({ number: '741741', body: 'HOME' }), 'sms:741741?body=HOME');
  assert.equal(smsHref({ number: '988' }), 'sms:988');
  assert.equal(smsHref({ number: '18009444773', body: 'Help' }), 'sms:+18009444773?body=Help');
});

const entries = [
  { id: 'a', name: '988 Suicide & Crisis Lifeline', number: '988', display: '988', hours: '24/7', languages: 'English, Spanish', category: 'crisis', description: 'Call or text.' },
  { id: 'b', name: 'PSI HelpLine', number: '18009444773', display: '1-800-944-4773', hours: 'Daily', languages: 'English, Spanish', category: 'moms', description: 'Perinatal support.' },
  { id: 'c', name: 'Poison Control', number: '18002221222', display: '1-800-222-1222', hours: '24/7', category: 'safety', description: 'Poisoning help.' },
];

test('searchPhones matches text and digits, case-insensitively', () => {
  assert.deepEqual(searchPhones(entries, 'poison').map((e) => e.id), ['c']);
  assert.deepEqual(searchPhones(entries, 'SPANISH').map((e) => e.id), ['a', 'b']);
  assert.deepEqual(searchPhones(entries, '944-4773').map((e) => e.id), ['b']);
  assert.equal(searchPhones(entries, '').length, 3);
  assert.equal(searchPhones(entries, 'zzz').length, 0);
});

test('groupByCategory keeps category order and drops empty groups', () => {
  const cats = [{ id: 'crisis', label: 'Crisis' }, { id: 'local', label: 'Local' }, { id: 'moms', label: 'Moms' }, { id: 'safety', label: 'Safety' }];
  const groups = groupByCategory(entries, cats);
  assert.deepEqual(groups.map((g) => g.id), ['crisis', 'moms', 'safety']);
  assert.equal(groups[0].items[0].id, 'a');
});
