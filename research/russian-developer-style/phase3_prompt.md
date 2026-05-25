Create a Russian technical-prose agent skill package based on the attached Phase 2 research report.

Goal:
Create a practical `ru-tech-prose` skill for writing and editing Russian software-facing prose.

Primary use:
- editing and rewriting LLM-generated Russian technical prose
- secondary use: authoring new Russian docs, UI strings, comments, PR text, changelog entries, error messages, and human-readable logs

The skill must optimize for:
- clear, natural Russian
- technical precision
- consistent software terminology
- genre-appropriate tone
- reduced bureaucratic / machine-translated / LLM-like prose

The skill must NOT optimize for:
- AI-detector evasion
- marketing copy
- fiction style
- generic “Главред 10/10”
- stripping technical precision for the sake of “инфостиль”

Use the Phase 2 report as the main source of truth.

## Source priorities

Use these sources as the conceptual base, in this order:

1. Контур.Гайды
   - default voice
   - UI text
   - error-message structure
   - warning against dogmatic Главред-style editing

2. Microsoft Russian Localization Style Guide
   - UI terminology
   - Russian localization conventions
   - address style: lowercase «вы»
   - capitalization, date/time/number formats
   - software UI wording

3. Ozon Tech styleguide
   - Russian documentation prose
   - neutral teaching tone
   - docs structure
   - naming UI elements in docs
   - syntax and formatting rules

4. Mozilla L10n general guide
   - accuracy, fluency, consistency
   - do-not-translate rules
   - product names, placeholders, plurals

5. Нора Галь
   - канцелярит diagnostics
   - verb-led prose
   - nominalization and passive-construction warnings
   - use only as editing principles, not as strict bans

6. Reinhart et al. 2025 + Habr LLM-tells posts
   - LLM-style failure modes
   - noun-heavy prose
   - participial constructions
   - formulaic closers
   - overuse of long dash and parallel triples
   - use as diagnostic background, not detector-evasion rules

Do not copy proprietary source text verbatim. Paraphrase rules and create original examples.

## Create this file layout

Create:

