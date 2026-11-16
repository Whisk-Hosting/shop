import { test } from "node:test"
import assert from "node:assert/strict"
import { publishableFor } from "../storefront/src/lib/stripe"

test("the storefront shows the publishable key of the payment's mode", () => {
  assert.equal(publishableFor(false, ["pk_live_1", "pk_test_1"]), "pk_test_1")
  assert.equal(publishableFor(true, ["pk_live_1", "pk_test_1"]), "pk_live_1")
  assert.equal(publishableFor(undefined, ["pk_live_1", "pk_test_1"]), "pk_live_1")
  assert.equal(publishableFor(true, [null, "pk_test_1"]), "pk_test_1")
  assert.equal(publishableFor(false, [null, null]), null)
})
