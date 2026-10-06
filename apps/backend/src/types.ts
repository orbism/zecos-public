// Inlined in place of the never-published @zec-os/shared package.
// zec-os (frontend) consumes this backend over plain HTTP, not as a TS import,
// so there's no need for a shared npm package for 4 request/response shapes.

export interface CreateCharacterRequest {
  username: string;
  class: string;
}

export interface LoginRequest {
  characterKey: string;
}

export interface ScoreSubmitRequest {
  sessionToken: string;
  score: number;
  weekId?: string;
}

export interface ServerConfig {
  gamblingMode: 'off' | 'test' | 'live';
  characterCreationFeeZatoshis: number;
  weeklyEntryFeeZatoshis: number;
}
