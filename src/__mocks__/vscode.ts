/**
 * Minimal vscode module mock for unit tests.
 * Only stubs the surface area actually used by the source code under test.
 */
export const workspace = {
  workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
  fs: {
    stat: async (_uri: unknown) => {
      throw new Error('file not found (mock)');
    },
  },
};

export class Uri {
  static file(path: string) {
    return { fsPath: path, scheme: 'file', path };
  }
}
