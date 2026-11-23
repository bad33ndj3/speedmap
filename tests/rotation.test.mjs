import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotateClockwise, layoutFloorplan } from '../rotation.js';

test('rotating four times keeps the original named spot', () => {
  let spot = {id:'a', name:'Test', x:0.25, y:0.75};
  spot = rotateClockwise(spot);
  assert.deepEqual(spot, {id:'a', name:'Test', x:0.25, y:0.25});
  for (let i=0; i<3; i++) spot = rotateClockwise(spot);
  assert.deepEqual(spot, {id:'a', name:'Test', x:0.25, y:0.75});
});

test('portrait layout swaps image dimensions after rotating', () => {
  const image = {naturalWidth: 800, naturalHeight: 400, hidden:false, style:{}};
  const map = {style:{}};
  layoutFloorplan(image, map, 90);
  assert.equal(map.style.width, 'min(100%, 400px)');
  assert.equal(map.style.aspectRatio, '400 / 800');
  assert.equal(image.style.width, '200%');
  assert.equal(image.style.transform, 'translate(-50%, -50%) rotate(90deg)');
});
