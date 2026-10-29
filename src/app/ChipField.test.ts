import * as assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChipField } from './Preferences';

const props = { hint: 'e.g. Italian', values: ['Thai'], onChange: () => {} };

const html = renderToStaticMarkup(
  createElement(ChipField, { ...props, label: 'Cuisine preferences' })
);

const labelFor = html.match(
  /<label for="([^"]+)"[^>]*>Cuisine preferences<\/label>/
)?.[1];
const inputId = html.match(
  /<input id="([^"]+)"[^>]*class="preferences-modal__chip-input"/
)?.[1];

assert.ok(labelFor, 'chip field label has a for attribute');
assert.equal(inputId, labelFor, 'chip field label points at its input');

// Per-member fields repeat the same visible label, so each input needs its own name.
const memberNames = [1, 2].map(
  (n) =>
    renderToStaticMarkup(
      createElement(ChipField, {
        ...props,
        label: "Won't eat",
        ariaLabel: `Member ${n}: Won't eat`,
      })
    ).match(
      /aria-label="([^"]+)"[^>]*class="preferences-modal__chip-input"/
    )?.[1]
);

assert.ok(memberNames[0], 'member chip input has an aria-label');
assert.notEqual(
  memberNames[0],
  memberNames[1],
  'member chip inputs get distinct names'
);
