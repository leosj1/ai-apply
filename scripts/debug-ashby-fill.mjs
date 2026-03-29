#!/usr/bin/env node
// Debug: open Ashby apply page and inspect + test-fill UUID fields

import { chromium } from "playwright-core";

const URL = "https://jobs.ashbyhq.com/linear/d3bc1ced-3ce4-4086-a050-555055dbb1ff/application";
const UUID_FIELDS = [
  "#1ed7df4b-e6d4-484e-92c3-4a5f5e07fd0c",
  "#1c843a13-4fe3-43df-afcf-37a69d88591b",
  "#7d3da580-9e6d-494f-a63b-0a889e0a157a",
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2000);

console.log("=== UUID Field Inspection ===");
for (const sel of UUID_FIELDS) {
  const id = sel.slice(1);
  const info = await page.evaluate((fieldId) => {
    const el = document.getElementById(fieldId);
    if (!el) return { found: false };
    return {
      found: true,
      tagName: el.tagName,
      type: el.getAttribute("type"),
      role: el.getAttribute("role"),
      contenteditable: el.getAttribute("contenteditable"),
      className: el.className?.slice(0, 80),
      required: el.hasAttribute("required"),
      disabled: el.disabled,
      parentTag: el.parentElement?.tagName,
      parentClass: el.parentElement?.className?.slice(0, 80),
      hasValueTracker: !!(el)._valueTracker,
      value: el.value?.slice(0, 40) || "",
      innerText: el.innerText?.slice(0, 40) || "",
      reactFiberKeys: Object.keys(el).filter(k => k.startsWith("__react")).join(", "),
    };
  }, id);
  console.log(`\n${sel}:`, JSON.stringify(info, null, 2));
}

// Check React onChange prop
console.log("\n=== React props on #1c843a13 ===");
const reactInfo = await page.evaluate(() => {
  const el = document.getElementById("1c843a13-4fe3-43df-afcf-37a69d88591b");
  if (!el) return "NOT FOUND";
  const propsKey = Object.keys(el).find(k => k.startsWith("__reactProps"));
  const props = propsKey ? el[propsKey] : null;
  return {
    hasOnChange: typeof props?.onChange === "function",
    hasOnInput: typeof props?.onInput === "function",
    hasValue: "value" in (props || {}),
    hasDefaultValue: "defaultValue" in (props || {}),
    propsKeys: Object.keys(props || {}).join(", "),
  };
});
console.log(JSON.stringify(reactInfo, null, 2));

// Test 1: _valueTracker trick
console.log("\n=== Test 1: _valueTracker + native setter on #1c843a13 ===");
const testSel = "1c843a13-4fe3-43df-afcf-37a69d88591b";
const testVal = "https://github.com/testuser";

await page.evaluate(({ id, val }) => {
  const el = document.getElementById(id);
  if (!el) return;
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue("");
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, { id: testSel, val: testVal });

await page.waitForTimeout(500);
const val1 = await page.evaluate(({ id }) => document.getElementById(id)?.value ?? "NOT FOUND", { id: testSel });
console.log("After _valueTracker + 500ms:", val1);

// Test 2: Playwright fill
console.log("\n=== Test 2: page.fill() on #1c843a13 ===");
await page.fill(`#${testSel}`, testVal);
await page.waitForTimeout(500);
const val2 = await page.evaluate(({ id }) => document.getElementById(id)?.value ?? "NOT FOUND", { id: testSel });
console.log("After page.fill() + 500ms:", val2);

// Test 3: Playwright keyboard.type
console.log("\n=== Test 3: triple-click + keyboard.type on #1c843a13 ===");
await page.fill(`#${testSel}`, ""); // clear first
await page.click(`#${testSel}`, { clickCount: 3 });
await page.keyboard.type(testVal, { delay: 10 });
await page.waitForTimeout(500);
const val3 = await page.evaluate(({ id }) => document.getElementById(id)?.value ?? "NOT FOUND", { id: testSel });
console.log("After keyboard.type + 500ms:", val3);

// Test 4: locator fill
console.log("\n=== Test 4: locator.fill() on #1c843a13 ===");
await page.locator(`#${testSel}`).fill(testVal);
await page.waitForTimeout(500);
const val4 = await page.evaluate(({ id }) => document.getElementById(id)?.value ?? "NOT FOUND", { id: testSel });
console.log("After locator.fill() + 500ms:", val4);

await browser.close();
