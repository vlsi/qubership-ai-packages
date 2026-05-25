# Research title

Deep evaluation of sources for a Russian LLM skill for technical prose, developer documentation, and UI text

# Goal

This is Phase 2 of the research.

Phase 1 found no single proven off-the-shelf Russian LLM skill for technical prose. The likely best approach is to create a compact `SKILL.md` by synthesizing:

- Russian UI/localization style guides
- Russian corporate software style guides
- Russian editorial/plain-language sources
- a small LLM-prose failure-mode checklist
- mechanical linting and typography tools kept outside the skill
- Phase 2 must not repeat broad discovery. It must deeply evaluate only the shortlisted candidates below.

Deeply evaluate the shortlisted candidates below and recommend how to build the final skill.

The target is not marketing copy, SEO text, fiction, or AI-detector evasion. The target is clear, natural, technically precise Russian for software engineering contexts.

# Target domain

The final skill should support:

- technical documentation
- README files
- API docs
- code comments
- Javadoc/KDoc/docstrings translated or written in Russian
- changelog and release notes
- PR descriptions and review replies
- UI strings and UI translations
- error messages
- log messages intended for humans

The practical goal is to avoid Russian LLM prose that sounds artificial, bureaucratic, over-translated, or machine-generated while preserving technical precision.

# Shortlisted candidates from Phase 1

Do not expand the candidate list unless you find a directly relevant authoritative source that clearly beats one of the shortlisted candidates. The main task is deep evaluation, not discovery.

Deeply evaluate these candidates:

1. Microsoft Russian Localization Style Guide  
   Why shortlisted: the strongest software-specific Russian UI/localization source; likely useful for UI strings, terminology, capitalization, formats, tone, and translation rules.

2. Microsoft Writing Style Guide, Russian view if relevant  
   Why shortlisted: useful for global product voice, but English-first; evaluate only rules that transfer well into Russian technical prose.

3. Контур.Гайды: Текст / Редполитика / Текст в интерфейсе  
   Why shortlisted: rare public Russian corporate guide for software interfaces and documentation; useful for tone, clarity, UI text, and avoiding “robotic” prose.

4. Ozon Tech public styleguide and Ozon UX-editing course  
   Why shortlisted: recent public Russian software/documentation style source; likely useful for developer docs, UI text, voice and tone, interface element names, and formatting.

5. Mozilla L10n general style guide  
   Why shortlisted: software-native localization principles: accuracy, fluency, consistency, do-not-translate handling, brand and terminology rules.

6. Нора Галь, “Слово живое и мёртвое”  
   Why shortlisted: canonical source for канцелярит and dead Russian prose; directly relevant to “является”, “осуществляет”, nominalizations, passive constructions, chains of genitives, and bureaucratic style.

7. Bureau Gorbunov “Советы”, especially the “Текст” category  
   Why shortlisted: practical modern Russian editing advice with many examples; useful as an example bank, but licensing and direct-copy risks must be checked.

8. Habr Russian LLM-tells posts + Reinhart et al. PNAS 2025  
   Why shortlisted: useful for identifying LLM-generated prose patterns, but must not become AI-detector evasion advice.

9. LanguageTool Russian + yaspeller  
   Why shortlisted: mechanical spelling/grammar layer; yaspeller has maintenance risk, LanguageTool is active but may be weaker for style.

10. Типограф Муравьёва / Типограф Студии Лебедева  
    Why shortlisted: typography layer: quotes, spaces, dashes, non-breaking spaces, number formatting.

11. JetBrains Russian Language Pack / Crowdin terminology  
    Why shortlisted: potential terminology source for developer-tool UI.

# Key questions to investigate

## 1. Best base for the skill

Answer:

- Is there a single best base source?
- Should the base be Microsoft Russian Localization Style Guide, Контур, Ozon, or a synthesis?
- Which source should define the default voice?
- Which source should define UI translation rules?
- Which source should define documentation prose?
- Which source should define terminology rules?

## 2. Skill architecture

Recommend whether the final result should be:

- one monolithic Russian technical-prose skill
- a core skill plus domain modules
- separate skills, for example:
  - `ru-technical-prose`
  - `ru-ui-strings`
  - `ru-error-messages`
  - `ru-code-comments`
- one skill plus companion linter configuration
- a skill package with glossary files and examples

Consider token budget and practical agent usage. Avoid a huge style guide that the LLM will ignore.

## 3. Authoring vs editing

Recommend whether the skill should be:

- editing/rewrite-oriented
- authoring-oriented
- split into authoring, editing, and final-check sections

The immediate need is to make LLM-generated Russian technical prose sound less artificial and less bureaucratic, but the same rules should help when drafting new text.

## 4. Russian genre defaults

For each text type, recommend default tone and grammar:

- UI button labels
- menu items
- placeholders
- error messages
- warnings
- logs intended for humans
- README and tutorials
- API docs
- code comments
- Javadoc/KDoc/docstrings
- changelog and release notes
- PR descriptions
- review replies

For each type, answer:

- imperative, infinitive, impersonal, “вы”, “мы”, or neutral?
- short phrase or full sentence?
- should the text explain action, reason, consequence, or recovery?
- what should be avoided?

## 5. Канцелярит vs technical precision

Deeply evaluate which anti-канцелярит rules transfer safely into technical prose.

For each rule family, classify as:

- safe and useful
- useful with technical-context exceptions
- dangerous if applied mechanically
- should live only in a human review checklist

Rule families to evaluate:

