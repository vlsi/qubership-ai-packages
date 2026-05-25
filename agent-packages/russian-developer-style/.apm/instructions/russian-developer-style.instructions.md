---
description: Russian-language style rules for developer-facing text — docs, comments, commits, PR descriptions, changelogs, UI strings, error and log messages, .po/.properties/JSON localisation. Triggered by review/translate/verify/proofread, not only writing.
applyTo: "**"
---


## Skill trigger: `russian-developer-style`

**You MUST invoke the `russian-developer-style` skill BEFORE producing, modifying, translating,
or critiquing any Russian developer-facing text.** The skill applies regardless of text length —
a one-line error message and a multi-page README go through the same checklist.

### Trigger verbs

The skill fires on any of these tasks. The verb in the user request, not the file size, decides.

- **EN:** write, edit, rewrite, translate, localise, review, proofread, verify, audit,
  double-check, sanity-check, cross-check.
- **RU:** напиши, перепиши, переведи, локализуй, отредактируй, поправь, проверь, перепроверь,
  сверь, отревью, отрецензируй, прочитай и поправь, посмотри перевод.

If the user asks about Russian text in any of these modes — even a human-authored translation,
even a five-word UI string — invoke the skill before answering.

### Covered surfaces

- Markdown: README, документация, design docs, ADR, changelog, release notes.
- Localisation files: `.po`, `.pot`, `.properties`, `.resx`, `.json` (i18n), `.ftl`, `.arb`.
- UI strings: кнопки, подписи, плейсхолдеры, tooltips, пустые состояния, подтверждения.
- Сообщения об ошибках, валидациях, варнингах и логах (включая однострочные `msgstr`).
- Комментарии в коде, docstring, Javadoc, KDoc, TSDoc.
- Сообщения коммитов, описания PR/MR, ответы на ревью.

Short messages count. A single `msgstr "..."` in a `.po` file is in scope.

### When NOT to invoke

- Идентификаторы кода, имена продуктов, флаги CLI, пути файлов, переменные окружения — оставляйте как есть.
- Сгенерированный API-reference и цитаты из третьих лиц.
- Файлы с явной отметкой «не редактировать» или с собственным стилевым гайдом в репозитории —
  уступайте локальному руководству.

### Failure mode to avoid

Если запрос пользователя касается русского текста и скилл не вызван — остановитесь и вызовите
его перед тем, как продолжить. Знание языка «и так» не заменяет скилл: глоссарий, шаблоны жанров,
политика канцелярита и длинного тире фиксируются скиллом, а не общей эрудицией.
