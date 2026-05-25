/* global require, module, process, console */
// typograf — стартовая конфигурация для русской developer-документации.
//
// ВНИМАНИЕ: точные имена правил typograf.js менялись между мажорными
// версиями. Перед раскаткой в CI сверьте имена в актуальной документации
// своей версии (https://github.com/typograf/typograf) и прогоните на
// 5–10 реальных файлах вашего репозитория.
//
// Этот файл — шаблон, а не «готовый к продакшну» конфиг.
//
// Принципы:
//   - включаем русскую типографику (кавычки-«ёлочки», тире, неразрывные пробелы);
//   - выключаем правила, портящие код и форматные строки;
//   - НЕ запускаем typograf на исходниках кода — только на Markdown и текстовых
//     файлах с предварительно вырезанными code-блоками.

'use strict';

const Typograf = require('typograf');

const tp = new Typograf({
  locale: ['ru', 'en-US'],
  htmlEntity: { type: 'name' },
});

// Включить группу русских правил.
tp.enableRule('ru/*');

// Отключить агрессивные правила, ломающие developer-текст.
const disabled = [
  // не превращать ASCII-эквиваленты внутри code-блоков;
  // safest: вырезать ```...``` и `...` ДО прогона через typograf.
  'common/punctuation/quote',
  // не вмешиваться в стрелки -> и =>: они часто часть кода/документации.
  'common/symbols/arrow',
];

disabled.forEach((rule) => {
  try {
    tp.disableRule(rule);
  } catch {
    // Имя правила может отличаться в вашей версии — это ок.
  }
});

// Защита code-блоков и inline-кода от обработки.
// typograf не умеет нативно понимать Markdown, поэтому вырезаем
// fenced и inline code до прогона и возвращаем после.

function protect(text) {
  const placeholders = [];
  const fenced = /```[\s\S]*?```/g;
  const inline = /`[^`\n]+`/g;

  function stash(match) {
    placeholders.push(match);
    return ` TYPOGRAF_${placeholders.length - 1} `;
  }

  const stripped = text.replace(fenced, stash).replace(inline, stash);
  return { stripped, placeholders };
}

function restore(text, placeholders) {
  return text.replace(/ TYPOGRAF_(\d+) /g, (_match, index) => placeholders[+index]);
}

function processMarkdown(markdown) {
  const { stripped, placeholders } = protect(markdown);
  const typed = tp.execute(stripped);
  return restore(typed, placeholders);
}

module.exports = { tp, process: processMarkdown };

// CLI-вход для одиночного файла:
//   node typograf.config.js path/to/file.md
if (require.main === module) {
  const fs = require('fs');
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node typograf.config.js <file.md>');
    process.exit(2);
  }
  const text = fs.readFileSync(file, 'utf8');
  process.stdout.write(processMarkdown(text));
}
