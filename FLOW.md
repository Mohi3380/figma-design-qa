# Design QA — How It Works

**In one line:** You give it two things — your **Figma design** and your **live website** — and it gives you back a **report** of every place the build doesn't match the design.

---

## The big picture

```mermaid
flowchart LR
    A["🎨 Figma Design<br/>(paste the frame link)"] --> P
    B["🌐 Live Website<br/>(paste the page URL)"] --> P
    P["⚙️ Design QA Engine"] --> R["📄 Report<br/>PDF · HTML · JSON"]

    style A fill:#E8F0FE,stroke:#4285F4,color:#1a1a1a
    style B fill:#E8F0FE,stroke:#4285F4,color:#1a1a1a
    style P fill:#1a73e8,stroke:#1a73e8,color:#ffffff
    style R fill:#E6F4EA,stroke:#34A853,color:#1a1a1a
```

> **Two URLs in, one report out.** No setup per page, no manual screenshots.

---

## What happens inside (step by step)

```mermaid
flowchart TD
    Start([Start: Figma link + Website URL])

    Start --> S1["1 · Read the design<br/><i>Pull the exact layout, colors,<br/>text & sizes from Figma</i>"]
    Start --> S2["2 · Capture the live site<br/><i>Open the real page in a browser,<br/>record every element & a screenshot</i>"]

    S1 --> S3["3 · Match them up<br/><i>Pair each design element with<br/>its counterpart on the live site</i>"]
    S2 --> S3

    S3 --> S4["4 · Spot the differences<br/><i>Compare color, size, position,<br/>spacing, text & fonts</i>"]
    S4 --> S5["5 · Visual proof<br/><i>Overlay screenshots and<br/>highlight the mismatched areas</i>"]
    S5 --> S6["6 · AI double-check<br/><i>AI reviews each finding and filters<br/>out false alarms, rates severity</i>"]
    S6 --> Out([📄 Report: every issue, ranked by severity,<br/>with side-by-side evidence])

    style Start fill:#E8F0FE,stroke:#4285F4,color:#1a1a1a
    style Out fill:#E6F4EA,stroke:#34A853,color:#1a1a1a
    style S6 fill:#FEF7E0,stroke:#FBBC04,color:#1a1a1a
```

| # | Step | In plain words | What you get |
|---|------|----------------|--------------|
| 1 | **Read the design** | Pulls layout, colors, text, fonts and sizes straight from your Figma frame | The "source of truth" |
| 2 | **Capture the live site** | Opens the real page in a real browser and records every element + a screenshot | The "as built" snapshot |
| 3 | **Match them up** | Pairs each design element with the one on the live page | Knows what to compare to what |
| 4 | **Spot the differences** | Checks color, size, position, spacing, text and typography | A list of mismatches |
| 5 | **Visual proof** | Highlights the exact areas that look wrong on a screenshot | Side-by-side evidence |
| 6 | **AI double-check** | AI confirms real problems vs. noise and ranks how serious each is | A trustworthy, prioritized report |

---

## How issues are graded

Each finding is ranked so your team fixes what matters first:

```mermaid
flowchart LR
    C["🔴 Critical<br/>Element missing<br/>or badly broken"]
    H["🟠 High<br/>Clearly wrong<br/>color / size / text"]
    M["🟡 Medium<br/>Noticeable but<br/>minor drift"]
    L["⚪ Low / Info<br/>Tiny, often<br/>cosmetic"]
    C --> H --> M --> L

    style C fill:#FCE8E6,stroke:#EA4335,color:#1a1a1a
    style H fill:#FEEFE3,stroke:#FA903E,color:#1a1a1a
    style M fill:#FEF7E0,stroke:#FBBC04,color:#1a1a1a
    style L fill:#F1F3F4,stroke:#9AA0A6,color:#1a1a1a
```

---

## Where it fits in your workflow

```mermaid
flowchart LR
    D["Designer<br/>finishes Figma"] --> Dev["Developer<br/>builds the page"]
    Dev --> QA["Design QA<br/>runs the check"]
    QA -->|"differences found"| Fix["Developer<br/>fixes & re-runs"]
    Fix --> QA
    QA -->|"matches the design ✅"| Ship["Ship it"]

    style QA fill:#1a73e8,stroke:#1a73e8,color:#ffffff
    style Ship fill:#E6F4EA,stroke:#34A853,color:#1a1a1a
```

It can run **on demand** (a person clicks "run") or **automatically** as part of the release process, blocking a release if serious mismatches are found.

---

### Plain-text version (for slides / email)

```
   FIGMA DESIGN ─┐
                 ├──►  [ DESIGN QA ENGINE ]  ──►  REPORT (PDF / HTML / JSON)
   LIVE WEBSITE ─┘

   Inside the engine:
   1. Read the design   →  2. Capture the live site
                  \           /
                   ▼         ▼
   3. Match elements  →  4. Compare (color · size · position · text · fonts)
                            ▼
   5. Highlight differences on screenshots
                            ▼
   6. AI filters false alarms + ranks severity
                            ▼
      REPORT: issues ranked Critical → High → Medium → Low, with evidence
```
