---
name: web-debug
description: "Debug or verify frontend behavior by driving a live page (DOM, storage, network, console) with the Playwright and Chrome DevTools MCP tools instead of reading source or asking the user to paste from devtools. Use when the user reports: broken login or auth flow, failed/401/403/CORS requests, JWT or session weirdness, form not submitting, button does nothing, blank screen, hydration mismatch, stale data, slow page, 'works locally / fails in prod', or asks you to verify a frontend change end-to-end."
---

# Web debugging via the live page

You can drive a real browser through two MCP servers. Use them. The default
failure mode is reading source, forming a hypothesis, and asking the user to
check their devtools. The answer usually lives in runtime state (localStorage,
the `Authorization` header the SPA actually sent, a console error), not in
source.

## Which server

| Server | Tools (pi names) | Use for |
|---|---|---|
| `playwright` | `mcp__playwright__browser_*` | Default: navigate, click, type, fill forms, evaluate JS, console, network list + details, screenshots |
| `chrome-devtools` | `mcp__chrome_devtools__*` | Performance traces, Lighthouse, heap snapshots, CSS inspection, network throttling / CPU emulation |

Both servers are disabled by default (`"enabled": false` in `mcp.json`) so they don't start in every session. If their tools are missing, ask the user to turn the server on with `/mcp`, then continue.

They run **separate browsers**: cookies and storage are not shared. Stick to
one server for a debugging session; switch only for what the other can't do.
If an MCP tool isn't declared yet, load it with `tool_search` or call it from
`codemode`.

Both servers keep a persistent browser profile by default, so a login from an
earlier turn is usually still there. Check before re-authenticating, and don't
close the browser between steps.

## Pattern-match the report

| User says something like… | Playbook |
|---|---|
| "I can't log in" / "auth doesn't work" | [Auth flow](#auth-flow) |
| "401 / 403 / CORS on `/api/foo`" | [Failing request](#failing-request) |
| "Session doesn't persist" / "logged out on refresh" | [Storage](#storage) |
| "This JWT looks wrong" | [Decode a JWT](#decode-a-jwt) |
| "The form does nothing" | [Form not submitting](#form-not-submitting) |
| "Blank screen" / "stuck loading" | [Blank screen](#blank-screen) |
| "The page is slow" | [Performance](#performance) |
| "Can you verify this fix?" | [Verify a change](#verify-a-change) |

Behavioral bug that fits none of these? Still open the page first.

## Core loop (Playwright)

1. `browser_navigate url=<page>`
2. `browser_snapshot`: get the accessibility tree. Interactive elements carry a
   `ref`; actions take `element` (a human description) plus `target` (that ref).
3. Reproduce: `browser_click`, `browser_type`, `browser_fill_form`,
   `browser_press_key`, `browser_select_option`.
4. Observe: `browser_console_messages`, `browser_network_requests`
   (`filter` narrows by URL), then `browser_network_request index=<n>` for one
   request's headers and body.
5. Read runtime state: `browser_evaluate function="() => …"`.
6. Hypothesize, change code, rerun the loop.

Refs go stale after navigation or a re-render. Take a fresh `browser_snapshot`
when a click fails with an unknown ref.

## Playbooks

### Auth flow

```
browser_navigate          url=<login url>
browser_snapshot                                    # find the email/password/submit refs
browser_fill_form         fields=[{email ref, value}, {password ref, value}]
browser_click             element="Sign in button" target=<ref>
browser_console_messages                            # JS errors?
browser_network_requests  filter=auth               # what was called, what status?
browser_network_request   index=<n>                 # request body + response
browser_evaluate          function="() => Object.keys(localStorage)"
```

Token endpoint returns 200 but no session in storage → the client's storage
adapter or init order is wrong, not the server. 400/401 → read the request
body and response; the problem is upstream.

### Failing request

Reproduce the action, then `browser_network_requests filter=<route>` and open
the failing one with `browser_network_request`. What the headers usually
reveal:

- missing or stale `Authorization` → see the auth flow;
- missing API key header → the client was built without it;
- wrong `content-type` → the body was serialized unexpectedly;
- CORS → compare `origin` with the `access-control-allow-*` response headers;
  a failed preflight shows up as an `OPTIONS` request.

### Storage

```
browser_evaluate function="() => Object.fromEntries(Object.entries(localStorage))"
browser_evaluate function="() => Object.fromEntries(Object.entries(sessionStorage))"
browser_evaluate function="() => document.cookie"
```

`document.cookie` hides `HttpOnly` cookies; check the `set-cookie` header of
the login response instead.

### Decode a JWT

```
browser_evaluate function="() => {
  const tok = /* read it from storage, e.g. */ JSON.parse(localStorage.getItem('<key>')).access_token;
  const dec = s => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
  const [h, p] = tok.split('.');
  const payload = dec(p);
  return { header: dec(h), payload, expiresIn: payload.exp - Math.floor(Date.now() / 1000) };
}"
```

Check `role`, `aud`, `iss`, and `exp` when the API treats a logged-in user as
anonymous.

### Form not submitting

```
browser_evaluate function="() => [...document.forms].map(f => ({ action: f.action, method: f.method, valid: f.checkValidity() }))"
browser_click             element="Submit button" target=<ref>
browser_console_messages
browser_network_requests
```

`valid: false` → an HTML constraint blocks submit (often a hidden `required`
field). Nothing fires on click → no handler bound (hydration problem, or the
button sits outside the form).

### Blank screen

```
browser_navigate          url=<page>
browser_console_messages                            # usually the answer
browser_take_screenshot
browser_evaluate          function="() => document.body.innerHTML.length"
```

Console errors → a runtime error during render tore down the tree. No errors
and an empty body → routing or build problem; fetch the raw HTML with
`fetch_content mode=raw` and check what the server sent.

### Performance

Use `chrome-devtools`:

```
navigate_page            url=<page>
performance_start_trace  reload=true autoStop=true
performance_analyze_insight insightName=<one listed in the trace result>
lighthouse_audit                                    # broader audit
emulate                  networkConditions=…  cpuThrottlingRate=4   # reproduce slow devices
```

### Verify a change

After a code change with visible behavior:

```
browser_navigate          url=<changed page>
# drive the new behavior
browser_evaluate          function="() => <assertion about resulting state>"
browser_take_screenshot                            # if the claim is visual
```

Don't report done without exercising the change. "I drove it and saw the
expected state" beats "this should work".

## Pitfalls

- **Evaluate takes a function**, not an expression: `function="() => …"`.
  Return plain data (`.textContent`, `.value`, `.outerHTML`), never DOM nodes.
- **A `fetch()` whose body you don't read** can show as aborted in the network
  list. In quick checks: `const r = await fetch(url); await r.text(); return r.status;`
  (make the function `async`).
- **Playwright MCP opens a visible browser** unless the server was started
  with `--headless`. That's expected; don't close it between steps.
- **`browser_run_code_unsafe`** runs arbitrary Playwright code. Use it only when
  the regular tools can't express the step.

## When not to use the browser

- Static content from a public URL: `fetch_content` is faster.
- Questions about why code was written: read the source.
- Checks across many URLs: write a script and run it with `bash`.
