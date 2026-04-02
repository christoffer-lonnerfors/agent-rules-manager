import * as vscode from 'vscode';
import { RuleIndex } from './index/ruleIndex';
import { ScannerService } from './scanner/scannerService';
import { RuleTreeProvider, DivergedRuleDecorationProvider } from './views/ruleTreeProvider';

export function activate(context: vscode.ExtensionContext) {
  // Initialize core services
  const ruleIndex = new RuleIndex(context);
  const scannerService = new ScannerService(ruleIndex);
  const treeProvider = new RuleTreeProvider(ruleIndex);
  treeProvider.setExtensionPath(context.extensionPath);

  // Load persisted index from last session
  ruleIndex.load();

  // Register divergence decoration provider
  const divergedDecoProvider = new DivergedRuleDecorationProvider();
  const decoRegistration = vscode.window.registerFileDecorationProvider(divergedDecoProvider);

  // Register TreeView
  const treeView = vscode.window.createTreeView('aiRulesScanner.rulesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register commands
  const scanCmd = vscode.commands.registerCommand('aiRulesScanner.scan', async () => {
    await scannerService.scan();
  });

  const rescanCmd = vscode.commands.registerCommand('aiRulesScanner.rescan', async () => {
    await scannerService.scan();
  });

  const openRuleCmd = vscode.commands.registerCommand(
    'aiRulesScanner.openRule',
    async (filePath: string) => {
      if (filePath) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri);
      }
    }
  );

  // Push all disposables
  context.subscriptions.push(
    treeView,
    scanCmd,
    rescanCmd,
    openRuleCmd,
    ruleIndex,
    scannerService,
    treeProvider,
    divergedDecoProvider,
    decoRegistration,
  );
}

export function deactivate() {
  // Nothing to clean up — disposables handle it
}

