# Phase 2 Evaluation: Sources for a Compact Russian LLM Skill (Technical Prose, Dev Docs, UI)

## TL;DR
- **No single source is sufficient; build a synthesis with Контур.Гайды as the default-voice base, Microsoft Russian Localization Style Guide as the UI/terminology authority, and Mozilla L10n + Ozon Tech as supporting documentation/localization sources.** Нора Галь and Habr LLM-tells posts provide editing principles, never wholesale rules.
- **Architecture: core `SKILL.md` (~900 lines) + 3 thin domain modules (ui-strings, errors-logs, code-comments) + companion linter config (yaspeller + LanguageTool ru-RU + typograf.js) + a small glossary.** Orient the skill toward *editing/rewriting* with a short authoring section — most LLM output will pass through it as a finisher.
- **Biggest adaptation risk: dogmatic Главред/инфостиль and Нора Галь rules will strip necessary technical nominalizations and normative modal verbs («необходимо», «следует») from API references, RFC-style specs, and changelogs.** The skill must encode explicit exceptions for technical genres or it will damage precision.

## Key Findings

**The shortlist holds; one candidate gets demoted.** All 11 candidates remain relevant, but JetBrains Russian Language Pack should be reclassified from "potential terminology source" to "background reference only": the JetBrains Marketplace currently lists at least five competing third-party Russian packs (plugin IDs 24544, 26495, 27350, 27449, 29935 on plugins.jetbrains.com) with no canonical maintained translation and no published terminology base. It is not citable as authoritative.

**yaspeller is archived but still works.** The repository hcodes/yaspeller is marked "Public archive" on GitHub; latest release v10.0.1, released 12 November 2023 (v10.0.0 on 11 November 2023); the repository was archived by owner on 24 April 2024 and is now read-only per github.com/hcodes/yaspeller/releases; npm lists it as "last published: 2 years ago." Snyk classifies maintenance as "Inactive." It still functions via the Yandex.Speller API and remains the de-facto Russian text linter for Markdown CI — but pin it and treat it as legacy infrastructure, not an evolving rule source.

**LanguageTool ru-RU has exactly 930 rules** per community.languagetool.org/rule/list?lang=ru-RU (page title: "Browse LanguageTool Rules: 930 matches for Russian"). language-ru v6.6 was released 27 March 2025 (last tagged non-snapshot release; published to Maven Central on 9 April 2025); from v6.6 onward LanguageTool switched to daily snapshot releases only. Official LanguageTool docs classify Russian as "spelling and (limited) grammar checks" — it catches typography and basic agreement but is not a stylistic editor. Use it as a deterministic safety net, not as the skill's voice.

**Reinhart et al. 2025 (PNAS 122(8) e2422455122; arxiv.org/abs/2410.16107) gives empirical, citable LLM-tells in English.** The paper identifies four grammatical features that instruction-tuned LLMs overproduce relative to humans, with paired Cohen's *d* effect sizes for GPT-4o: present participial clauses (5.3× human rate, d=1.38), nominalizations (2.1×, d=1.23), "that"-clauses as subject (2.6×, d=0.77), and phrasal coordination (1.9×, d=0.81). Verbatim: *"Instruction tuning, rather than training the models to write even more like humans, instead trains them in a particular informationally dense, noun-heavy style."* This validates the core skill premise: LLMs default to канцелярит-adjacent style, and editing toward verb-led, varied prose is *not* detector evasion — it is restoring genre fit.

**Important debunk**: the often-cited "10.62 em-dashes per 1000 words" attribution to Reinhart (e.g., in the Habr post habr.com/ru/articles/1022906/) is **not in Reinhart's main text** — the paper does not report em-dash frequencies. The em-dash signal is folklore-strength, not peer-reviewed strength. Treat it accordingly.

**Контур.Гайды are the strongest Russian-software editorial base, but they are intentionally not a documentation style guide.** guides.kontur.ru/principles/text/styleguide/ explicitly scopes itself to UI: «текст — элемент интерфейса, как кнопка или поле ввода». Their full Редполитика (linked from `in.kontur.ru/communications/more-redact`) is inside Контур's internal portal, partially closed. Public Контур pages are excellent for *интерфейсные тексты* but thin on API docs.

