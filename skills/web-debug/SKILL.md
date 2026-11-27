---
name: web-debug
description: "Debug or verify a web app in a real browser through the Playwright and Chrome DevTools MCP servers: reproduce the problem, then read the evidence (console, network, storage, DOM, rendering, performance) instead of guessing from source or asking the user to copy from devtools. Use for failing requests (401/403/CORS/500), login or session problems, forms or buttons that do nothing, blank or broken pages, Angular change-detection or state bugs, slow pages, 'works locally, fails in prod', and for checking a frontend change end-to-end."
---

# Debugging in the browser

Source code says what should happen; the browser shows what did. Reproduce the
problem in a real page, collect evidence, and only then explain it. Don't ask
the user to copy things out of their devtools: read them yourself.

## Before you start

The servers are off by default (`"enabled": false` in `mcp.json`) so they don't
run in every session. If their tools are missing, ask the user to turn one on
with `/mcp`. If a tool isn't declared yet, load it with `tool_search` or call it
from `codemode`.

| Server | pi tool names | Pick it for |
|---|---|---|
| `playwright` | `mcp__playwright__browser_*` | Most debugging: driving the page, console, network, evaluating JS, screenshots |
| `chrome-devtools` | `mcp__chrome_devtools__*` | Logpoints, scripts that run before the app loads, request history across navigations, throttling and device emulation, performance traces, Lighthouse, CSS |

Each server runs its own browser with its own persistent profile: a login done
in one is not visible in the other, but survives between turns in the same one.
Pick one per investigation, check whether you're already logged in, and don't
close the browser between steps. Playwright opens a visible window unless the
server runs with `--headless`.

## The loop

1. **Reproduce.** Navigate, then act like the user. In Playwright, take a
   `browser_snapshot` first: actions name an element (`element`, in words) and
   its `target` (the ref from the snapshot). Refs change after navigation or a
   re-render, so take a new snapshot when one stops working.
2. **Collect** the evidence the symptom points to (see below). Note exact
   values: status codes, header values, error text, line numbers.
3. **Explain** the failure from that evidence, and say which piece shows it.
4. **Fix** in the source.
5. **Run the same steps again** and show that the evidence changed.

