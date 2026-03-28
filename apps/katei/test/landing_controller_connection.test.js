import test from 'node:test';
import assert from 'node:assert/strict';
import { isLandingControllerConnected } from '../public/js/controllers/landing_controller_connection.js';

test('isLandingControllerConnected returns true when the controller element is connected', () => {
  assert.equal(
    isLandingControllerConnected({
      element: {
        isConnected: true
      }
    }),
    true
  );
});

test('isLandingControllerConnected returns false when the controller element is disconnected', () => {
  assert.equal(
    isLandingControllerConnected({
      element: {
        isConnected: false
      },
      isConnected: true
    }),
    false
  );
});

test('isLandingControllerConnected ignores a missing controller isConnected property when the element is connected', () => {
  assert.equal(
    isLandingControllerConnected({
      element: {
        isConnected: true
      }
    }),
    true
  );
});

test('isLandingControllerConnected ignores controller.isConnected when the element is connected', () => {
  assert.equal(
    isLandingControllerConnected({
      element: {
        isConnected: true
      },
      isConnected: false
    }),
    true
  );
});