**Ozon Tech now has TWO complementary public resources**: docs.ozon.ru/styleguide (the technical writers' guide by Аня Салугина, published 3 March 2025 on Habr at habr.com/ru/companies/ozontech/articles/883502/ — sections: Голос и тон, Слова и названия элементов интерфейса, Орфография/пунктуация/символы, Синтаксис, Структура документации, Оформление текста, Визуальные элементы) and Кира Калимулина's Figma UX-text guide (figma.com/ozon-guide). This is the closest thing to a complete public Russian dev-docs + UI-text pair, and the docs.ozon.ru one is explicitly modelled on Google Developer Documentation Style Guide + Microsoft Writing Style Guide.

## Details

### Deep candidate evaluation

| # | Source | URL | Disposition | Best use | Strongest contribution | Main weakness | Maintenance | FP risk | Portability |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Microsoft Russian Localization Style Guide | download.microsoft.com/download/c/8/a/c8ab1532-…/rus-rus-StyleGuide.pdf | **Primary base — UI/terminology** | UI strings, terminology, «вы» address, date/time/number formats, capitalization | Hundreds of pages of resolved Russian software-UI decisions used across Windows/Office | PDF, infrequent updates; English source-language framing | Periodic refresh on learn.microsoft.com/ru-ru/globalization/reference/microsoft-style-guides | Low | Medium (paraphrase only — proprietary) |
| 2 | Microsoft Writing Style Guide | learn.microsoft.com/en-us/style-guide/welcome/ | **Top-5 — voice principles** | English voice rules portable to Russian: "warm and relaxed, crisp and clear," sentence-style capitalization, second person, short sentences | Sets the meta-rule that tech writing should sound human | English-centric; do not transplant title-case to Russian | Active | Low | Easy |
| 3 | Контур.Гайды (Текст / Редполитика / Интерфейс) | guides.kontur.ru/principles/text/styleguide/ | **Primary base — default voice** | Tone, UI text, modal/error patterns | Cleanest stated UI-error pattern (заголовок → подробности → что делать); explicit warning against Главред maximalism: «не пытайтесь… получить 10 баллов по шкале Главреда» | Deeper Редполитика behind in.kontur.ru auth wall; public pages scoped to UI | Actively maintained; per-page auto-generated update date | Low–medium | Easy (paraphrase) |
| 4 | Ozon styleguide + Figma + Habr | docs.ozon.ru/styleguide/, figma.com/ozon-guide, habr.com/ru/companies/ozontech/articles/883502/ + /821383/ | **Primary base — documentation prose** | Tech-writer style; explicit «нейтральный обучающий тон, вежливый и сдержанный, но не формальный»; element-naming conventions (bold for clickable, quotes for non-clickable) | Only public Russian software style guide that covers docs + UI + API in one ecosystem | Newer (2024–2025), less battle-tested; Figma format awkward for parsing | Active, public since 2025 | Low | Easy |
| 5 | Mozilla L10n styleguides | mozilla-l10n.github.io/styleguides/, github.com/mozilla-l10n/styleguides | **Top-5 — l10n principles** | Tone register choice, do-not-translate criteria, capitalization handling, plurals | No Russian-specific page in the public repo | CC-BY-SA 4.0; active repo | Low | Easy — license allows excerpt or paraphrase |
| 6 | Нора Галь, «Слово живое и мёртвое» | vavilon.ru/noragal/slovo.html | **Top-5 — editing principles only** | Definitive description of канцелярит: «вытеснение глагола… причастием, деепричастием, существительным (особенно отглагольным!), а значит — застойность, неподвижность» | Reference text for *literary translation*, not software | Public text widely reproduced | High if applied mechanically to technical text | Medium (extract principles, not examples) |
| 7 | Bureau Gorbunov «Советы» | bureau.ru/soviet/ | **Supporting — inspire only** | 4 770+ short Q&A on text, typography, UI | No public CC license; «Принципы бюро» (bureau.ru/soviet/selected/artem-gorbunov/printsipy-byuro/) signals strict editorial control. Direct-copy risk is HIGH | Active | Medium | Hard — inspire only, do not copy text |
| 8a | Reinhart et al. 2025 PNAS | pnas.org/doi/10.1073/pnas.2422455122; preprint arxiv.org/abs/2410.16107 | **Top-5 — empirical LLM-tells** | Quantified grammatical overproduction by instruction-tuned LLMs | English-only corpus; transfer to Russian is conceptual | Peer-reviewed | Low (as principles) | Easy |
| 8b | Habr LLM-tells corpus | habr.com/ru/articles/1022906/, /967428/, /1033450/, /918226/ | **Supporting — Russian-specific anecdotal** | Russian markers: «играет ключевую роль», «важно отметить», «таким образом», parallel triples, formulaic concluding paragraph | Anecdotal, not peer-reviewed; some claims (em-dash 10.62/1000) mis-attributed to Reinhart | Active | Medium | Easy |
| 9a | yaspeller | github.com/hcodes/yaspeller | **Linter only** | Russian spelling/typo CI for Markdown via Yandex.Speller API | Repo archived 24 April 2024; Yandex API dependency | Inactive but functional (v10.0.1, 12 Nov 2023) | Low | n/a |
| 9b | LanguageTool ru-RU | community.languagetool.org/?lang=ru-RU | **Linter only** | 930 ru-RU rules; punctuation, agreement, repeated words | "Limited grammar" support per dev.languagetool.org/languages | Active (language-ru v6.6, 9 Apr 2025, then daily snapshots) | Medium (false positives in code-mixed text) | n/a |
| 10a | Типограф Муравьёва + typograf.js | mdash.ru, github.com/typograf/typograf, npmjs.com/package/typograf | **Linter only** | Quotes, dashes, NBSP, number formats | Original mdash last meaningful update ~2014; the typograf npm package is the maintained successor | mdash.ru API live; typograf npm active | Low | n/a |
| 10b | Типограф Студии Лебедева | artlebedev.ru/typograf/ | **Linter only** | XML web-service since 2000 | Closed-source, third-party API dependency | Hosted, no SLA | Low | n/a |
| 11 | JetBrains Russian Language Pack | plugins.jetbrains.com (5 competing plugins) | **Reject as authoritative; background** | Could illustrate developer-tool UI terminology | No single canonical pack; fragmented | Varies by plugin | n/a | n/a |

### Recommended skill architecture

**Package name:** `ru-tech-prose` (or `claude-skill-ru-tech`).

```
ru-tech-prose/
├── SKILL.md                # core (~900 lines, ~6–7k tokens)
├── modules/
│   ├── ui-strings.md       # ~250 lines: buttons, placeholders, labels
│   ├── errors-logs.md      # ~200 lines: error patterns, log conventions
│   └── code-comments.md    # ~150 lines: doc-comments, KDoc/Javadoc/docstrings, PR/review
├── glossary.md             # ~300 EN→RU canonical terms
├── examples/               # 40–60 before/after pairs
└── lint/
    ├── .yaspellerrc.json
    ├── languagetool.cfg
    └── typograf.config.js
```

**Split decision:** core + modules + linter, NOT separate skills. Rationale: most edits touch multiple genres in one PR (README + UI string + error message). A monolithic skill bloats the prompt; fully separate skills lose shared voice. Modules are conditionally loaded by the agent based on file type (`.po`, `.json`, `.md`, source code).

**Agent decision rule (encoded in SKILL.md):**
- `.md`/`.rst`/`.adoc` → core + (if `CHANGELOG` in path) errors-logs module.
- `.json`/`.po`/`.xliff`/`.properties` → core + ui-strings module.
- Source code (`.py`/`.kt`/`.java`/`.ts`) → core + code-comments module.
- Detected stack trace / log line / error-message string → errors-logs module.

**Orientation:** editing/rewrite with a thin authoring section. ~70% of skill content is rewrite rules (X → Y with rationale). Authoring = a short "default voice" preamble + 10 patterns. Final-check = a 12-item checklist. This matches how the skill will be used: LLMs produce drafts; the skill is a finisher.

### Rule families to PORT into SKILL.md (15)

| # | Rule family | Source(s) | Scope | Technical exceptions |
|---|---|---|---|---|
| 1 | Address user as «вы» (lowercase) | Microsoft ru style guide; Unbabel ru guidelines; WordPress.com ru guide | all | None |
| 2 | Sentence-case headings/UI labels (not title-case) | Microsoft Writing Style Guide; Mozilla L10n | docs, UI | Proper nouns, products |
| 3 | Verb-led sentences; replace nominalization chains | Нора Галь; Reinhart 2025 (nominalizations 2.1× human rate); Контур «Понятные предложения» | docs, PR, comments | Keep domain-term nominalizations («сериализация», «валидация») |
| 4 | «Является» → strong verb or zero-copula | Нора Галь; Главред stop-words | all | Keep in formal API spec when «X является подклассом Y» is genuinely cleanest |
| 5 | «Данный» → «этот» or drop | Нора Галь; Контур Редполитика | all | None |
| 6 | «Осуществлять / производить» → concrete verb | Нора Галь; Главред | all | None |
| 7 | «Необходимо/следует» — keep ONLY for normative requirements (RFC MUST/SHOULD) | Нора Галь (critic); IETF/RFC ru translations | docs, API ref | Keep in specs, security warnings, compliance |
| 8 | Imperative for UI actions; infinitive for menu items | Microsoft ru localization guide; docs.ozon.ru/styleguide | UI, docs | None |
| 9 | Error pattern: «Не удалось <X>» → cause → recovery | Контур (Текст в интерфейсе → ошибки); Microsoft ru; Mozilla L10n | errors, UI | Logs may invert order (technical first) |
| 10 | Avoid blaming user; describe state not fault | Контур; Microsoft Writing Style Guide tone | errors, UI | None |
| 11 | Don't translate product names, code identifiers, CLI flags, file paths | Mozilla L10n; Microsoft ru; Ozon styleguide | all | None |
| 12 | «…»; «лапки „…"» for nested; em-dash «—» with surrounding spaces; NBSP after one-letter prepositions and before dashes | typograf rules (mdash.ru); typograf npm | docs, UI | Plain ASCII inside code blocks, regex, JSON strings |
| 13 | Limit em-dash density and parallel triples in summative sentences | Reinhart 2025 ("grandiose, if hollow, summative sentences"); Habr 1022906, 1033450 | docs, PR, README | Rewrite, do not delete dashes mechanically |
| 14 | Cut closer formulas «таким образом», «в заключение», «важно отметить», «следует отметить», «играет ключевую роль», «на сегодняшний день» | Habr LLM-tells corpus; Главред; Нора Галь | docs, PR, README, release notes | Scientific paper translations where «в заключение» maps to "Conclusion" section |
| 15 | Plural forms via ICU MessageFormat or Project Fluent | Mozilla L10n; Microsoft ru; Fluent docs | UI strings | None |

### Rules to KEEP OUT of SKILL.md

| Belongs in | Rules | Why |
|---|---|---|
| **yaspeller / LanguageTool / spellcheck CI** | typos, ё/е consistency, repeated words, basic agreement, common confusions | Deterministic, cheap, no LLM judgment needed |
| **Типограф / typograf.js pipeline** | quote replacement, dash conversion, NBSP, number-unit binding, «г.» after years | Mechanical; running the LLM here is waste |
| **Glossary file** | EN→RU canonical translations for product terms ("API", "endpoint", "feature flag", "merge request") | LLM will drift; glossary is source of truth |
| **Human-review checklist** | inclusive language, ToV compliance for branded products, legal phrasing | Out-of-scope; varies per company |
| **Custom team linter** | banned-words lists, capitalization of specific feature names | Product-specific, ages quickly |

### Genre defaults table

| Genre | Voice | Length | Include | Avoid |
|---|---|---|---|---|
| UI button | Imperative, no period | 1–3 words | Verb of action: «Сохранить», «Отправить» | Politeness hedges; «Пожалуйста»; gerunds |
| UI placeholder | Noun/short noun phrase, sentence-case, no period | 1–4 words | Example or hint: «Имя файла» | Full sentences; "Введите…" prefix unless ambiguous |
| UI error (user-facing) | Impersonal/infinitive heading «Не удалось…» + sentence body | 1 heading + 1–2 sentences | What failed, why, recovery | Blame; stack traces; «Извините» |
| Developer log message | Past-tense impersonal or infinitive | One line | Component, action, identifiers, error code | UI politeness; «вы» |
| README / tutorial | «Вы»; imperative for steps | 10–18 words/sentence | Goal, prerequisites, numbered steps | First-person plural «мы» for procedures |
| API reference | Neutral impersonal; present tense | Short, declarative | Parameter, type, default, returns, throws | «Является», «данный»; emotive adjectives |
| Code comment (inline) | Impersonal, often noun phrase | ≤1 line | Why, not what | Restating the code |
| Docstring / Javadoc / KDoc | Impersonal; first sentence is a summary | First sentence ≤15 words | Purpose, params, returns, throws, since | Marketing tone |
| Changelog / release note | Past tense, third person, bullet | Fragmented | Verb-led bullet: «Добавили», «Исправили», «Удалили» | «Является» copulas; «мы рады сообщить» |
| PR description | First-person plural OK; concise prose | Short paragraphs | What, why, how to test, risk | Long preambles; «В рамках данной задачи» |
| Review reply | «Вы» or neutral; collegial | 1–3 sentences | Specific suggestion or accept | Sarcasm; bureaucratic hedges |

### High-risk contradictions and resolutions

| Contradiction | Resolution |
|---|---|
| Главред/инфостиль vs technical precision | **Override Главред in API refs and specs.** Контур itself warns against 10/10 Главред scores. Set explicit "do not optimize for Главред" rule. |
| Нора Галь (no nominalizations) vs domain terms | **Keep nominalizations that are terms** («сериализация», «инициализация», «авторизация»). Rewrite only chains of three+ genitives or empty action nouns («осуществление выполнения»). |
| Контур/Ozon friendly tone vs API reference neutrality | **Tone modulates by module.** Core voice = «вежливый и сдержанный, но не формальный» (Ozon's phrasing). API reference module = strictly neutral. UI module = closer to Контур. |
| UI imperative vs documentation procedure verbs | **UI = imperative («Сохранить»); docs = imperative for steps, noun-led for descriptions.** Microsoft ru and Ozon align. |
| Long em-dash as Russian norm vs LLM overuse | **Keep em-dashes; cap density.** Rule: rewrite when ≥2 em-dashes in one sentence or ≥1 per sentence average across a paragraph. Per Reinhart 2025, the deeper LLM tell is *parallel-triple summative sentences*, not the dash itself. |
| Typographic correctness vs Markdown/code readability | **Skip typograf inside fenced code blocks, inline code, link targets, YAML/JSON strings.** typograf npm supports safe-tag rules for this. |
| «Необходимо/следует» as канцелярит vs normative requirements | **Whitelist for spec/security context.** Inside `### Требования`, `### Security`, RFC sections — keep modals. Elsewhere prefer imperative or concrete verb. |

### Final synthesis

**Recommended primary base:** synthesis of Контур.Гайды (default voice + UI error patterns) + Microsoft Russian Localization Style Guide (terminology, formats, capitalization, «вы») + Ozon docs.ozon.ru/styleguide (documentation prose structure and element-naming) + Mozilla L10n general (l10n meta-rules and plurals).

**Secondary:** Reinhart 2025 PNAS + Habr LLM-tells (1022906, 967428, 1033450) — for the "what NOT to do" section.

**Background only:** Нора Галь (principles, not rules), Bureau Gorbunov Советы (inspire-only — proprietary), Microsoft Writing Style Guide (English meta-principles).

**Sources to avoid as primary:** JetBrains language packs (fragmented), Главред in isolation (over-optimizes), any single Типограф as the *style* authority (it's a pipe stage).

**15 concrete principles the final skill should enforce:**

1. Default address is «вы» (lowercase), with the pronoun dropped when grammatically optional.
2. Headings, UI labels, and changelog bullets are sentence-case.
3. Lead with verbs in body prose. Rewrite «X является Y» / «осуществляется Y-ом» → «X — это Y» / verb form.
4. Keep domain nominalizations; cut empty ones.
5. Errors follow «Не удалось <X>» + cause + recovery. Never blame the user.
6. UI buttons are imperatives, 1–3 words. Placeholders are noun phrases.
7. Product names, CLI flags, code identifiers, file paths: do not translate, do not decline, do not put in quotes.
8. Russian quotes «…»; em-dashes «—» with surrounding spaces; non-breaking spaces after one-letter prepositions; numbers and units bound by NBSP; ё restored where it disambiguates.
9. Plurals via ICU/Fluent only; never hard-code 1/N forms.
10. Cut these LLM closers unless they earn their place: «таким образом», «в заключение», «важно отметить», «следует отметить», «играет ключевую роль», «на сегодняшний день», parallel triples, summative final paragraphs.
11. Limit em-dash density and parallel coordinations in summative sentences (Reinhart 2025: phrasal coordination 1.9× human rate, present participles 5.3×).
12. Keep modal verbs «необходимо», «следует», «должен» in normative/spec/security contexts; replace elsewhere.
13. Skip typography normalization inside code/JSON/regex.
14. Capitalize Russian product/feature names by the product's own convention; do not invent capitalization.
15. Voice is «вежливый и сдержанный, но не формальный» (Ozon Tech's phrasing) — short sentences, second person, no jargon-for-jargon's sake, no marketing adjectives.

## Recommendations

**Stage 1 (week 1):** Build `SKILL.md` core with the 15 rule families above, drafted from Контур + Microsoft ru + Ozon docs.ozon.ru. Write ~30 before/after example pairs (10 docs, 10 UI, 10 errors). **Benchmark to advance:** the skill correctly rewrites ≥80% of a held-out test set of 50 obvious LLM-Russian samples (drawn from Habr 1022906 examples plus your own corpus).

**Stage 2 (week 2):** Add ui-strings, errors-logs, code-comments modules. Add glossary (start at 50 terms, grow). Wire yaspeller + LanguageTool ru-RU + typograf into CI as the non-LLM safety net. **Benchmark:** zero typograf/yaspeller errors on the skill's own examples; <5% false-positive rate on a 200-sample real-PR corpus.

**Stage 3 (week 3+):** A/B test the skill against an unguided LLM on real PR descriptions and changelogs from one repo. Track: subjective reviewer ratings, Reinhart-style feature counts (nominalization rate, present-participle rate, em-dash density per 1000 tokens). **Threshold to ship:** ≥0.5 σ improvement on Reinhart features and ≥70% reviewer preference.

**Trigger to reorganize from monolith to split skills:** if `SKILL.md` core exceeds ~1500 lines or if UI/docs voice contradictions appear in real use, split into `ru-docs-prose` and `ru-ui-text` as separate skills sharing the glossary.

**Trigger to retire yaspeller:** if Yandex.Speller API becomes unreliable or the archived repo breaks against current Node LTS — switch to LanguageTool-only spelling.

## Caveats

- **Microsoft Russian Localization Style Guide is proprietary.** The PDF on download.microsoft.com is free to read; rules can be paraphrased but verbatim text cannot be redistributed. Do not paste sections into SKILL.md.
- **Bureau Gorbunov «Советы» content is proprietary** and the site has no public CC license. Use as background inspiration, never copy.
- **Контур Редполитика is partially behind in.kontur.ru auth.** Only public guides.kontur.ru pages are confirmed citable.
- **Reinhart 2025 findings are English-only**; transfer to Russian is conceptually sound but not directly validated by the paper. Russian-specific evidence is anecdotal (Habr posts), not peer-reviewed.
- **The "em-dash 10.62/1000 words" claim circulating on Habr is not in Reinhart's main text** — treat as folklore until a primary source is found.
- **yaspeller is archived** (24 April 2024). Pin the version, mirror the Yandex.Speller dependency if you need long-term reproducibility.
- **JetBrains Russian translations are fragmented** across multiple competing third-party packs; do not treat any single one as authoritative IDE terminology.
- **The skill is for clarity and genre fit, not for AI-detector evasion.** Reinhart 2025 explicitly notes their classifiers reach 93–98% accuracy on pairwise human-vs-LLM tasks; editing toward natural Russian is editorial good practice, not a defense against detection.