| Symptom | Look first at |
|---|---|
| Request fails: 4xx/5xx, CORS, "network error" | [Network](#network) |
| Login fails, logged out on reload, "unauthorized" while logged in | [Network](#network), then [Storage and auth](#storage-and-auth) |
| Button or form does nothing | [Console](#console), then [DOM and forms](#dom-and-forms) |
| Blank, half-rendered or wrong page | [Console](#console), then [Rendering](#rendering) |
| Data on screen doesn't match the API, or doesn't update | [Network](#network), then [Angular](#angular) |
| Slow load or janky interaction | [Performance](#performance) |
| Only fails in prod or on another machine | Same steps against both, then compare evidence |

## Evidence

### Console

- Playwright: `browser_console_messages level=error` (`warning` includes
  errors too). It returns messages **since the last navigation**; pass
  `all: true` for the whole session, e.g. after a redirect.
- Chrome DevTools: `list_console_messages` with `includeStackTraces: true`,
  `includePreservedMessages: true` to keep the last 3 navigations.
- Need a value logged at a line you can't easily edit? `set_logpoints` with
  `<script url>:<line> <expression>` logs it without changing the code; reload
  and read the console.

The first error is usually the cause; the ones after it are often fallout.

### Network

- Playwright: `browser_network_requests filter=<url regex>` lists requests
  since the last navigation (`all: true` for the session; static assets are
  hidden unless `static: true`). Then `browser_network_request index=<n>`, and
  `part=request-headers | request-body | response-headers | response-body` to
  fetch just one piece.
- Chrome DevTools: `list_network_requests` (`includePreservedRequests: true`
  keeps redirect chains), then `get_network_request reqid=<n>`.

How to read it:

- **401**: credentials missing or rejected. Check the `Authorization` header
  or cookies actually sent, not the ones the code intends to send.
- **403**: authenticated but not allowed: roles, scopes, row-level policies.
- **CORS**: find the `OPTIONS` preflight. Compare the request's `Origin` and
  `Access-Control-Request-*` headers with the response's
  `Access-Control-Allow-*`. A credentialed request needs an exact origin and
  `Access-Control-Allow-Credentials: true`, never `*`.
- **Request never sent**: nothing in the list means the code never reached the
  call; go to the console.
- **200 but the page is wrong**: read the response body; the bug is in how the
  client uses it.

### Storage and auth

```
browser_evaluate function="() => ({ local: { ...localStorage }, session: { ...sessionStorage } })"
browser_evaluate function="() => document.cookie"
```

`document.cookie` can't see `HttpOnly` cookies: look for `set-cookie` in the
login response headers, and for the `cookie` request header on later calls.
Decode a JWT without sending it anywhere:

```
browser_evaluate function="() => {
  const token = localStorage.getItem('<key>');            // or wherever the app keeps it
  const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const part = (i) => JSON.parse(new TextDecoder().decode(bytes(token.split('.')[i])));
  const claims = part(1);
  return { header: part(0), claims, secondsLeft: claims.exp - Date.now() / 1000 };
}"
```

Check `exp`, `aud`, `iss` and roles. Don't paste tokens or cookies into your
answer; report the relevant claims.

### DOM and forms

- Is the element there and what you think it is? `browser_snapshot`, or
  evaluate `el.outerHTML` on a `target`.
- Clicks that do nothing: something may cover the element. Ask what is on top
  at its center (scroll it into view first: off-screen points return `null`),
  and check `disabled`, `pointer-events` and `visibility`:

  ```
  browser_evaluate target=<ref> function="(el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const css = getComputedStyle(el);
    return { onTop: el.contains(top), covering: el.contains(top) ? null : top?.outerHTML.slice(0, 120),
             disabled: el.disabled ?? null, pointerEvents: css.pointerEvents, visibility: css.visibility };
  }"
  ```
- Forms: `[...document.forms].map(f => ({ id: f.id, valid: f.checkValidity(),
  invalid: [...f.elements].filter(e => !e.checkValidity()).map(e => e.name) }))`
  finds the field that blocks submit, often a hidden `required` one.

### Rendering

- `browser_take_screenshot` (whole page with `fullPage: true`) to see what the
  user sees; use it to back up visual claims.
- An empty `<body>` with console errors: rendering crashed, read the first
  error. An empty body without errors: the app never booted. Fetch the raw HTML
  with `fetch_content mode=raw` and check the script tags and their status in
  the network list.
- Stale code after a deploy: a service worker or the cache serves an old
  bundle. Reload with `navigate_page type=reload ignoreCache=true`, or check
  `navigator.serviceWorker.getRegistrations()`.
- Layout and theme bugs: `emulate` a viewport, `colorScheme` or
  `prefersReducedMotion`; `get_css_styles` shows the computed styles of an
  element.

### Angular

Development builds expose debugging helpers on `window.ng`. They are missing
in production builds; if `typeof ng` is `"undefined"`, use the other sections.

```
browser_evaluate target=<ref> function="(el) => {
  const cmp = ng.getComponent(el) ?? ng.getOwningComponent(el);
  return { name: cmp?.constructor.name, state: { ...cmp } };
}"
browser_evaluate target=<ref> function="(el) => ng.getListeners(el).map(l => l.name)"
```

- State is right but the screen isn't: change detection didn't run. Check for
  `OnPush` components fed by mutated objects, or updates outside Angular.
  `ng.applyChanges(cmp)` after a manual change confirms it.
- `ExpressionChangedAfterItHasBeenChecked` and `NG0…` errors appear in the
  console with a code; the code names the cause on angular.dev.
- `ng.getInjector(el).get(<token>)` reaches a service instance only if you can
  name the token; otherwise read the component's fields.

### Performance

Use Chrome DevTools:

```
navigate_page url=<page>
performance_start_trace reload=true autoStop=true
performance_analyze_insight insightName=<one the trace lists>
```

`lighthouse_audit` gives a broader report. To reproduce a slow device or
network, `emulate networkConditions="Slow 4G" cpuThrottlingRate=4` before the
trace. For memory growth, compare two `take_heapsnapshot`s taken before and
after repeating an action.

## Reporting

Give the user: the steps that reproduce it, the evidence (status, header,
error, value) with where it came from, the cause, the fix, and the evidence
after the fix. "I ran it again and the request now returns 200 with the
expected body" is a result; "this should fix it" is not.

## Traps

- `browser_evaluate` takes a function: `function="() => …"`, or
  `(el) => …` with a `target`. Return plain data, never DOM nodes or
  `window`. Use an `async` function to `await` inside.
- `fetch()` in a check without reading the body can show up as aborted.
  `const r = await fetch(url); await r.text(); return r.status;`
- Console and network lists reset on navigation unless you ask for all of them.
- Two servers, two browsers: a session or a fix verified in one says nothing
  about the other.
- `browser_run_code_unsafe` runs arbitrary Playwright code; use it only when the
  normal tools can't express a step.

## When the browser isn't needed

- Static content from a public URL: `fetch_content` is faster.
- Why code was written a certain way: read the source and history.
- The same check over many pages: write a script and run it with `bash`.
