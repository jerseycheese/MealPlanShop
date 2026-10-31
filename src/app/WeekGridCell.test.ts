import * as assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeekGridCell } from './WeekGridCell';

const meal = { name: 'Birria Bowls', ingredients: [] } as never;
const noop = () => {};
const render = (moving: boolean) =>
  renderToStaticMarkup(
    createElement(WeekGridCell, {
      day: 'Wednesday',
      mealType: 'dinner',
      meal,
      isPickedUp: false,
      isValidTarget: true,
      moving,
      interactionDisabled: true,
      onActivate: noop,
      onPick: noop,
      onDrop: noop,
      onDragEnd: noop,
    })
  );

// The cell the user dropped on must stay a <button> mid-move; swapping it for a
// <div> unmounts the focused element and sends keyboard focus to <body>.
const moving = render(true);
assert.match(
  moving,
  /^<button[^>]*aria-disabled="true"/,
  'moving cell stays an inert button'
);
assert.doesNotMatch(moving, /draggable/, 'moving cell is not draggable');

assert.match(
  render(false),
  /^<div/,
  'other cells stay static while a move is in flight'
);
