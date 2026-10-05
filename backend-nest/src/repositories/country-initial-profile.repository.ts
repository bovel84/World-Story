import db from '../database';
import type { CountryInitialProfile } from '../core/simulation/CountryInitialProfile';
export interface CountryInitialProfilesSnapshot { version: 1; profiles: CountryInitialProfile[] }
/** Insert-only bootstrap authority, shared across branches. Reads never generate. */
export const countryInitialProfiles = {
  get(gameId: string, polityId: string): CountryInitialProfile | null {
    const row = db.prepare('SELECT profile_json FROM game_country_initial_profiles WHERE game_id=? AND polity_id=?').get(gameId, polityId) as { profile_json: string } | undefined;
    return row ? JSON.parse(row.profile_json) : null;
  },
  list(gameId: string): Record<string, CountryInitialProfile> {
    const rows = db.prepare('SELECT polity_id,profile_json FROM game_country_initial_profiles WHERE game_id=? ORDER BY polity_id').all(gameId) as Array<{ polity_id: string; profile_json: string }>;
    return Object.fromEntries(rows.map(r => [r.polity_id, JSON.parse(r.profile_json)]));
  },
  insertOnce(gameId: string, profile: CountryInitialProfile): CountryInitialProfile {
    db.prepare('INSERT OR IGNORE INTO game_country_initial_profiles(game_id,polity_id,profile_json) VALUES(?,?,?)').run(gameId, profile.polityId, JSON.stringify(profile));
    return this.get(gameId, profile.polityId)!;
  },
  snapshot(gameId: string): CountryInitialProfilesSnapshot { return { version: 1, profiles: Object.values(this.list(gameId)) }; },
  replaceAll(gameId: string, snapshot: CountryInitialProfilesSnapshot): void {
    db.prepare('DELETE FROM game_country_initial_profiles WHERE game_id=?').run(gameId);
    for (const profile of snapshot.profiles) this.insertOnce(gameId, profile);
  },
};
