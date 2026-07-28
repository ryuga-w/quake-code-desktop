# Localization

Quake Code supports Turkish and English in the renderer. The selected language
is stored under `quake-web:locale` as `auto`, `tr`, or `en`.

- `auto` follows the system/browser language (Turkish when a `tr-*` locale is
  present; English otherwise).
- `tr` and `en` force the interface language.
- The resolved language updates `<html lang>` and the Electron application
  menu. Electron keeps a small validated mirror in its user-data directory so
  its menu has the right language before the renderer finishes loading.

## Adding UI copy

1. Add matching keys to both `tr` and `en` in
   `src/client/src/i18n/index.tsx`.
2. Read text in a React component with `const { t } = useI18n()`.
3. Use `t("section.key")` for visible text, labels, titles, empty states, and
   confirmation messages. For variables, use named values such as
   `t("section.itemCount", { count })`.
4. Use `localeForIntl(locale)` for dates, numbers, and locale-aware sort or
   case operations. Do not hard-code `tr-TR` in renderer UI.

Keep protocol values, API identifiers, model IDs, and persisted enum values
language-neutral; only translate their displayed labels. New source tests
should assert translation keys or rendered behavior instead of literal Turkish
copy, so both languages remain valid.

The English message tree is checked against the Turkish tree at TypeScript
compile time, so a missing or misspelled English key fails `npm run typecheck`.
