import * as assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChipField } from './Preferences';

const html = renderToStaticMarkup(
  createElement(ChipField, {
    label: 'Cuisine preferences',
    hint: 'e.g. Italian',
    values: ['Thai'],
    onChange: () => {},
  })
);

const labelFor = html.match(
  /<label for="([^"]+)"[^>]*>Cuisine preferences<\/label>/
)?.[1];
const inputId = html.match(
  /<input id="([^"]+)"[^>]*class="preferences-modal__chip-input"/
)?.[1];

assert.ok(labelFor, 'chip field label has a for attribute');
assert.equal(inputId, labelFor, 'chip field label points at its input');