- “является”
- “данный”
- “осуществлять”
- “производить”
- “позволяет”
- “необходимо”
- “следует”
- passive and impersonal constructions
- отглагольные существительные
- причастные and деепричастные обороты
- chains of genitives
- long noun phrases
- English calques
- “играет ключевую роль”
- “важно отметить”
- “на сегодняшний день”
- “таким образом”
- “в заключение”

Give concrete guidance: when to rewrite, when to keep, and what to rewrite into.

## 6. UI and localization strategy

Evaluate how to handle:

- source-language interference from English
- literal translations
- product terminology
- untranslated brand names and feature names
- button labels
- menu items
- placeholders
- plural forms
- variables and placeholders in translated strings
- punctuation around placeholders
- consistency between UI and docs
- “ты” vs “вы” vs neutral style
- Russian capitalization in headings and UI labels

Recommend which source is strongest for each of these.

## 7. Error messages and logs

Recommend a Russian pattern for errors and logs.

Answer:

- Should errors start with “Не удалось…”?
- When should the message name the actor?
- Should the message say what happened, why, what to do next, or all three?
- Should errors use “вы”?
- Should they apologise?
- How should technical logs differ from user-facing errors?
- How to avoid blaming the user?

Use Microsoft, Контур, Ozon, Mozilla, or other sources if they provide guidance.

## 8. LLM-specific Russian failure modes

Use Habr LLM-tells posts and research sources only as diagnostic background.

Identify which Russian LLM failure modes are credible enough to include in the skill, for example:

- overuse of long dash
- “важно отметить”
- “следует отметить”
- “таким образом”
- “в заключение”
- “играет ключевую роль”
- excessive participial constructions
- English-like sentence rhythm
- noun-heavy prose
- vague summarizing closers
- over-explaining obvious context
- mechanically parallel bullet lists
- corporate boilerplate tone

Do not turn this into AI-detector evasion. Frame it as editing for reader clarity.

## 9. LLM skill vs linter split

Recommend which rule families belong in:

1. `SKILL.md`
2. linter / CI
3. glossary / terminology file
4. optional human-review checklist

Consider:

- spelling
- ё/е policy
- typography
- quotes
- non-breaking spaces
- dash types
- repeated words
- punctuation
- terminology consistency
- product names
- UI string placeholders
- passive voice
- канцелярит
- English calques
- sentence length
- LLM-tells
- inclusive language if relevant

## 10. Maintenance and licensing

Check:

- whether the source is actively maintained
- whether the source can be cited
- whether the rules can be paraphrased into a skill
- whether examples can be copied or should only inspire original examples
- whether the source is proprietary or lacks an open license
- whether the source is safe to use as an implementation base

Do not copy proprietary guide text verbatim into the final skill.

# Required output

Produce a research report under 3500 words.

Use source URLs and cite primary sources. Prefer official docs, public repositories, and named authors.

Do not spend space on generic Russian grammar unless it affects skill design.

## 1. Executive summary

Answer directly:

- What are the top 5 sources after deep evaluation?
- Is there a single best base?
- What should be the primary base: Microsoft, Контур, Ozon, Mozilla, Нора Галь, or a synthesis?
- Should the final deliverable be one skill, split skills, or a core skill with modules?
- What should live in the skill vs in linters/glossaries?
- What is the most important risk when adapting Russian editorial rules to software prose?

## 2. Deep candidate evaluation

For each shortlisted candidate, provide a compact table with:

- name
- URL
- final disposition:
  - primary base
  - top-5 source
  - supporting source
  - background only
  - linter only
  - reject for this use case
- author / organization
- best use:
  - authoring
  - editing / rewrite
  - UI translation
  - error messages
  - terminology
  - linting / review
  - background research
- strongest contribution
- main weakness
- evidence of authority or adoption
- maintenance status
- examples available: yes / no / partial
- false-positive or awkward-output risk: low / medium / high
- portability to compact `SKILL.md`: easy / medium / hard

## 3. Recommended architecture

Describe the proposed final skill package.

Include:

- package name
- file layout
- whether to split modules
- approximate `SKILL.md` length
- whether to include examples
- whether to include glossary files
- whether to include linter configs
- how agents should decide which module to use

## 4. Rule families to port into SKILL.md

List 12–20 rule families that should become skill guidance.

For each:

- source or sources
- why it matters
- whether it applies to docs, UI, comments, errors, logs, PRs, or all
- whether it needs exceptions for technical text
- one short original example if useful

Do not copy examples verbatim from proprietary sources.

## 5. Rules to keep out of SKILL.md

List rules that should instead live in:

- LanguageTool/yaspeller/custom linter
- typograf
- glossary
- human review checklist

Explain why.

## 6. Genre defaults

Create a compact table for the main text types:

- UI button
- UI placeholder
- UI error
- developer log message
- README/tutorial
- API reference
- code comment
- docstring/Javadoc/KDoc
- changelog/release note
- PR description
- review reply

For each, recommend:

- default voice: imperative / infinitive / impersonal / “вы” / “мы” / neutral
- sentence length
- what to include
- what to avoid

## 7. High-risk contradictions

Call out contradictions between sources and recommend decisions.

Examples to check:

- Главред/инфостиль vs technical precision
- Нора Галь vs necessary technical nominalizations
- Контур/Ozon tone vs API reference neutrality
- UI imperatives vs documentation procedures
- long dash as Russian punctuation norm vs LLM overuse
- typographic correctness vs Markdown/code readability
- “необходимо/следует” as канцелярит vs normative technical requirements

## 8. Final synthesis

End with:

- recommended primary base
- secondary sources
- background-only sources
- sources to avoid as primary
- recommended next step to create the actual `SKILL.md`
- 10–15 concrete principles that the final skill should enforce
