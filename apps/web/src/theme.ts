import { colorSchemeDark, colorSchemeLight, themeQuartz } from "ag-grid-community";

const sharedParams = {
  accentColor: "var(--brand)",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  borderColor: "var(--line)",
  chromeBackgroundColor: "var(--surface)",
  fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif',
  fontSize: 12,
  rowHeight: 30,
  headerHeight: 34,
  borderRadius: 4,
  wrapperBorderRadius: 0,
  spacing: 4,
};

export const lightGridTheme = themeQuartz.withPart(colorSchemeLight).withParams(sharedParams);
export const darkGridTheme = themeQuartz.withPart(colorSchemeDark).withParams(sharedParams);