```text
ru-tech-prose/
├── SKILL.md
├── modules/
│   ├── ui-strings.md
│   ├── errors-logs.md
│   └── code-comments.md
├── glossary.md
├── examples/
│   └── before-after.md
└── lint/
    ├── .yaspellerrc.json
    ├── languagetool.cfg
    └── typograf.config.js
````

If the target repository has a different skills layout, adapt the paths but keep the same logical structure.

## SKILL.md requirements

Create a complete `SKILL.md` with YAML frontmatter.

Suggested frontmatter:

```yaml
---
name: ru-tech-prose
description: Russian technical-prose conventions for software documentation, README files, UI strings, error messages, logs, code comments, PR descriptions, changelog entries, and Russian localization. Use when writing, editing, translating, or reviewing Russian software-facing prose. Focuses on clear natural Russian, technical precision, terminology consistency, and avoiding bureaucratic or LLM-like phrasing.
---
```

Keep `SKILL.md` compact but usable:

* target length: about 2500–4000 words
* do not create a huge style guide
* include short rules and original before/after examples
* make it editing/rewrite-oriented, with a small authoring section
* use Russian for the skill body unless a technical term is clearer in English
* explain when to load the optional modules

## SKILL.md structure

Use this structure:

1. Когда применять
2. Базовый стиль
3. Жанровые настройки
4. Редактура LLM-черновиков
5. Канцелярит без догматизма
6. Терминология и непереводимые элементы
7. UI-строки
8. Ошибки и логи
9. Комментарии в коде и docstrings
10. Что оставить линтерам
11. Финальный чеклист
12. Когда нарушать правила

## Core rules to include

Include these rule families.

### Voice and tone

Default voice:

* вежливо и сдержанно, но не формально
* ясно, технически точно, без маркетинговой окраски
* помогать пользователю выполнить действие
* не звучать как корпоративный регламент

Default address:

* use lowercase «вы» where direct address is needed
* drop the pronoun where Russian sounds more natural
* avoid switching between «вы», «мы», and impersonal style within one text

### Genre defaults

Encode these defaults:

* UI button: imperative, 1–3 words, no period: «Сохранить», «Удалить», «Повторить»
* UI placeholder: noun phrase or short hint, no full sentence unless needed
* UI error: «Не удалось <действие>» + cause + recovery
* developer log: technical, compact, no politeness, include identifiers
* README/tutorial: direct instructions, short paragraphs, consistent «вы» or neutral style
* API reference: neutral present tense, precise terms, no friendly filler
* code comment: explain why, not what the code already says
* docstring/Javadoc/KDoc: first sentence summarizes purpose; then params/returns/errors
* changelog/release note: verb-led bullets: «Добавили», «Исправили», «Удалили»
* PR description: what changed, why, how tested, risks
* review reply: specific, collegial, no sarcasm, no bureaucratic hedges

### Editing LLM-like Russian

Add rules to rewrite or question:

* «важно отметить»
* «следует отметить»
* «таким образом»
* «в заключение»
* «на сегодняшний день»
* «играет ключевую роль»
* «является»
* «данный»
* «осуществлять»
* «производить»
* excessive «позволяет»
* long participial and adverbial-participial constructions
* chains of genitives
* empty nominalizations
* mechanically parallel triples
* excessive long dashes
* generic final summary paragraphs that add no information

But avoid blanket bans. For each rule, say what to do instead.

### Канцелярит vs technical precision

Make this explicit:

* Do not mechanically remove technical nominalizations such as «сериализация», «инициализация», «аутентификация», «валидация», «конфигурация».
* Rewrite empty action nouns and bureaucratic shells.
* Keep «необходимо», «следует», «должен» in normative, security, compatibility, and specification contexts.
* Replace them in ordinary instructions when a direct imperative is clearer.
* Passive and impersonal constructions are allowed when the actor is irrelevant or unknown.

### Long dash policy

Russian uses long dashes naturally, so do not ban them.

Rules:

* keep a dash when it is normal Russian punctuation
* rewrite if a paragraph uses dashes as a repeated rhythm device
* rewrite if one sentence has two or more long dashes
* prefer colon for definitions and list introductions
* do not use dash as a universal connector
* never change dashes inside code, CLI examples, JSON, YAML, regexes, or file paths

### UI and localization

Include rules for:

* do not translate product names, CLI flags, code identifiers, file paths, API names, environment variables
* do not decline code tokens or put them in Russian quotation marks
* preserve placeholders and variables exactly
* handle plural forms via ICU MessageFormat / Fluent / project mechanism, not by hard-coded Russian strings
* sentence-case Russian headings and labels
* avoid English calques when a natural Russian UI phrase exists
* distinguish button labels, menu items, placeholders, tooltips, warnings, and errors

### Error messages and logs

Use this pattern:

1. What failed.
2. Why, if known.
3. What the user or operator can do next.

Examples:

* Bad: «Ошибка при выполнении операции»
* Better: «Не удалось сохранить файл. Проверьте права доступа и повторите попытку.»
* Bad: «Вы ввели некорректное значение»
* Better: «Значение не подходит. Укажите порт от 1 до 65535.»

For logs:

* prefer technical clarity over empathy
* include identifiers
* avoid «вы»
* do not hide the cause behind generic text

### Code comments and docstrings

Rules:

* comments explain intent, invariant, workaround, compatibility reason, or non-obvious behavior
* do not translate code identifiers
* do not restate code
* keep comments short
* avoid literary editing if the comment is already precise
* for public API docs, use stable terminology and neutral tone

### Linter split

Make clear that these belong outside SKILL.md:

* spelling
* ё/е policy
* repeated words
* basic grammar
* quote conversion
* non-breaking spaces
* dash conversion
* number-unit spacing
* product-specific terminology
* glossary enforcement
* placeholder validation
* ICU plural validation

Mention suggested tools:

* LanguageTool ru-RU
* yaspeller, pinned/forked because upstream is archived
* typograf.js
* custom glossary checks

## Modules

### modules/ui-strings.md

Create a focused module for UI and localization.

Include:

* buttons
* labels
* menu items
* placeholders
* tooltips
* empty states
* confirmations
* plural forms
* placeholders and variables
* terminology consistency
* examples of bad literal translation from English

### modules/errors-logs.md

Create a focused module for:

* user-facing errors
* warnings
* validation messages
* operational logs
* developer-facing diagnostic messages

Include:

* error pattern
* warning pattern
* validation message pattern
* log message pattern
* what to include / avoid
* examples

### modules/code-comments.md

Create a focused module for:

* inline comments
* docstrings
* Javadoc/KDoc/TSDoc
* README snippets
* PR descriptions
* review replies

Include:

* explain why, not what
* summary sentence rules
* parameter/return/error descriptions
* review tone
* examples

## glossary.md

Create a starter glossary with about 50 software terms.

Columns:

* English
* Russian
* Notes
* Translate? yes/no/contextual

Include terms such as:

* API
* endpoint
* request
* response
* payload
* header
* cookie
* token
* session
* cache
* queue
* topic
* partition
* broker
* cluster
* node
* replica
* primary
* standby
* failover
* rollback
* migration
* feature flag
* configuration
* setting
* option
* property
* parameter
* argument
* environment variable
* log
* trace
* span
* metric
* timeout
* retry
* backoff
* transaction
* connection pool
* driver
* plugin
* extension
* build
* release
* changelog
* pull request / merge request

Do not invent product-specific terminology. Mark uncertain translations as contextual.

## examples/before-after.md

Create 30–40 original before/after examples:

* 8 documentation examples
* 8 UI examples
* 8 error/log examples
* 6 code comment/docstring examples
* 4 PR/changelog examples

Examples should be compact and realistic.
Do not copy examples from proprietary sources.

Use this format:

```markdown
### Example: <topic>

Bad:
> ...

Better:
> ...

Why:
- ...
```

## lint configs

Create starter configs, but keep them conservative.

### lint/.yaspellerrc.json

Use a minimal config suitable for Markdown and Russian text.
Add comments in adjacent README text if JSON cannot contain comments.
Account for technical terms via dictionary or ignore list.

### lint/languagetool.cfg

Create a placeholder config or documented command usage for LanguageTool ru-RU.
Include guidance that LanguageTool has false positives in code-mixed technical prose.

### lint/typograf.config.js

Create a typograf.js config that:

* enables Russian typography
* avoids processing code blocks and inline code where possible
* preserves JSON/YAML/regex/code examples
* handles quotes, dashes, NBSP, number-unit spacing

If exact config APIs are uncertain, create a clearly marked starter template rather than pretending it is complete.

## Quality constraints

* Keep the skill practical. Do not write a textbook.
* Prefer short rules with examples.
* Avoid dogmatic bans.
* Preserve technical precision.
* Do not copy proprietary source text verbatim.
* Do not cite sources inside the skill unless the repository convention allows that.
* Do not overfit to Habr LLM-tell posts.
* Do not create rules that exist only to evade AI detectors.
* Make the skill usable by a coding agent editing real files.

## After creating the files

Report:

1. Which files were created.
2. Which rules from Phase 2 were encoded.
3. Which rules were intentionally left to linters/glossary.
4. Any assumptions or uncertainties.
5. Suggested next test: run the skill on 5–10 real Russian docs/UI strings and inspect the diff.
