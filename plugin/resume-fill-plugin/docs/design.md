# Edge Resume Autofill Design

## Goal

Build a local Microsoft Edge extension that reads one resume JSON profile and fills recruitment forms after a user explicitly clicks a fill button. The extension must work well on Baidu Talent first, then remain useful on other common Chinese ATS pages.

## Scope

- Load bundled `data/profile.json` by default.
- Let the user import a replacement JSON from the popup.
- Scan the current page and produce a preview of matched fields.
- Fill only matched fields when the user clicks the fill button.
- Never click final save, submit, apply, or upload buttons automatically.
- Skip file uploads, photos, CAPTCHA, login, and unsupported required fields.

## Architecture

- `shared/profile-normalizer.js`: converts the existing OpenJobAutofill `profileV2.sections` JSON into flat field candidates.
- `shared/matcher.js`: pure scoring and mapping logic. This is unit tested in Node before page code is written.
- `shared/filler.js`: browser-side write layer for native inputs, textareas, radios, checkboxes, date/month fields, contenteditable nodes, Brick Select, and Ant Design Select.
- `content/content.js`: scans forms, detects Baidu Talent, creates a page overlay, handles preview/fill messages, and calls the matcher/filler.
- `popup/*`: small control surface for status, JSON import, preview, and fill commands.
- `background.js`: opens `talent.baidu.com/jobs/resume/create` with `?dev=0` to avoid Baidu's own debug detector navigating automated pages to `about:blank`.

## Baidu Talent Adapter

Baidu Talent uses Brick form controls plus Ant Design autocomplete. The adapter maps:

- Resume type: internship profile prefers `实习生简历`.
- Basic fields: name, gender, phone, email.
- Target city: use profile preferred city; current profile resolves to Shenzhen.
- Target position category: use `技术` for software/engineering-related target positions.
- Interview method: default to `国内远程`.
- Education: school autocomplete, start/end month, education level, major autocomplete.
- Work: company, industry, start/end month, department, position, location, description.
- Project: name, role, start/end month, description, responsibility.
- Salary: skip confidential/non-numeric salary ranges instead of guessing.
- File/photo uploads: skip.
- Save/terms checkbox: never auto-click.

## Testing

- Node unit tests cover profile normalization and label matching.
- Browser fixture tests cover native fields, radio, select, custom combobox, and Baidu-like Brick/Ant markup.
- Edge/Playwright verifies the unpacked extension on a local fixture and scans Baidu Talent without saving.
