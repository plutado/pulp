/**
 * Hooks the end-to-end suite drives the app by, honored only in a development
 * build. A native dialog cannot be driven from the test protocol, so a test
 * answers the folder picker through an environment variable instead; a
 * packaged app ignores it, so no variable in a person's environment can steer
 * a shipped Pulp into adding a folder it was not asked to. Pure: the main
 * process passes `app.isPackaged`, and tests pass what they like.
 */

/** The variable the end-to-end suite answers Add → Stock Library…'s folder picker with. */
export const TEST_PICK_FOLDER = 'PULP_TEST_PICK_FOLDER';

/**
 * The folder a test asked the picker to answer with, or undefined: when the app is packaged,
 * whatever the environment says; when the variable is unset or empty.
 */
export function testPickedFolder(env: Readonly<Record<string, string | undefined>>, packaged: boolean): string | undefined {
  if (packaged) return undefined;
  const picked = env[TEST_PICK_FOLDER]?.trim();
  return picked ? picked : undefined;
}
