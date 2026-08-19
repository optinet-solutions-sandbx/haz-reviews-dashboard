# Login screen — portable UI/UX spec

A complete, resolved specification for `/login`, written so another application can reproduce
it without the source repo's Tailwind v4 setup or the private token package.

**Source of truth (the SIBLING app, not this one):** `src/app/login/LoginForm.tsx`,
`page.tsx`, `actions.ts`, `sso-error.ts`, `layout.tsx`, `globals.css`, and
`node_modules/@optinet-solutions-sandbx/dashboard-ui/dist/tokens.css`.

> **How this repo relates to the document.** Supplied 2026-08-19 as the design to adopt.
> This app's implementation is `src/pages/Login.tsx`, `src/components/LoginForm.tsx` and the
> `.login-*` block in `src/index.css`. Four deliberate deviations, all recorded in
> invariant 39 of `CLAUDE.md`:
>
> 1. The heading is **Haz Reviews**, not `Trybet Dashboard` — §9 is a copy slot.
> 2. Colours resolve through `--ref-*` tokens rather than the literal hexes, so the screen
>    carries these exact values in light **and** works in this app's dark theme, which the
>    spec does not have.
> 3. The **SSO notice banner is omitted.** Its `?error=` codes come from the sibling's portal
>    SSO; this app has no portal, so those states are unreachable and the banner would be
>    dead markup.
> 4. All three §11 fixes are applied.
>
> One correction: **§8's stylesheet contradicts §5's rhythm.** `.login-error { margin: 0 }`
> ties on specificity with `.login-form > * + *` and, being later, wins — collapsing the 12px
> gap and yielding a 320px card where §5 documents 332px. The sibling is unaffected because
> Tailwind's real `space-y-3` compiles to a higher-specificity selector. This port follows §5.

> **If you are working from a screenshot:** the pale blue fill inside the Email and Password
> fields is **Chrome's autofill background** (`rgb(232, 240, 254)`), not part of the design.
> The real inputs are white with a gray border. There is an override for it in §8.

---

## 1. Page frame

| Property | Value |
| --- | --- |
| Body background | `#f5f7fb` (neutral-50) |
| Body text colour | `#232b3d` (neutral-800) |
| Min height | `100vh` |
| Font smoothing | `antialiased` (`-webkit-font-smoothing: antialiased`) |
| Card position | `margin: 64px auto 0` — horizontally centred, **not** vertically centred |

The card hanging 64px from the top rather than sitting mid-viewport is intentional, and is why
the screen looks top-weighted on a tall monitor.

## 2. Card

| Property | Value |
| --- | --- |
| Width | `max-width: 384px` (24rem), fluid below |
| Padding | `24px` all sides |
| Background | `#ffffff` |
| Border | `1px solid #e1e7f0` (neutral-200) |
| Border radius | `14px` |
| Shadow | `0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1)` |
| Rendered height | 300px in the default state |

## 3. Typography

Three Google fonts load app-wide, but **this page uses only Figtree**. Outfit (display face)
and JetBrains Mono (data face) never appear on the login screen — do not pull them in for it.

```
font-family: Figtree, system-ui, Arial, sans-serif;   /* variable font */
```

Weights needed: 400, 500, 700.

| Element | Size / line-height | Weight | Colour |
| --- | --- | --- | --- |
| `h1` (product name) | 20px / 28px | 700 | `#232b3d` (inherited) |
| Subtitle "Sign in to continue" | 14px / 20px | 400 | `#636f86` (neutral-500) |
| Field labels | 14px / 20px | 500 | `#374056` (neutral-700) |
| Input text | 14px / 20px | 400 | inherited `#232b3d` |
| Button label | 14px / 20px | 500 | `#ffffff` |
| Error / notice text | 14px / 20px | 400 | see §4 |

## 4. Palette actually used

| Token | Hex | Where |
| --- | --- | --- |
| primary-700 | `#1e2a6e` | Button fill |
| primary-800 | `#18225a` | Button hover fill |
| accent-500 | `#1c9fe0` | Input focus border + ring, global focus outline |
| accent-400 | `#4cb8ec` | Button focus ring |
| neutral-50 | `#f5f7fb` | Page background |
| neutral-200 | `#e1e7f0` | Card border |
| neutral-300 | `#cbd4e1` | Input border |
| neutral-500 | `#636f86` | Subtitle |
| neutral-700 | `#374056` | Labels |
| neutral-800 | `#232b3d` | Body text |
| danger-50 / 200 / 700 | `#fbe6e4` / `#f1b8b4` / `#a82b25` | SSO notice banner |
| danger-600 | `#c7362f` | Inline submit error |

