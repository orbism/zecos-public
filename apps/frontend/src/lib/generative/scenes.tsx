/* Public build: the generative layer is not part of this distribution, so it is always off. */
export type Scene = { id: string; label: string; render: () => null };
export const SCENES: Scene[] = [];
export const sceneById = (_id: string): Scene | undefined => undefined;
export const randomScene = (): Scene => ({ id: 'none', label: 'none', render: () => null });
