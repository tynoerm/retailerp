import { queryRows } from "./crud";
import { defaultSettings, type Settings } from "./settings-defaults";

export { defaultSettings, type Settings };

export async function getSettings(): Promise<Settings> {
  const rows = await queryRows<{ setting_key: string; setting_value: string }>(
    "SELECT setting_key, setting_value FROM settings"
  );

  const saved = Object.fromEntries(
    rows
      .filter((row) => row.setting_key in defaultSettings)
      .map((row) => [row.setting_key, JSON.parse(row.setting_value)])
  );

  return { ...defaultSettings, ...saved };
}