`neutral-500` is deliberately `#636f86` rather than a lighter gray, so 14px text clears WCAG AA
on **both** white and the `#f5f7fb` page background. Do not lighten it on port.

## 5. Vertical rhythm

```
card padding-top .................. 24
h1 (28) + margin-bottom (4) ....... 32
subtitle (20) + margin-bottom (16)  36
[notice banner (36) + gap (12)] ... conditional
form (12px gap between children):
  label (20) + 4 + input (38) ..... 62
  gap ............................. 12
  label (20) + 4 + input (38) ..... 62
  gap ............................. 12
  [error text (20) + gap (12)] .... conditional
  button (36) ..................... 36
card padding-bottom ............... 24
                                  -----
                                    300
```

The conditional rows take the card to 348px (notice only), 332px (error only), or 380px (both).

## 6. Controls

### Text input — identical for email and password

| Property | Value |
| --- | --- |
| Width | `100%` (with `box-sizing: border-box`) |
| Margin above | `4px`, below its label |
| Padding | `8px 12px` |
| Border | `1px solid #cbd4e1` |
| Border radius | `6px` |
| Background | `#ffffff` |
| Height | **38px** |
| `outline` | `none` — this is what suppresses the global focus outline |
| Focus-visible | border becomes `#1c9fe0`, plus `box-shadow: 0 0 0 2px #1c9fe0` |

### Submit button

| Property | Value |
| --- | --- |
| Width | `100%` |
| Padding | `8px 12px` |
| Border | none |
| Border radius | `10px` |
| Background | `#1e2a6e`, hover `#18225a`, no transition (instant) |
| Height | **36px** |
| Disabled | `opacity: .5` |
| Focus-visible | `box-shadow: 0 0 0 2px #fff, 0 0 0 4px #4cb8ec` **and** the global `outline: 2px solid #1c9fe0; outline-offset: 2px` |

### Notice banner — SSO failure, above the form

`margin-bottom: 12px` · `padding: 8px 12px` · `border-radius: 6px` ·
`border: 1px solid #f1b8b4` · `background: #fbe6e4` · `color: #a82b25` · `role="alert"`.

### Inline error — bad credentials, between password and button

Plain text, `color: #c7362f`, `role="alert"`, no background or border.

## 7. UX behaviour

- **Submit states** — the label reads `Sign in`; while the action is pending it becomes
  `Signing in…` (U+2026 ellipsis, one character, not three dots) and the button is `disabled`.
- **Validation** — native only. Both inputs are `required`; email is `type="email"`. No
  validation library, no field-level inline errors.
- **Failed sign-in** — one generic message, `Invalid email or password.`, rendered above the
  button. It never distinguishes a wrong email from a wrong password. That is deliberate: it
  denies account enumeration. Keep it on port.
- **SSO errors** arrive as `?error=<code>` and resolve through a fixed allowlist —
  `sso`, `provision`, `session`. Anything unrecognised renders no banner, so **user input is
  never reflected into the page**. Also keep this on port.
- **Autocomplete** — `email` on the first field, `current-password` on the second.
- **Accessibility** — `<label for>` / `id` pairs on both fields; the `<form>` carries
  `aria-describedby` pointing at the error paragraph only while an error exists; both error
  surfaces are `role="alert"` so they announce when they appear.
- **Tab order** — email, password, Sign in. Nothing else is focusable.
- **Not present** — forgot-password link, show-password toggle, remember-me, social buttons,
  logo image, dark mode.

## 8. Framework-agnostic implementation

Every value resolved. No Tailwind and no token package required.

See the note at the top of this file: this repo does **not** paste the block below. It resolves
the same values through tokens so dark mode works, and it fixes the `.login-error` margin bug
described there.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;700&display=swap" rel="stylesheet">

