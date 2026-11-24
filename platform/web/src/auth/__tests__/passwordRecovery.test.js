import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_RECOVERY_FLAG_KEY,
  capturePasswordRecoveryFromLocation,
  clearPasswordRecovery,
  hasPasswordRecoveryFlag,
  installPasswordRecoveryListener,
  loginShouldRedirectToUpdatePassword,
  markPasswordRecovery,
  rootRedirectTarget,
  updatePasswordFormIsReady,
  updatePasswordLocation,
  urlHasAuthCallbackParams,
  urlHasPkceCode,
  urlHasRecoveryType,
  urlIndicatesPasswordRecovery,
} from "../passwordRecovery.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    _data: data,
  };
}

const recoveryHash =
  "https://web.example/update-password#access_token=tok&expires_in=3600&type=recovery&token_type=bearer";
const recoveryQuery = "https://web.example/login?type=recovery&token_hash=abc";
const pkceOnReset = "https://web.example/update-password?code=pkce-code";
const pkceOnLogin = "https://web.example/login?code=signup-code";
const plainLogin = "https://web.example/login";
const siteRoot = "https://web.example/";

test("urlHasRecoveryType reads type=recovery from hash or query", () => {
  assert.equal(urlHasRecoveryType(recoveryHash), true);
  assert.equal(urlHasRecoveryType(recoveryQuery), true);
  assert.equal(urlHasRecoveryType(pkceOnReset), false);
  assert.equal(urlHasRecoveryType(plainLogin), false);
  assert.equal(urlHasRecoveryType(""), false);
  assert.equal(urlIndicatesPasswordRecovery(recoveryHash), true);
  assert.equal(urlIndicatesPasswordRecovery(pkceOnReset), false);
});

test("urlHasPkceCode and auth callback detection", () => {
  assert.equal(urlHasPkceCode(pkceOnReset), true);
  assert.equal(urlHasPkceCode(pkceOnLogin), true);
  assert.equal(urlHasPkceCode(recoveryHash), false);
  assert.equal(urlHasAuthCallbackParams(recoveryHash), true);
  assert.equal(urlHasAuthCallbackParams(pkceOnLogin), true);
  assert.equal(urlHasAuthCallbackParams(`${siteRoot}#access_token=tok`), true);
  assert.equal(urlHasAuthCallbackParams(plainLogin), false);
  assert.equal(urlHasAuthCallbackParams(siteRoot), false);
});

test("flag helpers use the injected storage", () => {
  const storage = memoryStorage();
  assert.equal(hasPasswordRecoveryFlag(storage), false);
  assert.equal(markPasswordRecovery(storage), true);
  assert.equal(storage.getItem(PASSWORD_RECOVERY_FLAG_KEY), "1");
  assert.equal(hasPasswordRecoveryFlag(storage), true);
  assert.equal(clearPasswordRecovery(storage), true);
  assert.equal(hasPasswordRecoveryFlag(storage), false);
});

test("capture from location only stamps type=recovery URLs", () => {
  const storage = memoryStorage();
  assert.equal(capturePasswordRecoveryFromLocation(pkceOnLogin, storage), false);
  assert.equal(hasPasswordRecoveryFlag(storage), false);
  assert.equal(capturePasswordRecoveryFromLocation(recoveryHash, storage), true);
  assert.equal(hasPasswordRecoveryFlag(storage), true);
});

test("login redirects on recovery type or flag, not on a bare signup code", () => {
  const storage = memoryStorage();
  assert.equal(loginShouldRedirectToUpdatePassword(plainLogin, storage), false);
  assert.equal(loginShouldRedirectToUpdatePassword(pkceOnLogin, storage), false);
  assert.equal(loginShouldRedirectToUpdatePassword(recoveryQuery, storage), true);
  markPasswordRecovery(storage);
  assert.equal(loginShouldRedirectToUpdatePassword(plainLogin, storage), true);
  assert.equal(loginShouldRedirectToUpdatePassword(pkceOnLogin, storage), true);
});

test("update-password form is ready for hash, flag, event, or PKCE code on that route", () => {
  const storage = memoryStorage();
  assert.equal(updatePasswordFormIsReady(plainLogin, { flag: false }, storage), false);
  assert.equal(updatePasswordFormIsReady(recoveryHash, { flag: false }, storage), true);
  assert.equal(updatePasswordFormIsReady(pkceOnReset, { flag: false }, storage), true);
  assert.equal(
    updatePasswordFormIsReady("https://web.example/update-password", { flag: false, eventFired: true }, storage),
    true,
  );
  assert.equal(
    updatePasswordFormIsReady("https://web.example/update-password", { flag: true }, storage),
    true,
  );
  assert.equal(
    updatePasswordFormIsReady("https://web.example/update-password", {}, storage),
    false,
  );
  markPasswordRecovery(storage);
  assert.equal(
    updatePasswordFormIsReady("https://web.example/update-password", {}, storage),
    true,
  );
});

test("root redirect preserves recovery and waits on ambiguous callbacks", () => {
  const storage = memoryStorage();
  assert.equal(rootRedirectTarget(siteRoot, { flag: false }, storage), "dashboard");
  assert.equal(rootRedirectTarget(`${siteRoot}`, { flag: false }, storage), "dashboard");
  assert.equal(rootRedirectTarget(recoveryHash.replace("/update-password", ""), { flag: false }, storage), "update-password");
  assert.equal(rootRedirectTarget("https://web.example/?type=recovery", { flag: false }, storage), "update-password");
  assert.equal(rootRedirectTarget("https://web.example/?code=pkce-code", { flag: false }, storage), "wait");
  assert.equal(rootRedirectTarget("https://web.example/#access_token=tok", { flag: false }, storage), "wait");
  markPasswordRecovery(storage);
  assert.equal(rootRedirectTarget(siteRoot, {}, storage), "update-password");
  assert.equal(rootRedirectTarget("https://web.example/?code=pkce-code", {}, storage), "update-password");
});

test("updatePasswordLocation keeps search and hash", () => {
  assert.deepEqual(updatePasswordLocation(recoveryHash), {
    pathname: "/update-password",
    search: "",
    hash: "#access_token=tok&expires_in=3600&type=recovery&token_type=bearer",
  });
  assert.deepEqual(updatePasswordLocation(pkceOnLogin), {
    pathname: "/update-password",
    search: "?code=signup-code",
    hash: "",
  });
});

test("installPasswordRecoveryListener captures URL and auth events", () => {
  const storage = memoryStorage();
  const listeners = [];
  const auth = {
    onAuthStateChange(cb) {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe() {} } } };
    },
  };

  installPasswordRecoveryListener(auth, { storage, href: recoveryHash });
  assert.equal(hasPasswordRecoveryFlag(storage), true);

  listeners[0]("SIGNED_OUT");
  assert.equal(hasPasswordRecoveryFlag(storage), false);

  listeners[0]("SIGNED_IN");
  assert.equal(hasPasswordRecoveryFlag(storage), false);

  listeners[0]("PASSWORD_RECOVERY");
  assert.equal(hasPasswordRecoveryFlag(storage), true);
});

test("install listener does not stamp a bare signup PKCE code", () => {
  const storage = memoryStorage();
  const auth = {
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  };
  installPasswordRecoveryListener(auth, { storage, href: pkceOnLogin });
  assert.equal(hasPasswordRecoveryFlag(storage), false);
});
