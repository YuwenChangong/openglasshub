import assert from 'node:assert/strict';
import { observeFinalLogout } from './locale-v2-logout-observer.mjs';

export async function acceptLocaleLogout({ page, context, factory, expectedActor, authKey, record, transport = () => [] }) {
  record.settlement = 'FAIL_CLOSED';
  await observeFinalLogout({ page, context, factory, expectedActor, authKey, record, diagnostic: false });
  assert.ok(!record.instrumentationFailed, 'LOGOUT_INSTRUMENTATION_ERROR');
  assert.equal(record.finalDocumentIdentified, true, 'FINAL_DOCUMENT_NOT_IDENTIFIED');
  assert.equal(record.observersArmedBeforeClick, true, 'OBSERVERS_NOT_ARMED');
  assert.equal(record.clickCount, 1, 'LOGOUT_CLICK_BUDGET');
  const events = record.events, after = record.after;
  const has = event => events.some(value => value.event === event);
  const signOut = events.filter(value => value.event === 'SIGNOUT_PROMISE_SETTLED');
  assert.equal(signOut.length, 1, 'ONE_SIGNOUT_RESULT_REQUIRED');
  assert.equal(signOut[0].result, 'SUCCESS', 'SIGNOUT_NOT_SUCCESSFUL');
  assert.ok(has('AUTH_STATE_NULL'), 'SIGNED_OUT_NULL_NOT_OBSERVED');
  assert.ok(!has('SIGNOUT_REJECTED'), 'SIGNOUT_REJECTED');

  // A retiring document can cancel its fetch after the owned gateway completed 204.
  // Only that correlated, successful terminal may substitute for browser completion.
  const gateway = transport();
  const gatewayComplete = ['AUTH_UPSTREAM_RESPONSE_FINISHED', 'FRONT_DOOR_RESPONSE_FINISHED']
    .every(event => gateway.some(value => value.event === event && value.status === 204));
  const browserComplete = has('LOGOUT_HTTP_FINISHED') && events.some(value => value.event === 'LOGOUT_HTTP_RESPONSE' && value.status === 204);
  assert.ok(browserComplete || gatewayComplete, 'LOGOUT_HTTP_TERMINAL_MISSING');
  assert.ok(events.filter(value => value.event === 'LOGOUT_HTTP_RESPONSE').every(value => value.status === 204), 'LOGOUT_HTTP_UNSUCCESSFUL');
  record.logoutHttpStatus = 204;
  record.signOutSuccess = true;
  record.signedOutNullObserved = true;

  const final = record.documents.at(-1);
  assert.equal(final?.generation, record.finalDocumentGeneration, 'LATEST_DOCUMENT_REQUIRED');
  assert.ok(final.committed && final.domContentLoaded && final.load && final.httpFinished && final.quietPeriodCompleted, 'FINAL_DOCUMENT_READY_TERMINAL_MISSING');
  assert.equal(final.responseStatus, 200, 'FINAL_DOCUMENT_STATUS');
  assert.equal(final.path, '/settings/', 'FINAL_DOCUMENT_PATH');
  assert.equal(after.readyState, 'complete', 'FINAL_DOCUMENT_NOT_COMPLETE');
  assert.equal(after.path, '/settings/', 'FINAL_PATH');
  assert.ok(after.sessionNull && !after.sessionError && after.authObservable?.hasSession === false, 'FINAL_SESSION_NOT_NULL');
  assert.ok(after.authStorageCleared && after.authCookieNames.length === 0, 'AUTH_STORAGE_NOT_CLEARED');
  assert.equal(after.anonymousDom, true, 'FINAL_ANONYMOUS_DOM_MISSING');
  assert.equal(after.authenticatedDom, false, 'FINAL_AUTHENTICATED_DOM_PRESENT');
  assert.equal(after.logoutAlertPresent, false, 'LOGOUT_ERROR_ALERT_PRESENT');
  const pageErrors = record.pageErrors.filter(value => value.generation === final.generation);
  assert.equal(pageErrors.length, 0, 'FINAL_PAGE_ERROR');
  const failures = record.requestFailures.filter(value => {
    if (value.kind === 'DOCUMENT' && value.generation < final.generation && value.canceled && value.reason === 'net::ERR_ABORTED') return false;
    if (value.kind === 'LOGOUT' && value.canceled && value.reason === 'net::ERR_ABORTED' && value.status === 204 && gatewayComplete) return false;
    return true;
  });
  assert.equal(failures.length, 0, 'UNEXPECTED_REQUEST_FAILURE');
  record.finalPageErrorCount = pageErrors.length;
  record.finalDocumentFailureCount = record.requestFailures.filter(value => value.kind === 'DOCUMENT' && value.generation === final.generation).length;
  record.settlement = 'PASS';
  return record;
}
