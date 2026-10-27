# Edge Resume Autofill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or direct inline execution task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test a local Edge extension that fills Baidu Talent resume fields from the existing JSON profile and provides a reusable generic autofill base.

**Architecture:** A Manifest V3 extension loads shared pure modules for profile normalization and matching, then browser-only modules scan and fill page controls. Baidu gets a site adapter for its Brick Select and Ant Design controls.

**Tech Stack:** Manifest V3, plain JavaScript, CSS, Node built-in `node:test`, Playwright CLI for Edge verification.

---

### Task 1: Core Tests

**Files:**
- Create: `test/unit.test.js`

- [ ] Write failing tests for normalizing `profileV2.sections` into candidates.
- [ ] Write failing tests for matching Baidu labels such as `移动电话`, `目标工作城市`, `项目职务`, and `职位年薪`.
- [ ] Run `node --test test/unit.test.js` and confirm expected module-not-found failures.

### Task 2: Shared Core

**Files:**
- Create: `shared/profile-normalizer.js`
- Create: `shared/matcher.js`

- [ ] Implement only enough normalization and matching to pass Task 1.
- [ ] Run `node --test test/unit.test.js` and confirm pass.

### Task 3: Extension Shell

**Files:**
- Create: `manifest.json`
- Create: `background.js`
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`
- Create: `data/profile.json`

- [ ] Build the unpacked Edge extension structure.
- [ ] Copy the authorized profile JSON into `data/profile.json`.
- [ ] Add popup buttons for scan, fill, import JSON, and open Baidu with `dev=0`.

### Task 4: Content Scanner and Filler

**Files:**
- Create: `shared/filler.js`
- Create: `content/content.js`
- Create: `content/content.css`
- Create: `test/fixture.html`

- [ ] Add a page scanner that detects native, Brick, and Ant Design controls.
- [ ] Add a filler that dispatches real input/change/click events for React-controlled forms.
- [ ] Add Baidu site mapping and skip unsafe fields.

### Task 5: Verification

**Files:**
- Create: `test/playwright-fixture-check.js`
- Create: `test/playwright-baidu-scan.js`

- [ ] Run Node unit tests.
- [ ] Load the extension in Edge against the local fixture and verify fields are filled.
- [ ] Open `https://talent.baidu.com/jobs/resume/create?dev=0`, scan fields, and verify Baidu mappings are produced without clicking save.
- [ ] Record verified counts in the final response.