<style>
  :root {
    --primary-700: #1e2a6e;  --primary-800: #18225a;
    --accent-400: #4cb8ec;   --accent-500: #1c9fe0;
    --neutral-50: #f5f7fb;   --neutral-200: #e1e7f0;
    --neutral-300: #cbd4e1;  --neutral-500: #636f86;
    --neutral-700: #374056;  --neutral-800: #232b3d;
    --danger-50: #fbe6e4;    --danger-200: #f1b8b4;
    --danger-600: #c7362f;   --danger-700: #a82b25;
  }

  body {
    margin: 0;
    min-height: 100vh;
    background: var(--neutral-50);
    color: var(--neutral-800);
    font-family: Figtree, system-ui, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Global focus ring for any focusable element without its own style */
  :where(a, button, input, select, textarea, [tabindex]):focus-visible {
    outline: 2px solid var(--accent-500);
    outline-offset: 2px;
  }

  .login-card {
    margin: 64px auto 0;
    max-width: 384px;
    padding: 24px;
    background: #fff;
    border: 1px solid var(--neutral-200);
    border-radius: 14px;
    box-shadow: 0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
  }

  .login-card h1 {
    margin: 0 0 4px;
    font-size: 20px;
    line-height: 28px;
    font-weight: 700;
  }

  .login-sub {
    margin: 0 0 16px;
    font-size: 14px;
    line-height: 20px;
    color: var(--neutral-500);
  }

  .login-notice {
    margin: 0 0 12px;
    padding: 8px 12px;
    border: 1px solid var(--danger-200);
    border-radius: 6px;
    background: var(--danger-50);
    color: var(--danger-700);
    font-size: 14px;
    line-height: 20px;
  }

  .login-form > * + * { margin-top: 12px; }   /* Tailwind space-y-3 */

  .login-form label {
    display: block;
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    color: var(--neutral-700);
  }

  .login-form input {
    margin-top: 4px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    border: 1px solid var(--neutral-300);
    border-radius: 6px;
    background: #fff;
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    outline: none;
  }
  .login-form input:focus-visible {
    border-color: var(--accent-500);
    box-shadow: 0 0 0 2px var(--accent-500);
  }

  .login-error {
    margin: 0;
    font-size: 14px;
    line-height: 20px;
    color: var(--danger-600);
  }

  .login-submit {
    width: 100%;
    padding: 8px 12px;
    border: 0;
    border-radius: 10px;
    background: var(--primary-700);
    color: #fff;
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    cursor: pointer;
  }
  .login-submit:hover     { background: var(--primary-800); }
  .login-submit:disabled  { opacity: .5; cursor: default; }
  .login-submit:focus-visible {
    box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--accent-400);
  }

  /* Optional: suppress Chrome's blue autofill fill */
  .login-form input:-webkit-autofill {
    -webkit-box-shadow: 0 0 0 100px #fff inset;
    -webkit-text-fill-color: var(--neutral-800);
  }
</style>

<div class="login-card">
  <h1>Trybet Dashboard</h1>
  <p class="login-sub">Sign in to continue</p>

  <!-- render only when a known SSO error code is present -->
  <p class="login-notice" role="alert">Sign-in couldn't complete. Please try again.</p>

  <form class="login-form" method="post" aria-describedby="login-form-error">
    <div>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required autocomplete="email">
    </div>
    <div>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required autocomplete="current-password">
    </div>
    <!-- render only on failed sign-in -->
    <p class="login-error" id="login-form-error" role="alert">Invalid email or password.</p>
    <button class="login-submit" type="submit">Sign in</button>
  </form>
</div>
```

## 9. Copy strings

| Slot | Text |
| --- | --- |
| Heading | product name — `Haz Reviews` in this repo |
| Subtitle | `Sign in to continue` |
| Labels | `Email`, `Password` |
| Button, idle | `Sign in` |
| Button, pending | `Signing in…` |
| Credential failure | `Invalid email or password.` |
| Notice, `?error=sso` | `Portal sign-in failed — please try again from the portal, or sign in below.` |
| Notice, `?error=provision` | `We couldn't set up your account. Please contact an admin.` |
| Notice, `?error=session` | `Sign-in couldn't complete. Please try again.` |

## 10. If you port the Tailwind classes directly instead

Two utility values are **not** Tailwind defaults — the token package overrides `--radius-lg`
and `--radius-xl`, so `rounded-lg` is **10px** (not 8px) and `rounded-xl` is **14px** (not
12px). Paste the class list into a project without those tokens and the card and button radii
come out wrong. `rounded-md` (6px) is untouched. Reference: Tailwind `4.3.0`.

## 11. Three inconsistencies worth fixing in your version

All three are fixed in this repo's port.

1. **Inputs are 38px, the button is 36px.** The inputs carry a 1px border and the button does
   not. Add `border: 1px solid transparent` to the button (or bump it to 9px vertical padding)
   if you want them flush.
2. **The button gets a double focus ring.** It has its own ring *and* inherits the global
   `outline`, because unlike the inputs it never sets `outline: none`. Pick one.
3. **Hover has no transition.** The button jumps between navy shades instantly. Add
   `transition: background-color .15s ease` if you want it smoother.
