import * as assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dialogKeyAction } from './useDialog';
import { DayMealsField } from './Preferences';

const [first, middle, last] = ['household', 'notes', 'save'];
const fields = [first, middle, last];

assert.deepEqual(dialogKeyAction('Escape', false, fields, middle), {
  type: 'close',
});
assert.deepEqual(
  dialogKeyAction('Tab', false, fields, last),
  { type: 'focus', target: first },
  'Tab on the last field wraps to the first'
);
assert.deepEqual(
  dialogKeyAction('Tab', true, fields, first),
  { type: 'focus', target: last },
  'Shift+Tab on the first field wraps to the last'
);
assert.equal(
  dialogKeyAction('Tab', false, fields, middle),
  null,
  'Tab mid-dialog moves normally'
);
assert.deepEqual(
  dialogKeyAction('Tab', false, fields, 'page-behind'),
  { type: 'focus', target: first },
  'focus outside the dialog is pulled back in'
);

const names = [
  ...renderToStaticMarkup(
    createElement(DayMealsField, { mealsByDay: {}, onToggle: () => {} })
  ).matchAll(/<input type="checkbox" aria-label="([^"]+)"/g),
].map((m) => m[1]);

assert.equal(names.length, 21, 'one checkbox per day and meal');
assert.equal(
  new Set(names).size,
  21,
  'every day-meal checkbox has its own name'
);
assert.ok(names.includes('monday dinner'), 'checkbox name includes its day');
